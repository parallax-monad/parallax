import {
  type CheckSwapRequest,
  convertAtomicAmountToHuman,
  type QuoteRequest,
  quoteResultSchema,
  runResultSchema,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { bootstrapBackendApp } from "../bootstrap/backend.js";
import {
  normalizeArbitrumOneCheckSwapRequest,
  normalizeQuoteRequestForChain,
} from "../normalization.js";
import type { QuoteAgentFlowPort } from "../ports.js";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  bootstrapBackendRuntime,
} from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import { createArbitrumOneLocalForkCheckFlow } from "./arbitrum-one-local-fork-check.js";
import { createArbitrumOneQuoteFlow } from "./arbitrum-one-quote.js";
import {
  createNativeRpcClient,
  NativeRpcClientError,
} from "./native-rpc-client.js";

const sender = "0x1111111111111111111111111111111111111111";
const concurrentSender = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"ab".repeat(32)}`;
const nativeGasHeadroomAtomic = 1_000_000_000_000_000_000n;
const uint256Max = (1n << 256n) - 1n;
const sourceBlockNumber = "7";
const sourceBlockTag = "0x7";
const quoteRequest: QuoteRequest = {
  chainId: ARBITRUM_ONE_CHAIN_ID,
  protocol: "camelot-v3",
  sender,
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address,
  },
  amountIn: "0.001",
};
const tokenRegistry = {
  chains: [{ chainId: ARBITRUM_ONE_CHAIN_ID, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: ARBITRUM_ONE_CHAIN_ID,
      address: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.address,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "6",
    },
  ],
};

const localForkInstanceId = "00000000-0000-4000-8000-000000000001";
const localForkEnvironment = {
  MONAD_RPC_URL: "https://monad.example.test",
  ARBITRUM_ONE_RPC_URL: "https://arbitrum-one.example.test",
  NODE_ENV: "development",
  ARBITRUM_ONE_LOCAL_FORK_CHECK_ENABLED: "true",
  ARBITRUM_ONE_FORK_LOCAL_RPC_URL: "http://127.0.0.1:8545",
  ARBITRUM_ONE_FORK_INSTANCE_ID: localForkInstanceId,
  MOSS_RUNTIME_VERSION: "test-runtime",
  MOSS_RUNTIME_REVISION: "test-revision",
};

function createRuntime(
  input: { rpcUrl?: string; tokenSymbol?: string; tokenDecimals?: number } = {},
) {
  return bootstrapBackendRuntime({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      ...(input.rpcUrl === undefined
        ? { ARBITRUM_ONE_RPC_URL: "https://arbitrum-one.example.test" }
        : input.rpcUrl === ""
          ? {}
          : { ARBITRUM_ONE_RPC_URL: input.rpcUrl }),
      MOSS_RUNTIME_VERSION: "test-runtime",
      MOSS_RUNTIME_REVISION: "test-revision",
    },
    tokenRegistry: {
      ...tokenRegistry,
      tokens: [
        {
          ...tokenRegistry.tokens[0],
          ...(input.tokenSymbol === undefined
            ? {}
            : { symbol: input.tokenSymbol }),
          ...(input.tokenDecimals === undefined
            ? {}
            : { decimals: input.tokenDecimals }),
        },
      ],
    },
  });
}

type RpcCall = {
  method: string;
  params: readonly unknown[];
  timeoutMs?: number;
};
type RpcResponder = (
  method: string,
  params: readonly unknown[],
  callIndex: number,
) => unknown | Promise<unknown>;

function createRpc(responder?: RpcResponder) {
  const calls: RpcCall[] = [];
  const rpcClient: ArbitrumRpcClient = {
    async request(method, params = [], options) {
      calls.push({ method, params, timeoutMs: options?.timeoutMs });
      if (responder !== undefined) {
        return responder(method, params, calls.length - 1);
      }
      return defaultRpcResponse(method, params);
    },
  };
  return { rpcClient, calls };
}

type LocalForkRpcOptions = {
  forkInstanceId?: string;
  clientVersion?: string;
  chainId?: string;
  accounts?: unknown;
  blockNumber?: string;
  postSimulationBlockNumber?: string;
  blockHash?: string;
  callError?: Error;
  gasEstimateError?: Error;
  prestateError?: Error;
  stateOverrideError?: Error;
  stateDumpError?: Error;
  revertResult?: unknown;
  senderUsdcBalanceAtomic?: bigint;
  senderUsdcBalanceAfterNativeOverrideAtomic?: bigint;
  simulatedRecipientBalanceAtomic?: bigint;
};

const recipientBalanceSlot = `0x${"22".repeat(32)}`;
const poolBalanceSlot = `0x${"11".repeat(32)}`;
const poolBalanceBefore = 1_000_000_000n;
const poolBalanceAfter = poolBalanceBefore - 2_413_423n;
const simulatedRecipientBalance = 2_413_423n;

function storageWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function createLocalForkRpc(options: LocalForkRpcOptions = {}) {
  const calls: RpcCall[] = [];
  const balances = new Map<string, string>();
  const snapshots = new Map<
    string,
    {
      readonly balances: Map<string, string>;
      readonly stateRevision: number;
      readonly senderUsdcBalanceAtomic: bigint;
    }
  >();
  let snapshotId = 0;
  let stateRevision = 0;
  let blockNumberCalls = 0;
  let senderUsdcBalanceAtomic = options.senderUsdcBalanceAtomic ?? 0n;
  const usdcAddress =
    ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase();
  const rpcClient: ArbitrumRpcClient = {
    async request(method, params = [], operationOptions) {
      calls.push({ method, params, timeoutMs: operationOptions?.timeoutMs });
      switch (method) {
        case "parallax_forkInstanceId":
          return options.forkInstanceId ?? localForkInstanceId;
        case "web3_clientVersion":
          return options.clientVersion ?? "anvil/v1.8.5 (test build)";
        case "eth_chainId":
          return options.chainId ?? "0x7a69";
        case "eth_accounts":
          return options.accounts ?? [];
        case "eth_blockNumber": {
          blockNumberCalls += 1;
          return options.postSimulationBlockNumber !== undefined &&
            blockNumberCalls >= 3
            ? options.postSimulationBlockNumber
            : (options.blockNumber ?? sourceBlockTag);
        }
        case "eth_getBlockByNumber":
          return {
            number: options.blockNumber ?? sourceBlockTag,
            hash: options.blockHash ?? blockHash,
            timestamp: "0x6ad3c5b0",
          };
        case "eth_getCode":
          return "0x6000";
        case "eth_getBalance": {
          const address = String(params[0]).toLowerCase();
          return params[1] === "latest"
            ? (balances.get(address) ?? "0x0")
            : "0x0";
        }
        case "eth_getStorageAt": {
          const slot = String(params[1]).toLowerCase();
          if (slot === poolBalanceSlot) return storageWord(poolBalanceBefore);
          if (slot === recipientBalanceSlot) {
            return storageWord(senderUsdcBalanceAtomic);
          }
          return storageWord(0n);
        }
        case "evm_snapshot": {
          snapshotId += 1;
          const id = `0x${snapshotId.toString(16)}`;
          snapshots.set(id, {
            balances: new Map(balances),
            stateRevision,
            senderUsdcBalanceAtomic,
          });
          return id;
        }
        case "anvil_setBalance": {
          const address = String(params[0]).toLowerCase();
          balances.set(address, String(params[1]));
          if (
            address === sender.toLowerCase() &&
            options.senderUsdcBalanceAfterNativeOverrideAtomic !== undefined
          ) {
            senderUsdcBalanceAtomic =
              options.senderUsdcBalanceAfterNativeOverrideAtomic;
          }
          stateRevision += 1;
          return null;
        }
        case "anvil_dumpState":
          if (options.stateDumpError !== undefined) {
            throw options.stateDumpError;
          }
          return stateRevision === 0 ? "0x00" : "0x01";
        case "eth_call": {
          const call = params[0] as { to?: unknown; data?: unknown };
          const to = typeof call?.to === "string" ? call.to.toLowerCase() : "";
          const data = typeof call?.data === "string" ? call.data : "";
          if (params[2] !== undefined) {
            if (options.stateOverrideError !== undefined) {
              throw options.stateOverrideError;
            }
            const overrides = params[2] as Record<
              string,
              { stateDiff?: Record<string, string> }
            >;
            const tokenOverride = Object.entries(overrides).find(
              ([address]) => address.toLowerCase() === usdcAddress,
            )?.[1];
            const recipientValue =
              tokenOverride?.stateDiff?.[recipientBalanceSlot];
            return storageWord(
              recipientValue === undefined ? 0n : BigInt(recipientValue),
            );
          }
          if (
            to === usdcAddress &&
            data.slice(0, 10).toLowerCase() === "0x70a08231"
          ) {
            const queriedAddress = `0x${data.slice(-40)}`.toLowerCase();
            return storageWord(
              queriedAddress === sender.toLowerCase()
                ? senderUsdcBalanceAtomic
                : 0n,
            );
          }
          if (options.callError !== undefined) throw options.callError;
          return "0x";
        }
        case "eth_estimateGas":
          if (options.gasEstimateError !== undefined)
            throw options.gasEstimateError;
          return "0x5208";
        case "debug_traceCall":
          if (options.prestateError !== undefined) throw options.prestateError;
          return {
            pre: {
              [ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress]: {
                balance: "0x0",
                code: "0x6000",
                nonce: 0,
                storage: {
                  [poolBalanceSlot]: storageWord(poolBalanceBefore),
                  [recipientBalanceSlot]: storageWord(senderUsdcBalanceAtomic),
                },
              },
            },
            post: {
              [ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress]: {
                storage: {
                  [poolBalanceSlot]: storageWord(poolBalanceAfter),
                  [recipientBalanceSlot]: storageWord(
                    senderUsdcBalanceAtomic +
                      (options.simulatedRecipientBalanceAtomic ??
                        simulatedRecipientBalance),
                  ),
                },
              },
            },
          };
        case "evm_revert": {
          if (options.revertResult === false) return false;
          const id = String(params[0]);
          const snapshot = snapshots.get(id);
          if (snapshot === undefined) return false;
          balances.clear();
          for (const [address, balance] of snapshot.balances) {
            balances.set(address, balance);
          }
          stateRevision = snapshot.stateRevision;
          senderUsdcBalanceAtomic = snapshot.senderUsdcBalanceAtomic;
          return true;
        }
        default:
          throw new Error(`Unexpected local fork RPC method: ${method}`);
      }
    },
  };
  return { rpcClient, calls };
}

function createRpcError(code: number, message: string): Error {
  return Object.assign(new Error(message), { rpcCode: code });
}

function createConcurrentLocalForkRpc() {
  const calls: RpcCall[] = [];
  const usdcAddress =
    ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase();
  const initialBalances = new Map([
    [sender.toLowerCase(), "0x64"],
    [concurrentSender.toLowerCase(), "0xc8"],
  ]);
  const balances = new Map(initialBalances);
  const snapshots = new Map<string, Map<string, string>>();
  const observations: Array<{
    sender: string;
    firstSenderBalance: string | undefined;
    secondSenderBalance: string | undefined;
  }> = [];
  let snapshotId = 0;
  let transactionCallCount = 0;
  let baseBalanceReadCount = 0;
  let resolveFirstCallStarted!: () => void;
  let resolveBothBaseBalancesRead!: () => void;
  let releaseFirstCall!: () => void;
  const firstCallStarted = new Promise<void>((resolve) => {
    resolveFirstCallStarted = resolve;
  });
  const bothBaseBalancesRead = new Promise<void>((resolve) => {
    resolveBothBaseBalancesRead = resolve;
  });
  const firstCallGate = new Promise<void>((resolve) => {
    releaseFirstCall = resolve;
  });
  const rpcClient: ArbitrumRpcClient = {
    async request(method, params = [], operationOptions) {
      calls.push({ method, params, timeoutMs: operationOptions?.timeoutMs });
      switch (method) {
        case "parallax_forkInstanceId":
          return localForkInstanceId;
        case "web3_clientVersion":
          return "anvil/v1.8.5 (test build)";
        case "eth_chainId":
          return "0x7a69";
        case "eth_accounts":
          return [];
        case "eth_blockNumber":
          return sourceBlockTag;
        case "eth_getBlockByNumber":
          return {
            number: sourceBlockTag,
            hash: blockHash,
            timestamp: "0x6ad3c5b0",
          };
        case "eth_getCode":
          return "0x6000";
        case "eth_getBalance": {
          const address = String(params[0]).toLowerCase();
          if (params[1] === "latest") return balances.get(address) ?? "0x0";
          baseBalanceReadCount += 1;
          if (baseBalanceReadCount === 2) resolveBothBaseBalancesRead();
          return initialBalances.get(address) ?? "0x0";
        }
        case "evm_snapshot": {
          snapshotId += 1;
          const id = `0x${snapshotId.toString(16)}`;
          snapshots.set(id, new Map(balances));
          return id;
        }
        case "anvil_setBalance":
          balances.set(String(params[0]).toLowerCase(), String(params[1]));
          return true;
        case "eth_call": {
          const transaction = params[0] as {
            from?: string;
            to?: string;
            data?: string;
          };
          if (transaction.to?.toLowerCase() === usdcAddress) {
            return storageWord(0n);
          }
          transactionCallCount += 1;
          observations.push({
            sender: transaction.from?.toLowerCase() ?? "",
            firstSenderBalance: balances.get(sender.toLowerCase()),
            secondSenderBalance: balances.get(concurrentSender.toLowerCase()),
          });
          if (transactionCallCount === 1) {
            resolveFirstCallStarted();
            await firstCallGate;
          }
          return "0x";
        }
        case "eth_estimateGas":
          return "0x5208";
        case "evm_revert": {
          const id = String(params[0]);
          const snapshot = snapshots.get(id);
          if (snapshot === undefined) return false;
          balances.clear();
          for (const [address, balance] of snapshot) {
            balances.set(address, balance);
          }
          const revertedId = BigInt(id);
          for (const existingId of snapshots.keys()) {
            if (BigInt(existingId) >= revertedId) snapshots.delete(existingId);
          }
          return true;
        }
        default:
          throw new Error(`Unexpected local fork RPC method: ${method}`);
      }
    },
  };
  return {
    rpcClient,
    calls,
    initialBalances,
    balances,
    observations,
    firstCallStarted,
    bothBaseBalancesRead,
    releaseFirstCall,
  };
}

function defaultRpcResponse(
  method: string,
  params: readonly unknown[],
): unknown {
  if (method === "eth_chainId") return "0xa4b1";
  if (method === "eth_blockNumber") return sourceBlockTag;
  if (method === "eth_getBlockByNumber") {
    return {
      number: sourceBlockTag,
      hash: blockHash,
      timestamp: "0x6ad3c5b0",
    };
  }
  if (method === "eth_getCode") return "0x6000";
  if (method === "eth_call") {
    const call = params[0] as { to: string; data: string };
    const address = call.to.toLowerCase();
    const selector = call.data.slice(2, 10).toLowerCase();
    if (selector === "95d89b41") {
      return encodeString(
        address ===
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress.toLowerCase()
          ? "WETH"
          : "USDC",
      );
    }
    if (selector === "313ce567") {
      return `0x${encodeUint(
        address ===
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress.toLowerCase()
          ? 18n
          : 6n,
      )}`;
    }
    if (selector === "0dfe1681") {
      return encodeAddress(
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
      );
    }
    if (selector === "d21220a7") {
      return encodeAddress(
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
      );
    }
    if (selector === "1a686502") return `0x${encodeUint(100n)}`;
    if (selector === "2d9ebd1d")
      return `0x${encodeUint(2_413_423n)}${encodeUint(500n)}`;
  }
  throw new Error(`Unexpected RPC method ${method}`);
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodeAddress(value: string): string {
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

function encodeString(value: string): string {
  const hex = Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const paddedLength = Math.ceil(hex.length / 64) * 64;
  return `0x${encodeUint(32n)}${encodeUint(BigInt(value.length))}${hex.padEnd(paddedLength, "0")}`;
}

function createQuoteInput(runtime = createRuntime()) {
  const normalized = normalizeQuoteRequestForChain(
    quoteRequest,
    runtime.tokenRegistry,
    ARBITRUM_ONE_CHAIN_ID,
  );
  if (!normalized.success)
    throw new Error("Test quote request did not normalize");
  return {
    runId: "quote-test",
    intent: normalized.intent,
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    moss: runtime.config.moss,
  };
}

function createQuoteApp(arbitrumOneQuoteFlow: QuoteAgentFlowPort) {
  return bootstrapBackendApp({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      NODE_ENV: "production",
      ARBITRUM_ONE_RPC_URL: "https://arbitrum-one.example.test",
      MOSS_RUNTIME_VERSION: "test-runtime",
      MOSS_RUNTIME_REVISION: "test-revision",
    },
    tokenRegistry,
    store: new InMemoryRunStore(),
    arbitrumOneQuoteFlow,
  });
}

function createLocalRuntime() {
  return bootstrapBackendRuntime({
    environment: localForkEnvironment,
    tokenRegistry,
  });
}

function createLocalCheckInput(
  runtime = createLocalRuntime(),
  options: {
    amountIn?: string;
    minimumReceived?: string;
    sender?: string;
  } = {},
) {
  const request: CheckSwapRequest = {
    ...quoteRequest,
    sender: options.sender ?? quoteRequest.sender,
    amountIn: options.amountIn ?? quoteRequest.amountIn,
    economicBoundary:
      options.minimumReceived === undefined
        ? { availability: "unavailable", source: "unavailable" }
        : {
            availability: "available",
            minimumReceived: options.minimumReceived,
            source: "user_declared",
          },
  };
  const normalized = normalizeArbitrumOneCheckSwapRequest(
    request,
    runtime.tokenRegistry,
  );
  if (!normalized.success)
    throw new Error("Test local-fork check request did not normalize");
  return {
    runId: "local-fork-check-test",
    intent: normalized.intent,
    executionPurpose: "primary" as const,
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    moss: runtime.config.moss,
  };
}

function createLocalCheckFixture(
  rpcOptions: LocalForkRpcOptions = {},
  checkOptions: {
    amountIn?: string;
    minimumReceived?: string;
    sender?: string;
  } = {},
) {
  const runtime = createLocalRuntime();
  const source = createRpc();
  const local = createLocalForkRpc(rpcOptions);
  const flow = createArbitrumOneLocalForkCheckFlow(runtime, {
    sourceRpcClient: source.rpcClient,
    localRpcClient: local.rpcClient,
    now: () => new Date("2026-10-17T19:17:33.990Z"),
  });
  return {
    runtime,
    source,
    local,
    flow,
    input: createLocalCheckInput(runtime, checkOptions),
  };
}

type NativeRpcErrorPayload = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

function encodeErrorString(reason: string): string {
  const reasonBytes = new TextEncoder().encode(reason);
  const reasonHex = Array.from(reasonBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const paddedLength = Math.ceil(reasonBytes.length / 32) * 64;
  return `0x08c379a0${32n.toString(16).padStart(64, "0")}${BigInt(reasonBytes.length).toString(16).padStart(64, "0")}${reasonHex.padEnd(paddedLength, "0")}`;
}

function createNativeLocalForkFetch(
  options: {
    readonly callError?: NativeRpcErrorPayload;
    readonly gasEstimateError?: NativeRpcErrorPayload;
  } = {},
) {
  const methods: string[] = [];
  let nativeBalance = "0x0";
  const fetchImplementation: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: readonly unknown[];
    };
    methods.push(request.method);
    if (request.method === "anvil_setBalance") {
      nativeBalance = String(request.params[1]);
    }
    if (request.method === "evm_revert") nativeBalance = "0x0";

    const resultByMethod: Record<string, unknown> = {
      parallax_forkInstanceId: localForkInstanceId,
      web3_clientVersion: "anvil/v1.8.5 (test build)",
      eth_chainId: "0x7a69",
      eth_accounts: [],
      eth_blockNumber: sourceBlockTag,
      eth_getBlockByNumber: {
        number: sourceBlockTag,
        hash: blockHash,
        timestamp: "0x6ad3c5b0",
      },
      eth_getCode: "0x6000",
      eth_getBalance: request.params[1] === "latest" ? nativeBalance : "0x0",
      evm_snapshot: "0x1",
      anvil_setBalance: null,
      eth_estimateGas: "0x5208",
      evm_revert: true,
    };
    const call = request.params[0] as
      | { to?: unknown; data?: unknown }
      | undefined;
    const isBalanceOfCall =
      typeof call?.to === "string" &&
      call.to.toLowerCase() ===
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase() &&
      typeof call.data === "string" &&
      call.data.slice(0, 10).toLowerCase() === "0x70a08231";
    const rpcError =
      request.method === "eth_call" && !isBalanceOfCall
        ? options.callError
        : request.method === "eth_estimateGas"
          ? options.gasEstimateError
          : undefined;
    const responseBody =
      request.method === "eth_call" && isBalanceOfCall
        ? {
            jsonrpc: "2.0",
            id: request.id,
            result: storageWord(0n),
          }
        : rpcError === undefined
          ? {
              jsonrpc: "2.0",
              id: request.id,
              result: resultByMethod[request.method],
            }
          : {
              jsonrpc: "2.0",
              id: request.id,
              error: rpcError,
            };
    return new Response(JSON.stringify(responseBody), { status: 200 });
  };
  return { methods, fetchImplementation };
}

function findSenderUsdcBalanceReadIndexes(calls: readonly RpcCall[]): number[] {
  const usdcAddress =
    ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase();
  return calls.flatMap((call, index) => {
    if (call.method !== "eth_call") return [];
    const balanceCall = call.params[0] as
      | { to?: unknown; data?: unknown }
      | undefined;
    if (
      typeof balanceCall?.to !== "string" ||
      balanceCall.to.toLowerCase() !== usdcAddress ||
      typeof balanceCall.data !== "string" ||
      balanceCall.data.slice(0, 10).toLowerCase() !== "0x70a08231" ||
      balanceCall.data.slice(-40).toLowerCase() !==
        sender.slice(2).toLowerCase()
    ) {
      return [];
    }
    return [index];
  });
}

function createLocalCheckApp(
  flow: ReturnType<typeof createArbitrumOneLocalForkCheckFlow>,
) {
  return bootstrapBackendApp({
    environment: localForkEnvironment,
    tokenRegistry,
    store: new InMemoryRunStore(),
    arbitrumOneLocalForkCheckFlow: flow,
  });
}

describe("Arbitrum One Camelot pinned quote flow", () => {
  it("returns the exact ETH-to-USDC quote with complete source provenance", async () => {
    const runtime = createRuntime();
    const { rpcClient } = createRpc();
    const flow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });

    const result = quoteResultSchema.parse(
      await flow.quote(createQuoteInput(runtime)),
    );

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.quote).toMatchObject({
      estimatedAmountOut: "2.413423",
      blockNumber: sourceBlockNumber,
      fetchedAt: "2026-10-17T19:17:33.990Z",
      provenance: {
        version: 1,
        profileId: "arbitrum-one-camelot-v3",
        sourceChainId: ARBITRUM_ONE_CHAIN_ID,
        sourceBlock: {
          number: sourceBlockNumber,
          hash: blockHash,
          timestamp: BigInt("0x6ad3c5b0").toString(),
          observedAt: "2026-10-17T19:17:33.990Z",
        },
        amountInAtomic: "1000000000000000",
        amountOutAtomic: "2413423",
        route: {
          kind: "direct",
          protocol: "camelot-v3",
          poolAddress: ARBITRUM_ONE_RUNTIME_PROFILE.route.poolAddress,
          tokenPath: [
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
          ],
        },
        quoteSource: {
          kind: "quoter",
          protocol: "camelot-v3",
          address: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress,
        },
      },
    });
    expect(result.quote.provenance?.inputAsset).toMatchObject({
      symbol: "ETH",
      decimals: 18,
    });
    expect(result.quote.provenance?.outputAsset).toMatchObject({
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("routes API Quote through the One profile while Check remains unavailable", async () => {
    const runtime = createRuntime();
    const { rpcClient } = createRpc();
    const app = createQuoteApp(
      createArbitrumOneQuoteFlow(runtime, {
        rpcClient,
        now: () => new Date("2026-10-17T19:17:33.990Z"),
      }),
    );

    try {
      const quoteResponse = await app.fetch(
        new Request("https://api.example.test/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(quoteRequest),
        }),
      );
      const quoteBody = (await quoteResponse.json()) as {
        status: string;
        quote?: { provenance?: { profileId?: string } };
      };
      expect(quoteResponse.status).toBe(200);
      expect(quoteBody).toMatchObject({
        status: "available",
        quote: { provenance: { profileId: "arbitrum-one-camelot-v3" } },
      });

      const checkResponse = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...quoteRequest,
            economicBoundary: {
              availability: "unavailable",
              source: "unavailable",
            },
          }),
        }),
      );
      expect(checkResponse.status).toBe(400);
      await expect(checkResponse.json()).resolves.toMatchObject({
        error: { code: "NORMALIZATION_FAILED" },
      });
    } finally {
      await app.close();
    }
  });

  it("rejects an available One API quote without complete provenance", async () => {
    const incompleteQuoteFlow: QuoteAgentFlowPort = {
      async quote() {
        return {
          status: "available",
          quote: {
            estimatedAmountOut: "2.413423",
            source: "quote",
            blockNumber: sourceBlockNumber,
            fetchedAt: "2026-10-17T19:17:33.990Z",
            runtimeVersion: "arbitrum-one-camelot-v3",
            runtimeRevision: "native-rpc",
          },
        };
      },
    };
    const app = createQuoteApp(incompleteQuoteFlow);

    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(quoteRequest),
        }),
      );
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "QUOTE_ERROR" },
      });
    } finally {
      await app.close();
    }
  });

  it("reproduces the same atomic quote and direct route at the same pinned block", async () => {
    const runtime = createRuntime();
    const { rpcClient, calls } = createRpc();
    const flow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });
    const input = createQuoteInput(runtime);

    const first = quoteResultSchema.parse(await flow.quote(input));
    const second = quoteResultSchema.parse(await flow.quote(input));

    expect(first).toEqual(second);
    expect(first.status).toBe("available");
    expect(calls.filter((call) => call.method === "eth_getCode")).toHaveLength(
      12,
    );
    const pinnedStateCalls = calls.filter(
      (call) => call.method === "eth_getCode" || call.method === "eth_call",
    );
    expect(
      pinnedStateCalls.every((call) => call.params[1] === sourceBlockTag),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.method === "eth_getBlockByNumber")
        .every((call) => call.params[0] === sourceBlockTag),
    ).toBe(true);
    expect(calls.some((call) => call.params.includes("latest"))).toBe(false);
    expect(calls.some((call) => call.method === "eth_estimateGas")).toBe(false);
  });

  it("returns NO_ROUTE without RPC calls for unsupported assets", async () => {
    const runtime = createRuntime();
    const { rpcClient, calls } = createRpc();
    const flow = createArbitrumOneQuoteFlow(runtime, { rpcClient });
    const input = createQuoteInput(runtime);

    const result = await flow.quote({
      ...input,
      intent: {
        ...input.intent,
        tokenOut: {
          kind: "erc20",
          address: "0x1111111111111111111111111111111111111111",
        },
      },
    });

    expect(result).toEqual({ status: "unavailable", reason: "NO_ROUTE" });
    expect(calls).toEqual([]);
  });

  it("fails unavailable for chain mismatch, absent endpoint, or wrong trusted metadata", async () => {
    const cases: Array<{
      name: string;
      runtime: ReturnType<typeof createRuntime>;
      responder?: RpcResponder;
    }> = [
      {
        name: "chain mismatch",
        runtime: createRuntime(),
        responder: (method) =>
          method === "eth_chainId" ? "0x66eee" : defaultRpcResponse(method, []),
      },
      { name: "absent endpoint", runtime: createRuntime({ rpcUrl: "" }) },
      {
        name: "wrong trusted symbol",
        runtime: createRuntime({ tokenSymbol: "USDC.e" }),
      },
      {
        name: "wrong trusted decimals",
        runtime: createRuntime({ tokenDecimals: 18 }),
      },
    ];

    for (const testCase of cases) {
      const rpc = createRpc(testCase.responder);
      const flow = createArbitrumOneQuoteFlow(testCase.runtime, {
        rpcClient: rpc.rpcClient,
      });
      await expect(
        flow.quote(createQuoteInput(testCase.runtime)),
      ).resolves.toMatchObject({
        status: "unavailable",
      });
      if (
        testCase.name === "absent endpoint" ||
        testCase.name.startsWith("wrong trusted")
      ) {
        expect(rpc.calls).toEqual([]);
      }
    }
  });

  it("fails unavailable for missing code and wrong onchain token metadata", async () => {
    const runtime = createRuntime();
    const missingCode = createRpc((method, params) => {
      if (
        method === "eth_getCode" &&
        params[0] === ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress
      ) {
        return "0x";
      }
      return defaultRpcResponse(method, params);
    });
    const missingCodeFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: missingCode.rpcClient,
    });
    await expect(
      missingCodeFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });

    const wrongSymbol = createRpc((method, params) => {
      if (method === "eth_call") {
        const call = params[0] as { to: string; data: string };
        if (
          call.to.toLowerCase() ===
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress.toLowerCase() &&
          call.data.startsWith("0x95d89b41")
        ) {
          return encodeString("USDC.e");
        }
      }
      return defaultRpcResponse(method, params);
    });
    const wrongSymbolFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: wrongSymbol.rpcClient,
    });
    await expect(
      wrongSymbolFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails unavailable for historical-state errors and missing block hash", async () => {
    const runtime = createRuntime();
    for (const responder of [
      (method: string, params: readonly unknown[]) =>
        method === "eth_getBlockByNumber"
          ? null
          : defaultRpcResponse(method, params),
      (method: string, params: readonly unknown[]) => {
        if (method === "eth_getBlockByNumber") {
          return { number: sourceBlockTag, timestamp: "0x6b1f2b5f" };
        }
        return defaultRpcResponse(method, params);
      },
    ]) {
      const { rpcClient } = createRpc(responder);
      const flow = createArbitrumOneQuoteFlow(runtime, { rpcClient });
      await expect(
        flow.quote(createQuoteInput(runtime)),
      ).resolves.toMatchObject({
        status: "unavailable",
      });
    }
  });

  it("fails unavailable for malformed Quoter ABI output and timeout", async () => {
    const runtime = createRuntime();
    const malformed = createRpc((method, params) => {
      if (method === "eth_call") {
        const call = params[0] as { data: string };
        if (call.data.startsWith("0x2d9ebd1d"))
          return `0x${encodeUint(2413423n)}`;
      }
      return defaultRpcResponse(method, params);
    });
    const malformedFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: malformed.rpcClient,
    });
    await expect(
      malformedFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });

    const timeout = createRpc((method, params) => {
      if (method === "eth_call") {
        const call = params[0] as { data: string };
        if (call.data.startsWith("0x2d9ebd1d")) throw new Error("timed out");
      }
      return defaultRpcResponse(method, params);
    });
    const timeoutFlow = createArbitrumOneQuoteFlow(runtime, {
      rpcClient: timeout.rpcClient,
    });
    await expect(
      timeoutFlow.quote(createQuoteInput(runtime)),
    ).resolves.toMatchObject({ status: "unavailable" });
  });
  it("keeps the production Arbitrum One path quote-only without local opt-in", async () => {
    const source = createRpc();
    const runtime = createRuntime();
    const app = createQuoteApp(
      createArbitrumOneQuoteFlow(runtime, { rpcClient: source.rpcClient }),
    );
    try {
      const checkResponse = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...quoteRequest,
            economicBoundary: {
              availability: "unavailable",
              source: "unavailable",
            },
          }),
        }),
      );
      expect(checkResponse.status).toBe(400);
      await expect(checkResponse.json()).resolves.toMatchObject({
        error: {
          code: "NORMALIZATION_FAILED",
          issues: { code: "UNSUPPORTED_CHAIN" },
        },
      });
      expect(source.calls).toHaveLength(0);

      const quoteResponse = await app.fetch(
        new Request("https://api.example.test/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(quoteRequest),
        }),
      );
      expect(quoteResponse.status).toBe(200);
      await expect(quoteResponse.json()).resolves.toMatchObject({
        status: "available",
      });
      expect(source.calls.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

describe("Arbitrum One local-fork Check/Run provenance", () => {
  it("covers input above one ETH and preserves a full ETH of gas headroom", async () => {
    const fixture = createLocalCheckFixture({}, { amountIn: "2" });
    const result = runResultSchema.parse(
      await fixture.flow.check(fixture.input),
    );
    const provenance = result.arbitrumOneForkProvenance;
    if (provenance?.status !== "AVAILABLE") {
      throw new Error("Expected available local-fork provenance");
    }

    const overrideCall = fixture.local.calls.find(
      (call) => call.method === "anvil_setBalance",
    );
    const executionCall = fixture.local.calls.find((call) => {
      if (call.method !== "eth_call") return false;
      const transaction = call.params[0] as { to?: unknown } | undefined;
      return (
        typeof transaction?.to === "string" &&
        transaction.to.toLowerCase() ===
          ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress.toLowerCase()
      );
    });
    expect(overrideCall).toBeDefined();
    expect(executionCall).toBeDefined();
    const estimateCall = fixture.local.calls.find(
      (call) => call.method === "eth_estimateGas",
    );
    const configuredBalance = BigInt(String(overrideCall?.params[1]));
    const transaction = executionCall?.params[0] as
      | { value?: unknown }
      | undefined;
    const transactionValue = BigInt(String(transaction?.value));
    expect(estimateCall?.params[0]).toEqual(executionCall?.params[0]);
    expect(transactionValue).toBe(2n * 10n ** 18n);
    expect(configuredBalance - transactionValue).toBe(nativeGasHeadroomAtomic);
    expect(configuredBalance).toBe(3n * 10n ** 18n);
    expect(provenance.accountOverride.nativeBalanceAtomic).toBe(
      configuredBalance.toString(),
    );
    expect(provenance.accountOverride.snapshotRestored).toBe(true);
    expect(
      fixture.local.calls.some(
        (call) => call.method === "evm_revert" && call.params[0] === "0x1",
      ),
    ).toBe(true);
  });

  it("allows the largest input whose gas headroom fits in uint256", async () => {
    const amountIn = convertAtomicAmountToHuman(
      (uint256Max - nativeGasHeadroomAtomic).toString(),
      18,
    );
    const fixture = createLocalCheckFixture({}, { amountIn });
    const result = runResultSchema.parse(
      await fixture.flow.check(fixture.input),
    );
    const provenance = result.arbitrumOneForkProvenance;
    if (provenance?.status !== "AVAILABLE") {
      throw new Error("Expected available local-fork provenance");
    }
    const overrideCall = fixture.local.calls.find(
      (call) => call.method === "anvil_setBalance",
    );

    expect(BigInt(String(overrideCall?.params[1]))).toBe(uint256Max);
    expect(provenance.accountOverride.nativeBalanceAtomic).toBe(
      uint256Max.toString(),
    );
    expect(provenance.accountOverride.snapshotRestored).toBe(true);
  });

  it("fails closed before snapshot when input leaves no uint256 gas headroom", async () => {
    const amountIn = convertAtomicAmountToHuman(uint256Max.toString(), 18);
    const fixture = createLocalCheckFixture({}, { amountIn });

    await expect(fixture.flow.check(fixture.input)).rejects.toThrow(
      "Local fork transaction value leaves no room for native gas headroom",
    );
    expect(
      fixture.local.calls.some((call) => call.method === "evm_snapshot"),
    ).toBe(false);
    expect(
      fixture.local.calls.some((call) => call.method === "anvil_setBalance"),
    ).toBe(false);
  });

  it.each([
    { name: "zero", senderUsdcBalanceAtomic: 0n },
    { name: "nonzero", senderUsdcBalanceAtomic: 8_765_432n },
  ])(
    "accepts a $name sender USDC baseline when native balance is overridden",
    async ({ senderUsdcBalanceAtomic }) => {
      const fixture = createLocalCheckFixture({ senderUsdcBalanceAtomic });
      const result = runResultSchema.parse(
        await fixture.flow.check(fixture.input),
      );
      const provenance = result.arbitrumOneForkProvenance;
      if (provenance?.status !== "AVAILABLE") {
        throw new Error("Expected available local-fork provenance");
      }

      expect(provenance.simulation).toMatchObject({
        call: { status: "SUCCEEDED" },
        amountReceived: {
          status: "AVAILABLE",
          amountReceivedAtomic: simulatedRecipientBalance.toString(),
          source: "VALIDATED_STATE_DIFF",
        },
      });
      expect(provenance.accountOverride.snapshotRestored).toBe(true);

      const overrideIndex = fixture.local.calls.findIndex(
        (call) => call.method === "anvil_setBalance",
      );
      const senderBalanceReadIndexes = findSenderUsdcBalanceReadIndexes(
        fixture.local.calls,
      );
      expect(senderBalanceReadIndexes.length).toBeGreaterThanOrEqual(2);
      expect(senderBalanceReadIndexes[0]).toBeLessThan(overrideIndex);
      expect(senderBalanceReadIndexes[1]).toBeGreaterThan(overrideIndex);
    },
  );

  it("fails closed when the native-balance override changes sender USDC", async () => {
    const baselineUsdcBalance = 1_234_567n;
    const fixture = createLocalCheckFixture({
      senderUsdcBalanceAtomic: baselineUsdcBalance,
      senderUsdcBalanceAfterNativeOverrideAtomic: baselineUsdcBalance + 1n,
    });

    await expect(fixture.flow.check(fixture.input)).rejects.toThrow(
      "Local fork snapshot restoration failed",
    );
    const senderBalanceReadIndexes = findSenderUsdcBalanceReadIndexes(
      fixture.local.calls,
    );
    const overrideIndex = fixture.local.calls.findIndex(
      (call) => call.method === "anvil_setBalance",
    );
    expect(senderBalanceReadIndexes).toHaveLength(2);
    expect(senderBalanceReadIndexes[0]).toBeLessThan(overrideIndex);
    expect(senderBalanceReadIndexes[1]).toBeGreaterThan(overrideIndex);
    expect(
      fixture.local.calls.some((call) => {
        if (call.method !== "eth_call") return false;
        const callTransaction = call.params[0] as
          | { from?: unknown }
          | undefined;
        return callTransaction?.from === sender;
      }),
    ).toBe(false);
    expect(
      fixture.local.calls.some((call) => call.method === "evm_revert"),
    ).toBe(true);

    const restoredBalance = await fixture.local.rpcClient.request("eth_call", [
      {
        to: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
        data: `0x70a08231${sender.slice(2).toLowerCase().padStart(64, "0")}`,
      },
      "latest",
    ]);
    expect(typeof restoredBalance).toBe("string");
    expect(BigInt(restoredBalance as string)).toBe(baselineUsdcBalance);
  });

  it("persists Check provenance and returns it on GET without rerunning RPCs", async () => {
    const { flow, source, local } = createLocalCheckFixture();
    const app = createLocalCheckApp(flow);
    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...quoteRequest,
            economicBoundary: {
              availability: "unavailable",
              source: "unavailable",
            },
          }),
        }),
      );
      expect(response.status).toBe(200);
      const postBody = (await response.json()) as {
        runId: string;
        arbitrumOneForkProvenance?: unknown;
        simulationProvenance?: unknown;
      };
      expect(postBody.runId).toBeTruthy();
      expect(postBody.arbitrumOneForkProvenance).toMatchObject({
        schemaVersion: 1,
        status: "AVAILABLE",
        source: {
          chainId: ARBITRUM_ONE_CHAIN_ID,
          blockNumber: sourceBlockNumber,
          blockHash,
        },
        localExecution: {
          chainId: 31_337,
          stateRevision: {
            status: "AVAILABLE",
            method: "ANVIL_DUMP_STATE",
          },
        },
        simulation: {
          call: { status: "SUCCEEDED" },
          gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
          amountReceived: {
            status: "AVAILABLE",
            amountReceivedAtomic: simulatedRecipientBalance.toString(),
            source: "VALIDATED_STATE_DIFF",
          },
        },
        accountOverride: { snapshotRestored: true },
        safety: {
          upstreamWritesAllowed: false,
          signingOrBroadcastingPerformed: false,
          transactionSubmissionPerformed: false,
          localTransactionsMined: false,
        },
      });
      expect(postBody.simulationProvenance).toMatchObject({
        schemaVersion: 1,
        status: "AVAILABLE",
        sourceChainId: ARBITRUM_ONE_CHAIN_ID,
        sourceBlockNumber,
        sourceBlockHash: blockHash,
        executionEnvironment: "LOCAL_FORK",
        executionChainId: 31_337,
        executionBlockContext: {
          baseBlockNumber: sourceBlockNumber,
          baseBlockHash: blockHash,
          observedHeadNumber: sourceBlockNumber,
        },
        forkRunId: localForkInstanceId,
        stateRevision: { status: "AVAILABLE" },
        accountOverridesApplied: true,
        transactionFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        quote: {
          amountInAtomic: "1000000000000000",
          amountOutAtomic: "2413423",
          poolAddress: ARBITRUM_ONE_RUNTIME_PROFILE.route.poolAddress,
          tokenPath: [
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
          ],
        },
        capabilities: {
          call: { status: "SUCCEEDED" },
          gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
          amountReceived: {
            status: "AVAILABLE",
            amountReceivedAtomic: "2413423",
            source: "VALIDATED_STATE_DIFF",
          },
        },
        quoteReconciliation: {
          status: "MATCHED",
          comparisonMethod: "ATOMIC_INTEGER_EQUALITY",
          quoteAmountOutAtomic: "2413423",
          simulatedAmountReceivedAtomic: "2413423",
          differenceAtomic: "0",
        },
      });
      const provenanceBody = postBody.arbitrumOneForkProvenance as {
        localExecution?: {
          stateRevision?: { fingerprint?: unknown };
        };
      };
      expect(provenanceBody.localExecution?.stateRevision?.fingerprint).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
      const txCalls = local.calls.filter((call) => {
        if (call.method !== "eth_call" && call.method !== "eth_estimateGas") {
          return false;
        }
        const transaction = call.params[0] as { to?: unknown } | undefined;
        return (
          typeof transaction?.to === "string" &&
          transaction.to.toLowerCase() ===
            ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress.toLowerCase()
        );
      });
      expect(txCalls).toHaveLength(2);
      expect(txCalls[0]?.params[0]).toEqual(txCalls[1]?.params[0]);
      expect(txCalls[0]?.params[0]).not.toHaveProperty("chainId");
      const prestateTrace = local.calls.find(
        (call) => call.method === "debug_traceCall",
      );
      expect(prestateTrace?.params[0]).toEqual(txCalls[0]?.params[0]);
      expect(prestateTrace?.params[2]).toEqual({
        tracer: "prestateTracer",
        tracerConfig: { diffMode: true },
      });
      expect(
        local.calls.some((call) =>
          [
            "eth_sendTransaction",
            "eth_sendRawTransaction",
            "evm_mine",
            "anvil_mine",
          ].includes(call.method),
        ),
      ).toBe(false);

      const rpcCallCount = source.calls.length + local.calls.length;
      const getResponse = await app.fetch(
        new Request(
          `https://api.example.test/api/runs/${encodeURIComponent(postBody.runId)}`,
        ),
      );
      expect(getResponse.status).toBe(200);
      const getBody = (await getResponse.json()) as {
        result?: {
          arbitrumOneForkProvenance?: unknown;
          simulationProvenance?: unknown;
        };
      };
      expect(getBody.result?.arbitrumOneForkProvenance).toEqual(
        postBody.arbitrumOneForkProvenance,
      );
      expect(getBody.result?.simulationProvenance).toEqual(
        postBody.simulationProvenance,
      );
      expect(source.calls.length + local.calls.length).toBe(rpcCallCount);
    } finally {
      await app.close();
    }
  });

  it("records an exact runtime recipient mismatch without promoting Risk", async () => {
    const simulatedAmountReceivedAtomic = 2_409_000n;
    const fixture = createLocalCheckFixture({
      simulatedRecipientBalanceAtomic: simulatedAmountReceivedAtomic,
    });
    const result = runResultSchema.parse(
      await fixture.flow.check(fixture.input),
    );
    const simulation = result.simulationProvenance;
    if (simulation === undefined) {
      throw new Error("Expected provider-neutral simulation provenance");
    }
    const fork = result.arbitrumOneForkProvenance;
    if (fork?.status !== "AVAILABLE") {
      throw new Error("Expected local-fork provenance");
    }

    expect(result.verdict).toBe("UNKNOWN");
    expect(simulation.capabilities.amountReceived).toEqual({
      status: "AVAILABLE",
      amountReceivedAtomic: simulatedAmountReceivedAtomic.toString(),
      source: "VALIDATED_STATE_DIFF",
    });
    expect(simulation.quoteReconciliation).toEqual({
      status: "MISMATCHED",
      comparisonMethod: "ATOMIC_INTEGER_EQUALITY",
      quoteAmountOutAtomic: "2413423",
      simulatedAmountReceivedAtomic: "2409000",
      differenceAtomic: "-4423",
    });
    expect(fork.simulation.amountReceived).toEqual({
      status: "AVAILABLE",
      amountReceivedAtomic: "2409000",
      source: "VALIDATED_STATE_DIFF",
    });
    expect(fork.accountOverride.snapshotRestored).toBe(true);
  });

  it.each([
    {
      name: "timeout",
      rpcOptions: {
        callError: new NativeRpcClientError("TIMEOUT", "simulated timeout"),
      },
      checkOptions: {},
      expected: {
        call: { status: "UNAVAILABLE", failureReason: "RPC_TIMEOUT" },
        gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
      },
    },
    {
      name: "minimum-output protection revert",
      rpcOptions: {
        callError: new NativeRpcClientError(
          "RPC_ERROR",
          "execution reverted",
          3,
          "SLIPPAGE_GUARD",
        ),
        gasEstimateError: new NativeRpcClientError(
          "RPC_ERROR",
          "execution reverted",
          3,
          "SLIPPAGE_GUARD",
        ),
      },
      checkOptions: { minimumReceived: "3" },
      expected: {
        call: { status: "REVERTED", failureReason: "SLIPPAGE_GUARD" },
        gasEstimate: {
          status: "UNAVAILABLE",
          failureReason: "SLIPPAGE_GUARD",
        },
      },
    },
    {
      name: "non-slippage EVM revert",
      rpcOptions: {
        callError: createRpcError(3, "execution reverted: invalid pool state"),
        gasEstimateError: createRpcError(
          3,
          "execution reverted: invalid pool state",
        ),
      },
      checkOptions: {},
      expected: {
        call: { status: "REVERTED", failureReason: "EVM_REVERT" },
        gasEstimate: { status: "UNAVAILABLE", failureReason: "EVM_REVERT" },
      },
    },
    {
      name: "insufficient native balance",
      rpcOptions: {
        callError: createRpcError(
          -32000,
          "insufficient funds for gas * price + value",
        ),
      },
      checkOptions: { amountIn: "2" },
      expected: {
        call: {
          status: "UNAVAILABLE",
          failureReason: "INSUFFICIENT_NATIVE_BALANCE",
        },
        gasEstimate: { status: "AVAILABLE", gasUnits: "21000" },
      },
    },
  ])(
    "records $name without claiming received output",
    async ({ rpcOptions, checkOptions, expected }) => {
      const fixture = createLocalCheckFixture(rpcOptions, checkOptions);
      const result = runResultSchema.parse(
        await fixture.flow.check(fixture.input),
      );
      const provenance = result.arbitrumOneForkProvenance;
      if (provenance?.status !== "AVAILABLE")
        throw new Error("Expected local-fork provenance");
      expect(provenance.simulation).toMatchObject({
        ...expected,
        amountReceived: { status: "UNAVAILABLE" },
      });
      expect(result.verdict).toBe("UNKNOWN");
      expect(result.simulationProvenance?.capabilities).toMatchObject({
        ...expected,
        amountReceived: { status: "UNAVAILABLE" },
      });
      expect(result.simulationProvenance?.quoteReconciliation).toMatchObject({
        status: "UNAVAILABLE",
        comparisonMethod: "ATOMIC_INTEGER_EQUALITY",
        quoteAmountOutAtomic: "2413423",
      });
      expect(provenance.simulation.amountReceived).not.toHaveProperty(
        "amountReceivedAtomic",
      );
      expect(provenance.accountOverride.snapshotRestored).toBe(true);
      expect(
        fixture.local.calls.some((call) => call.method === "evm_revert"),
      ).toBe(true);
      expect(
        fixture.local.calls.some(
          (call) =>
            call.method === "eth_getBalance" && call.params[1] === "latest",
        ),
      ).toBe(true);
    },
  );

  it.each([
    {
      name: "prestateTracer is unsupported",
      rpcOptions: {
        prestateError: createRpcError(-32601, "method not found"),
      },
      expectedStateRevision: "AVAILABLE",
    },
    {
      name: "state overrides are unsupported",
      rpcOptions: {
        stateOverrideError: createRpcError(-32602, "invalid params"),
      },
      expectedStateRevision: "AVAILABLE",
    },
    {
      name: "Anvil state dump is unsupported",
      rpcOptions: {
        stateDumpError: createRpcError(-32601, "method not found"),
      },
      expectedStateRevision: "UNKNOWN",
    },
  ])(
    "fails closed when $name",
    async ({ rpcOptions, expectedStateRevision }) => {
      const fixture = createLocalCheckFixture(rpcOptions);
      const result = runResultSchema.parse(
        await fixture.flow.check(fixture.input),
      );
      const provenance = result.arbitrumOneForkProvenance;
      if (provenance?.status !== "AVAILABLE") {
        throw new Error("Expected available local-fork provenance");
      }
      expect(provenance.localExecution.stateRevision.status).toBe(
        expectedStateRevision,
      );
      expect(provenance.simulation.amountReceived).toEqual({
        status: "UNAVAILABLE",
        reason: "STATE_DIFF_NOT_QUALIFIED",
      });
      expect(provenance.simulation.amountReceived).not.toHaveProperty(
        "amountReceivedAtomic",
      );
      expect(provenance.accountOverride.snapshotRestored).toBe(true);
    },
  );

  it("rejects a claimed balance delta without a qualified state revision", async () => {
    const fixture = createLocalCheckFixture();
    const result = runResultSchema.parse(
      await fixture.flow.check(fixture.input),
    );
    const provenance = result.arbitrumOneForkProvenance;
    if (provenance?.status !== "AVAILABLE") {
      throw new Error("Expected available local-fork provenance");
    }
    const invalidResult = {
      ...result,
      arbitrumOneForkProvenance: {
        ...provenance,
        localExecution: {
          ...provenance.localExecution,
          stateRevision: {
            status: "UNKNOWN",
            reason: "NO_QUALIFIED_ANVIL_STATE_REVISION_TOKEN",
          },
        },
      },
    };
    expect(runResultSchema.safeParse(invalidResult).success).toBe(false);
  });

  it("marks a changed Anvil state revision unavailable without Risk promotion", async () => {
    const runtime = createLocalRuntime();
    const source = createRpc();
    const local = createLocalForkRpc();
    let stateDumpCount = 0;
    const localRpcClient: ArbitrumRpcClient = {
      async request(method, params, operationOptions) {
        const response = await local.rpcClient.request(
          method,
          params,
          operationOptions,
        );
        if (method === "anvil_dumpState") {
          stateDumpCount += 1;
          if (stateDumpCount === 3) return "0x02";
        }
        return response;
      },
    };
    const flow = createArbitrumOneLocalForkCheckFlow(runtime, {
      sourceRpcClient: source.rpcClient,
      localRpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });
    const result = runResultSchema.parse(
      await flow.check(createLocalCheckInput(runtime)),
    );
    const fork = result.arbitrumOneForkProvenance;
    if (fork?.status !== "AVAILABLE") {
      throw new Error("Expected local-fork context to remain available");
    }

    expect(fork.localExecution.stateRevision).toEqual({
      status: "UNKNOWN",
      reason: "STATE_CHANGED_DURING_SIMULATION",
    });
    expect(fork.simulation).toMatchObject({
      call: { status: "UNAVAILABLE", failureReason: "FORK_STATE_CHANGED" },
      gasEstimate: {
        status: "UNAVAILABLE",
        failureReason: "FORK_STATE_CHANGED",
      },
      amountReceived: { status: "UNAVAILABLE" },
    });
    expect(result.simulationProvenance?.quoteReconciliation).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SIMULATED_OUTPUT_UNAVAILABLE",
    });
    expect(result.verdict).toBe("UNKNOWN");
    expect(local.calls.some((call) => call.method === "debug_traceCall")).toBe(
      false,
    );
    expect(local.calls.some((call) => call.method === "evm_revert")).toBe(true);
  });

  it("rejects mutations to recipient, amount, router, chain, quote source, route, and revision", async () => {
    const fixture = createLocalCheckFixture();
    const result = runResultSchema.parse(
      await fixture.flow.check(fixture.input),
    );
    const provenance = result.simulationProvenance;
    if (provenance === undefined) {
      throw new Error("Expected provider-neutral simulation provenance");
    }
    const changedFingerprint = `sha256:${"cd".repeat(32)}`;
    const changedAddress = "0x3333333333333333333333333333333333333333";
    const invalidRuns = [
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          transactionBinding: {
            ...provenance.transactionBinding,
            recipient: concurrentSender,
          },
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          transactionBinding: {
            ...provenance.transactionBinding,
            amountInAtomic: "1000000000000001",
          },
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          transactionBinding: {
            ...provenance.transactionBinding,
            router: changedAddress,
            to: changedAddress,
          },
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          transactionBinding: {
            ...provenance.transactionBinding,
            chainId: 421614,
          },
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          sourceBlockHash: `0x${"cd".repeat(32)}`,
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          quote: { ...provenance.quote, poolAddress: changedAddress },
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          quote: {
            ...provenance.quote,
            tokenPath: [provenance.quote.tokenPath[0], changedAddress] as [
              string,
              string,
            ],
          },
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          transactionFingerprint: changedFingerprint,
        },
      },
      {
        ...result,
        simulationProvenance: {
          ...provenance,
          stateRevision: {
            status: "AVAILABLE" as const,
            fingerprint: changedFingerprint,
          },
        },
      },
    ];

    for (const invalidRun of invalidRuns) {
      expect(runResultSchema.safeParse(invalidRun).success).toBe(false);
    }
  });

  it("binds the quote input asset to the Intent, including the native-asset path", async () => {
    const fixture = createLocalCheckFixture();
    const result = runResultSchema.parse(
      await fixture.flow.check(fixture.input),
    );
    const quote = result.quote;
    const quoteProvenance = quote?.provenance;
    const simulation = result.simulationProvenance;
    if (quote === undefined || quoteProvenance === undefined) {
      throw new Error("Expected quote provenance");
    }
    if (simulation === undefined) {
      throw new Error("Expected provider-neutral simulation provenance");
    }

    expect(result.intent.tokenIn).toEqual({ kind: "native" });
    expect(simulation.transactionBinding.tokenIn).toBe("native");
    expect(runResultSchema.safeParse(result).success).toBe(true);

    const otherInputToken = "0x7777777777777777777777777777777777777777";
    const tamperedRun = {
      ...result,
      quote: {
        ...quote,
        provenance: {
          ...quoteProvenance,
          inputAsset: {
            chainId: quoteProvenance.inputAsset.chainId,
            asset: { kind: "erc20" as const, address: otherInputToken },
            symbol: "OTHER",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: quoteProvenance.sourceBlock.number,
          },
          route: {
            ...quoteProvenance.route,
            tokenPath: [
              otherInputToken,
              quoteProvenance.route.tokenPath[1],
            ] as [string, string],
          },
        },
      },
      simulationProvenance: {
        ...simulation,
        quote: {
          ...simulation.quote,
          tokenPath: [otherInputToken, simulation.quote.tokenPath[1]] as [
            string,
            string,
          ],
        },
      },
    };

    expect(tamperedRun.intent.tokenIn).toEqual({ kind: "native" });
    expect(tamperedRun.simulationProvenance.transactionBinding.tokenIn).toBe(
      "native",
    );
    expect(tamperedRun.quote.provenance.inputAsset.asset).toEqual({
      kind: "erc20",
      address: otherInputToken,
    });
    expect(tamperedRun.simulationProvenance.quote.tokenPath[0]).toBe(
      otherInputToken,
    );
    expect(runResultSchema.safeParse(tamperedRun).success).toBe(false);
  });

  it("serializes concurrent checks for one fork and restores both senders' state", async () => {
    const runtime = createLocalRuntime();
    const source = createRpc();
    const local = createConcurrentLocalForkRpc();
    const flow = createArbitrumOneLocalForkCheckFlow(runtime, {
      sourceRpcClient: source.rpcClient,
      localRpcClient: local.rpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });
    const firstCheck = flow.check(createLocalCheckInput(runtime, { sender }));
    await local.firstCallStarted;

    const secondCheck = flow.check(
      createLocalCheckInput(runtime, { sender: concurrentSender }),
    );
    try {
      await local.bothBaseBalancesRead;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        local.calls.filter((call) => call.method === "evm_snapshot"),
      ).toHaveLength(1);
    } finally {
      local.releaseFirstCall();
    }

    const [firstResult, secondResult] = await Promise.all([
      firstCheck,
      secondCheck,
    ]);
    expect(
      runResultSchema.parse(firstResult).arbitrumOneForkProvenance,
    ).toMatchObject({ accountOverride: { snapshotRestored: true } });
    expect(
      runResultSchema.parse(secondResult).arbitrumOneForkProvenance,
    ).toMatchObject({ accountOverride: { snapshotRestored: true } });
    expect(local.observations).toEqual([
      {
        sender: sender.toLowerCase(),
        firstSenderBalance: `0x${(nativeGasHeadroomAtomic + 10n ** 15n).toString(16)}`,
        secondSenderBalance: "0xc8",
      },
      {
        sender: concurrentSender.toLowerCase(),
        firstSenderBalance: "0x64",
        secondSenderBalance: `0x${(nativeGasHeadroomAtomic + 10n ** 15n).toString(16)}`,
      },
    ]);
    expect(local.balances).toEqual(local.initialBalances);
    const firstRevertIndex = local.calls.findIndex(
      (call) => call.method === "evm_revert",
    );
    const secondSnapshotIndex = local.calls.findIndex(
      (call, index) =>
        index > firstRevertIndex && call.method === "evm_snapshot",
    );
    expect(firstRevertIndex).toBeGreaterThan(-1);
    expect(secondSnapshotIndex).toBeGreaterThan(firstRevertIndex);
    expect(
      local.calls.filter((call) => call.method === "evm_revert"),
    ).toHaveLength(2);
  });

  it("classifies insufficient balance from the actual Native RPC adapter", async () => {
    const runtime = createLocalRuntime();
    const source = createRpc();
    const rawInsufficientBalanceMessage =
      "insufficient funds for gas * price + value: address 0x1111111111111111111111111111111111111111 have 50883771891842106 want 100000000000000000000";
    const methods: string[] = [];
    let nativeBalance = "0x0";
    const fetchImplementation: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: readonly unknown[];
      };
      methods.push(request.method);
      if (request.method === "anvil_setBalance") {
        nativeBalance = String(request.params[1]);
      }
      if (request.method === "evm_revert") nativeBalance = "0x0";
      const resultByMethod: Record<string, unknown> = {
        parallax_forkInstanceId: localForkInstanceId,
        web3_clientVersion: "anvil/v1.8.5 (test build)",
        eth_chainId: "0x7a69",
        eth_accounts: [],
        eth_blockNumber: sourceBlockTag,
        eth_getBlockByNumber: {
          number: sourceBlockTag,
          hash: blockHash,
          timestamp: "0x6ad3c5b0",
        },
        eth_getCode: "0x6000",
        eth_getBalance: request.params[1] === "latest" ? nativeBalance : "0x0",
        evm_snapshot: "0x1",
        anvil_setBalance: null,
        eth_estimateGas: "0x5208",
        evm_revert: true,
      };
      const call = request.params[0] as
        | { to?: unknown; data?: unknown }
        | undefined;
      const isBalanceOfCall =
        call?.to === ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress &&
        typeof call.data === "string" &&
        call.data.slice(0, 10).toLowerCase() === "0x70a08231";
      const responseBody =
        request.method === "eth_call" && isBalanceOfCall
          ? {
              jsonrpc: "2.0",
              id: request.id,
              result: storageWord(0n),
            }
          : request.method === "eth_call"
            ? {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                  code: -32000,
                  message: rawInsufficientBalanceMessage,
                },
              }
            : {
                jsonrpc: "2.0",
                id: request.id,
                result: resultByMethod[request.method],
              };
      return new Response(JSON.stringify(responseBody), { status: 200 });
    };
    const localRpcClient = createNativeRpcClient({
      rpcUrl: localForkEnvironment.ARBITRUM_ONE_FORK_LOCAL_RPC_URL,
      fetchImplementation,
    });
    const flow = createArbitrumOneLocalForkCheckFlow(runtime, {
      sourceRpcClient: source.rpcClient,
      localRpcClient,
      now: () => new Date("2026-10-17T19:17:33.990Z"),
    });
    const result = runResultSchema.parse(
      await flow.check(createLocalCheckInput(runtime, { amountIn: "2" })),
    );
    const provenance = result.arbitrumOneForkProvenance;
    if (provenance?.status !== "AVAILABLE") {
      throw new Error("Expected available local-fork provenance");
    }

    expect(provenance.simulation.call).toEqual({
      status: "UNAVAILABLE",
      failureReason: "INSUFFICIENT_NATIVE_BALANCE",
    });
    expect(methods).toContain("eth_call");
    const publicResult = JSON.stringify(result);
    expect(publicResult).not.toContain("have 50883771891842106");
    expect(publicResult).not.toContain("want 100000000000000000000");
    expect(publicResult).not.toContain(rawInsufficientBalanceMessage);
  });

  it.each([
    {
      name: "valid structured minimum-output revert",
      rpcError: {
        code: 3,
        message: "execution reverted: Too little received",
        data: encodeErrorString("Too little received"),
      },
      expected: "SLIPPAGE_GUARD",
    },
    {
      name: "ordinary structured revert",
      rpcError: {
        code: 3,
        message: "execution reverted: pool is locked",
        data: encodeErrorString("pool is locked"),
      },
      expected: "EVM_REVERT",
    },
    {
      name: "oversized structured reason is rejected",
      rpcError: {
        code: 3,
        message: "execution reverted: Too little received",
        data: encodeErrorString(`Too little received${"x".repeat(200)}`),
      },
      expected: "EVM_REVERT",
    },
    {
      name: "attacker-controlled slippage text without structured revert data",
      rpcError: {
        code: 3,
        message:
          "execution reverted: slippage; amountOutMinimum; untrusted-marker-9f12 https://user:secret@example.test/rpc?key=private",
      },
      expected: "EVM_REVERT",
    },
    {
      name: "nested attacker-controlled text is not parsed as revert data",
      rpcError: {
        code: 3,
        message: "execution reverted: slippage",
        data: { message: encodeErrorString("Too little received") },
      },
      expected: "EVM_REVERT",
    },
  ] as const)(
    "classifies $name through the actual NativeRpcClient path",
    async ({ rpcError, expected }) => {
      const runtime = createLocalRuntime();
      const source = createRpc();
      const nativeFetch = createNativeLocalForkFetch({
        callError: rpcError,
        gasEstimateError: rpcError,
      });
      const localRpcClient = createNativeRpcClient({
        rpcUrl: localForkEnvironment.ARBITRUM_ONE_FORK_LOCAL_RPC_URL,
        fetchImplementation: nativeFetch.fetchImplementation,
      });
      const flow = createArbitrumOneLocalForkCheckFlow(runtime, {
        sourceRpcClient: source.rpcClient,
        localRpcClient,
        now: () => new Date("2026-10-17T19:17:33.990Z"),
      });
      const result = runResultSchema.parse(
        await flow.check(
          createLocalCheckInput(runtime, { minimumReceived: "3" }),
        ),
      );
      const provenance = result.arbitrumOneForkProvenance;
      if (provenance?.status !== "AVAILABLE") {
        throw new Error("Expected available local-fork provenance");
      }

      expect(provenance.simulation.call).toEqual({
        status: "REVERTED",
        failureReason: expected,
      });
      expect(provenance.simulation.gasEstimate).toEqual({
        status: "UNAVAILABLE",
        failureReason: expected,
      });
      expect(nativeFetch.methods).toContain("eth_call");
      expect(nativeFetch.methods).toContain("eth_estimateGas");
      expect(nativeFetch.methods).toContain("evm_revert");
      const publicResult = JSON.stringify(result);
      expect(publicResult).not.toContain(rpcError.message);
      expect(publicResult).not.toContain("user:secret@example.test");
      expect(publicResult).not.toContain("untrusted-marker-9f12");
    },
  );

  it("rejects a fork/source identity mismatch before transaction simulation", async () => {
    const fixture = createLocalCheckFixture({
      blockHash: `0x${"cd".repeat(32)}`,
    });
    await expect(fixture.flow.check(fixture.input)).rejects.toThrow(
      "Pinned source quote does not match the verified local fork context",
    );
    expect(fixture.local.calls.some((call) => call.method === "eth_call")).toBe(
      false,
    );
    expect(
      fixture.local.calls.some((call) => call.method === "evm_snapshot"),
    ).toBe(false);
  });

  it("projects a source mismatch as a distinct UNKNOWN integration failure", async () => {
    const fixture = createLocalCheckFixture({
      blockHash: `0x${"cd".repeat(32)}`,
    });
    const app = createLocalCheckApp(fixture.flow);
    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...quoteRequest,
            economicBoundary: {
              availability: "unavailable",
              source: "unavailable",
            },
          }),
        }),
      );
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SOURCE_MISMATCH" },
        run: {
          status: "integration_error",
          verdict: "UNKNOWN",
          error: { code: "SOURCE_MISMATCH", stage: "simulation" },
        },
      });
      expect(
        fixture.local.calls.some((call) => call.method === "eth_call"),
      ).toBe(false);
      expect(
        fixture.local.calls.some((call) => call.method === "evm_snapshot"),
      ).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("persists the completed quote as UNKNOWN when the fork head advances after simulation", async () => {
    const fixture = createLocalCheckFixture({
      postSimulationBlockNumber: "0x8",
    });
    const app = createLocalCheckApp(fixture.flow);
    try {
      const response = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...quoteRequest,
            economicBoundary: {
              availability: "unavailable",
              source: "unavailable",
            },
          }),
        }),
      );

      expect(response.status).toBe(502);
      const postBody = (await response.json()) as {
        error: { code: string };
        run: {
          runId: string;
          status: string;
          verdict: string;
          error: { code: string; stage: string };
          quote?: {
            estimatedAmountOut: string;
            provenance?: {
              amountInAtomic: string;
              amountOutAtomic: string;
            };
          };
          simulationProvenance?: unknown;
          providerEvidence?: {
            execution?: { status: string };
            simulation?: { value: unknown };
            assetChanges?: { value: unknown };
          };
        };
      };
      expect(postBody.error.code).toBe("FORK_STATE_CHANGED");
      expect(postBody.run).toMatchObject({
        status: "integration_error",
        verdict: "UNKNOWN",
        error: { code: "FORK_STATE_CHANGED", stage: "simulation" },
        quote: {
          estimatedAmountOut: "2.413423",
          provenance: {
            amountInAtomic: "1000000000000000",
            amountOutAtomic: "2413423",
          },
        },
        providerEvidence: {
          execution: { status: "UNKNOWN" },
          simulation: { value: null },
          assetChanges: { value: null },
        },
      });
      expect(postBody.run.simulationProvenance).toBeUndefined();
      expect(
        fixture.local.calls.filter((call) => call.method === "eth_blockNumber"),
      ).toHaveLength(3);
      expect(
        fixture.local.calls.some((call) => call.method === "evm_revert"),
      ).toBe(true);

      const getResponse = await app.fetch(
        new Request(
          `https://api.example.test/api/runs/${encodeURIComponent(postBody.run.runId)}`,
        ),
      );
      expect(getResponse.status).toBe(200);
      const getBody = (await getResponse.json()) as {
        result?: {
          status: string;
          verdict: string;
          quote?: {
            estimatedAmountOut: string;
            provenance?: { amountOutAtomic: string };
          };
          providerEvidence?: {
            execution?: { status: string };
            simulation?: { value: unknown };
            assetChanges?: { value: unknown };
          };
        };
      };
      expect(getBody.result).toMatchObject({
        status: "integration_error",
        verdict: "UNKNOWN",
        quote: {
          estimatedAmountOut: "2.413423",
          provenance: { amountOutAtomic: "2413423" },
        },
        providerEvidence: {
          execution: { status: "UNKNOWN" },
          simulation: { value: null },
          assetChanges: { value: null },
        },
      });
    } finally {
      await app.close();
    }
  });

  it.each([
    {
      name: "fork instance",
      rpcOptions: {
        forkInstanceId: "00000000-0000-4000-8000-000000000002",
      },
      message: "Local fork instance identity does not match configuration",
    },
    {
      name: "Anvil version",
      rpcOptions: { clientVersion: "anvil/v1.8.4 (test build)" },
      message: "Local Anvil version does not match configuration",
    },
    {
      name: "chain ID",
      rpcOptions: { chainId: "0xa4b1" },
      message: "Local fork chain identity is invalid",
    },
    {
      name: "unlocked accounts",
      rpcOptions: { accounts: [sender] },
      message: "Local fork must not expose unlocked signing accounts",
    },
  ])(
    "rejects a $name mismatch before transaction simulation",
    async ({ rpcOptions, message }) => {
      const fixture = createLocalCheckFixture(rpcOptions);
      await expect(fixture.flow.check(fixture.input)).rejects.toThrow(message);
      expect(
        fixture.local.calls.some((call) => call.method === "evm_snapshot"),
      ).toBe(false);
      expect(
        fixture.local.calls.some((call) => call.method === "eth_call"),
      ).toBe(false);
      expect(
        fixture.source.calls.filter((call) => call.method !== "eth_chainId"),
      ).toHaveLength(0);
    },
  );

  it("fails closed when the snapshot cannot be restored", async () => {
    const fixture = createLocalCheckFixture({ revertResult: false });
    await expect(fixture.flow.check(fixture.input)).rejects.toThrow(
      "Local fork snapshot restoration failed",
    );
    expect(fixture.local.calls.at(-1)?.method).toBe("evm_revert");
  });
});

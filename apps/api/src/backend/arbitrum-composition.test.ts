import { createHash } from "node:crypto";
import {
  convertAtomicAmountToHuman,
  type ExpectationBaseline,
  type GenericEvidence,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
  runResultSchema,
} from "@parallax/contracts";
import { closeUnverifiedAdjust } from "@parallax/orchestrator/application";
import { economicFailStopResult } from "@parallax/orchestrator/application/action-gate-fixtures";
import type { CallerConstraint, ConstraintEvidence } from "@parallax/risk";
import { describe, expect, it, vi } from "vitest";
import canonicalRealCamelotCapture from "../../../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
import { bootstrapBackendApp, createBackendApp } from "../bootstrap/backend.js";
import { UnsupportedAgentFlowError } from "../ports.js";
import { bootstrapBackendRuntime } from "../runtime-config.js";
import { InMemoryRunStore } from "../store.js";

import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import {
  type ArbitrumProductionCompositionOptions,
  bootstrapArbitrumBackend,
  createArbitrumProductionComposition,
} from "./arbitrum-composition.js";
import {
  CAMELOT_SEPOLIA_QUOTER,
  CAMELOT_SEPOLIA_ROUTER,
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
  createCamelotV3ProtocolAdapter,
} from "./camelot-v3-protocol-adapter.js";
import type { BackendCompositionRuntime } from "./composition.js";
import {
  createFakeChainAdapter,
  createFakeProviderAdapter,
} from "./fake-harness.js";
import { NativeRpcClientError } from "./native-rpc-client.js";
import { NATIVE_RPC_ARBITRUM_PROVIDER_ID } from "./native-rpc-evidence.js";
import { BackendPipeline } from "./pipeline.js";
import {
  createTenderlyProvider,
  TENDERLY_ARBITRUM_PROVIDER_ID,
} from "./tenderly-provider.js";
import {
  createTraceRpcEvidenceSource,
  type TraceRpcClient,
} from "./trace-rpc-evidence-source.js";

const normalizedIntent: NormalizedSwapIntent = {
  chainId: 421614,
  protocol: "camelot-v3",
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x1111111111111111111111111111111111111111",
  recipientSource: "defaulted_from_sender",
  tokenIn: { kind: "native" },
  tokenOut: {
    kind: "erc20",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  amountInAtomic: "1000",
  economicBoundary: { availability: "unavailable", source: "unavailable" },
};

function options(): ArbitrumProductionCompositionOptions {
  const runtime = bootstrapBackendRuntime({
    environment: {
      MONAD_RPC_URL: "https://monad.example.test",
      ARBITRUM_RPC_URL: "https://arbitrum.example.test",
      MOSS_RUNTIME_VERSION: "fixture-runtime",
      MOSS_RUNTIME_REVISION: "fixture-revision",
    },
    tokenRegistry: {
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [],
    },
  });
  return {
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    providers: [
      createFakeProviderAdapter<NormalizedSwapIntent>({
        providerId: "controlled-arbitrum-provider",
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capabilities: ["simulate"],
      }),
    ],
    core: { evaluate: async (input) => input },
    decision: { decide: async (input) => input },
  };
}

const arbitrumTokenAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const arbitrumTokenRegistry = {
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: arbitrumTokenAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
  ],
};
const reverseCamelotTokenRegistry = {
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: CAMELOT_SEPOLIA_USDC,
      symbol: "USDC",
      decimals: 18,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
    {
      chainId: 421614,
      address: CAMELOT_SEPOLIA_WETH,
      symbol: "WETH",
      decimals: 18,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "42",
    },
  ],
};
const arbitrumEnvironment = {
  MONAD_RPC_URL: "https://monad.example.test",
  ARBITRUM_RPC_URL: "https://arbitrum.example.test",
  MOSS_RUNTIME_VERSION: "fixture-runtime",
  MOSS_RUNTIME_REVISION: "fixture-revision",
};

function arbitrumRuntime() {
  return bootstrapBackendRuntime({
    environment: arbitrumEnvironment,
    tokenRegistry: arbitrumTokenRegistry,
  });
}

function arbitrumCompositionOptions(
  runtime: ReturnType<typeof arbitrumRuntime>,
  protocolAdapter?: ArbitrumProductionCompositionOptions["protocolAdapter"],
): ArbitrumProductionCompositionOptions {
  return {
    runtime,
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    ...(protocolAdapter === undefined ? {} : { protocolAdapter }),
    core: { evaluate: async (input) => input },
    decision: { decide: async (input) => input },
  };
}

type CanonicalCaptureRecord = {
  readonly context: string;
  readonly method: string;
  readonly request: { readonly params: readonly unknown[] };
  readonly response: { readonly result?: unknown };
};

function canonicalRealRpcReplay() {
  const capture = canonicalRealCamelotCapture as unknown as {
    readonly observations: {
      readonly pinnedBlock: {
        readonly number: string;
        readonly hash: string;
      };
    };
    readonly records: readonly CanonicalCaptureRecord[];
  };
  const records = capture.records;
  const quoteRecord = records.find(
    (record) => record.context === "quote:IQuoter:WETH_TO_USDC",
  );
  const preparedCallRecord = records.find(
    (record) => record.context === "preparedSwap.ethCall",
  );
  const preparedGasRecord = records.find(
    (record) => record.context === "preparedSwap.ethEstimateGas",
  );
  if (
    quoteRecord?.response.result === undefined ||
    preparedCallRecord?.response.result === undefined ||
    preparedGasRecord?.response.result === undefined
  ) {
    throw new Error(
      "canonical BE-063 capture is missing prepared swap records",
    );
  }

  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const client: ArbitrumRpcClient = {
    async request(method, params = []) {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x66eee";
      if (method === "eth_getBlockByNumber") {
        return {
          number: capture.observations.pinnedBlock.number,
          hash: capture.observations.pinnedBlock.hash,
        };
      }
      if (method === "eth_call") {
        const transaction = params[0] as { readonly to?: unknown } | undefined;
        const target =
          typeof transaction?.to === "string"
            ? transaction.to.toLowerCase()
            : undefined;
        if (target === CAMELOT_SEPOLIA_QUOTER.toLowerCase()) {
          return quoteRecord.response.result;
        }
        if (target === CAMELOT_SEPOLIA_ROUTER.toLowerCase()) {
          return preparedCallRecord.response.result;
        }
      }
      if (method === "eth_estimateGas") {
        return preparedGasRecord.response.result;
      }
      throw new Error(`unexpected canonical fixture RPC method ${method}`);
    },
  };
  return { calls, client, capture, quoteRecord };
}

type TraceRpcReplayOptions = {
  readonly contextFailure?: "chain_mismatch" | "block_mismatch";
  readonly capabilityFailure?: "timeout" | "unsupported" | "malformed";
  readonly failCapability?: "callTracer" | "prestateTracerDiff";
  readonly failCapabilities?: boolean;
};

function traceRpcReplay(
  replay: ReturnType<typeof canonicalRealRpcReplay>,
  options: TraceRpcReplayOptions = {},
) {
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const client: TraceRpcClient = {
    async request(method, params = []) {
      calls.push({ method, params });
      if (method === "eth_chainId") {
        if (options.contextFailure === "chain_mismatch") return "0x1";
        return replay.client.request(method, params);
      }
      if (method === "eth_getBlockByNumber") {
        if (options.contextFailure === "block_mismatch") {
          return {
            number: "0x1",
            hash: replay.capture.observations.pinnedBlock.hash,
          };
        }
        return replay.client.request(method, params);
      }
      if (method !== "debug_traceCall") {
        throw new Error(`unexpected trace fixture RPC method ${method}`);
      }
      const config = params[2] as { readonly tracer?: string };
      const capability =
        config.tracer === "callTracer" ? "callTracer" : "prestateTracerDiff";
      const shouldFail =
        options.failCapabilities === true ||
        options.failCapability === capability;
      if (shouldFail && options.capabilityFailure === "timeout") {
        throw new NativeRpcClientError("TIMEOUT", "controlled trace timeout");
      }
      if (shouldFail && options.capabilityFailure === "unsupported") {
        throw new NativeRpcClientError(
          "RPC_ERROR",
          "method unsupported",
          -32601,
        );
      }
      if (shouldFail && options.capabilityFailure === "malformed") {
        return {};
      }
      if (options.failCapabilities === true) {
        throw new Error("controlled trace capability failure");
      }

      const transaction = params[0] as {
        readonly from?: string;
        readonly to?: string;
        readonly data?: string;
        readonly value?: string;
      };
      if (config.tracer === "callTracer") {
        return {
          type: "CALL",
          from: transaction.from,
          to: transaction.to,
          input: transaction.data,
          value: transaction.value,
          gasUsed: "0x1",
          output: "0x1234",
        };
      }
      if (config.tracer === "prestateTracer") {
        return {
          pre: { [transaction.from ?? ""]: {} },
          post: { [transaction.to ?? ""]: {} },
        };
      }
      throw new Error("unexpected trace configuration");
    },
  };
  return { calls, client };
}

function createTraceBackendFixture(options: TraceRpcReplayOptions = {}) {
  const replay = canonicalRealRpcReplay();
  const traceReplay = traceRpcReplay(replay, options);
  const blockNumber = String(
    BigInt(replay.capture.observations.pinnedBlock.number),
  );
  const tokenRegistry = {
    chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
    tokens: [
      {
        chainId: 421614,
        address: CAMELOT_SEPOLIA_USDC,
        symbol: "USDC",
        decimals: 18,
        decimalsSource: "onchain_verified" as const,
        verifiedAtBlock: blockNumber,
      },
    ],
  };
  const runtime = bootstrapBackendRuntime({
    environment: arbitrumEnvironment,
    tokenRegistry,
  });
  const store = new InMemoryRunStore();
  const source = createTraceRpcEvidenceSource({
    client: traceReplay.client,
    mode: "RECORDED_REPLAY",
    now: () => "2026-09-28T12:10:00.000Z",
  });
  const composition = createArbitrumProductionComposition({
    runtime,
    runStore: store,
    rpcClient: replay.client,
    traceRpcEvidenceSource: source,
  });
  const app = bootstrapBackendApp({
    environment: arbitrumEnvironment,
    tokenRegistry,
    arbitrumComposition: composition,
  });
  return { app, blockNumber, replay, store, traceReplay };
}

function traceCheckRequest(): Request {
  return new Request("https://api.example.test/api/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: 421614,
      protocol: "camelot-v3",
      sender: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
      amountIn: "0.001",
      economicBoundary: {
        availability: "unavailable",
        source: "unavailable",
      },
    }),
  });
}

describe("Arbitrum production composition skeleton", () => {
  it("bootstraps runtime and composition without starting a server", () => {
    const input = options();
    const { runtime: _runtime, ...compositionOptions } = input;
    const bootstrapped = bootstrapArbitrumBackend({
      ...compositionOptions,
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        ARBITRUM_RPC_URL: "https://arbitrum.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [],
      },
    });

    expect(bootstrapped.runtime.config.arbitrum?.protocolId).toBe("camelot-v3");
    expect(bootstrapped.composition.resolveChain(421614).chainId).toBe(421614);
  });

  it("selects the exact Arbitrum chain, Camelot protocol, and injected provider", () => {
    const composition = createArbitrumProductionComposition(options());

    expect(composition.resolveChain(421614).chainId).toBe(421614);
    expect(composition.resolveProtocol(421614, "camelot-v3").protocolId).toBe(
      "camelot-v3",
    );
    expect(
      composition.resolveProvider({
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      }).providerId,
    ).toBe("controlled-arbitrum-provider");
  });

  it("selects Tenderly as the configured production provider", () => {
    const runtime = bootstrapBackendRuntime({
      environment: {
        ...arbitrumEnvironment,
        TENDERLY_ACCOUNT_SLUG: "account",
        TENDERLY_PROJECT_SLUG: "project",
        TENDERLY_ACCESS_KEY: "test-secret",
      },
      tokenRegistry: arbitrumTokenRegistry,
    });
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime),
    );

    expect(
      composition.resolveProvider({
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      }).providerId,
    ).toBe(TENDERLY_ARBITRUM_PROVIDER_ID);
  });

  it("keeps Native RPC as the default when Tenderly is not configured", () => {
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(arbitrumRuntime()),
    );

    expect(
      composition.resolveProvider({
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      }).providerId,
    ).toBe(NATIVE_RPC_ARBITRUM_PROVIDER_ID);
  });

  it("binds the production Camelot adapter to trusted token decimals", async () => {
    const amountOut = 2n * 10n ** 6n;
    const composition = createArbitrumProductionComposition({
      runtime: arbitrumRuntime(),
      runStore: new InMemoryRunStore(),
      rpcClient: {
        request: async () =>
          `0x${amountOut.toString(16).padStart(64, "0")}${"0".repeat(64)}`,
      },
      providers: [],
      core: { evaluate: async (input) => input },
      decision: { decide: async (input) => input },
    });
    const productionIntent: NormalizedSwapIntent = {
      ...normalizedIntent,
      amountInAtomic: "1000000000000000000",
      tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
    };
    const protocol = composition.resolveProtocol(421614, "camelot-v3");
    const blockContext = { blockNumber: "42" };
    const quote = await protocol.quote(productionIntent, { blockContext });
    const transaction = await protocol.buildTransaction(productionIntent, {
      blockContext,
      quote,
    });

    expect(quote).toMatchObject({ estimatedAmountOut: "2" });
    const calldata = String(transaction.payload.data);
    const amountOutMinimum = BigInt(
      `0x${calldata.slice(2 + 8 + 5 * 64, 2 + 8 + 6 * 64)}`,
    );
    expect(amountOutMinimum).toBe(1_980_000n);
  });

  it("projects non-success Native RPC evidence through the public check response", async () => {
    const runtime = arbitrumRuntime();
    const provider = createFakeProviderAdapter<NormalizedSwapIntent>({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      intent: normalizedIntent,
      chainId: 421614,
      protocol: "camelot-v3",
      capabilities: ["simulate", "eth_call", "estimateGas", "pinned-block"],
      mode: "LIVE",
      supports: () => true,
      result: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          observedAt: "2026-09-10T00:01:00.000Z",
        },
        status: "unknown",
        responseEvidence: {
          kind: "redacted_snapshot",
          redactionProfile: "native-rpc-method-results-v1",
          snapshot: { mode: "LIVE", status: "unknown" },
        },
        candidateFields: [
          {
            candidatePath: "nativeRpc.ethCall.returnData",
            observedShape: "hex_string",
            status: "observed",
            nullable: false,
            confidence: "high",
            value: "0xabcdef",
          },
          {
            candidatePath: "nativeRpc.estimateGas.gasUnits",
            observedShape: "decimal_string",
            status: "observed",
            nullable: false,
            confidence: "high",
            value: "21000",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      providers: [provider],
      protocolAdapter: createCamelotV3ProtocolAdapter({
        quote: async () => ({
          estimatedAmountOut: "0.5",
          minimumAmountOut: "0.4",
          runtimeVersion: "arbitrum-camelot-v3",
          runtimeRevision: "native-rpc",
        }),
        buildTransaction: async () => ({
          to: "0x2222222222222222222222222222222222222222",
          data: "0x1234",
          value: "0x0",
        }),
      }),
      core: { evaluate: async (input) => input },
      decision: {
        decide: async (_input, context) => {
          const pipelineContext = context as {
            runId: string;
            intent: NormalizedSwapIntent;
          };
          const result = economicFailStopResult(
            {
              sender: pipelineContext.intent.sender,
              mon: { kind: "native" },
              usdc: pipelineContext.intent.tokenOut as {
                kind: "erc20";
                address: string;
              },
              simulatorPinnedBlock: "42",
              runtimeVersion: "arbitrum-camelot-v3",
              runtimeRevision: "native-rpc",
            },
            pipelineContext.runId,
            pipelineContext.intent,
          );
          return {
            ...result,
            route: {
              ...result.route,
              protocol: pipelineContext.intent.protocol,
            },
          };
        },
      },
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: arbitrumTokenAddress,
          },
          amountIn: "1",
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.02",
            source: "user_declared",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        provenance: {
          source: "rpc",
          mode: "LIVE",
          simulationBlock: "42",
          runtime: {
            runtimeVersion: "arbitrum-camelot-v3",
            runtimeRevision: "native-rpc",
          },
        },
        checkedScope: ["native-rpc.eth_call", "native-rpc.estimateGas"],
        providerData: {},
      },
    });
    expect(JSON.stringify(body)).not.toContain("callReturnData");
    expect(JSON.stringify(body)).not.toContain("gasUnits");
  });

  it("accepts the LIVE Arbitrum composition runtime instead of the Moss runtime identity", async () => {
    // Regression for the P0 integration blocker: the authoritative runtime of a
    // provider-neutral composition Run is the LIVE provider Evidence's own
    // provenance runtime (arbitrum-camelot-v3 / native-rpc). The configured Moss
    // runtime identity is deliberately unrelated here and must not reject it.
    const blockHash = `0x${"ab".repeat(32)}`;
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_getBlockByNumber") {
          return { number: "0x2a", hash: blockHash };
        }
        if (method === "eth_estimateGas") return "0x426b4";
        if (method === "eth_call") {
          const transaction = params[0] as { to?: string } | undefined;
          if (
            transaction?.to?.toLowerCase() ===
            CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${15882896725531551n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          return "0x";
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        ],
      },
    });
    expect(runtime.config.moss.runtimeVersion).not.toBe("arbitrum-camelot-v3");
    expect(runtime.config.moss.runtimeRevision).not.toBe("native-rpc");
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient,
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountIn: "0.001",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      status?: string;
      verdict?: string;
      evidence?: Array<{ runtimeVersion?: string; runtimeRevision?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        provenance: {
          mode: "LIVE",
          source: "rpc",
          simulationBlock: "42",
          runtime: {
            runtimeVersion: "arbitrum-camelot-v3",
            runtimeRevision: "native-rpc",
          },
        },
      },
    });
    expect(body.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeVersion: "arbitrum-camelot-v3",
          runtimeRevision: "native-rpc",
        }),
      ]),
    );
  });

  it("accepts a bound LIVE Tenderly result through the public Arbitrum Check route", async () => {
    const blockHash = `0x${"cd".repeat(32)}`;
    const target = "0x2222222222222222222222222222222222222222";
    const runtime = arbitrumRuntime();
    const tenderlyProvider = createTenderlyProvider({
      accountSlug: "account",
      projectSlug: "project",
      accessKey: "test-secret",
      fetchImplementation: vi.fn(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          readonly from: string;
          readonly to: string;
          readonly input: string;
          readonly value: string;
          readonly network_id: string;
          readonly block_number: number;
          readonly gas?: number;
        };
        return Response.json({
          transaction: {
            ...request,
            block_hash: blockHash,
            gas: request.gas ?? 21000,
            status: true,
            gas_used: 19000,
            transaction_info: { asset_changes: [], balance_changes: [] },
          },
          simulation: {
            ...request,
            gas: request.gas ?? 21000,
            status: true,
          },
        });
      }) as typeof fetch,
      now: () => new Date("2026-09-17T00:00:00Z"),
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      chainAdapter: createFakeChainAdapter({
        chainId: 421614,
        blockNumber: "42",
        blockHash,
        observedAt: "2026-09-17T00:00:00Z",
        gasUnits: "21000",
        finality: { status: "finalized" },
      }),
      protocolAdapter: createCamelotV3ProtocolAdapter({
        quote: async () => ({
          estimatedAmountOut: "0.5",
          minimumAmountOut: "0.4",
          blockNumber: "42",
          runtimeVersion: "arbitrum-camelot-v3",
          runtimeRevision: "tenderly",
        }),
        buildTransaction: async () => ({
          from: normalizedIntent.sender,
          to: target,
          data: "0x1234",
          value: "0x0",
          gas: "0x5208",
          chainId: "0x66eee",
        }),
      }),
      providers: [tenderlyProvider],
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      providerEvidence: {
        provider: {
          providerId: TENDERLY_ARBITRUM_PROVIDER_ID,
          status: "SUCCESS",
        },
        provenance: {
          mode: "LIVE",
          source: "external",
          simulationBlock: "42",
          runtime: {
            runtimeVersion: "arbitrum-camelot-v3",
            runtimeRevision: "tenderly",
          },
        },
        checkedScope: expect.arrayContaining([
          "tenderly.execution",
          "tenderly.gas",
          "tenderly.pinned-block",
        ]),
        providerData: {},
      },
    });
  });

  it("does not label a Native RPC provider failure as Moss simulation", async () => {
    const runtime = arbitrumRuntime();
    const provider = createFakeProviderAdapter<NormalizedSwapIntent>({
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      intent: normalizedIntent,
      chainId: 421614,
      protocol: "camelot-v3",
      capabilities: ["simulate"],
      supports: () => false,
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime),
      providers: [provider],
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: {
            kind: "erc20",
            address: arbitrumTokenAddress,
          },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: {
        code: "UNSUPPORTED",
        message: "Provider evaluation is not available in this runtime",
      },
      run: {
        status: "integration_error",
        scope: [
          {
            key: "P0-CHECK-SIMULATION-001",
            label: "Provider evaluation",
            status: "unknown",
            reason: "REQUIRED_CHECK_INTERRUPTED",
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("Moss simulation");
  });

  it("requires an explicit Arbitrum endpoint when no controlled chain seam is supplied", () => {
    const input = options();
    const { chainAdapter: _chainAdapter, ...withoutChain } = input;
    const runtimeWithoutRpc = bootstrapBackendRuntime({
      environment: {
        MONAD_RPC_URL: "https://monad.example.test",
        MOSS_RUNTIME_VERSION: "fixture-runtime",
        MOSS_RUNTIME_REVISION: "fixture-revision",
      },
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [],
      },
    });
    expect(() =>
      createArbitrumProductionComposition({
        ...withoutChain,
        runtime: runtimeWithoutRpc,
      }),
    ).toThrow("Arbitrum RPC URL is required");
  });

  it("wires a configured Arbitrum RPC through Camelot and NativeRpcProvider", async () => {
    const blockHash = `0x${"ab".repeat(32)}`;
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_getBlockByNumber") {
          return { number: "0x2a", hash: blockHash };
        }
        if (method === "eth_estimateGas") return "0x426b4";
        if (method === "eth_call") {
          const transaction = params[0] as { to?: string } | undefined;
          if (
            transaction?.to?.toLowerCase() ===
            CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${15882896725531551n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          return "0x";
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient,
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const execution = await pipeline.executeNormalized(
      {
        ...normalizedIntent,
        tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
        amountInAtomic: "1000000000000000",
      },
      {
        rawInput: normalizedIntent as never,
        runId: "arbitrum-golden-path",
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      },
    );

    expect(execution.providerResult).toMatchObject({
      status: "success",
      provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
    });
    expect(execution.providerEvidence).toMatchObject({
      provider: {
        providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
        status: "UNKNOWN",
      },
      provenance: { mode: "LIVE", source: "rpc" },
      unknownScope: expect.arrayContaining(["receipt", "simulation"]),
    });
    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      providerEvidence: {
        provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
      },
    });
    expect(execution.unsignedTransaction.payload).toMatchObject({
      to: CAMELOT_SEPOLIA_ROUTER,
      chainId: "0x66eee",
    });
    const quoteCall = calls.find(
      ({ method, params }) =>
        method === "eth_call" &&
        (params[0] as { to?: string } | undefined)?.to?.toLowerCase() ===
          CAMELOT_SEPOLIA_QUOTER.toLowerCase(),
    );
    expect(quoteCall).toMatchObject({
      params: [
        {
          to: CAMELOT_SEPOLIA_QUOTER,
          data: expect.stringContaining(
            `2d9ebd1d${CAMELOT_SEPOLIA_WETH.slice(2).toLowerCase().padStart(64, "0")}${CAMELOT_SEPOLIA_USDC.slice(2).toLowerCase().padStart(64, "0")}${1000000000000000n.toString(16).padStart(64, "0")}`,
          ),
        },
        "0x2a",
      ],
    });
    const estimateCall = calls.find(
      ({ method }) => method === "eth_estimateGas",
    );
    expect(estimateCall).toMatchObject({
      params: [
        expect.objectContaining({
          to: CAMELOT_SEPOLIA_ROUTER,
          data: expect.stringContaining("bc651188"),
          chainId: "0x66eee",
        }),
      ],
    });
    expect(calls[2]).toMatchObject({
      method: "eth_call",
      params: [expect.anything(), "0x2a"],
    });
    expect(calls.map(({ method }) => method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
      "eth_getBlockByNumber",
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_estimateGas",
      "eth_getBlockByNumber",
    ]);
  });

  it("stops before Native RPC evaluation when the chain gas preflight reverts", async () => {
    const blockHash = `0x${"a".repeat(64)}`;
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    let gasRequests = 0;
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        if (method === "eth_getBlockByNumber") {
          return { number: "0x2a", hash: blockHash };
        }
        if (method === "eth_estimateGas") {
          gasRequests += 1;
          throw Object.assign(
            new Error(
              "execution reverted: network fetch failed while checking allowance",
            ),
            { rpcCode: 3 },
          );
        }
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_call") {
          const transaction = params[0] as { to?: string } | undefined;
          if (
            transaction?.to?.toLowerCase() ===
            CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${15882896725531551n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          throw new NativeRpcClientError("RPC_ERROR", "execution reverted", 3);
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: "42",
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient,
    });
    const pipeline = new BackendPipeline({ runtime: composition });

    await expect(
      pipeline.executeNormalized(
        {
          ...normalizedIntent,
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountInAtomic: "1000000000000000",
        },
        {
          rawInput: normalizedIntent as never,
          runId: "arbitrum-preflight-execution-revert",
          chainId: 421614,
          protocol: "camelot-v3",
          capability: "simulate",
        },
      ),
    ).rejects.toMatchObject({
      code: "EXECUTION_REVERT",
      operation: "estimateGas",
      chainId: 421614,
    });

    expect(gasRequests).toBe(1);
    expect(
      calls.filter(({ method }) => method === "eth_estimateGas"),
    ).toHaveLength(1);
    const callRequests = calls.filter(({ method }) => method === "eth_call");
    expect(callRequests).toHaveLength(1);
    expect(callRequests[0]?.params[0]).toMatchObject({
      to: CAMELOT_SEPOLIA_QUOTER,
    });
  });

  it("replays the committed QUALIFIED_REAL Camelot fixture through the production path", async () => {
    const replay = canonicalRealRpcReplay();
    const blockNumber = String(
      BigInt(replay.capture.observations.pinnedBlock.number),
    );
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: blockNumber,
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient: replay.client,
    });
    const pipeline = new BackendPipeline({ runtime: composition });
    const execution = await pipeline.executeNormalized(
      {
        chainId: 421614,
        protocol: "camelot-v3",
        sender: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
        recipient: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
        recipientSource: "explicit",
        tokenIn: { kind: "native" },
        tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
        amountInAtomic: "1000000000000000",
        economicBoundary: {
          availability: "unavailable",
          source: "unavailable",
        },
      },
      {
        rawInput: normalizedIntent as never,
        runId: "arbitrum-be-063-qualified-real",
        chainId: 421614,
        protocol: "camelot-v3",
        capability: "simulate",
      },
    );

    expect(execution.providerResult).toMatchObject({ status: "success" });
    expect(execution.providerEvidence).toMatchObject({
      provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
      quote: {
        value: { estimatedAmountOut: "0.015882896725531551" },
        blockNumber,
      },
      providerData: { nativeRpc: { gasUnits: "272052" } },
    });
    expect(execution.unsignedTransaction.payload).toMatchObject({
      to: CAMELOT_SEPOLIA_ROUTER,
      value: "0x38d7ea4c68000",
    });
    const quoteCall = replay.calls.find(
      ({ method, params }) =>
        method === "eth_call" &&
        (params[0] as { readonly to?: unknown } | undefined)?.to ===
          CAMELOT_SEPOLIA_QUOTER,
    );
    expect(quoteCall?.params[0]).toMatchObject(
      replay.quoteRecord.request.params[0] as Record<string, unknown>,
    );

    const publicResult = runResultSchema.parse(execution.decisionOutput);
    expect(publicResult.providerEvidence?.providerData).toEqual({});
  });

  it("invokes qualified Trace supplementary evidence on the exact Backend execution and persists its public projection", async () => {
    const replay = canonicalRealRpcReplay();
    const traceReplay = traceRpcReplay(replay);
    const source = createTraceRpcEvidenceSource({
      client: traceReplay.client,
      mode: "RECORDED_REPLAY",
      now: () => "2026-09-28T12:00:00.000Z",
    });
    const blockNumber = String(
      BigInt(replay.capture.observations.pinnedBlock.number),
    );
    const tokenRegistry = {
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [
        {
          chainId: 421614,
          address: CAMELOT_SEPOLIA_USDC,
          symbol: "USDC",
          decimals: 18,
          decimalsSource: "onchain_verified" as const,
          verifiedAtBlock: blockNumber,
        },
      ],
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry,
    });
    const store = new InMemoryRunStore();
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: store,
      rpcClient: replay.client,
      traceRpcEvidenceSource: source,
    });
    const app = bootstrapBackendApp({
      environment: arbitrumEnvironment,
      tokenRegistry,
      arbitrumComposition: composition,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountIn: "0.001",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      providerEvidence: {
        provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
        providerData: {
          traceRpc: {
            status: "success",
            source: {
              sourceId: "trace-rpc",
              sourceVersion: "trace-rpc-evidence-source-v1",
              mode: "RECORDED_REPLAY",
              observedAt: "2026-09-28T12:00:00.000Z",
            },
            binding: {
              runId: body.runId,
              chainId: 421614,
              protocol: "camelot-v3",
              blockContext: { blockNumber },
            },
            capabilities: {
              callTracer: {
                status: "observed",
                executionStatus: "succeeded",
                gasUsed: "0x1",
              },
              prestateTracerDiff: { status: "observed", diffMode: true },
            },
            checkedScope: [
              "trace-rpc.chain",
              "trace-rpc.pinned-block",
              "trace-rpc.callTracer",
              "trace-rpc.prestateTracer.diffMode",
            ],
          },
        },
      },
    });
    const publicTrace = body.providerEvidence?.providerData.traceRpc as
      | {
          readonly binding?: {
            readonly transactionFingerprint?: unknown;
          };
        }
      | undefined;
    expect(publicTrace?.binding?.transactionFingerprint).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    const publicSimulation = body.p0?.basicSimulation as
      | {
          readonly preparedTransactionFingerprint?: unknown;
        }
      | undefined;
    expect(publicTrace?.binding?.transactionFingerprint).toBe(
      publicSimulation?.preparedTransactionFingerprint,
    );
    const traceCalls = traceReplay.calls.filter(
      ({ method }) => method === "debug_traceCall",
    );
    expect(traceCalls).toHaveLength(2);
    const nativePreparedCall = replay.calls.find(
      ({ method, params }) =>
        method === "eth_call" &&
        (params[0] as { readonly to?: unknown } | undefined)?.to ===
          CAMELOT_SEPOLIA_ROUTER,
    );
    expect(nativePreparedCall).toBeDefined();
    for (const traceCall of traceCalls) {
      expect(traceCall.params[0]).toEqual(nativePreparedCall?.params[0]);
      expect(traceCall.params[1]).toBe(
        replay.capture.observations.pinnedBlock.number,
      );
    }
    expect(JSON.stringify(body)).not.toContain("storage");
    expect(JSON.stringify(body)).not.toContain("ARBITRUM_RPC_URL");
    expect(JSON.stringify(body)).not.toContain("0x1234");

    expect(body.evidencePresentation?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "native-rpc.eth_call",
          sourceCategory: "native_rpc",
          status: "checked",
        }),
        expect.objectContaining({
          key: "trace-rpc.callTracer",
          sourceCategory: "trace_rpc",
          status: "checked",
          mode: "RECORDED_REPLAY",
        }),
      ]),
    );

    const traceCallsBeforeHistoricalRead = traceReplay.calls.length;
    const nativeCallsBeforeHistoricalRead = replay.calls.length;
    const storedResponse = await app.fetch(
      new Request(`https://api.example.test/api/runs/${body.runId}`),
    );
    const storedRecord = (await storedResponse.json()) as {
      readonly result?: unknown;
    };
    const stored = runResultSchema.parse(storedRecord.result);

    expect(storedResponse.status).toBe(200);
    expect(stored.providerEvidence?.providerData.traceRpc).toEqual(
      body.providerEvidence?.providerData.traceRpc,
    );
    expect(JSON.stringify(stored)).not.toContain("0x1234");
    expect(stored.evidencePresentation).toEqual(body.evidencePresentation);
    expect(traceReplay.calls).toHaveLength(traceCallsBeforeHistoricalRead);
    expect(replay.calls).toHaveLength(nativeCallsBeforeHistoricalRead);
  });

  it("keeps Native facts and a truthful missing Trace scope when the supplementary source fails", async () => {
    const replay = canonicalRealRpcReplay();
    const traceReplay = traceRpcReplay(replay, { failCapabilities: true });
    const source = createTraceRpcEvidenceSource({
      client: traceReplay.client,
      mode: "RECORDED_REPLAY",
      now: () => "2026-09-28T12:05:00.000Z",
    });
    const blockNumber = String(
      BigInt(replay.capture.observations.pinnedBlock.number),
    );
    const tokenRegistry = {
      chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
      tokens: [
        {
          chainId: 421614,
          address: CAMELOT_SEPOLIA_USDC,
          symbol: "USDC",
          decimals: 18,
          decimalsSource: "onchain_verified" as const,
          verifiedAtBlock: blockNumber,
        },
      ],
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry,
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient: replay.client,
      traceRpcEvidenceSource: source,
    });
    const app = bootstrapBackendApp({
      environment: arbitrumEnvironment,
      tokenRegistry,
      arbitrumComposition: composition,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountIn: "0.001",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        quote: { value: { estimatedAmountOut: "0.015882896725531551" } },
        providerData: {
          traceRpc: {
            status: "unknown",
            unknownScope: [
              "trace-rpc.callTracer",
              "trace-rpc.prestateTracer.diffMode",
            ],
            unavailableScope: [],
          },
        },
      },
    });
    const publicTrace = body.providerEvidence?.providerData.traceRpc as
      | {
          readonly capabilities?: unknown;
        }
      | undefined;
    expect(publicTrace?.capabilities).toEqual({
      callTracer: { status: "unknown", reason: "rpc_unavailable" },
      prestateTracerDiff: { status: "unknown", reason: "rpc_unavailable" },
    });
  });

  it.each([
    {
      name: "a chain context mismatch",
      options: { contextFailure: "chain_mismatch" },
      expected: {
        status: "invalid",
        call: { status: "unknown", reason: "context_unverified" },
        diff: { status: "unknown", reason: "context_unverified" },
        checkedScope: [],
        unknownScope: [
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unavailableScope: [],
      },
    },
    {
      name: "a pinned block context mismatch",
      options: { contextFailure: "block_mismatch" },
      expected: {
        status: "invalid",
        call: { status: "unknown", reason: "context_unverified" },
        diff: { status: "unknown", reason: "context_unverified" },
        checkedScope: ["trace-rpc.chain"],
        unknownScope: [
          "trace-rpc.pinned-block",
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unavailableScope: [],
      },
    },
    {
      name: "a capability timeout",
      options: {
        capabilityFailure: "timeout",
        failCapability: "callTracer",
      },
      expected: {
        status: "partial",
        call: { status: "unknown", reason: "timeout" },
        diff: { status: "observed" },
        checkedScope: [
          "trace-rpc.chain",
          "trace-rpc.pinned-block",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unknownScope: ["trace-rpc.callTracer"],
        unavailableScope: [],
      },
    },
    {
      name: "an unsupported capability method",
      options: {
        capabilityFailure: "unsupported",
        failCapability: "callTracer",
      },
      expected: {
        status: "partial",
        call: { status: "unavailable", reason: "method_unsupported" },
        diff: { status: "observed" },
        checkedScope: [
          "trace-rpc.chain",
          "trace-rpc.pinned-block",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unknownScope: [],
        unavailableScope: ["trace-rpc.callTracer"],
      },
    },
    {
      name: "a malformed capability response",
      options: {
        capabilityFailure: "malformed",
        failCapability: "callTracer",
      },
      expected: {
        status: "partial",
        call: { status: "unknown", reason: "malformed_response" },
        diff: { status: "observed" },
        checkedScope: [
          "trace-rpc.chain",
          "trace-rpc.pinned-block",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unknownScope: ["trace-rpc.callTracer"],
        unavailableScope: [],
      },
    },
    {
      name: "both capabilities unavailable",
      options: {
        capabilityFailure: "unsupported",
        failCapabilities: true,
      },
      expected: {
        status: "unavailable",
        call: { status: "unavailable", reason: "method_unsupported" },
        diff: { status: "unavailable", reason: "method_unsupported" },
        checkedScope: ["trace-rpc.chain", "trace-rpc.pinned-block"],
        unknownScope: [],
        unavailableScope: [
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
      },
    },
  ] as const)(
    "keeps the primary Native result for $name",
    async ({ options, expected }) => {
      const fixture = createTraceBackendFixture(options);
      const response = await fixture.app.fetch(traceCheckRequest());
      const body = runResultSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(body.providerEvidence).toMatchObject({
        provider: { providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID },
        quote: { value: { estimatedAmountOut: "0.015882896725531551" } },
        providerData: {
          traceRpc: {
            status: expected.status,
            capabilities: {
              callTracer: expected.call,
              prestateTracerDiff: expected.diff,
            },
            checkedScope: expected.checkedScope,
            unknownScope: expected.unknownScope,
            unavailableScope: expected.unavailableScope,
          },
        },
      });

      const publicTrace = body.providerEvidence?.providerData.traceRpc;
      const presentation = body.evidencePresentation;
      expect(
        presentation?.capabilities.some(
          (item) => item.sourceCategory === "native_rpc",
        ),
      ).toBe(true);
      for (const key of expected.checkedScope) {
        expect(presentation?.capabilities).toContainEqual(
          expect.objectContaining({
            key,
            sourceCategory: "trace_rpc",
            status: "checked",
          }),
        );
      }
      for (const key of expected.unknownScope) {
        expect(presentation?.capabilities).toContainEqual(
          expect.objectContaining({
            key,
            sourceCategory: "trace_rpc",
            status: "unknown",
          }),
        );
      }
      for (const key of expected.unavailableScope) {
        expect(presentation?.capabilities).toContainEqual(
          expect.objectContaining({
            key,
            sourceCategory: "trace_rpc",
            status: "unavailable",
          }),
        );
      }
      const traceCallsBeforeHistoricalRead = fixture.traceReplay.calls.length;
      const nativeCallsBeforeHistoricalRead = fixture.replay.calls.length;
      const storedResponse = await fixture.app.fetch(
        new Request(`https://api.example.test/api/runs/${body.runId}`),
      );
      const storedRecord = (await storedResponse.json()) as {
        readonly result?: unknown;
      };
      const stored = runResultSchema.parse(storedRecord.result);

      expect(storedResponse.status).toBe(200);
      expect(stored.providerEvidence?.providerData.traceRpc).toEqual(
        publicTrace,
      );
      expect(stored.evidencePresentation).toEqual(presentation);
      expect(fixture.traceReplay.calls).toHaveLength(
        traceCallsBeforeHistoricalRead,
      );
      expect(fixture.replay.calls).toHaveLength(
        nativeCallsBeforeHistoricalRead,
      );
      await fixture.app.close();
    },
  );

  it("persists the Native RPC P0 facts through POST /api/check and GET /api/runs", async () => {
    const replay = canonicalRealRpcReplay();
    const blockNumber = String(
      BigInt(replay.capture.observations.pinnedBlock.number),
    );
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: blockNumber,
          },
        ],
      },
    });
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: new InMemoryRunStore(),
      rpcClient: replay.client,
    });
    const app = bootstrapBackendApp({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: blockNumber,
          },
        ],
      },
      arbitrumComposition: composition,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountIn: "0.001",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      p0: {
        basicSimulation: {
          call: { status: "SUCCEEDED" },
          gasEstimate: { status: "AVAILABLE" },
          blockNumber,
          validityAtExecution: "VALID",
          transactionBinding: {
            chainId: 421614,
            protocol: "camelot-v3",
            amountInAtomic: "1000000000000000",
          },
        },
      },
      providerEvidence: { providerData: {} },
    });
    const runId = body.runId;

    const rpcCallsBeforeHistoricalRead = replay.calls.length;
    const storedResponse = await app.fetch(
      new Request(`https://api.example.test/api/runs/${runId}`),
    );
    const storedRecord = (await storedResponse.json()) as {
      readonly result?: unknown;
    };
    const stored = runResultSchema.parse(storedRecord.result);

    expect(storedResponse.status).toBe(200);
    expect(stored.p0?.basicSimulation).toEqual(body.p0?.basicSimulation);
    expect(JSON.stringify(stored)).not.toContain("callReturnData");
    expect(stored.providerEvidence?.providerData).toEqual({});
    expect(replay.calls).toHaveLength(rpcCallsBeforeHistoricalRead);
  });

  it("persists partial call-success/gas-failure facts through POST /api/check and GET /api/runs", async () => {
    const replay = canonicalRealRpcReplay();
    const blockNumber = String(
      BigInt(replay.capture.observations.pinnedBlock.number),
    );
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: {
        chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
        tokens: [
          {
            chainId: 421614,
            address: CAMELOT_SEPOLIA_USDC,
            symbol: "USDC",
            decimals: 18,
            decimalsSource: "onchain_verified" as const,
            verifiedAtBlock: blockNumber,
          },
        ],
      },
    });
    const gasFailureRpc: ArbitrumRpcClient = {
      async request(method, params = []) {
        if (method === "eth_estimateGas") {
          throw new Error("controlled eth_estimateGas failure");
        }
        return replay.client.request(method, params);
      },
    };
    const store = new InMemoryRunStore();
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: store,
      rpcClient: gasFailureRpc,
      // Keep the Chain seam successful so the Provider owns the partial
      // eth_call/gas-estimate result exercised by this regression.
      chainAdapter: createFakeChainAdapter({
        chainId: 421614,
        blockNumber,
        blockHash: replay.capture.observations.pinnedBlock.hash,
        gasUnits: "272052",
        finality: { status: "finalized" },
      }),
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          amountIn: "0.001",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const body = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      p0: {
        basicSimulation: {
          call: { status: "SUCCEEDED" },
          gasEstimate: { status: "UNAVAILABLE" },
          blockNumber,
          validityAtExecution: "UNKNOWN",
          failureStage: "GAS_ESTIMATE",
        },
      },
      providerEvidence: { providerData: {} },
    });
    expect(JSON.stringify(body)).not.toContain("callReturnData");

    const callsBeforeRead = replay.calls.length;
    const storedResponse = await app.fetch(
      new Request(`https://api.example.test/api/runs/${body.runId}`),
    );
    const storedRecord = (await storedResponse.json()) as {
      readonly result?: unknown;
    };
    const stored = runResultSchema.parse(storedRecord.result);

    expect(storedResponse.status).toBe(200);
    expect(stored.p0?.basicSimulation).toEqual(body.p0?.basicSimulation);
    expect(stored.providerEvidence?.providerData).toEqual({});
    expect(JSON.stringify(stored)).not.toContain("callReturnData");
    expect(replay.calls).toHaveLength(callsBeforeRead);
  });

  it("normalizes Arbitrum quotes through the public app and reaches Camelot", async () => {
    const runtime = arbitrumRuntime();
    let receivedIntent: NormalizedSwapIntent | undefined;
    const protocolAdapter = createCamelotV3ProtocolAdapter({
      quote: async (intent) => {
        receivedIntent = intent;
        return {
          status: "available",
          quote: {
            estimatedAmountOut: "0.5",
            source: "quote",
            blockNumber: "42",
            runtimeVersion: "camelot-fixture-runtime",
            runtimeRevision: "camelot-fixture-revision",
          },
        };
      },
    });
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime, protocolAdapter),
    );
    const app = createBackendApp({
      runtime,
      // createBackendApp predates specialized composition input unions.
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "available",
      quote: {
        estimatedAmountOut: "0.5",
        blockNumber: "42",
        runtimeVersion: "camelot-fixture-runtime",
        runtimeRevision: "camelot-fixture-revision",
      },
    });
    expect(receivedIntent).toMatchObject({
      chainId: 421614,
      protocol: "camelot-v3",
      amountInAtomic: "1000000000000000000",
      economicBoundary: { availability: "unavailable" },
    });
  });

  it("preserves quote acquisition time and uses it instead of block observation time", async () => {
    const blockObservedAt = "2026-09-30T12:00:00.000Z";
    const sourceFetchedAt = "2026-09-30T12:01:00.000Z";
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: reverseCamelotTokenRegistry,
    });
    let quoteCount = 0;
    const protocolAdapter = createCamelotV3ProtocolAdapter({
      quote: async () => {
        quoteCount += 1;
        const quote = {
          estimatedAmountOut: "0.000062941960793078",
          source: "quote",
          blockNumber: "42",
          ...(quoteCount === 1 || quoteCount === 3
            ? { fetchedAt: sourceFetchedAt }
            : {}),
          ...(quoteCount === 3 ? { adapterQuoteId: "adapter-quote-3" } : {}),
          runtimeVersion: "camelot-reverse-fixture-runtime",
          runtimeRevision: "camelot-reverse-fixture-revision",
        };
        return quoteCount === 3 ? quote : { status: "available", quote };
      },
    });
    const composition = createArbitrumProductionComposition({
      ...arbitrumCompositionOptions(runtime, protocolAdapter),
      chainAdapter: createFakeChainAdapter({
        chainId: 421614,
        blockNumber: "42",
        observedAt: blockObservedAt,
        gasUnits: "21000",
        finality: { status: "finalized" },
      }),
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const fetchQuote = async () => {
      const response = await app.fetch(
        new Request("https://api.example.test/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId: 421614,
            protocol: "camelot-v3",
            sender: "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d",
            tokenIn: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
            tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_WETH },
            amountIn: "0.001",
          }),
        }),
      );
      return {
        response,
        body: (await response.json()) as {
          quote?: { fetchedAt?: string; estimatedAmountOut?: string };
        },
      };
    };

    try {
      const withSourceTime = await fetchQuote();
      expect(quoteCount).toBe(1);
      expect(
        withSourceTime.response.status,
        JSON.stringify(withSourceTime.body),
      ).toBe(200);
      expect(withSourceTime.body.quote).toMatchObject({
        estimatedAmountOut: "0.000062941960793078",
        blockNumber: "42",
        fetchedAt: sourceFetchedAt,
      });

      const fallbackWindowStart = Date.now();
      const withoutSourceTime = await fetchQuote();
      expect(withoutSourceTime.response.status).toBe(200);
      expect(withoutSourceTime.body.quote).toMatchObject({
        estimatedAmountOut: "0.000062941960793078",
        blockNumber: "42",
      });
      expect(
        Date.parse(withoutSourceTime.body.quote?.fetchedAt ?? ""),
      ).toBeGreaterThanOrEqual(fallbackWindowStart);
      expect(
        Date.parse(withoutSourceTime.body.quote?.fetchedAt ?? ""),
      ).toBeLessThanOrEqual(Date.now());

      const fallbackShape = await fetchQuote();
      expect(fallbackShape.response.status).toBe(200);
      expect(fallbackShape.body.quote).toMatchObject({
        estimatedAmountOut: "0.000062941960793078",
        blockNumber: "42",
        fetchedAt: sourceFetchedAt,
      });
    } finally {
      await app.close();
    }
  });

  it("checks USDC to WETH through the public route with exact unsigned binding and immutable history", async () => {
    const sender = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
    const recipient = "0x2222222222222222222222222222222222222222";
    const blockHash = `0x${"ab".repeat(32)}`;
    const blockNumber = "0x2a";
    const amountOutAtomic = 62_941_960_793_078n;
    const minimumReceivedAtomic = "60000000000000";
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const rpcClient: ArbitrumRpcClient = {
      async request(method, params = []) {
        calls.push({ method, params });
        if (method === "eth_chainId") return "0x66eee";
        if (method === "eth_getBlockByNumber") {
          return { number: blockNumber, hash: blockHash };
        }
        if (method === "eth_estimateGas") return "0x426b4";
        if (method === "eth_call") {
          const transaction = params[0] as { readonly to?: unknown };
          if (
            typeof transaction?.to === "string" &&
            transaction.to.toLowerCase() ===
              CAMELOT_SEPOLIA_QUOTER.toLowerCase()
          ) {
            return `0x${amountOutAtomic.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
          }
          return "0x";
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const runtime = bootstrapBackendRuntime({
      environment: arbitrumEnvironment,
      tokenRegistry: reverseCamelotTokenRegistry,
    });
    const store = new InMemoryRunStore();
    const composition = createArbitrumProductionComposition({
      runtime,
      runStore: store,
      rpcClient,
    });
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender,
          recipient,
          tokenIn: { kind: "erc20", address: CAMELOT_SEPOLIA_USDC },
          tokenOut: { kind: "erc20", address: CAMELOT_SEPOLIA_WETH },
          amountIn: "0.001",
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.00006",
            source: "user_declared",
          },
        }),
      }),
    );
    const body = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      intent: {
        sender,
        recipient,
      },
      providerEvidence: {
        provider: {
          providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
          status: "UNKNOWN",
        },
        quote: {
          value: { estimatedAmountOut: "0.000062941960793078" },
          blockNumber: "42",
        },
      },
      p0: {
        transactionProtection: {
          minimumReceivedAtomic,
          source: "user_declared",
        },
      },
    });

    const quoteCall = calls.find(
      ({ method, params }) =>
        method === "eth_call" &&
        (params[0] as { readonly to?: unknown } | undefined)?.to ===
          CAMELOT_SEPOLIA_QUOTER,
    );
    expect(quoteCall).toMatchObject({
      params: [
        {
          data: expect.stringContaining(
            `${CAMELOT_SEPOLIA_USDC.slice(2).toLowerCase().padStart(64, "0")}${CAMELOT_SEPOLIA_WETH.slice(2).toLowerCase().padStart(64, "0")}${1000000000000000n.toString(16).padStart(64, "0")}`,
          ),
        },
        blockNumber,
      ],
    });

    const routerCalls = calls.filter(
      ({ method, params }) =>
        method === "eth_call" &&
        (params[0] as { readonly to?: unknown } | undefined)?.to ===
          CAMELOT_SEPOLIA_ROUTER,
    );
    expect(routerCalls).toHaveLength(1);
    const transaction = routerCalls[0]?.params[0] as {
      readonly chainId: string;
      readonly data: string;
      readonly from: string;
      readonly to: string;
      readonly value: string;
    };
    const calldataWord = (index: number) =>
      transaction.data.slice(10 + index * 64, 10 + (index + 1) * 64);
    expect(transaction).toMatchObject({
      from: sender,
      to: CAMELOT_SEPOLIA_ROUTER,
      chainId: "0x66eee",
      value: "0x0",
    });
    expect(transaction.data).toMatch(/^0xbc651188/);
    expect(calldataWord(0)).toBe(
      CAMELOT_SEPOLIA_USDC.slice(2).toLowerCase().padStart(64, "0"),
    );
    expect(calldataWord(1)).toBe(
      CAMELOT_SEPOLIA_WETH.slice(2).toLowerCase().padStart(64, "0"),
    );
    expect(calldataWord(2)).toBe(
      recipient.slice(2).toLowerCase().padStart(64, "0"),
    );
    expect(BigInt(`0x${calldataWord(3)}`)).toBeGreaterThan(0n);
    expect(BigInt(`0x${calldataWord(4)}`)).toBe(1000000000000000n);
    expect(BigInt(`0x${calldataWord(5)}`)).toBe(BigInt(minimumReceivedAtomic));
    expect(BigInt(`0x${calldataWord(6)}`)).toBe(0n);
    expect(
      calls.some(({ method }) => method === "eth_sendRawTransaction"),
    ).toBe(false);

    const callsBeforeHistoryRead = calls.length;
    const historyResponse = await app.fetch(
      new Request(`https://api.example.test/api/runs/${body.runId}`),
    );
    const historyRecord = (await historyResponse.json()) as {
      readonly result?: unknown;
    };
    const history = runResultSchema.parse(historyRecord.result);
    expect(historyResponse.status).toBe(200);
    expect(history.p0).toEqual(body.p0);
    expect(history.providerEvidence).toEqual(body.providerEvidence);
    expect(calls).toHaveLength(callsBeforeHistoryRead);
  });

  it("continues to normalize Arbitrum checks at the public app boundary", async () => {
    const runtime = arbitrumRuntime();
    let receivedIntent: NormalizedSwapIntent | undefined;
    const composition = createArbitrumProductionComposition(
      arbitrumCompositionOptions(runtime),
    );
    const app = createBackendApp({
      runtime,
      // createBackendApp predates specialized composition input unions.
      composition: composition as unknown as BackendCompositionRuntime,
      agentFlow: {
        async check(input) {
          receivedIntent = input.intent;
          throw new UnsupportedAgentFlowError();
        },
      },
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: "0x1111111111111111111111111111111111111111",
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "1",
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED" },
    });
    expect(receivedIntent).toMatchObject({
      chainId: 421614,
      protocol: "camelot-v3",
      amountInAtomic: "1000000000000000000",
      economicBoundary: { availability: "unavailable" },
    });
  });

  it("publishes provider-neutral P0 diagnosis at POST /api/check", async () => {
    const runtime = arbitrumRuntime();
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runtime,
        providerEvidenceMapper: ({ normalizedIntent }) => {
          const evidence = p0VerifiedEvidence(
            normalizedIntent as NormalizedSwapIntent,
          );
          return genericEvidenceSchema.parse({
            ...evidence,
            providerData: { rawRpcResponse: { secret: "must-not-leak" } },
          });
        },
      }),
    );
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "0.000000000000001",
          expectationBaseline: p0ExpectationBaseline,
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        }),
      }),
    );
    const result = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      status: "completed",
      p0: {
        expectationBaseline: {
          status: "AVAILABLE",
          amountOutAtomic: "490000",
          blockNumber: "41",
        },
        quoteFidelity: { status: "VERIFIED" },
        cause: { status: "NOT_VERIFIED" },
        evidenceState: "VERIFIED",
      },
      providerEvidence: { providerData: {} },
    });
  });
});

const p0IntentAmountInAtomic = "1000";
const p0AuthorizedIntent: NormalizedSwapIntent = {
  ...normalizedIntent,
  amountInIncreaseAuthorization: {
    availability: "available",
    source: "user_declared",
    consent: true,
    maximumAmountInAtomic: "3000",
  },
};
const p0ObservedAt = "2026-09-01T00:00:00.000Z";

function p0Field<T>(value: T) {
  return {
    value,
    source: "rpc" as const,
    reproducibility: "REPRODUCIBLE" as const,
    blockNumber: "42",
    fetchedAt: p0ObservedAt,
  };
}

/**
 * A fully verified provider-neutral observation, used only to prove that the
 * default Arbitrum decision obeys the P0 Risk verdict. It is never a claim
 * about real Native RPC evidence.
 */
function p0VerifiedEvidence(
  intent: NormalizedSwapIntent = normalizedIntent,
  options: {
    estimatedAmountOut?: string;
    amountReceivedAtomic?: string;
  } = {},
): GenericEvidence {
  const estimatedAmountOut = options.estimatedAmountOut ?? "0.5";
  const amountReceivedAtomic = options.amountReceivedAtomic ?? "500000";
  const minimumReceived =
    intent.economicBoundary.availability === "available"
      ? convertAtomicAmountToHuman(
          intent.economicBoundary.minimumReceivedAtomic,
          6,
        )
      : undefined;
  return genericEvidenceSchema.parse({
    intent: {
      chainId: 421614,
      protocol: "camelot-v3",
      sender: intent.sender,
      tokenIn: "native",
      tokenOut: arbitrumTokenAddress,
      amountIn: convertAtomicAmountToHuman(intent.amountInAtomic, 18),
      ...(minimumReceived === undefined
        ? { minimumReceivedSource: "unavailable" }
        : {
            minimumReceived,
            minimumReceivedSource: intent.economicBoundary.source,
          }),
    },
    provider: {
      providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      status: "SUCCESS",
      integrationStatus: "OK",
      errors: p0Field([]),
    },
    execution: { status: "SUCCESS" },
    quote: {
      value: { estimatedAmountOut },
      source: "quote",
      reproducibility: "REPRODUCIBLE",
      blockNumber: "42",
      fetchedAt: p0ObservedAt,
    },
    action: p0Field([{ transactionFingerprint: `sha256:${"4".repeat(64)}` }]),
    receipt: p0Field({
      status: "success",
      transactionFingerprint: `sha256:${"4".repeat(64)}`,
      blockHash: `0x${"5".repeat(64)}`,
    }),
    outcome: p0Field({
      amountReceivedAtomic,
      derivation: "recipient_balance_delta",
      derivationVersion: "synthetic-recipient-snapshot/v1",
      inputEvidenceKeys: ["live:outcome"],
      balanceBeforeAtomic: "0",
      balanceAfterAtomic: amountReceivedAtomic,
      amountInAtomic: intent.amountInAtomic,
      evaluatedAmountIn: convertAtomicAmountToHuman(intent.amountInAtomic, 18),
      transactionFingerprint: `sha256:${"4".repeat(64)}`,
      blockHash: `0x${"5".repeat(64)}`,
      recipient: intent.recipient,
      tokenOut: arbitrumTokenAddress,
    }),
    assetChanges: p0Field([]),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: p0Field([]),
    simulation: {
      value: {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      source: "derived",
      reproducibility: "REPRODUCIBLE",
      blockNumber: "42",
      fetchedAt: p0ObservedAt,
    },
    blockNumber: p0Field("42"),
    capabilities: ["quote"],
    provenance: {
      observedChainId: 421614,
      fetchedAt: p0ObservedAt,
      mode: "LIVE",
      source: "rpc",
      simulationBlock: "42",
      runtime: {
        runtimeVersion: "arbitrum-camelot-v3",
        runtimeRevision: "native-rpc",
      },
    },
    checkedScope: ["quote"],
    unknownScope: [],
    providerData: {},
  });
}

const p0ExpectationBaseline: ExpectationBaseline = {
  chainId: 421614,
  protocol: "camelot-v3",
  tokenIn: { kind: "native" },
  tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
  amountIn: "0.000000000000001",
  quote: {
    estimatedAmountOut: "0.49",
    source: "quote",
    blockNumber: "41",
    fetchedAt: "2026-08-31T00:00:00.000Z",
    runtimeVersion: "arbitrum-camelot-v3",
    runtimeRevision: "native-rpc",
  },
};

const p0Constraints: readonly CallerConstraint[] = [
  {
    name: "maxPriceImpact",
    source: "caller",
    declarationId: "impact",
    numerator: "10",
    denominator: "1",
    unit: "bps",
  },
];

const p0ConstraintEvidence: readonly ConstraintEvidence[] = [
  {
    name: "maxPriceImpact",
    state: "VERIFIED",
    numerator: "50",
    denominator: "1",
    unit: "bps",
    evidenceKey: "impact",
  },
];

function p0CompositionOptions(
  overrides: Partial<ArbitrumProductionCompositionOptions> = {},
): ArbitrumProductionCompositionOptions {
  return {
    runtime: arbitrumRuntime(),
    runStore: new InMemoryRunStore(),
    chainAdapter: createFakeChainAdapter({
      chainId: 421614,
      blockNumber: "42",
      blockHash: `0x${"5".repeat(64)}`,
      gasUnits: "21000",
      finality: { status: "finalized" },
    }),
    providers: [
      createFakeProviderAdapter<NormalizedSwapIntent>({
        providerId: NATIVE_RPC_ARBITRUM_PROVIDER_ID,
        intent: normalizedIntent,
        chainId: 421614,
        protocol: "camelot-v3",
        capabilities: ["simulate", "eth_call", "estimateGas", "pinned-block"],
        supports: () => true,
      }),
    ],
    protocolAdapter: createCamelotV3ProtocolAdapter({
      quote: async () => ({
        estimatedAmountOut: "0.5",
        blockNumber: "42",
        runtimeVersion: "arbitrum-camelot-v3",
        runtimeRevision: "native-rpc",
      }),
      buildTransaction: async () => ({
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        value: "0x0",
      }),
    }),
    ...overrides,
  };
}

function boundP0Evidence(
  input: { normalizedIntent: unknown; preparedExecution: unknown },
  options: Parameters<typeof p0VerifiedEvidence>[1] = {},
) {
  const prepared = input.preparedExecution as { unsignedTransaction: unknown };
  const evidence = p0VerifiedEvidence(
    input.normalizedIntent as NormalizedSwapIntent,
    options,
  );
  const receipt = evidence.receipt.value;
  const outcome = evidence.outcome.value;
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    outcome === null ||
    typeof outcome !== "object" ||
    Array.isArray(outcome)
  )
    throw new Error("Expected synthetic receipt and outcome");
  const transactionFingerprint = `sha256:${createHash("sha256").update(JSON.stringify(prepared.unsignedTransaction)).digest("hex")}`;
  return genericEvidenceSchema.parse({
    ...evidence,
    action: { ...evidence.action, value: [{ transactionFingerprint }] },
    receipt: {
      ...evidence.receipt,
      value: { ...receipt, transactionFingerprint },
    },
    outcome: {
      ...evidence.outcome,
      value: { ...outcome, transactionFingerprint },
    },
  });
}

async function runP0Check(
  composition: ReturnType<typeof createArbitrumProductionComposition>,
  runId: string,
  intent: NormalizedSwapIntent = normalizedIntent,
  expectationBaseline: ExpectationBaseline | null = p0ExpectationBaseline,
) {
  if ((await composition.runStore.get(runId)) === undefined) {
    await composition.runStore.start(runId, intent);
  }
  const pipeline = new BackendPipeline({ runtime: composition });
  return pipeline.executeNormalized(intent, {
    rawInput: normalizedIntent as never,
    runId,
    chainId: 421614,
    protocol: "camelot-v3",
    capability: "simulate",
    ...(expectationBaseline === null
      ? {}
      : { decisionContext: { expectationBaseline } }),
  });
}

describe("Arbitrum composition P0 Risk wiring", () => {
  it("fails the default decision closed to UNKNOWN without a selected baseline", async () => {
    // The legacy projection of this verified Evidence is PROCEED; the P0 gate
    // has no Expectation Baseline, so the published verdict must be UNKNOWN and
    // the current quote must never be used as the baseline.
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-no-baseline",
      normalizedIntent,
      null,
    );

    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      summary: "Live check could not establish a trustworthy result",
      p0: {
        expectationBaseline: { status: "MISSING" },
        quoteFidelity: { status: "UNKNOWN", reason: "MISSING_BASELINE" },
        cause: { status: "NOT_VERIFIED" },
      },
    });
    expect(
      (execution.decisionOutput as { readonly verdict: string }).verdict,
    ).not.toBe("PROCEED");
    // The Backend-side verdict override must keep the shared Run contract valid.
    expect(runResultSchema.safeParse(execution.decisionOutput).success).toBe(
      true,
    );
  });

  it.each(["runtimeVersion", "runtimeRevision"] as const)(
    "fails closed when the selected quote %s differs from current Evidence",
    async (identityField) => {
      const composition = createArbitrumProductionComposition(
        p0CompositionOptions({
          providerEvidenceMapper: ({ normalizedIntent }) =>
            p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        }),
      );
      const mismatchedBaseline =
        identityField === "runtimeVersion"
          ? {
              ...p0ExpectationBaseline,
              quote: {
                ...p0ExpectationBaseline.quote,
                runtimeVersion: "different-runtime",
              },
            }
          : {
              ...p0ExpectationBaseline,
              quote: {
                ...p0ExpectationBaseline.quote,
                runtimeRevision: "different-revision",
              },
            };

      const execution = await runP0Check(
        composition,
        "p0-runtime-mismatch",
        normalizedIntent,
        mismatchedBaseline,
      );

      expect(execution.decisionOutput).toMatchObject({
        status: "completed",
        verdict: "UNKNOWN",
        p0: {
          expectationBaseline: { status: "AVAILABLE" },
          quoteFidelity: { status: "UNKNOWN", reason: "INCOMPATIBLE" },
        },
      });
    },
  );

  it("makes the final verdict obey the P0 Risk verdict for an injected baseline", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
        },
      }),
    );

    const execution = await runP0Check(composition, "p0-constraint-stop");

    // The legacy projection of this verified Evidence is PROCEED; the injected
    // caller constraint violation must still be published as STOP.
    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "STOP",
      summary: "Live check completed with verdict STOP",
      p0: {
        expectationBaseline: {
          status: "AVAILABLE",
          amountInAtomic: p0IntentAmountInAtomic,
          amountOutAtomic: "490000",
          blockNumber: "41",
        },
        quoteFidelity: { status: "VERIFIED" },
        cause: { status: "NOT_VERIFIED" },
        constraints: [{ status: "FAIL" }],
        evidenceState: "VERIFIED",
      },
    });
    expect(runResultSchema.safeParse(execution.decisionOutput).success).toBe(
      true,
    );
  });

  it("fails closed when the selected quote is for another exact-input amount", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-incompatible-baseline",
      normalizedIntent,
      {
        ...p0ExpectationBaseline,
        amountIn: "0.000000000000002",
      },
    );

    expect(execution.decisionOutput).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      p0: {
        expectationBaseline: { status: "AVAILABLE" },
        quoteFidelity: { status: "UNKNOWN", reason: "INCOMPATIBLE" },
      },
    });
  });

  it("keeps a degraded selected target descriptive when the baseline Risk is PROCEED", async () => {
    const store = new InMemoryRunStore();
    const start = vi.spyOn(store, "start");
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: boundP0Evidence,
        p0Risk: {
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
          },
        },
      }),
    );
    const execution = await runP0Check(
      composition,
      "proceed-degraded-target",
      {
        ...p0AuthorizedIntent,
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "400000",
          source: "user_declared",
        },
      },
      {
        ...p0ExpectationBaseline,
        quote: { ...p0ExpectationBaseline.quote, estimatedAmountOut: "0.6" },
      },
    );
    const result = runResultSchema.parse(execution.decisionOutput);
    expect(result).toMatchObject({
      verdict: "PROCEED",
      recommendedActions: [],
      p0: {
        quoteFidelity: { status: "VERIFIED" },
        transactionProtection: { status: "PASS" },
        remediation: { status: "NOT_RUN" },
      },
    });
    expect(
      start.mock.calls.filter(([id]) => id.includes(":p0-child:")),
    ).toEqual([]);
  });

  it("runs bounded remediation through a terminal child Run before recording VERIFIED", async () => {
    const store = new InMemoryRunStore();
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: boundP0Evidence,
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-remediation",
      p0AuthorizedIntent,
    );

    expect(execution.decisionOutput).toMatchObject({
      p0: {
        remediation: {
          status: "VERIFIED",
          parentRunId: "p0-remediation",
          childRunId: expect.any(String),
          verificationBlock: "42",
          verificationProof: {
            targetAmountOutAtomic: "490000",
            targetQuoteId: expect.any(String),
            verifiedAmountOutAtomic: "500000",
            resultEvidenceRef: {
              kind: "CROSS_RUN_EVIDENCE",
              runId: expect.any(String),
              evidenceId: "live:simulated-token-out",
            },
          },
        },
      },
    });
    const result = runResultSchema.parse(execution.decisionOutput);
    expect(result).toMatchObject({
      status: "completed",
      verdict: "ADJUST",
      recommendedActions: [
        { proposedChange: { before: "1000", after: "2000" } },
      ],
    });
    expect(result.intent.economicBoundary.availability).toBe("unavailable");
    expect(
      result.ruleResults.find((rule) => rule.ruleId === "P0-ECONOMIC-001")
        ?.status,
    ).toBe("NOT_APPLICABLE");
    expect(
      result.evidence.find((item) => item.kind === "action_verification"),
    ).toMatchObject({ targetOutputProof: { targetAmountOutAtomic: "490000" } });
    expect(result.providerEvidence?.providerData).not.toHaveProperty(
      "backendP0",
    );
  });

  it("does not recommend a target-qualified child that misses Transaction Protection", async () => {
    const runtime = arbitrumRuntime();
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runtime,
        providerEvidenceMapper: boundP0Evidence,
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });

    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: { kind: "native" },
          tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
          amountIn: "0.000000000000001",
          amountInIncreaseAuthorization: {
            availability: "available",
            source: "user_declared",
            consent: true,
            maximumAmountIn: "0.000000000000003",
          },
          expectationBaseline: p0ExpectationBaseline,
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.6",
            source: "user_declared",
          },
        }),
      }),
    );
    const result = runResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      status: "completed",
      verdict: "STOP",
      ruleResults: expect.arrayContaining([
        expect.objectContaining({
          ruleId: "P0-ECONOMIC-001",
          status: "FAIL",
          reasonCode: "OUTPUT_BELOW_BOUNDARY",
        }),
      ]),
    });
    expect(result.p0?.remediation.status).not.toBe("VERIFIED");
    expect(
      result.recommendedActions.some(
        (action) => action.action.kind === "TRANSACTION_ADJUSTMENT",
      ),
    ).toBe(false);
  });

  it("does not start remediation without explicit input-increase consent", async () => {
    const store = new InMemoryRunStore();
    const start = vi.spyOn(store, "start");
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
          },
        },
      }),
    );
    const execution = await runP0Check(composition, "no-input-consent");
    expect(
      runResultSchema.parse(execution.decisionOutput).p0?.remediation,
    ).toEqual({ status: "NOT_RUN" });
    expect(start.mock.calls.some(([id]) => id.includes(":p0-child:"))).toBe(
      false,
    );
  });

  it("never falls back to automatic size reduction for a fresh P0 request without consent", async () => {
    const store = new InMemoryRunStore();
    const start = vi.spyOn(store, "start");
    const runtime = arbitrumRuntime();
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runtime,
        runStore: store,
        providerEvidenceMapper: boundP0Evidence,
      }),
    );
    const app = createBackendApp({
      runtime,
      composition: composition as unknown as BackendCompositionRuntime,
    });
    const response = await app.fetch(
      new Request("https://api.example.test/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 421614,
          protocol: "camelot-v3",
          sender: normalizedIntent.sender,
          tokenIn: normalizedIntent.tokenIn,
          tokenOut: normalizedIntent.tokenOut,
          amountIn: "0.000000000000001",
          expectationBaseline: p0ExpectationBaseline,
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.6",
            source: "user_declared",
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runResultSchema.parse(await response.json())).toMatchObject({
      verdict: "STOP",
      recommendedActions: [],
      p0: { remediation: { status: "NOT_RUN" } },
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("never substitutes a successful candidate quote for its smaller simulated output", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: (input) =>
          boundP0Evidence(input, { amountReceivedAtomic: "450000" }),
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );
    const execution = await runP0Check(
      composition,
      "actual-output-shortfall",
      p0AuthorizedIntent,
    );
    const result = runResultSchema.parse(execution.decisionOutput);
    expect(result.p0?.remediation.status).not.toBe("VERIFIED");
    expect(result.recommendedActions).toEqual([]);
  });

  it("caps child evaluation at the user budget rather than the configured search ceiling", async () => {
    const store = new InMemoryRunStore();
    const start = vi.spyOn(store, "start");
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: boundP0Evidence,
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
          },
        },
      }),
    );
    await runP0Check(composition, "budget-cap", {
      ...p0AuthorizedIntent,
      amountInIncreaseAuthorization: {
        availability: "available",
        source: "user_declared",
        consent: true,
        maximumAmountInAtomic: "1500",
      },
    });
    const children = start.mock.calls.filter(([id]) =>
      id.includes(":p0-child:"),
    );
    expect(children).toHaveLength(1);
    expect(children[0]?.[1].amountInAtomic).toBe("1500");
    expect(children[0]?.[1].amountInIncreaseAuthorization).toMatchObject({
      maximumAmountInAtomic: "1500",
    });
  });

  it.each([
    "execution",
    "malformed",
    "intent",
    "constraints",
    "malformed-constraints",
    "constraints-with-economic-fail",
  ] as const)(
    "retains a terminal child when candidate %s fails",
    async (failure) => {
      const store = new InMemoryRunStore();
      const start = vi.spyOn(store, "start");
      const composition = createArbitrumProductionComposition(
        p0CompositionOptions({
          runStore: store,
          providerEvidenceMapper: (input) => {
            const intent = input.normalizedIntent as NormalizedSwapIntent;
            if (intent.amountInAtomic !== "1000") {
              if (failure === "execution")
                throw new Error("sensitive upstream failure");
              if (failure === "malformed") return { broken: true };
              if (failure === "intent") return p0VerifiedEvidence();
            }
            return boundP0Evidence(input);
          },
          p0Risk: {
            constraints: p0Constraints,
            constraintEvidence: p0ConstraintEvidence,
            remediation: {
              maxAmountInAtomic: "3000",
              initialStepAtomic: "1000",
              maxEvaluations: 2,
              constraintEvidenceForCandidate: () => {
                if (failure === "malformed-constraints")
                  return { broken: true } as unknown as ConstraintEvidence[];
                throw new Error("constraint source failed");
              },
            },
          },
        }),
      );
      const execution = await runP0Check(
        composition,
        `failed-attempt-${failure}`,
        failure === "constraints-with-economic-fail"
          ? {
              ...p0AuthorizedIntent,
              economicBoundary: {
                availability: "available",
                minimumReceivedAtomic: "600000",
                source: "user_declared",
              },
            }
          : p0AuthorizedIntent,
      );
      expect(
        runResultSchema.parse(execution.decisionOutput).p0?.remediation.status,
      ).not.toBe("VERIFIED");
      const children = start.mock.calls.filter(([id]) =>
        id.includes(":p0-child:"),
      );
      expect(children.length).toBeGreaterThan(0);
      for (const [id] of children) {
        const record = await store.get(id);
        expect(record).toMatchObject({
          status: "failed",
          parentRunId: `failed-attempt-${failure}`,
          result: { verdict: "UNKNOWN", recommendedActions: [] },
        });
        expect(JSON.stringify(record)).not.toContain(
          "sensitive upstream failure",
        );
        if (
          failure === "constraints" ||
          failure === "malformed-constraints" ||
          failure === "constraints-with-economic-fail"
        ) {
          if (record?.status !== "failed")
            throw new Error("Expected failed child");
          expect(record?.result?.evidence.length).toBeGreaterThan(0);
          expect(
            record?.result?.ruleResults.some((rule) => rule.status === "PASS"),
          ).toBe(true);
          expect(record?.result?.scope).toContainEqual(
            expect.objectContaining({
              key: "P0-CHECK-ACTION-001",
              status: "unknown",
            }),
          );
          expect(
            record.result.ruleResults.every((rule) => rule.status !== "FAIL"),
          ).toBe(true);
          if (failure === "constraints-with-economic-fail") {
            expect(record.result.ruleResults).toContainEqual(
              expect.objectContaining({
                ruleId: "P0-ECONOMIC-001",
                status: "UNKNOWN",
                reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE",
              }),
            );
          }
        }
      }
    },
  );

  it.each(["transaction", "block", "save", "read", "second-read"] as const)(
    "fails closed when child %s proof cannot be verified",
    async (failure) => {
      const store = new InMemoryRunStore();
      if (failure === "save")
        vi.spyOn(store, "complete").mockRejectedValue(
          new Error("store unavailable"),
        );
      if (failure === "read" || failure === "second-read") {
        const get = store.get.bind(store);
        let completedReads = 0;
        vi.spyOn(store, "get").mockImplementation(async (id) => {
          const record = await get(id);
          if (id.includes(":p0-child:") && record?.status === "completed") {
            completedReads++;
            if (failure === "read" || completedReads > 1) return undefined;
          }
          return record;
        });
      }
      const composition = createArbitrumProductionComposition(
        p0CompositionOptions({
          runStore: store,
          providerEvidenceMapper: (input) => {
            const intent = input.normalizedIntent as NormalizedSwapIntent;
            if (failure === "transaction" && intent.amountInAtomic !== "1000")
              return p0VerifiedEvidence(intent);
            const evidence = boundP0Evidence(input);
            if (failure !== "block" || intent.amountInAtomic === "1000")
              return evidence;
            const blockHash = `0x${"6".repeat(64)}`;
            return genericEvidenceSchema.parse({
              ...evidence,
              receipt: {
                ...evidence.receipt,
                value: { ...(evidence.receipt.value as object), blockHash },
              },
              outcome: {
                ...evidence.outcome,
                value: { ...(evidence.outcome.value as object), blockHash },
              },
            });
          },
          p0Risk: {
            constraints: p0Constraints,
            constraintEvidence: p0ConstraintEvidence,
            remediation: {
              maxAmountInAtomic: "3000",
              initialStepAtomic: "1000",
              maxEvaluations: 2,
              constraintEvidenceForCandidate: () => [
                {
                  name: "maxPriceImpact",
                  state: "VERIFIED",
                  numerator: "1",
                  denominator: "1",
                  unit: "bps",
                  evidenceKey: "candidate-impact",
                },
              ],
            },
          },
        }),
      );
      const executionPromise = runP0Check(
        composition,
        `invalid-child-${failure}`,
        p0AuthorizedIntent,
      );
      if (failure === "read" || failure === "second-read") {
        await expect(executionPromise).rejects.toMatchObject({
          code: "RUN_STORE_ERROR",
        });
        return;
      }
      const execution = await executionPromise;
      const result = runResultSchema.parse(execution.decisionOutput);
      expect(result.p0?.remediation.status).not.toBe("VERIFIED");
      expect(result.recommendedActions).toEqual([]);
    },
  );

  it("fails closed when candidate Evidence is bound to the baseline Intent", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: () => p0VerifiedEvidence(),
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-mismatched-candidate",
      p0AuthorizedIntent,
    );

    expect(runResultSchema.parse(execution.decisionOutput)).toMatchObject({
      status: "completed",
      verdict: "STOP",
      recommendedActions: [],
    });
  });

  it("does not reuse parent constraint Evidence for a changed candidate", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        providerEvidenceMapper: ({ normalizedIntent }) =>
          p0VerifiedEvidence(normalizedIntent as NormalizedSwapIntent),
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
          },
        },
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-parent-constraints",
      p0AuthorizedIntent,
    );

    expect(runResultSchema.parse(execution.decisionOutput)).toMatchObject({
      status: "completed",
      verdict: "STOP",
      recommendedActions: [],
    });
  });

  it("does not run remediation when the canonical parent derivation is incomplete", async () => {
    const candidateConstraintEvidence = vi.fn(() => [
      {
        name: "maxPriceImpact" as const,
        state: "VERIFIED" as const,
        numerator: "1",
        denominator: "1",
        unit: "bps" as const,
        evidenceKey: "candidate-impact",
      },
    ]);
    const availableIntent: NormalizedSwapIntent = {
      ...normalizedIntent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "400000",
        source: "user_declared",
      },
    };
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        protocolAdapter: createCamelotV3ProtocolAdapter({
          quote: async (intent) => ({
            estimatedAmountOut:
              intent.amountInAtomic === "1000" ? "0.48" : "0.5",
            blockNumber: "42",
            runtimeVersion: "arbitrum-camelot-v3",
            runtimeRevision: "native-rpc",
          }),
          buildTransaction: async () => ({
            to: "0x2222222222222222222222222222222222222222",
            data: "0x1234",
            value: "0x0",
          }),
        }),
        providerEvidenceMapper: ({ normalizedIntent }) => {
          const candidate = normalizedIntent as NormalizedSwapIntent;
          const evidence = p0VerifiedEvidence(candidate, {
            estimatedAmountOut:
              candidate.amountInAtomic === "1000" ? "0.48" : "0.5",
            amountReceivedAtomic:
              candidate.amountInAtomic === "1000" ? "480000" : "500000",
          });
          if (candidate.amountInAtomic === "1000") {
            // The parent lacks canonical derivation; child success cannot repair it.
            const outcome = evidence.outcome.value as Record<string, unknown>;
            delete outcome.derivation;
            delete outcome.derivationVersion;
          }
          return evidence;
        },
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: candidateConstraintEvidence,
          },
        },
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-unknown-parent-remediation",
      availableIntent,
    );
    const result = runResultSchema.parse(execution.decisionOutput);
    expect(result).toMatchObject({
      status: "completed",
      verdict: "UNKNOWN",
      p0: { remediation: { status: "NOT_RUN" } },
    });
    expect(result.recommendedActions).toEqual([]);
    expect(result.irrelevantActions).toEqual([]);
    expect(result.p0?.remediation).toEqual({ status: "NOT_RUN" });
    expect(candidateConstraintEvidence).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("candidate-impact");
  });

  it("publishes a verified remediation through the existing RunResult Action Gate", async () => {
    const store = new InMemoryRunStore();
    const availableIntent: NormalizedSwapIntent = {
      ...p0AuthorizedIntent,
      economicBoundary: {
        availability: "available",
        minimumReceivedAtomic: "600000",
        source: "user_declared",
      },
    };
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        runStore: store,
        providerEvidenceMapper: (input) => {
          const { normalizedIntent } = input;
          const candidate = normalizedIntent as NormalizedSwapIntent;
          return boundP0Evidence(input, {
            estimatedAmountOut:
              candidate.amountInAtomic === "1000" ? "0.5" : "0.7",
            amountReceivedAtomic:
              candidate.amountInAtomic === "1000" ? "500000" : "700000",
          });
        },
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
          remediation: {
            maxAmountInAtomic: "3000",
            initialStepAtomic: "1000",
            maxEvaluations: 2,
            constraintEvidenceForCandidate: () => [
              {
                name: "maxPriceImpact",
                state: "VERIFIED",
                numerator: "1",
                denominator: "1",
                unit: "bps",
                evidenceKey: "candidate-impact",
              },
            ],
          },
        },
      }),
    );

    const execution = await runP0Check(
      composition,
      "p0-public-remediation",
      availableIntent,
    );
    const result = runResultSchema.parse(execution.decisionOutput);

    expect(result).toMatchObject({
      status: "completed",
      verdict: "ADJUST",
      recommendedActions: [
        {
          action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
          recommendable: true,
          proposedChange: { before: "1000", after: "2000" },
        },
      ],
    });
    expect(result.providerEvidence?.providerData).not.toHaveProperty(
      "backendP0",
    );
    const verification = result.evidence.find(
      (item) => item.kind === "action_verification",
    );
    expect(verification).toMatchObject({
      kind: "action_verification",
      baselineRunId: "p0-public-remediation",
      beforeValue: "1000",
      afterValue: "2000",
    });
    if (verification?.kind === "action_verification") {
      await expect(
        store.get(verification.verificationRunId),
      ).resolves.toMatchObject({
        status: "completed",
        parentRunId: "p0-public-remediation",
      });
    }
  });

  it.each([
    "none",
    "missing",
    "fingerprint",
    "block-hash",
    "lower-output",
    "invalid-delta",
    "recipient",
    "token",
    "input-amount",
    "warning",
    "unexplained-assets",
    "missing-warnings",
    "missing-quote",
    "external-quote-source",
    "missing-quote-observation-time",
    "quote-unknown-scope",
    "parent-missing-derivation",
    "failed-terminalization",
    "complete-terminalization",
  ] as const)(
    "persists the HTTP child proof only when the final Action Gate binding is intact (%s)",
    async (finalReadFailure) => {
      const store = new InMemoryRunStore();
      const pendingChild =
        finalReadFailure === "failed-terminalization" ||
        finalReadFailure === "complete-terminalization";
      if (pendingChild) {
        vi.spyOn(store, "fail").mockRejectedValue(
          new Error("sensitive persistence failure"),
        );
        if (finalReadFailure === "complete-terminalization") {
          const complete = store.complete.bind(store);
          vi.spyOn(store, "complete").mockImplementation(async (result) => {
            if (result.parentRunId !== undefined)
              throw new Error("child completion unavailable");
            return complete(result);
          });
        }
      }
      // Exercise JSON storage semantics, not in-memory undefined properties.
      const get = store.get.bind(store);
      let childReads = 0;
      vi.spyOn(store, "get").mockImplementation(async (id) => {
        const record = await get(id);
        if (record?.status === "completed" && id.includes(":p0-child:")) {
          childReads++;
          if (finalReadFailure === "missing" && childReads > 3)
            return undefined;
          if (
            childReads > 3 &&
            (finalReadFailure === "fingerprint" ||
              finalReadFailure === "block-hash" ||
              finalReadFailure === "lower-output" ||
              finalReadFailure === "invalid-delta" ||
              finalReadFailure === "recipient" ||
              finalReadFailure === "token" ||
              finalReadFailure === "input-amount" ||
              finalReadFailure === "warning" ||
              finalReadFailure === "unexplained-assets" ||
              finalReadFailure === "missing-warnings" ||
              finalReadFailure === "missing-quote" ||
              finalReadFailure === "external-quote-source" ||
              finalReadFailure === "missing-quote-observation-time" ||
              finalReadFailure === "quote-unknown-scope")
          ) {
            const changed = structuredClone(record);
            const provider = changed.result.providerEvidence;
            if (!provider) throw new Error("Missing provider fixture");
            if (finalReadFailure === "warning") {
              provider.warnings.value = ["Unclassified warning"];
              return changed;
            }
            if (finalReadFailure === "unexplained-assets") {
              provider.assetChangeAssessment = "UNEXPLAINED";
              return changed;
            }
            if (finalReadFailure === "missing-warnings") {
              provider.warnings.value = null;
              return changed;
            }
            if (finalReadFailure === "missing-quote") {
              provider.quote.value = null;
              return changed;
            }
            if (finalReadFailure === "external-quote-source") {
              provider.quote.source = "external";
              return changed;
            }
            if (finalReadFailure === "missing-quote-observation-time") {
              delete provider.quote.fetchedAt;
              return changed;
            }
            if (finalReadFailure === "quote-unknown-scope") {
              provider.unknownScope = [...provider.unknownScope, "quote"];
              return changed;
            }
            const outcome = changed.result.providerEvidence?.outcome.value;
            if (
              outcome === null ||
              typeof outcome !== "object" ||
              Array.isArray(outcome)
            )
              throw new Error("Missing outcome fixture");
            if (finalReadFailure === "fingerprint")
              outcome.transactionFingerprint = `sha256:${"f".repeat(64)}`;
            else if (finalReadFailure === "block-hash")
              outcome.blockHash = `0x${"f".repeat(64)}`;
            else if (finalReadFailure === "lower-output") {
              outcome.amountReceivedAtomic = "400000";
              outcome.balanceAfterAtomic = "400000";
            } else if (finalReadFailure === "invalid-delta")
              outcome.balanceAfterAtomic = "400000";
            else if (finalReadFailure === "recipient")
              outcome.recipient = "0x2222222222222222222222222222222222222222";
            else if (finalReadFailure === "token")
              outcome.tokenOut = "0x2222222222222222222222222222222222222222";
            else outcome.amountInAtomic = "1000";
            return changed;
          }
        }
        return record === undefined
          ? undefined
          : JSON.parse(JSON.stringify(record));
      });
      const startSpy = vi.spyOn(store, "start");
      const runtime = arbitrumRuntime();
      const composition = createArbitrumProductionComposition(
        p0CompositionOptions({
          runtime,
          runStore: store,
          providerEvidenceMapper: (input) => {
            const { normalizedIntent } = input;
            const candidate = normalizedIntent as NormalizedSwapIntent;
            if (
              finalReadFailure === "failed-terminalization" &&
              candidate.amountInAtomic !== "1000"
            )
              throw new Error("sensitive candidate failure");
            const evidence = boundP0Evidence(input, {
              estimatedAmountOut:
                candidate.amountInAtomic === "1000" ? "0.5" : "0.7",
              amountReceivedAtomic:
                candidate.amountInAtomic === "1000" ? "500000" : "700000",
            });
            if (
              finalReadFailure === "parent-missing-derivation" &&
              candidate.amountInAtomic === "1000"
            ) {
              const outcome = evidence.outcome.value as Record<string, unknown>;
              delete outcome.derivation;
              delete outcome.derivationVersion;
            }
            return evidence;
          },
          p0Risk: {
            constraints: p0Constraints,
            constraintEvidence: p0ConstraintEvidence,
            remediation: {
              maxAmountInAtomic: "3000",
              initialStepAtomic: "1000",
              maxEvaluations: 2,
              constraintEvidenceForCandidate: () => [
                {
                  name: "maxPriceImpact",
                  state: "VERIFIED",
                  numerator: "1",
                  denominator: "1",
                  unit: "bps",
                  evidenceKey: "candidate-impact",
                },
              ],
            },
          },
        }),
      );
      const app = createBackendApp({
        runtime,
        composition: composition as unknown as BackendCompositionRuntime,
      });

      const response = await app.fetch(
        new Request("https://api.example.test/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId: 421614,
            protocol: "camelot-v3",
            sender: normalizedIntent.sender,
            tokenIn: { kind: "native" },
            tokenOut: { kind: "erc20", address: arbitrumTokenAddress },
            amountIn: "0.000000000000001",
            amountInIncreaseAuthorization: {
              availability: "available",
              source: "user_declared",
              consent: true,
              maximumAmountIn: "0.000000000000003",
            },
            expectationBaseline: p0ExpectationBaseline,
            economicBoundary: {
              availability: "available",
              minimumReceived: "0.6",
              source: "user_declared",
            },
          }),
        }),
      );
      const responseBody = await response.json();
      if (pendingChild) {
        expect(response.status).toBe(500);
        expect(responseBody).toEqual({
          error: {
            code: "RUN_STORE_ERROR",
            message: "The check run lifecycle could not be stored",
          },
        });
        const parentId = startSpy.mock.calls[0]?.[0];
        const childId = startSpy.mock.calls.find(([id]) =>
          id.includes(":p0-child:"),
        )?.[0];
        if (!parentId || !childId) throw new Error("Missing started Runs");
        expect(await store.get(parentId)).toMatchObject({ status: "started" });
        expect(await store.get(childId)).toMatchObject({ status: "started" });
        expect(responseBody).not.toHaveProperty("run");
        return;
      }
      const result = runResultSchema.parse(responseBody);

      expect(response.status).toBe(200);
      if (finalReadFailure !== "none") {
        if (finalReadFailure !== "parent-missing-derivation")
          expect(childReads).toBeGreaterThan(3);
        expect(result).toMatchObject({
          verdict:
            finalReadFailure === "parent-missing-derivation"
              ? "UNKNOWN"
              : "STOP",
          recommendedActions: [],
          p0: {
            remediation: { status: "UNKNOWN", reason: "EVIDENCE_NOT_VERIFIED" },
          },
        });
        expect(
          result.evidence.filter((item) => item.kind === "action_verification"),
        ).toEqual([]);
        const response = await app.fetch(
          new Request(`https://api.example.test/api/runs/${result.runId}`),
        );
        const body = (await response.json()) as { result: unknown };
        expect(runResultSchema.parse(body.result)).toEqual(result);
        return;
      }
      expect(result).toMatchObject({
        status: "completed",
        verdict: "ADJUST",
        recommendedActions: [
          {
            proposedChange: { before: "1000", after: "2000" },
          },
        ],
      });
      expect(startSpy).toHaveBeenCalledTimes(2);
      expect(
        startSpy.mock.calls.filter(([runId]) => runId.includes(":p0-child:")),
      ).toHaveLength(1);
      const recovered = await app.fetch(
        new Request(`https://api.example.test/api/runs/${result.runId}`),
      );
      expect(recovered.status).toBe(200);
      const recoveredBody = (await recovered.json()) as { result: unknown };
      expect(runResultSchema.parse(recoveredBody.result)).toEqual(result);
      expect(result.intent.amountInIncreaseAuthorization).toEqual(
        p0AuthorizedIntent.amountInIncreaseAuthorization,
      );
      const remediation = result.p0?.remediation;
      expect(remediation?.status).toBe("VERIFIED");
      if (remediation?.status !== "VERIFIED")
        throw new Error("Expected verified fixture result");
      const childResponse = await app.fetch(
        new Request(
          `https://api.example.test/api/runs/${encodeURIComponent(remediation.childRunId)}`,
        ),
      );
      expect(childResponse.status).toBe(200);
      const childBody = (await childResponse.json()) as { result: unknown };
      const child = runResultSchema.parse(childBody.result);
      expect(child).toMatchObject({
        parentRunId: result.runId,
        intent: {
          amountInAtomic: "2000",
          amountInIncreaseAuthorization:
            p0AuthorizedIntent.amountInIncreaseAuthorization,
        },
      });
      expect(
        child.evidence.find(
          (item) =>
            item.key ===
            remediation.verificationProof?.resultEvidenceRef.evidenceId,
        ),
      ).toMatchObject({
        kind: "simulated_token_out",
        amountReceivedAtomic:
          remediation.verificationProof?.verifiedAmountOutAtomic,
      });
      expect(child.p0?.constraintVerification).toMatchObject({
        candidateQuoteId: remediation.quoteId,
        blockNumber: remediation.verificationBlock,
        checks: [
          {
            declaration: p0Constraints[0],
            measurements: [
              {
                numerator: "1",
                denominator: "1",
                evidenceKey: "candidate-impact",
              },
            ],
            outcome: { status: "PASS", declarationId: "impact" },
          },
        ],
      });
      for (const delta of [
        {
          evidence: result.evidence.map((item) =>
            item.kind === "action_verification"
              ? { ...item, targetOutputProof: undefined }
              : item,
          ),
        },
        {
          intent: {
            ...result.intent,
            amountInIncreaseAuthorization: undefined,
          },
        },
        {
          intent: {
            ...result.intent,
            amountInIncreaseAuthorization: {
              availability: "available",
              source: "user_declared",
              consent: true,
              maximumAmountInAtomic: "1500",
            },
          },
        },
        {
          evidence: result.evidence.map((item) =>
            item.kind !== "action_verification"
              ? item
              : {
                  ...item,
                  targetOutputProof: {
                    ...item.targetOutputProof,
                    targetQuoteId: "another-target",
                  },
                },
          ),
        },
        {
          evidence: result.evidence.map((item) =>
            item.kind !== "action_verification" ||
            item.targetOutputProof === undefined
              ? item
              : {
                  ...item,
                  targetOutputProof: {
                    ...item.targetOutputProof,
                    resultEvidenceRef: {
                      ...item.targetOutputProof.resultEvidenceRef,
                      runId: "unrelated-child",
                    },
                  },
                },
          ),
        },
      ]) {
        expect(runResultSchema.safeParse({ ...result, ...delta }).success).toBe(
          false,
        );
      }
      if (child.status !== "completed" || result.status !== "completed")
        throw new Error("Expected completed fixture");
      const actionVerification = result.evidence.find(
        (item) => item.kind === "action_verification",
      );
      expect(actionVerification).toMatchObject({
        targetOutputProof: {
          resultEvidenceRef: {
            kind: "CROSS_RUN_EVIDENCE",
            runId: child.runId,
          },
        },
      });
      if (actionVerification?.kind !== "action_verification")
        throw new Error("Expected selected-target Action Gate attestation");
      expect(actionVerification.resultEvidenceKey).toBeUndefined();
      expect(
        result.recommendedActions[0]?.evidenceRefs.map((ref) => ref.key),
      ).toEqual([actionVerification?.key]);
      const childOutput = child.evidence.find(
        (item) =>
          item.key ===
          remediation.verificationProof?.resultEvidenceRef.evidenceId,
      );
      if (childOutput?.kind !== "simulated_token_out")
        throw new Error("Expected child output");
      expect(
        actionVerification.targetOutputProof?.resultEvidenceRef.evidenceId,
      ).toBe(childOutput.key);
      expect(
        result.evidence.some((item) =>
          item.key.startsWith(`action-verification:${child.runId}:`),
        ),
      ).toBe(false);
      expect(
        result.evidence.some(
          (item) =>
            item.kind === "simulated_token_out" &&
            item.key.startsWith(`action-verification:${child.runId}:`),
        ),
      ).toBe(false);
      const checks = child.p0?.constraintVerification;
      if (!checks) throw new Error("Expected recorded constraints");
      const tamperedChildren = [
        {
          ...child,
          p0: {
            ...child.p0,
            constraintVerification: { ...checks, checks: [] },
          },
        },
        {
          ...child,
          p0: {
            ...child.p0,
            constraintVerification: {
              ...checks,
              checks: [...checks.checks, ...checks.checks],
            },
          },
        },
        {
          ...child,
          p0: {
            ...child.p0,
            constraintVerification: {
              ...checks,
              checks: checks.checks.map((check) => ({
                ...check,
                declaration: { ...check.declaration, numerator: "999" },
              })),
            },
          },
        },
        {
          ...child,
          p0: {
            ...child.p0,
            constraintVerification: {
              ...checks,
              checks: checks.checks.map((check) => ({
                ...check,
                measurements: check.measurements.map((measurement) => ({
                  ...measurement,
                  numerator: "999",
                })),
              })),
            },
          },
        },
        {
          ...child,
          evidence: child.evidence.map((item) =>
            item.kind === "generic" &&
            item.simulationInputRole === "RECIPIENT_BALANCE_SNAPSHOT"
              ? { ...item, simulationInputRole: "SIMULATION_RECEIPT" as const }
              : item,
          ),
        },
        {
          ...child,
          evidence: child.evidence.map((item) =>
            item.kind === "generic" &&
            item.simulationInputRole === "RECIPIENT_BALANCE_SNAPSHOT"
              ? { ...item, blockNumber: "999" }
              : item,
          ),
        },
        {
          ...child,
          evidence: child.evidence.map((item) =>
            item.kind === "simulated_token_out"
              ? {
                  ...item,
                  inputEvidenceRefs: item.inputEvidenceRefs.map((ref) => ({
                    ...ref,
                    key: "missing-source",
                  })),
                }
              : item,
          ),
        },
      ];
      for (const tampered of tamperedChildren) {
        // Storage corruption must close the gate even when recorded PASS is retained.
        const closed = closeUnverifiedAdjust(
          result,
          new Map([
            [
              child.runId,
              {
                status: "completed" as const,
                result: tampered as typeof child,
              },
            ],
          ]),
        );
        expect(closed.verdict).not.toBe("ADJUST");
        expect(closed.p0?.remediation.status).toBe("UNKNOWN");
      }
      const counted = runResultSchema.parse({
        ...result,
        p0: { ...result.p0, remediation: { ...remediation, evaluations: 2 } },
      });
      const closed = closeUnverifiedAdjust(counted, new Map());
      expect(closed.p0?.remediation).toMatchObject({
        status: "UNKNOWN",
        evaluations: 2,
      });
      const multiParent = structuredClone(result);
      const multiChild = structuredClone(child);
      if (
        !multiParent.p0?.constraintVerification ||
        !multiChild.p0?.constraintVerification
      )
        throw new Error("Missing audit fixture");
      for (const run of [multiParent, multiChild]) {
        const audit = run.p0?.constraintVerification;
        if (!audit || !run.p0) throw new Error("Missing audit");
        const check = structuredClone(audit.checks[0]);
        check.declaration.declarationId = "impact-secondary";
        check.declaration.numerator = "20";
        check.outcome.declarationId = "impact-secondary";
        audit.checks.push(check);
        run.p0.constraints.push(check.outcome);
      }
      expect(
        closeUnverifiedAdjust(
          multiParent,
          new Map([
            [multiChild.runId, { status: "completed", result: multiChild }],
          ]),
        ).verdict,
      ).toBe("ADJUST");
      const conflicting = structuredClone(multiChild);
      const conflictingCheck =
        conflicting.p0?.constraintVerification?.checks[1];
      if (!conflictingCheck || !conflicting.p0)
        throw new Error("Missing repeated metric fixture");
      conflictingCheck.measurements[0].numerator = "2";
      conflictingCheck.measurements[0].evidenceKey =
        "different-impact-observation";
      conflictingCheck.outcome.evidenceKey = "different-impact-observation";
      conflicting.p0.constraints[1].evidenceKey =
        "different-impact-observation";
      expect(
        closeUnverifiedAdjust(
          multiParent,
          new Map([
            [conflicting.runId, { status: "completed", result: conflicting }],
          ]),
        ).verdict,
      ).toBe("STOP");
      expect(startSpy).toHaveBeenCalledTimes(2);
    },
  );

  it("leaves an injected custom core/decision override unchanged", async () => {
    const composition = createArbitrumProductionComposition(
      p0CompositionOptions({
        core: { evaluate: async () => ({ custom: "core" }) },
        decision: {
          decide: async (input) => ({ custom: "decision", input }),
        },
        p0Risk: {
          constraints: p0Constraints,
          constraintEvidence: p0ConstraintEvidence,
        },
      }),
    );

    const execution = await runP0Check(composition, "custom-override");

    expect(execution.decisionOutput).toEqual({
      custom: "decision",
      input: { custom: "core" },
    });
  });
});

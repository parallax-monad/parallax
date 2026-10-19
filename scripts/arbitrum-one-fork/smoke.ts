import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ArbitrumRpcClient } from "../../apps/api/src/backend/arbitrum-chain-adapter.js";
import {
  type ArbitrumOneQuoteFlowOptions,
  createArbitrumOneQuoteFlow,
} from "../../apps/api/src/backend/arbitrum-one-quote.js";
import { normalizeQuoteRequestForChain } from "../../apps/api/src/normalization.js";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  bootstrapBackendRuntime,
} from "../../apps/api/src/runtime-config.js";
import {
  type QuoteRequest,
  quoteResultSchema,
} from "../../packages/contracts/src/index.js";

interface ForkConfig {
  readonly source: {
    readonly chainId: number;
    readonly blockNumber: string;
    readonly blockHash: string;
  };
  readonly localExecutionChainId: number;
  readonly quote: {
    readonly amountIn: string;
    readonly verifiedTokenMetadataBlock: string;
  };
  readonly senderNativeBalanceAtomic: string;
  readonly anvil: {
    readonly version: string;
    readonly image: string;
  };
  readonly rpcProxy: {
    readonly image: string;
    readonly port: number;
  };
  readonly localRpcPort: number;
}

const FORK_CONFIG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./config.json", import.meta.url)),
    "utf8",
  ),
) as ForkConfig;

const READ_ONLY_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
]);
const ERC20_BALANCE_OF_SELECTOR = "70a08231";
const SOURCE_BLOCK_TAG = toRpcQuantity(BigInt(FORK_CONFIG.source.blockNumber));
const EXPECTED_USDC_ADDRESS =
  ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress;

export interface RpcClient {
  request(
    method: string,
    params?: readonly unknown[],
    options?: Parameters<ArbitrumRpcClient["request"]>[2],
  ): Promise<unknown>;
}

export class ForkSmokeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ForkSmokeError";
    this.code = code;
  }
}

export interface ForkQuoteSmokeEvidence {
  readonly schemaVersion: "parallax-arbitrum-one-fork-quote-v1";
  readonly evidenceStatus: "READ_ONLY_QUOTE_REPRODUCIBILITY_NOT_SIMULATION";
  readonly observedAt: string;
  readonly source: {
    readonly chainId: number;
    readonly observedHeadNumber: string;
    readonly blockNumber: string;
    readonly blockHash: string;
  };
  readonly localExecution: {
    readonly chainId: number;
    readonly baseBlockNumber: string;
    readonly baseBlockHash: string;
    readonly observedHeadNumber: string;
    readonly forkInstanceId: string;
  };
  readonly anvil: {
    readonly expectedVersion: string;
    readonly clientVersion: string;
    readonly image: string;
  };
  readonly senderPreparation: {
    readonly address: string;
    readonly unlockedSignerCount: 0;
    readonly upstreamNativeBalanceBeforeOverrideAtomic: string;
    readonly upstreamUsdcBalanceAtomic: "0";
    readonly localNativeBalanceOverrideAtomic: string;
    readonly localUsdcBalanceAfterOverrideAtomic: "0";
    readonly resetRestoredUpstreamBalances: true;
  };
  readonly quote: {
    readonly profileId: string;
    readonly protocol: string;
    readonly amountInAtomic: string;
    readonly sourceBlockNumber: string;
    readonly sourceBlockHash: string;
    readonly upstreamAmountOutAtomic: string;
    readonly forkAmountOutAtomic: string;
    readonly resetRerunAmountOutAtomic: string;
    readonly poolAddress: string;
    readonly quoterAddress: string;
    readonly tokenPath: readonly string[];
    readonly exactAtomicOutputMatched: true;
  };
  readonly reset: {
    readonly snapshotRevertedBetweenQuotes: true;
    readonly repeatQuoteMatched: true;
    readonly snapshotRevertedAfterSmoke: true;
    readonly localBlockNumberRestored: true;
  };
  readonly rpcSafety: {
    readonly upstreamWritesAllowed: false;
    readonly signingOrBroadcastingPerformed: false;
    readonly gasOrSimulationMethodsPerformed: false;
    readonly localStateOverrides: readonly string[];
    readonly localTransactionsMined: false;
  };
  readonly limitations: readonly string[];
}

export interface RunForkQuoteSmokeInput {
  readonly sourceRpc: RpcClient;
  readonly localRpc: RpcClient;
  readonly forkInstanceId: string;
  readonly now?: () => Date;
  readonly senderAddress?: string;
}

interface QuoteObservation {
  readonly amountInAtomic: string;
  readonly amountOutAtomic: string;
  readonly sourceBlockNumber: string;
  readonly sourceBlockHash: string;
  readonly poolAddress: string;
  readonly quoterAddress: string;
  readonly tokenPath: readonly string[];
}

export function createPinnedQuoteRpcClient(
  delegate: RpcClient,
  label: string,
): ArbitrumRpcClient {
  return {
    async request(method, params = [], options) {
      if (!READ_ONLY_METHODS.has(method)) {
        throw new ForkSmokeError(
          "READ_ONLY_METHOD_REJECTED",
          `${label} quote client rejected a non-allowlisted RPC method.`,
        );
      }
      if (method === "eth_chainId") {
        return toRpcQuantity(BigInt(FORK_CONFIG.source.chainId));
      }
      if (method === "eth_blockNumber") return SOURCE_BLOCK_TAG;
      return delegate.request(method, params, options);
    },
  };
}

export async function runForkQuoteSmoke(
  input: RunForkQuoteSmokeInput,
): Promise<ForkQuoteSmokeEvidence> {
  validateInstanceId(input.forkInstanceId);
  const now = input.now ?? (() => new Date());
  const observedAtDate = now();
  if (Number.isNaN(observedAtDate.getTime())) {
    throw new ForkSmokeError(
      "INVALID_CLOCK",
      "Smoke clock returned an invalid date.",
    );
  }
  const observedAt = observedAtDate.toISOString();
  const sourceRpc = readonlyClient(input.sourceRpc, "upstream");
  const localRpc = input.localRpc;

  await assertChainId(sourceRpc, FORK_CONFIG.source.chainId, "upstream");
  await assertChainId(
    localRpc,
    FORK_CONFIG.localExecutionChainId,
    "local fork",
  );

  const sourceHeadNumber = await readHeadNumber(sourceRpc, "upstream");
  if (BigInt(sourceHeadNumber) < BigInt(FORK_CONFIG.source.blockNumber)) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_UNAVAILABLE",
      "Upstream RPC head is earlier than the configured source block.",
    );
  }
  const localHeadNumber = await readHeadNumber(localRpc, "local fork");
  if (localHeadNumber !== FORK_CONFIG.source.blockNumber) {
    throw new ForkSmokeError(
      "LOCAL_FORK_BLOCK_MISMATCH",
      "Local fork head does not equal the configured source block; reset the fork.",
    );
  }

  await assertBlockIdentity(sourceRpc, "upstream");
  await assertBlockIdentity(localRpc, "local fork");
  await assertRequiredCode(sourceRpc, "upstream");
  await assertRequiredCode(localRpc, "local fork");

  const clientVersion = await readAnvilClientVersion(localRpc);
  const accounts = await rpcResult(localRpc, "eth_accounts", [], "local fork");
  if (!Array.isArray(accounts) || accounts.length !== 0) {
    throw new ForkSmokeError(
      "UNEXPECTED_LOCAL_SIGNERS",
      "Anvil must expose zero unlocked signer accounts for this quote-only harness.",
    );
  }

  const senderAddress =
    input.senderAddress ?? `0x${randomBytes(20).toString("hex")}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(senderAddress)) {
    throw new ForkSmokeError(
      "INVALID_TEST_SENDER",
      "Ephemeral test sender address is invalid.",
    );
  }

  const sourceNativeBalance = await readNativeBalance(
    sourceRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "upstream",
  );
  const sourceUsdcBalance = await readUsdcBalance(
    sourceRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "upstream",
  );
  const localNativeBalanceBefore = await readNativeBalance(
    localRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "local fork",
  );
  const localUsdcBalanceBefore = await readUsdcBalance(
    localRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "local fork",
  );
  if (sourceUsdcBalance !== "0" || localUsdcBalanceBefore !== "0") {
    throw new ForkSmokeError(
      "TEST_SENDER_HAS_USDC",
      "Generated sender has USDC at the pinned source state; no token balance will be changed.",
    );
  }
  if (localNativeBalanceBefore !== sourceNativeBalance) {
    throw new ForkSmokeError(
      "LOCAL_BASE_STATE_MISMATCH",
      "Local fork sender balance differs from the pinned upstream base state before preparation.",
    );
  }

  const upstreamQuote = await readQuote(sourceRpc, senderAddress, observedAt);
  let snapshotId = await createSnapshot(localRpc);
  let firstForkQuote: QuoteObservation;
  let secondForkQuote: QuoteObservation;
  let localUsdcBalanceAfter = "0";
  try {
    await prepareSender(localRpc, senderAddress);
    localUsdcBalanceAfter = await readUsdcBalance(
      localRpc,
      senderAddress,
      "latest",
      "local fork",
    );
    if (localUsdcBalanceAfter !== "0") {
      throw new ForkSmokeError(
        "LOCAL_USDC_STATE_CHANGED",
        "Native ETH preparation unexpectedly changed the sender's USDC balance.",
      );
    }
    firstForkQuote = await readQuote(input.localRpc, senderAddress, observedAt);
    assertQuoteMatchesSource(upstreamQuote, firstForkQuote, "first fork quote");
    await revertSnapshot(localRpc, snapshotId);
    snapshotId = await createSnapshot(localRpc);

    await prepareSender(localRpc, senderAddress);
    const secondUsdcBalance = await readUsdcBalance(
      localRpc,
      senderAddress,
      "latest",
      "local fork",
    );
    if (secondUsdcBalance !== "0") {
      throw new ForkSmokeError(
        "LOCAL_USDC_STATE_CHANGED",
        "Reset/re-run changed the sender's USDC balance.",
      );
    }
    secondForkQuote = await readQuote(
      input.localRpc,
      senderAddress,
      observedAt,
    );
    assertQuoteMatchesSource(
      upstreamQuote,
      secondForkQuote,
      "reset fork quote",
    );
    await revertSnapshot(localRpc, snapshotId);
    snapshotId = "";
  } catch (error) {
    if (snapshotId !== "") {
      try {
        await revertSnapshot(localRpc, snapshotId);
      } catch {
        throw new ForkSmokeError(
          "RESET_FAILED",
          "Anvil snapshot reset failed; destroy and recreate the fork before retrying.",
        );
      }
    }
    throw error;
  }

  const localNativeBalanceAfter = await readNativeBalance(
    localRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "local fork",
  );
  const localUsdcBalanceAfterReset = await readUsdcBalance(
    localRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "local fork",
  );
  const restoredHead = await readHeadNumber(localRpc, "local fork");
  if (
    localNativeBalanceAfter !== sourceNativeBalance ||
    localUsdcBalanceAfterReset !== sourceUsdcBalance ||
    restoredHead !== FORK_CONFIG.source.blockNumber
  ) {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Snapshot reset did not restore the pinned fork state; destroy and recreate the fork.",
    );
  }
  assertQuoteMatchesSource(upstreamQuote, secondForkQuote, "reset fork quote");

  return {
    schemaVersion: "parallax-arbitrum-one-fork-quote-v1",
    evidenceStatus: "READ_ONLY_QUOTE_REPRODUCIBILITY_NOT_SIMULATION",
    observedAt,
    source: {
      chainId: FORK_CONFIG.source.chainId,
      observedHeadNumber: sourceHeadNumber,
      blockNumber: FORK_CONFIG.source.blockNumber,
      blockHash: FORK_CONFIG.source.blockHash,
    },
    localExecution: {
      chainId: FORK_CONFIG.localExecutionChainId,
      baseBlockNumber: FORK_CONFIG.source.blockNumber,
      baseBlockHash: FORK_CONFIG.source.blockHash,
      observedHeadNumber: restoredHead,
      forkInstanceId: input.forkInstanceId,
    },
    anvil: {
      expectedVersion: FORK_CONFIG.anvil.version,
      clientVersion,
      image: FORK_CONFIG.anvil.image,
    },
    senderPreparation: {
      address: senderAddress.toLowerCase(),
      unlockedSignerCount: 0,
      upstreamNativeBalanceBeforeOverrideAtomic: sourceNativeBalance,
      upstreamUsdcBalanceAtomic: "0",
      localNativeBalanceOverrideAtomic: FORK_CONFIG.senderNativeBalanceAtomic,
      localUsdcBalanceAfterOverrideAtomic: "0",
      resetRestoredUpstreamBalances: true,
    },
    quote: {
      profileId: ARBITRUM_ONE_RUNTIME_PROFILE.profileId,
      protocol: ARBITRUM_ONE_RUNTIME_PROFILE.protocolId,
      amountInAtomic: upstreamQuote.amountInAtomic,
      sourceBlockNumber: upstreamQuote.sourceBlockNumber,
      sourceBlockHash: upstreamQuote.sourceBlockHash,
      upstreamAmountOutAtomic: upstreamQuote.amountOutAtomic,
      forkAmountOutAtomic: firstForkQuote.amountOutAtomic,
      resetRerunAmountOutAtomic: secondForkQuote.amountOutAtomic,
      poolAddress: upstreamQuote.poolAddress,
      quoterAddress: upstreamQuote.quoterAddress,
      tokenPath: upstreamQuote.tokenPath,
      exactAtomicOutputMatched: true,
    },
    reset: {
      snapshotRevertedBetweenQuotes: true,
      repeatQuoteMatched: true,
      snapshotRevertedAfterSmoke: true,
      localBlockNumberRestored: true,
    },
    rpcSafety: {
      upstreamWritesAllowed: false,
      signingOrBroadcastingPerformed: false,
      gasOrSimulationMethodsPerformed: false,
      localStateOverrides: [
        `anvil_setBalance(${senderAddress.toLowerCase()}, ${FORK_CONFIG.senderNativeBalanceAtomic} wei)`,
      ],
      localTransactionsMined: false,
    },
    limitations: [
      "This is read-only quote parity evidence, not transaction simulation, gas evidence, production Check support, Product acceptance, or transaction-execution evidence.",
      "The only local state override is native ETH balance preparation for an ephemeral address with no unlocked signer; no USDC balance, allowance, or pool state is changed.",
      "Upstream and local quote calls use the merged Arbitrum One profile, direct Camelot V3 route, exact input, and the same explicitly pinned source block.",
    ],
  };
}

async function readQuote(
  delegateRpc: RpcClient,
  senderAddress: string,
  observedAt: string,
): Promise<QuoteObservation> {
  const runtime = bootstrapBackendRuntime({
    environment: {
      MONAD_RPC_URL: "https://moss.invalid",
      ARBITRUM_ONE_RPC_URL: "http://fork-rpc.invalid",
      MOSS_RUNTIME_VERSION: "local-fork-quote-smoke",
      MOSS_RUNTIME_REVISION: "read-only",
    },
    tokenRegistry: {
      chains: [
        {
          chainId: ARBITRUM_ONE_CHAIN_ID,
          symbol: "ETH",
          decimals: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenIn.decimals,
        },
      ],
      tokens: [
        {
          chainId: ARBITRUM_ONE_CHAIN_ID,
          address: EXPECTED_USDC_ADDRESS,
          symbol: "USDC",
          decimals: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.decimals,
          decimalsSource: "onchain_verified",
          verifiedAtBlock: FORK_CONFIG.quote.verifiedTokenMetadataBlock,
        },
      ],
    },
  });
  const request: QuoteRequest = {
    chainId: ARBITRUM_ONE_CHAIN_ID,
    protocol: ARBITRUM_ONE_RUNTIME_PROFILE.protocolId,
    sender: senderAddress,
    tokenIn: { kind: "native" },
    tokenOut: { kind: "erc20", address: EXPECTED_USDC_ADDRESS },
    amountIn: FORK_CONFIG.quote.amountIn,
  };
  const normalized = normalizeQuoteRequestForChain(
    request,
    runtime.tokenRegistry,
    ARBITRUM_ONE_CHAIN_ID,
  );
  if (!normalized.success) {
    throw new ForkSmokeError(
      "QUOTE_REQUEST_INVALID",
      "Configured exact-input quote does not normalize against the verified route.",
    );
  }

  const rpcClient = createPinnedQuoteRpcClient(delegateRpc, "quote");
  const options: ArbitrumOneQuoteFlowOptions = {
    rpcClient,
    now: () => new Date(observedAt),
  };
  const flow = createArbitrumOneQuoteFlow(runtime, options);
  const result = quoteResultSchema.parse(
    await flow.quote({
      runId: "local-arbitrum-one-fork-quote",
      intent: normalized.intent,
      tokenInDecimals: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenIn.decimals,
      tokenOutDecimals: ARBITRUM_ONE_RUNTIME_PROFILE.route.tokenOut.decimals,
      moss: runtime.config.moss,
    }),
  );
  if (result.status !== "available") {
    throw new ForkSmokeError(
      "QUOTE_UNAVAILABLE",
      "Verified Camelot Quoter call was unavailable at the pinned source block.",
    );
  }
  const provenance = result.quote.provenance;
  if (
    provenance === undefined ||
    provenance.sourceChainId !== FORK_CONFIG.source.chainId ||
    provenance.sourceBlock.number !== FORK_CONFIG.source.blockNumber ||
    provenance.sourceBlock.hash.toLowerCase() !==
      FORK_CONFIG.source.blockHash.toLowerCase()
  ) {
    throw new ForkSmokeError(
      "QUOTE_PROVENANCE_MISMATCH",
      "Quote is not bound to the configured source block and profile.",
    );
  }
  return {
    amountInAtomic: provenance.amountInAtomic,
    amountOutAtomic: provenance.amountOutAtomic,
    sourceBlockNumber: provenance.sourceBlock.number,
    sourceBlockHash: provenance.sourceBlock.hash,
    poolAddress: provenance.route.poolAddress,
    quoterAddress: provenance.quoteSource.address,
    tokenPath: provenance.route.tokenPath,
  };
}

function readonlyClient(client: RpcClient, label: string): RpcClient {
  return {
    request(method, params = [], options) {
      if (!READ_ONLY_METHODS.has(method)) {
        throw new ForkSmokeError(
          "UPSTREAM_WRITE_BLOCKED",
          `${label} RPC method is outside the read-only allowlist.`,
        );
      }
      return client.request(method, params, options);
    },
  };
}

async function assertChainId(
  rpc: RpcClient,
  expectedChainId: number,
  label: string,
): Promise<void> {
  const value = await rpcResult(rpc, "eth_chainId", [], label);
  if (
    parseRpcQuantity(value, `${label} chain ID`) !== BigInt(expectedChainId)
  ) {
    throw new ForkSmokeError(
      label === "upstream"
        ? "SOURCE_CHAIN_ID_MISMATCH"
        : "LOCAL_CHAIN_ID_MISMATCH",
      `${label} RPC reported an unexpected chain ID.`,
    );
  }
}

async function readHeadNumber(rpc: RpcClient, label: string): Promise<string> {
  const value = await rpcResult(rpc, "eth_blockNumber", [], label);
  return parseRpcQuantity(value, `${label} block number`).toString();
}

async function assertBlockIdentity(
  rpc: RpcClient,
  label: string,
): Promise<void> {
  const block = await rpcResult(
    rpc,
    "eth_getBlockByNumber",
    [SOURCE_BLOCK_TAG, false],
    label,
  );
  if (!isRecord(block)) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_UNAVAILABLE",
      `${label} RPC cannot serve the configured historical block.`,
    );
  }
  const number = parseRpcQuantity(block.number, `${label} pinned block number`);
  if (number !== BigInt(FORK_CONFIG.source.blockNumber)) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_NUMBER_MISMATCH",
      `${label} RPC returned a different block number than configured.`,
    );
  }
  if (
    typeof block.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(block.hash) ||
    block.hash.toLowerCase() !== FORK_CONFIG.source.blockHash.toLowerCase()
  ) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_HASH_MISMATCH",
      `${label} RPC block hash differs from the pinned source hash.`,
    );
  }
}

async function assertRequiredCode(
  rpc: RpcClient,
  label: string,
): Promise<void> {
  const requiredContracts = [
    ["factory", ARBITRUM_ONE_RUNTIME_PROFILE.deployments.factoryAddress],
    ["quoter", ARBITRUM_ONE_RUNTIME_PROFILE.deployments.quoterAddress],
    ["router", ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress],
    [
      "wrapped native",
      ARBITRUM_ONE_RUNTIME_PROFILE.deployments.wrappedNativeAddress,
    ],
    ["USDC", ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress],
    ["direct pool", ARBITRUM_ONE_RUNTIME_PROFILE.route.poolAddress],
  ] as const;
  for (const [name, address] of requiredContracts) {
    const code = await rpcResult(
      rpc,
      "eth_getCode",
      [address, SOURCE_BLOCK_TAG],
      label,
    );
    if (
      typeof code !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) ||
      /^0x0+$/i.test(code)
    ) {
      throw new ForkSmokeError(
        "REQUIRED_CONTRACT_CODE_MISSING",
        `${label} RPC has no code for the verified route's ${name} at the pinned block.`,
      );
    }
  }
}

async function readAnvilClientVersion(rpc: RpcClient): Promise<string> {
  const value = await rpcResult(rpc, "web3_clientVersion", [], "local fork");
  if (
    typeof value !== "string" ||
    !value.toLowerCase().includes("anvil") ||
    !value.includes(FORK_CONFIG.anvil.version)
  ) {
    throw new ForkSmokeError(
      "ANVIL_VERSION_MISMATCH",
      `Local execution RPC is not the pinned Anvil ${FORK_CONFIG.anvil.version} version.`,
    );
  }
  return value;
}

async function readNativeBalance(
  rpc: RpcClient,
  address: string,
  blockTag: string,
  label: string,
): Promise<string> {
  const value = await rpcResult(
    rpc,
    "eth_getBalance",
    [address, blockTag],
    label,
  );
  return parseRpcQuantity(value, `${label} native balance`).toString();
}

async function readUsdcBalance(
  rpc: RpcClient,
  address: string,
  blockTag: string,
  label: string,
): Promise<string> {
  const encodedAddress = address.slice(2).toLowerCase().padStart(64, "0");
  const value = await rpcResult(
    rpc,
    "eth_call",
    [
      {
        to: EXPECTED_USDC_ADDRESS,
        data: `0x${ERC20_BALANCE_OF_SELECTOR}${encodedAddress}`,
      },
      blockTag,
    ],
    label,
  );
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ForkSmokeError(
      "SENDER_TOKEN_BALANCE_INVALID",
      `${label} returned a malformed USDC balance result.`,
    );
  }
  return BigInt(value).toString();
}

async function prepareSender(rpc: RpcClient, address: string): Promise<void> {
  await rpcResult(
    rpc,
    "anvil_setBalance",
    [address, toRpcQuantity(BigInt(FORK_CONFIG.senderNativeBalanceAtomic))],
    "local fork",
  );
  const balance = await readNativeBalance(rpc, address, "latest", "local fork");
  if (balance !== FORK_CONFIG.senderNativeBalanceAtomic) {
    throw new ForkSmokeError(
      "LOCAL_SENDER_PREPARATION_FAILED",
      "Anvil did not apply the native-only local sender balance override.",
    );
  }
}

async function createSnapshot(rpc: RpcClient): Promise<string> {
  const value = await rpcResult(rpc, "evm_snapshot", [], "local fork");
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).length === 0
  ) {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Anvil did not create a local EVM snapshot; destroy and recreate the fork.",
    );
  }
  return String(value);
}

async function revertSnapshot(
  rpc: RpcClient,
  snapshotId: string,
): Promise<void> {
  const value = await rpcResult(rpc, "evm_revert", [snapshotId], "local fork");
  if (value !== true) {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Anvil did not restore the local EVM snapshot; destroy and recreate the fork.",
    );
  }
}

function assertQuoteMatchesSource(
  expected: QuoteObservation,
  actual: QuoteObservation,
  label: string,
): void {
  if (
    expected.amountInAtomic !== actual.amountInAtomic ||
    expected.amountOutAtomic !== actual.amountOutAtomic ||
    expected.sourceBlockNumber !== actual.sourceBlockNumber ||
    expected.sourceBlockHash.toLowerCase() !==
      actual.sourceBlockHash.toLowerCase() ||
    expected.poolAddress.toLowerCase() !== actual.poolAddress.toLowerCase() ||
    expected.quoterAddress.toLowerCase() !==
      actual.quoterAddress.toLowerCase() ||
    expected.tokenPath.length !== actual.tokenPath.length ||
    expected.tokenPath.some(
      (address, index) =>
        address.toLowerCase() !== actual.tokenPath[index]?.toLowerCase(),
    )
  ) {
    throw new ForkSmokeError(
      "QUOTE_PARITY_MISMATCH",
      `${label} differs from the same-block upstream Camelot Quoter result.`,
    );
  }
}

function validateInstanceId(instanceId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      instanceId,
    )
  ) {
    throw new ForkSmokeError(
      "FORK_INSTANCE_ID_UNAVAILABLE",
      "Start the local harness to create a fork instance identity before smoke execution.",
    );
  }
}

async function rpcResult(
  rpc: RpcClient,
  method: string,
  params: readonly unknown[],
  label: string,
): Promise<unknown> {
  try {
    return await rpc.request(method, params);
  } catch (error) {
    if (error instanceof ForkSmokeError) throw error;
    throw new ForkSmokeError(
      "RPC_REQUEST_FAILED",
      `${label} RPC request failed during ${method}; endpoint details are suppressed.`,
    );
  }
}

function parseRpcQuantity(value: unknown, label: string): bigint {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw new ForkSmokeError(
      "RPC_RESPONSE_INVALID",
      `${label} is not a valid RPC quantity.`,
    );
  }
  return BigInt(value);
}

function toRpcQuantity(value: bigint): string {
  if (value < 0n) throw new RangeError("RPC quantity cannot be negative");
  return `0x${value.toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getForkHarnessConfig(): ForkConfig {
  return FORK_CONFIG;
}

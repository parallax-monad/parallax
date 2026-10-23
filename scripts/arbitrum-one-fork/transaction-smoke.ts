import { createHash } from "node:crypto";
import {
  fingerprintArbitrumOneTransaction,
  inspectArbitrumOneTransaction,
  type PreparedArbitrumOneTransaction,
} from "../../apps/api/src/backend/arbitrum-one-transaction.js";
import { NativeRpcClientError } from "../../apps/api/src/backend/native-rpc-client.js";
import { NATIVE_RPC_UNCHECKED_CAPABILITIES } from "../../apps/api/src/backend/native-rpc-evidence.js";
import { ARBITRUM_ONE_RUNTIME_PROFILE } from "../../apps/api/src/runtime-config.js";
import {
  type NormalizedSwapIntent,
  type P0BasicSimulation,
  p0BasicSimulationSchema,
  type Quote,
} from "../../packages/contracts/src/index.js";
import {
  createReadOnlyForkRpcClient,
  ForkSmokeError,
  getForkHarnessConfig,
  type RpcClient,
} from "./smoke.js";

const FORK_CONFIG = getForkHarnessConfig();
const LOCAL_SIMULATION_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "debug_traceCall",
  "eth_accounts",
  "web3_clientVersion",
  "parallax_forkInstanceId",
  "anvil_setBalance",
  "evm_snapshot",
  "evm_revert",
]);
const ERC20_BALANCE_OF_SELECTOR = "70a08231";
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const ABI_UINT256_RETURN_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TOPIC_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RETURN_DATA_HEX_LENGTH = 262_144;
const SOURCE_BLOCK_TAG = toRpcQuantity(BigInt(FORK_CONFIG.source.blockNumber));
// The local head is verified against the source block before this call. Use the
// current local state so Anvil's ephemeral balance override is visible without
// mining a transaction or changing the pinned block identity.
const LOCAL_SIMULATION_STATE_TAG = "latest";

export interface ForkTransactionSimulationEvidence {
  readonly schemaVersion: "parallax-arbitrum-one-fork-transaction-simulation-v1";
  readonly evidenceStatus: "LOCAL_FORK_BACKEND_EVIDENCE_NOT_PRODUCTION_SUPPORT";
  readonly observedAt: string;
  readonly source: {
    readonly chainId: number;
    readonly observedHeadNumber: string;
    readonly quoteBlockNumber: string;
    readonly quoteBlockHash: string;
    readonly quoteObservedAt: string;
  };
  readonly localExecution: {
    readonly chainId: number;
    readonly baseBlockNumber: string;
    readonly baseBlockHash: string;
    readonly observedHeadNumber: string;
    readonly forkInstanceId: string;
    readonly anvilVersion: string;
  };
  readonly quote: {
    readonly profileId: string;
    readonly protocol: string;
    readonly amountInAtomic: string;
    readonly amountOutAtomic: string;
    readonly poolAddress: string;
    readonly quoterAddress: string;
    readonly tokenPath: readonly string[];
  };
  readonly transaction: {
    readonly fingerprint: string;
    readonly binding: NonNullable<P0BasicSimulation["transactionBinding"]>;
  };
  readonly backendEvidence: P0BasicSimulation;
  readonly transactionOutcome: {
    readonly recipientTransfer: {
      readonly status: "AVAILABLE" | "UNAVAILABLE";
      readonly source: "LOCAL_DEBUG_TRACE_TRANSFER_LOG" | "NOT_OBSERVED";
      readonly tokenAddress: string;
      readonly recipient: string;
      readonly amountOutAtomic?: string;
      readonly transferEventCount?: number;
      readonly matchesQuoteAmountOut?: boolean;
      readonly meetsMinimumOutput?: boolean;
    };
    readonly assetBalanceDelta: {
      readonly status: "UNAVAILABLE";
      readonly reason: "READ_ONLY_TRACE_DOES_NOT_PERSIST_STATE";
    };
  };
  readonly senderPreparation: {
    readonly address: string;
    readonly unlockedSignerCount: 0;
    readonly sourceNativeBalanceBeforeOverrideAtomic: string;
    readonly sourceUsdcBalanceAtomic: "0";
    readonly localNativeBalanceOverrideAtomic: string;
    readonly localUsdcBalanceAfterOverrideAtomic: "0";
    readonly resetRestoredSourceBalances: true;
  };
  readonly rpcSafety: {
    readonly upstreamWritesAllowed: false;
    readonly signingOrBroadcastingPerformed: false;
    readonly transactionSubmissionPerformed: false;
    readonly localTransactionsMined: false;
    readonly localStateOverride: "ephemeral sender native ETH balance only";
  };
  readonly limitations: readonly string[];
}

export interface RunForkTransactionSimulationInput {
  readonly sourceRpc: RpcClient;
  readonly localRpc: RpcClient;
  readonly forkInstanceId: string;
  readonly intent: NormalizedSwapIntent;
  readonly quote: Quote;
  readonly preparedTransaction: PreparedArbitrumOneTransaction;
  readonly now?: () => Date;
}

interface BlockIdentity {
  readonly number: string;
  readonly hash: string;
  readonly timestamp: string;
}

interface RpcObservation<T> {
  readonly status: "available" | "unavailable";
  readonly value?: T;
  readonly reason?: "EVM_REVERT" | "RPC_UNAVAILABLE" | "MALFORMED_RESPONSE";
}

type RecipientTransferObservation =
  | {
      readonly status: "available";
      readonly amountAtomic: string;
      readonly eventCount: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "TRACE_UNAVAILABLE"
        | "MALFORMED_RESPONSE"
        | "NO_TRANSFER";
    };

/**
 * Allowlist the local Anvil operations used by the developer simulation.
 * Transactions, signing, mining, and every other RPC method are rejected.
 */
export function createLocalForkSimulationRpcClient(
  delegate: RpcClient,
): RpcClient {
  return {
    request(method, params = [], options) {
      if (!LOCAL_SIMULATION_METHODS.has(method)) {
        throw new ForkSmokeError(
          "LOCAL_SIMULATION_METHOD_REJECTED",
          "Local fork simulation rejected an RPC method outside its allowlist.",
        );
      }
      return delegate.request(method, params, options);
    },
  };
}

/** Simulate the exact prepared transaction; this function never quotes or builds. */
export async function runForkTransactionSimulation(
  input: RunForkTransactionSimulationInput,
): Promise<ForkTransactionSimulationEvidence> {
  validateInstanceId(input.forkInstanceId);
  if (
    input.preparedTransaction.kind !== "unsigned" ||
    input.preparedTransaction.fingerprint !==
      fingerprintArbitrumOneTransaction(input.preparedTransaction.payload)
  ) {
    throw new ForkSmokeError(
      "TRANSACTION_FINGERPRINT_MISMATCH",
      "Prepared transaction fingerprint does not match its exact unsigned payload.",
    );
  }
  const observedAtDate = (input.now ?? (() => new Date()))();
  if (Number.isNaN(observedAtDate.getTime())) {
    throw new ForkSmokeError(
      "INVALID_CLOCK",
      "Transaction simulation clock returned an invalid date.",
    );
  }
  const observedAt = observedAtDate.toISOString();
  const inspection = inspectArbitrumOneTransaction({
    intent: input.intent,
    quote: input.quote,
    transaction: input.preparedTransaction.payload,
    now: observedAtDate,
  });
  if (!inspection.ok) {
    throw new ForkSmokeError(
      "TRANSACTION_BINDING_MISMATCH",
      "Prepared transaction does not match the verified One route and quote.",
    );
  }
  const provenance = input.quote.provenance;
  if (
    provenance === undefined ||
    provenance.sourceChainId !== FORK_CONFIG.source.chainId ||
    provenance.sourceBlock.number !== FORK_CONFIG.source.blockNumber ||
    provenance.sourceBlock.hash.toLowerCase() !==
      FORK_CONFIG.source.blockHash.toLowerCase()
  ) {
    throw new ForkSmokeError(
      "QUOTE_BLOCK_MISMATCH",
      "Quote provenance does not match the configured fork source block.",
    );
  }

  const sourceRpc = createReadOnlyForkRpcClient(input.sourceRpc, "upstream");
  const localRpc = createLocalForkSimulationRpcClient(input.localRpc);
  await assertForkInstanceIdentity(localRpc, input.forkInstanceId);
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
      "Upstream RPC head is earlier than the configured quote block.",
    );
  }
  const localHeadNumber = await readHeadNumber(localRpc, "local fork");
  if (localHeadNumber !== FORK_CONFIG.source.blockNumber) {
    throw new ForkSmokeError(
      "LOCAL_FORK_BLOCK_MISMATCH",
      "Local fork head does not equal the configured source block; reset the fork.",
    );
  }
  const [sourceBlock, localBlock] = await Promise.all([
    readBlockIdentity(sourceRpc, "upstream"),
    readBlockIdentity(localRpc, "local fork"),
  ]);
  assertExpectedBlock(sourceBlock, "upstream");
  assertExpectedBlock(localBlock, "local fork");
  const anvilVersion = await readAnvilClientVersion(localRpc);
  const accounts = await rpcResult(localRpc, "eth_accounts", [], "local fork");
  if (!Array.isArray(accounts) || accounts.length !== 0) {
    throw new ForkSmokeError(
      "UNEXPECTED_LOCAL_SIGNERS",
      "Anvil must expose zero unlocked signer accounts for local simulation.",
    );
  }
  await assertRouterCode(localRpc);

  const senderAddress = input.preparedTransaction.payload.from;
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
      "Ephemeral sender has USDC at the pinned source state; no token balance will be changed.",
    );
  }
  if (localNativeBalanceBefore !== sourceNativeBalance) {
    throw new ForkSmokeError(
      "LOCAL_BASE_STATE_MISMATCH",
      "Local sender balance differs from the pinned upstream state before preparation.",
    );
  }
  if (
    BigInt(FORK_CONFIG.senderNativeBalanceAtomic) <=
    BigInt(input.preparedTransaction.payload.value)
  ) {
    throw new ForkSmokeError(
      "LOCAL_SENDER_PREPARATION_INVALID",
      "Configured native-only sender balance does not cover the exact transaction value.",
    );
  }

  const snapshotId = await createSnapshot(localRpc);
  let call: RpcObservation<string>;
  let gasEstimate: RpcObservation<string>;
  let recipientTransfer: RecipientTransferObservation;
  try {
    await prepareSender(localRpc, senderAddress);
    const localUsdcAfterOverride = await readUsdcBalance(
      localRpc,
      senderAddress,
      "latest",
      "local fork",
    );
    if (localUsdcAfterOverride !== "0") {
      throw new ForkSmokeError(
        "LOCAL_USDC_STATE_CHANGED",
        "Native-only sender preparation unexpectedly changed the USDC balance.",
      );
    }
    call = await observeCall(localRpc, input.preparedTransaction.payload);
    gasEstimate = await observeGasEstimate(
      localRpc,
      input.preparedTransaction.payload,
    );
    recipientTransfer =
      call.status === "available"
        ? await observeRecipientTransfer(
            localRpc,
            input.preparedTransaction.payload,
            inspection.binding.recipient,
          )
        : { status: "unavailable", reason: "NO_TRANSFER" };
  } finally {
    await revertSnapshot(localRpc, snapshotId);
  }

  const localNativeBalanceAfter = await readNativeBalance(
    localRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "local fork",
  );
  const localUsdcBalanceAfter = await readUsdcBalance(
    localRpc,
    senderAddress,
    SOURCE_BLOCK_TAG,
    "local fork",
  );
  const restoredHead = await readHeadNumber(localRpc, "local fork");
  if (
    localNativeBalanceAfter !== sourceNativeBalance ||
    localUsdcBalanceAfter !== sourceUsdcBalance ||
    restoredHead !== FORK_CONFIG.source.blockNumber
  ) {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Local fork snapshot did not restore the pinned sender state and base block.",
    );
  }

  const backendEvidence = projectBackendEvidence({
    call,
    gasEstimate,
    blockNumber: localBlock.number,
    blockHash: localBlock.hash,
    observedAt,
    transactionFingerprint: input.preparedTransaction.fingerprint,
    transactionBinding: inspection.binding,
  });
  const expectedQuoteOutput = BigInt(provenance.amountOutAtomic);
  const minimumOutput = BigInt(inspection.binding.amountOutMinimumAtomic);
  return {
    schemaVersion: "parallax-arbitrum-one-fork-transaction-simulation-v1",
    evidenceStatus: "LOCAL_FORK_BACKEND_EVIDENCE_NOT_PRODUCTION_SUPPORT",
    observedAt,
    source: {
      chainId: FORK_CONFIG.source.chainId,
      observedHeadNumber: sourceHeadNumber,
      quoteBlockNumber: provenance.sourceBlock.number,
      quoteBlockHash: provenance.sourceBlock.hash,
      quoteObservedAt: provenance.sourceBlock.observedAt,
    },
    localExecution: {
      chainId: FORK_CONFIG.localExecutionChainId,
      baseBlockNumber: localBlock.number,
      baseBlockHash: localBlock.hash,
      observedHeadNumber: restoredHead,
      forkInstanceId: input.forkInstanceId,
      anvilVersion,
    },
    quote: {
      profileId: provenance.profileId,
      protocol: provenance.route.protocol,
      amountInAtomic: provenance.amountInAtomic,
      amountOutAtomic: provenance.amountOutAtomic,
      poolAddress: provenance.route.poolAddress,
      quoterAddress: provenance.quoteSource.address,
      tokenPath: provenance.route.tokenPath,
    },
    transaction: {
      fingerprint: input.preparedTransaction.fingerprint,
      binding: inspection.binding,
    },
    backendEvidence,
    transactionOutcome: {
      recipientTransfer: {
        status:
          recipientTransfer.status === "available"
            ? "AVAILABLE"
            : "UNAVAILABLE",
        source:
          recipientTransfer.status === "available"
            ? "LOCAL_DEBUG_TRACE_TRANSFER_LOG"
            : "NOT_OBSERVED",
        tokenAddress: inspection.binding.tokenOut,
        recipient: inspection.binding.recipient.toLowerCase(),
        ...(recipientTransfer.status === "available"
          ? {
              amountOutAtomic: recipientTransfer.amountAtomic,
              transferEventCount: recipientTransfer.eventCount,
              matchesQuoteAmountOut:
                BigInt(recipientTransfer.amountAtomic) === expectedQuoteOutput,
              meetsMinimumOutput:
                BigInt(recipientTransfer.amountAtomic) >= minimumOutput,
            }
          : {}),
      },
      assetBalanceDelta: {
        status: "UNAVAILABLE",
        reason: "READ_ONLY_TRACE_DOES_NOT_PERSIST_STATE",
      },
    },
    senderPreparation: {
      address: senderAddress.toLowerCase(),
      unlockedSignerCount: 0,
      sourceNativeBalanceBeforeOverrideAtomic: sourceNativeBalance,
      sourceUsdcBalanceAtomic: "0",
      localNativeBalanceOverrideAtomic: FORK_CONFIG.senderNativeBalanceAtomic,
      localUsdcBalanceAfterOverrideAtomic: "0",
      resetRestoredSourceBalances: true,
    },
    rpcSafety: {
      upstreamWritesAllowed: false,
      signingOrBroadcastingPerformed: false,
      transactionSubmissionPerformed: false,
      localTransactionsMined: false,
      localStateOverride: "ephemeral sender native ETH balance only",
    },
    limitations: [
      "This capture is developer-only local-fork evidence; it does not enable Arbitrum One production Check or simulation and is not Product acceptance.",
      "The exact prepared unsigned transaction was evaluated with eth_call and eth_estimateGas; neither observation is a receipt or gas-used value.",
      "No transaction was signed, broadcast, submitted, or mined; the only local state override was an ephemeral sender's native ETH balance and the Anvil snapshot was reverted.",
      "The exact eth_call return bytes are represented only by a fingerprint. If local Anvil supports the bounded debug_traceCall callTracer request, matching USDC Transfer events to the prepared recipient are summarized and compared with the quote and encoded minimum-output protection; raw trace payloads and logs are discarded.",
      "A simulated Transfer event is not a recipient balance delta or receipt.",
      "Recipient balance delta and committed asset state are unavailable because eth_call and debug_traceCall do not persist transaction state.",
    ],
  };
}

function projectBackendEvidence(input: {
  readonly call: RpcObservation<string>;
  readonly gasEstimate: RpcObservation<string>;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly observedAt: string;
  readonly transactionFingerprint: string;
  readonly transactionBinding: NonNullable<
    P0BasicSimulation["transactionBinding"]
  >;
}): P0BasicSimulation {
  const callStatus: P0BasicSimulation["call"]["status"] =
    input.call.status === "available"
      ? "SUCCEEDED"
      : input.call.reason === "EVM_REVERT"
        ? "REVERTED"
        : "UNAVAILABLE";
  const gasStatus: P0BasicSimulation["gasEstimate"]["status"] =
    input.gasEstimate.status === "available" ? "AVAILABLE" : "UNAVAILABLE";
  const failureStage =
    callStatus !== "SUCCEEDED"
      ? ("CALL" as const)
      : gasStatus !== "AVAILABLE"
        ? ("GAS_ESTIMATE" as const)
        : undefined;
  const reason =
    callStatus === "REVERTED"
      ? "LOCAL_FORK_EVM_REVERT"
      : callStatus === "UNAVAILABLE"
        ? "LOCAL_FORK_CALL_UNAVAILABLE"
        : gasStatus === "UNAVAILABLE"
          ? "LOCAL_FORK_GAS_ESTIMATE_UNAVAILABLE"
          : undefined;
  const validityAtExecution =
    callStatus === "REVERTED"
      ? "INVALID"
      : callStatus === "SUCCEEDED" && gasStatus === "AVAILABLE"
        ? "VALID"
        : "UNKNOWN";
  return p0BasicSimulationSchema.parse({
    call: {
      status: callStatus,
      ...(input.call.value === undefined
        ? {}
        : { returnDataFingerprint: fingerprintData(input.call.value) }),
    },
    gasEstimate: {
      status: gasStatus,
      ...(input.gasEstimate.value === undefined
        ? {}
        : { gasUnits: input.gasEstimate.value }),
    },
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    observedAt: input.observedAt,
    validityAtExecution,
    preparedTransactionFingerprint: input.transactionFingerprint,
    transactionBinding: input.transactionBinding,
    ...(failureStage === undefined ? {} : { failureStage }),
    ...(reason === undefined ? {} : { reason }),
    uncheckedCapabilities: [...NATIVE_RPC_UNCHECKED_CAPABILITIES],
  });
}

async function assertForkInstanceIdentity(
  localRpc: RpcClient,
  expectedInstanceId: string,
): Promise<void> {
  const observed = await rpcResult(
    localRpc,
    "parallax_forkInstanceId",
    [],
    "local fork",
  );
  if (observed !== expectedInstanceId) {
    throw new ForkSmokeError(
      "FORK_INSTANCE_IDENTITY_MISMATCH",
      "Local RPC endpoint is not served by the expected fork instance.",
    );
  }
}

async function assertChainId(
  rpc: RpcClient,
  expected: number,
  label: string,
): Promise<void> {
  const observed = parseRpcQuantity(
    await rpcResult(rpc, "eth_chainId", [], label),
    `${label} chain ID`,
  );
  if (observed !== BigInt(expected)) {
    throw new ForkSmokeError(
      label === "upstream"
        ? "SOURCE_CHAIN_ID_MISMATCH"
        : "LOCAL_CHAIN_ID_MISMATCH",
      `${label} RPC reported an unexpected chain ID.`,
    );
  }
}

async function readHeadNumber(rpc: RpcClient, label: string): Promise<string> {
  return parseRpcQuantity(
    await rpcResult(rpc, "eth_blockNumber", [], label),
    `${label} block number`,
  ).toString();
}

async function readBlockIdentity(
  rpc: RpcClient,
  label: string,
): Promise<BlockIdentity> {
  const value = await rpcResult(
    rpc,
    "eth_getBlockByNumber",
    [SOURCE_BLOCK_TAG, false],
    label,
  );
  if (!isRecord(value)) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_UNAVAILABLE",
      `${label} RPC cannot serve the configured historical block.`,
    );
  }
  const number = parseRpcQuantity(value.number, `${label} pinned block number`);
  if (
    typeof value.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.hash)
  ) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_IDENTITY_INVALID",
      `${label} RPC returned an invalid pinned block hash.`,
    );
  }
  const timestamp = parseRpcQuantity(
    value.timestamp,
    `${label} block timestamp`,
  );
  return {
    number: number.toString(),
    hash: value.hash,
    timestamp: timestamp.toString(),
  };
}

function assertExpectedBlock(block: BlockIdentity, label: string): void {
  if (block.number !== FORK_CONFIG.source.blockNumber) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_NUMBER_MISMATCH",
      `${label} RPC returned a different block number than configured.`,
    );
  }
  if (block.hash.toLowerCase() !== FORK_CONFIG.source.blockHash.toLowerCase()) {
    throw new ForkSmokeError(
      "SOURCE_BLOCK_HASH_MISMATCH",
      `${label} RPC block hash differs from the pinned source hash.`,
    );
  }
}

async function readAnvilClientVersion(localRpc: RpcClient): Promise<string> {
  const value = await rpcResult(
    localRpc,
    "web3_clientVersion",
    [],
    "local fork",
  );
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
  // Persist only the project-pinned version, not an arbitrary raw RPC string.
  return FORK_CONFIG.anvil.version;
}

async function assertRouterCode(localRpc: RpcClient): Promise<void> {
  const code = await rpcResult(
    localRpc,
    "eth_getCode",
    [ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress, SOURCE_BLOCK_TAG],
    "local fork",
  );
  if (
    typeof code !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) ||
    /^0x0+$/i.test(code)
  ) {
    throw new ForkSmokeError(
      "REQUIRED_CONTRACT_CODE_MISSING",
      "Local fork has no code for the backend-owned Camelot router at the source block.",
    );
  }
}

async function readNativeBalance(
  rpc: RpcClient,
  address: string,
  blockTag: string,
  label: string,
): Promise<string> {
  return parseRpcQuantity(
    await rpcResult(rpc, "eth_getBalance", [address, blockTag], label),
    `${label} native balance`,
  ).toString();
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
        to: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress,
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

async function prepareSender(
  localRpc: RpcClient,
  senderAddress: string,
): Promise<void> {
  await rpcResult(
    localRpc,
    "anvil_setBalance",
    [
      senderAddress,
      toRpcQuantity(BigInt(FORK_CONFIG.senderNativeBalanceAtomic)),
    ],
    "local fork",
  );
  const observed = await readNativeBalance(
    localRpc,
    senderAddress,
    "latest",
    "local fork",
  );
  if (observed !== FORK_CONFIG.senderNativeBalanceAtomic) {
    throw new ForkSmokeError(
      "LOCAL_SENDER_PREPARATION_FAILED",
      "Anvil did not apply the native-only local sender balance override.",
    );
  }
}

async function createSnapshot(localRpc: RpcClient): Promise<string> {
  const value = await rpcResult(localRpc, "evm_snapshot", [], "local fork");
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).length === 0
  ) {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Anvil did not create a local EVM snapshot.",
    );
  }
  return String(value);
}

async function revertSnapshot(
  localRpc: RpcClient,
  snapshotId: string,
): Promise<void> {
  let value: unknown;
  try {
    value = await localRpc.request("evm_revert", [snapshotId]);
  } catch {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Anvil snapshot reset failed; destroy and recreate the fork before retrying.",
    );
  }
  if (value !== true) {
    throw new ForkSmokeError(
      "RESET_FAILED",
      "Anvil did not restore the local EVM snapshot; destroy and recreate the fork.",
    );
  }
}

async function observeCall(
  localRpc: RpcClient,
  transaction: PreparedArbitrumOneTransaction["payload"],
): Promise<RpcObservation<string>> {
  try {
    const result = await localRpc.request("eth_call", [
      transaction,
      LOCAL_SIMULATION_STATE_TAG,
    ]);
    if (
      typeof result !== "string" ||
      !DATA_PATTERN.test(result) ||
      result.length > MAX_RETURN_DATA_HEX_LENGTH
    ) {
      return { status: "unavailable", reason: "MALFORMED_RESPONSE" };
    }
    return { status: "available", value: result };
  } catch (error) {
    if (isEvmRevertError(error)) {
      return { status: "unavailable", reason: "EVM_REVERT" };
    }
    return { status: "unavailable", reason: "RPC_UNAVAILABLE" };
  }
}

function isEvmRevertError(error: unknown): boolean {
  if (error instanceof NativeRpcClientError) {
    return error.kind === "RPC_ERROR" && error.message === "execution reverted";
  }
  if (
    !(error instanceof Error) ||
    !isRecord(error) ||
    !Object.hasOwn(error, "rpcCode") ||
    typeof error.rpcCode !== "number" ||
    !Number.isInteger(error.rpcCode)
  ) {
    return false;
  }
  // The JSON-RPC client attaches rpcCode only to error envelopes. The provider
  // message is inspected only for classification and never enters evidence.
  return /\b(?:execution reverted|revert(?:ed)?)\b/i.test(error.message);
}

async function observeGasEstimate(
  localRpc: RpcClient,
  transaction: PreparedArbitrumOneTransaction["payload"],
): Promise<RpcObservation<string>> {
  try {
    const result = await localRpc.request("eth_estimateGas", [
      transaction,
      LOCAL_SIMULATION_STATE_TAG,
    ]);
    if (typeof result !== "string" || !RPC_QUANTITY_PATTERN.test(result)) {
      return { status: "unavailable", reason: "MALFORMED_RESPONSE" };
    }
    const gasUnits = parseRpcQuantity(result, "gas estimate");
    if (gasUnits === 0n) {
      return { status: "unavailable", reason: "MALFORMED_RESPONSE" };
    }
    return { status: "available", value: gasUnits.toString() };
  } catch {
    return { status: "unavailable", reason: "RPC_UNAVAILABLE" };
  }
}

async function observeRecipientTransfer(
  localRpc: RpcClient,
  transaction: PreparedArbitrumOneTransaction["payload"],
  recipient: string,
): Promise<RecipientTransferObservation> {
  let trace: unknown;
  try {
    trace = await localRpc.request("debug_traceCall", [
      transaction,
      LOCAL_SIMULATION_STATE_TAG,
      { tracer: "callTracer", tracerConfig: { withLog: true } },
    ]);
  } catch {
    return { status: "unavailable", reason: "TRACE_UNAVAILABLE" };
  }
  const logs = collectTraceLogs(trace);
  if (logs === undefined) {
    return { status: "unavailable", reason: "MALFORMED_RESPONSE" };
  }
  const tokenAddress = ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress;
  const recipientTopic = `0x${recipient.slice(2).toLowerCase().padStart(64, "0")}`;
  let amount = 0n;
  let eventCount = 0;
  for (const log of logs) {
    if (
      log.address.toLowerCase() !== tokenAddress.toLowerCase() ||
      log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC ||
      log.topics.length !== 3 ||
      log.topics[2]?.toLowerCase() !== recipientTopic
    ) {
      continue;
    }
    if (!ABI_UINT256_RETURN_PATTERN.test(log.data)) {
      return { status: "unavailable", reason: "MALFORMED_RESPONSE" };
    }
    amount += BigInt(log.data);
    eventCount += 1;
  }
  if (eventCount === 0) {
    return { status: "unavailable", reason: "NO_TRANSFER" };
  }
  if (eventCount !== 1) {
    return { status: "unavailable", reason: "MALFORMED_RESPONSE" };
  }
  return {
    status: "available",
    amountAtomic: amount.toString(),
    eventCount,
  };
}

interface SanitizedTraceLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
}

function collectTraceLogs(value: unknown): SanitizedTraceLog[] | undefined {
  if (!isRecord(value)) return undefined;
  const pending: Record<string, unknown>[] = [value];
  const logs: SanitizedTraceLog[] = [];
  let visited = 0;
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined || ++visited > 10_000) return undefined;
    if (frame.logs !== undefined) {
      if (!Array.isArray(frame.logs)) return undefined;
      for (const rawLog of frame.logs) {
        if (
          !isRecord(rawLog) ||
          typeof rawLog.address !== "string" ||
          !ADDRESS_PATTERN.test(rawLog.address) ||
          !Array.isArray(rawLog.topics) ||
          !rawLog.topics.every(
            (topic) => typeof topic === "string" && TOPIC_PATTERN.test(topic),
          ) ||
          typeof rawLog.data !== "string" ||
          !DATA_PATTERN.test(rawLog.data)
        ) {
          return undefined;
        }
        logs.push({
          address: rawLog.address,
          topics: rawLog.topics,
          data: rawLog.data,
        });
      }
    }
    if (frame.calls !== undefined) {
      if (!Array.isArray(frame.calls) || !frame.calls.every(isRecord)) {
        return undefined;
      }
      pending.push(...frame.calls);
    }
  }
  return logs;
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
      `${label} RPC request failed during ${method}; endpoint and provider details are suppressed.`,
    );
  }
}

function parseRpcQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !RPC_QUANTITY_PATTERN.test(value)) {
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

function fingerprintData(value: string): string {
  return `sha256:${createHash("sha256").update(value.toLowerCase()).digest("hex")}`;
}

function validateInstanceId(instanceId: string): void {
  if (!UUID_PATTERN.test(instanceId)) {
    throw new ForkSmokeError(
      "FORK_INSTANCE_ID_UNAVAILABLE",
      "Start the local harness to create a fork instance identity before simulation.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

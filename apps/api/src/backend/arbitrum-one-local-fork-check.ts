import { createHash } from "node:crypto";
import {
  convertAtomicAmountToHuman,
  type FailedRunResult,
  failedRunResultSchema,
  type GenericEvidence,
  genericEvidenceSchema,
  type ProviderNeutralSimulationProvenance,
  providerNeutralSimulationProvenanceSchema,
  type Quote,
  quoteResultSchema,
  runResultSchema,
} from "@parallax/contracts";
import { projectGenericEvidenceToRunResult } from "@parallax/orchestrator/agent-flow";
import type { AgentFlowCheckInput, AgentFlowPort } from "../ports.js";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_ONE_RUNTIME_PROFILE,
  type BackendRuntime,
} from "../runtime-config.js";
import {
  type AnvilStateRevision,
  createArbitrumOneExecutionCall,
  qualifyArbitrumOneRecipientBalanceDelta,
  readAnvilStateRevision,
  type StateDiffAmountReceived,
} from "./anvil-prestate-diff.js";
import type { ArbitrumRpcClient } from "./arbitrum-chain-adapter.js";
import { createArbitrumOneQuoteFlow } from "./arbitrum-one-quote.js";
import { createArbitrumOneQuoteRuntime } from "./arbitrum-one-runtime.js";
import {
  inspectArbitrumOneTransaction,
  prepareArbitrumOneTransaction,
} from "./arbitrum-one-transaction.js";
import type { ChainOperationOptions } from "./chain-adapter.js";
import {
  createNativeRpcClient,
  NativeRpcClientError,
} from "./native-rpc-client.js";

const LOCAL_FORK_CHAIN_ID = 31_337n;
const LOCAL_RPC_TIMEOUT_MS = 5_000;
const SENDER_NATIVE_GAS_HEADROOM_ATOMIC = 1_000_000_000_000_000_000n;
const MAX_NATIVE_BALANCE_ATOMIC = (1n << 256n) - 1n;
const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const LOCAL_FORK_METHODS = new Set([
  "parallax_forkInstanceId",
  "web3_clientVersion",
  "eth_chainId",
  "eth_accounts",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getBalance",
  "eth_getStorageAt",
  "evm_snapshot",
  "anvil_setBalance",
  "anvil_dumpState",
  "eth_call",
  "eth_estimateGas",
  "debug_traceCall",
  "evm_revert",
]);

// This queue serializes API Check mutations only inside this Node process. It
// cannot coordinate another backend process or an external Anvil RPC writer.
const localForkSimulationTails = new Map<string, Promise<void>>();

type LocalForkFailureReason =
  | "EVM_REVERT"
  | "SLIPPAGE_GUARD"
  | "RPC_TIMEOUT"
  | "RPC_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "INSUFFICIENT_NATIVE_BALANCE"
  | "FORK_STATE_CHANGED";

export class ArbitrumOneSourceMismatchError extends Error {
  public readonly code = "SOURCE_MISMATCH";
  public readonly integrationStatus = "INTEGRATION_ERROR";
  public readonly source = "rpc";
  public readonly stage = "simulation";
  public readonly partialRunResult: FailedRunResult | undefined;

  public constructor(partialRunResult?: FailedRunResult) {
    super("Pinned source quote does not match the verified local fork context");
    this.name = "ArbitrumOneSourceMismatchError";
    this.partialRunResult = partialRunResult;
  }
}

export class ArbitrumOneForkStateChangedError extends Error {
  public readonly code = "FORK_STATE_CHANGED";
  public readonly integrationStatus = "INTEGRATION_ERROR";
  public readonly source = "rpc";
  public readonly stage = "simulation";
  public readonly partialRunResult: FailedRunResult | undefined;

  public constructor(partialRunResult?: FailedRunResult) {
    super("Local fork state changed during read-only simulation");
    this.name = "ArbitrumOneForkStateChangedError";
    this.partialRunResult = partialRunResult;
  }
}

export type ArbitrumOneLocalForkCheckFlowOptions = {
  /** Internal deterministic-test seam. Never populated from an API request. */
  readonly localRpcClient?: ArbitrumRpcClient;
  /** Internal deterministic-test seam for the source quote RPC. */
  readonly sourceRpcClient?: ArbitrumRpcClient;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
};

/**
 * Local-only Arbitrum One Check. Source RPC is used for quote reads only; the
 * exact prepared transaction is evaluated with read-only call/gas/trace RPCs on
 * a pinned, identity-verified local Anvil fork. A recipient amount is exposed
 * only when prestateTracer storage is cross-checked against eth_getStorageAt
 * and state-override balanceOf calls. The temporary native balance override
 * is always reverted; this flow never signs, sends, or mines a transaction.
 */
export function createArbitrumOneLocalForkCheckFlow(
  runtime: BackendRuntime,
  options: ArbitrumOneLocalForkCheckFlowOptions = {},
): AgentFlowPort {
  return {
    async check(input) {
      const localConfig = runtime.config.arbitrumOneLocalForkCheck;
      if (localConfig === undefined) {
        throw new Error("Local fork Check is not enabled");
      }
      const localRpc = createLocalForkRpcClient(
        localConfig.rpcUrl,
        options.localRpcClient,
        options.fetchImplementation,
      );
      const observedAtDate = (options.now ?? (() => new Date()))();
      if (Number.isNaN(observedAtDate.getTime())) {
        throw new Error("Local fork observation clock is invalid");
      }
      const observedAt = observedAtDate.toISOString();
      const sourceRuntime = await createArbitrumOneQuoteRuntime(runtime, {
        ...(options.sourceRpcClient === undefined
          ? {}
          : { rpcClient: options.sourceRpcClient }),
        ...(options.fetchImplementation === undefined
          ? {}
          : { fetchImplementation: options.fetchImplementation }),
      });
      const localIdentity = await readLocalForkIdentity(
        localRpc,
        localConfig.forkInstanceId,
        localConfig.anvilVersion,
      );
      const sourceBlockTag = toRpcQuantity(BigInt(localIdentity.block.number));
      const sourceBlockBefore = await readSourceBlock(
        sourceRuntime.rpcClient,
        sourceBlockTag,
        localIdentity.block.number,
      );
      if (
        sourceBlockBefore.hash.toLowerCase() !==
        localIdentity.block.hash.toLowerCase()
      ) {
        throw new ArbitrumOneSourceMismatchError();
      }

      const localRouterCode = await requestLocal(localRpc, "eth_getCode", [
        ARBITRUM_ONE_RUNTIME_PROFILE.deployments.routerAddress,
        sourceBlockTag,
      ]);
      if (
        typeof localRouterCode !== "string" ||
        !/^0x[0-9a-f]+$/i.test(localRouterCode) ||
        /^0x0*$/i.test(localRouterCode)
      ) {
        throw new Error("Local fork router code is unavailable");
      }
      const sourceQuoteFlow = createArbitrumOneQuoteFlow(runtime, {
        rpcClient: sourceRuntime.rpcClient,
        sourceBlockNumber: localIdentity.block.number,
        now: () => observedAtDate,
      });
      const quoteResult = quoteResultSchema.parse(
        await sourceQuoteFlow.quote(input),
      );
      if (quoteResult.status !== "available") {
        throw new Error("Pinned source quote is unavailable");
      }
      const quote = quoteResult.quote;
      const quoteProvenance = quote.provenance;
      if (
        quoteProvenance === undefined ||
        quoteProvenance.sourceBlock.number !== localIdentity.block.number ||
        quoteProvenance.sourceBlock.hash.toLowerCase() !==
          localIdentity.block.hash.toLowerCase()
      ) {
        throw new ArbitrumOneSourceMismatchError();
      }

      const prepared = prepareArbitrumOneTransaction({
        intent: input.intent,
        quote,
        now: () => observedAtDate,
      });
      const inspection = inspectArbitrumOneTransaction({
        intent: input.intent,
        quote,
        transaction: prepared.payload,
        expectedSourceBlock: {
          chainId: ARBITRUM_ONE_CHAIN_ID,
          number: localIdentity.block.number,
          hash: localIdentity.block.hash,
        },
        now: observedAtDate,
      });
      if (!inspection.ok) {
        if (inspection.failureCode === "SOURCE_MISMATCH") {
          throw new ArbitrumOneSourceMismatchError();
        }
        throw new Error("Prepared local fork transaction binding is invalid");
      }
      const senderNativeBalanceOverrideAtomic =
        calculateSenderNativeBalanceOverrideAtomic(prepared.payload.value);

      const senderBalanceAtBase = parseRpcQuantity(
        await requestLocal(localRpc, "eth_getBalance", [
          input.intent.sender,
          sourceBlockTag,
        ]),
      );
      const simulation = await withLocalForkSimulationLock(
        localIdentity.forkInstanceId,
        () =>
          simulateInSnapshot({
            rpc: localRpc,
            sender: input.intent.sender,
            recipient: inspection.binding.recipient,
            tokenAddress: inspection.binding.tokenOut,
            transaction: prepared.payload,
            sourceBlockTag,
            baseBlockNumber: localIdentity.block.number,
            baseBlockHash: localIdentity.block.hash,
            senderBalanceAtBase,
            senderNativeBalanceOverrideAtomic,
            forkInstanceId: localIdentity.forkInstanceId,
          }),
      );

      const sourceBlockAfter = await readSourceBlock(
        sourceRuntime.rpcClient,
        sourceBlockTag,
        localIdentity.block.number,
      );
      const localHeadAfter = parseRpcQuantity(
        await requestLocal(localRpc, "eth_blockNumber", []),
      ).toString();
      if (
        sourceBlockAfter.hash.toLowerCase() !==
        sourceBlockBefore.hash.toLowerCase()
      ) {
        throw new ArbitrumOneSourceMismatchError(
          postSimulationFailureRunResult(
            input,
            quote,
            observedAt,
            "SOURCE_MISMATCH",
          ),
        );
      }
      if (localHeadAfter !== localIdentity.block.number) {
        throw new ArbitrumOneForkStateChangedError(
          postSimulationFailureRunResult(
            input,
            quote,
            observedAt,
            "FORK_STATE_CHANGED",
          ),
        );
      }

      const provenance = {
        schemaVersion: 1 as const,
        status: "AVAILABLE" as const,
        source: {
          chainId: ARBITRUM_ONE_CHAIN_ID,
          blockNumber: localIdentity.block.number,
          blockHash: sourceBlockBefore.hash,
          observedAt,
        },
        localExecution: {
          chainId: 31_337 as const,
          baseBlockNumber: localIdentity.block.number,
          baseBlockHash: localIdentity.block.hash,
          observedHeadNumber: localIdentity.block.number,
          forkInstanceId: localIdentity.forkInstanceId,
          anvilVersion: localConfig.anvilVersion,
          stateRevision: simulation.stateRevision,
        },
        transaction: {
          preparedTransactionFingerprint: prepared.fingerprint,
          binding: inspection.binding,
        },
        simulation: {
          observedAt,
          call: simulation.call,
          gasEstimate: simulation.gasEstimate,
          amountReceived: simulation.amountReceived,
        },
        accountOverride: {
          address: input.intent.sender,
          nativeBalanceAtomic: senderNativeBalanceOverrideAtomic.toString(),
          snapshotRestored: true as const,
        },
        safety: {
          upstreamWritesAllowed: false as const,
          signingOrBroadcastingPerformed: false as const,
          transactionSubmissionPerformed: false as const,
          localTransactionsMined: false as const,
        },
      };
      const evidence = buildUnknownOutcomeEvidence(input, quote, observedAt);
      const simulationProvenance =
        providerNeutralSimulationProvenanceSchema.parse({
          schemaVersion: 1,
          status: "AVAILABLE",
          sourceChainId: quoteProvenance.sourceChainId,
          sourceBlockNumber: quoteProvenance.sourceBlock.number,
          sourceBlockHash: quoteProvenance.sourceBlock.hash,
          sourceObservedAt: quoteProvenance.sourceBlock.observedAt,
          executionEnvironment: "LOCAL_FORK",
          executionChainId: simulation.executionChainId,
          executionBlockContext: {
            baseBlockNumber: localIdentity.block.number,
            baseBlockHash: localIdentity.block.hash,
            observedHeadNumber: localIdentity.block.number,
          },
          forkRunId: localIdentity.forkInstanceId,
          stateRevision: providerNeutralStateRevision(simulation.stateRevision),
          accountOverridesApplied: true,
          transactionFingerprint: prepared.fingerprint,
          transactionBinding: inspection.binding,
          quote: {
            amountInAtomic: quoteProvenance.amountInAtomic,
            amountOutAtomic: quoteProvenance.amountOutAtomic,
            poolAddress: quoteProvenance.route.poolAddress,
            tokenPath: quoteProvenance.route.tokenPath,
          },
          capabilities: {
            call: simulation.call,
            gasEstimate: simulation.gasEstimate,
            amountReceived: simulation.amountReceived,
          },
          quoteReconciliation: quoteReconciliation(
            quoteProvenance.amountOutAtomic,
            simulation.amountReceived,
          ),
        } satisfies ProviderNeutralSimulationProvenance);
      const baseResult = projectGenericEvidenceToRunResult(
        input.runId,
        input.intent,
        evidence,
      );
      return runResultSchema.parse({
        ...baseResult,
        quote,
        arbitrumOneForkProvenance: provenance,
        simulationProvenance,
      });
    },
  };
}

function createLocalForkRpcClient(
  rpcUrl: string,
  injectedClient?: ArbitrumRpcClient,
  fetchImplementation?: typeof fetch,
): ArbitrumRpcClient {
  const delegate =
    injectedClient ??
    createNativeRpcClient({
      rpcUrl,
      fetchImplementation,
    });
  return {
    async request(method, params = [], operationOptions) {
      if (!LOCAL_FORK_METHODS.has(method)) {
        throw new Error("Local fork RPC method is not permitted");
      }
      return delegate.request(method, params, {
        ...operationOptions,
        timeoutMs: operationOptions?.timeoutMs ?? LOCAL_RPC_TIMEOUT_MS,
      });
    },
  };
}

async function readLocalForkIdentity(
  rpc: ArbitrumRpcClient,
  expectedForkInstanceId: string,
  expectedAnvilVersion: string,
): Promise<{
  readonly forkInstanceId: string;
  readonly block: {
    readonly number: string;
    readonly hash: string;
    readonly timestamp: string;
  };
}> {
  const [forkIdValue, versionValue, chainIdValue, accountsValue, headValue] =
    await Promise.all([
      requestLocal(rpc, "parallax_forkInstanceId", []),
      requestLocal(rpc, "web3_clientVersion", []),
      requestLocal(rpc, "eth_chainId", []),
      requestLocal(rpc, "eth_accounts", []),
      requestLocal(rpc, "eth_blockNumber", []),
    ]);
  if (
    typeof forkIdValue !== "string" ||
    forkIdValue.toLowerCase() !== expectedForkInstanceId.toLowerCase()
  ) {
    throw new Error(
      "Local fork instance identity does not match configuration",
    );
  }
  if (
    typeof versionValue !== "string" ||
    !versionValue.toLowerCase().includes(`anvil/v${expectedAnvilVersion}`)
  ) {
    throw new Error("Local Anvil version does not match configuration");
  }
  if (parseRpcQuantity(chainIdValue) !== LOCAL_FORK_CHAIN_ID) {
    throw new Error("Local fork chain identity is invalid");
  }
  if (!Array.isArray(accountsValue) || accountsValue.length !== 0) {
    throw new Error("Local fork must not expose unlocked signing accounts");
  }
  const blockNumber = parseRpcQuantity(headValue).toString();
  const blockTag = toRpcQuantity(BigInt(blockNumber));
  const block = await readLocalBlock(rpc, blockTag, blockNumber);
  return {
    forkInstanceId: expectedForkInstanceId,
    block,
  };
}

async function readLocalBlock(
  rpc: ArbitrumRpcClient,
  blockTag: string,
  expectedNumber: string,
) {
  const raw = await requestLocal(rpc, "eth_getBlockByNumber", [
    blockTag,
    false,
  ]);
  if (!isRecord(raw)) throw new Error("Local fork block is unavailable");
  const number = parseRpcQuantity(raw.number).toString();
  const hash = raw.hash;
  const timestamp = parseRpcQuantity(raw.timestamp).toString();
  if (
    number !== expectedNumber ||
    typeof hash !== "string" ||
    !BLOCK_HASH_PATTERN.test(hash)
  ) {
    throw new Error("Local fork block response is malformed");
  }
  return { number, hash, timestamp };
}

async function readSourceBlock(
  rpc: {
    request(
      method: "eth_getBlockByNumber",
      params?: readonly unknown[],
      options?: ChainOperationOptions,
    ): Promise<unknown>;
  },
  blockTag: string,
  expectedNumber: string,
) {
  const raw = await rpc.request("eth_getBlockByNumber", [blockTag, false], {
    timeoutMs: LOCAL_RPC_TIMEOUT_MS,
  });
  if (!isRecord(raw)) throw new Error("Source block is unavailable");
  const number = parseRpcQuantity(raw.number).toString();
  const hash = raw.hash;
  if (
    number !== expectedNumber ||
    typeof hash !== "string" ||
    !BLOCK_HASH_PATTERN.test(hash)
  ) {
    throw new Error("Source block response is malformed");
  }
  return { number, hash };
}

async function withLocalForkSimulationLock<Result>(
  forkInstanceId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const key = forkInstanceId.toLowerCase();
  const previous = localForkSimulationTails.get(key);
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  localForkSimulationTails.set(key, current);

  if (previous !== undefined) await previous;
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (localForkSimulationTails.get(key) === current) {
      localForkSimulationTails.delete(key);
    }
  }
}

async function simulateInSnapshot(input: {
  readonly rpc: ArbitrumRpcClient;
  readonly sender: string;
  readonly recipient: string;
  readonly tokenAddress: string;
  readonly transaction: {
    readonly from: string;
    readonly to: string;
    readonly data: string;
    readonly value: string;
    readonly chainId: string;
  };
  readonly sourceBlockTag: string;
  readonly baseBlockNumber: string;
  readonly baseBlockHash: string;
  readonly senderBalanceAtBase: bigint;
  readonly senderNativeBalanceOverrideAtomic: bigint;
  readonly forkInstanceId: string;
}): Promise<{
  readonly call:
    | {
        readonly status: "SUCCEEDED";
        readonly returnDataFingerprint: string;
      }
    | {
        readonly status: "REVERTED" | "UNAVAILABLE";
        readonly failureReason: LocalForkFailureReason;
      };
  readonly gasEstimate:
    | { readonly status: "AVAILABLE"; readonly gasUnits: string }
    | {
        readonly status: "UNAVAILABLE";
        readonly failureReason: LocalForkFailureReason;
      };
  readonly stateRevision: AnvilStateRevision;
  readonly executionChainId: number;
  readonly amountReceived:
    | StateDiffAmountReceived
    | {
        readonly status: "UNAVAILABLE";
        readonly reason: "CALL_NOT_SUCCEEDED";
      };
}> {
  if (input.sender.toLowerCase() !== input.transaction.from.toLowerCase()) {
    throw new Error(
      "Local fork sender does not match the prepared transaction",
    );
  }
  const callTransaction = createArbitrumOneExecutionCall(input.transaction);
  const revisionContext = {
    forkInstanceId: input.forkInstanceId,
    chainId: Number(LOCAL_FORK_CHAIN_ID),
    blockNumber: input.baseBlockNumber,
    blockHash: input.baseBlockHash,
  };
  const baselineStateRevision = await readAnvilStateRevision(
    input.rpc,
    revisionContext,
  );
  const snapshot = await requestLocal(input.rpc, "evm_snapshot", []);
  if (typeof snapshot !== "string" || !/^0x[0-9a-f]+$/i.test(snapshot)) {
    throw new Error("Local fork snapshot could not be created");
  }
  let snapshotCreated = true;
  let call:
    | { status: "SUCCEEDED"; returnDataFingerprint: string }
    | {
        status: "REVERTED" | "UNAVAILABLE";
        failureReason: LocalForkFailureReason;
      } = { status: "UNAVAILABLE", failureReason: "RPC_UNAVAILABLE" };
  let gasEstimate:
    | { status: "AVAILABLE"; gasUnits: string }
    | {
        status: "UNAVAILABLE";
        failureReason: LocalForkFailureReason;
      } = { status: "UNAVAILABLE", failureReason: "RPC_UNAVAILABLE" };
  let stateRevision: AnvilStateRevision = {
    status: "UNKNOWN",
    reason: "NO_QUALIFIED_ANVIL_STATE_REVISION_TOKEN",
  };
  let amountReceived:
    | StateDiffAmountReceived
    | {
        readonly status: "UNAVAILABLE";
        readonly reason: "CALL_NOT_SUCCEEDED";
      } = {
    status: "UNAVAILABLE",
    reason: "STATE_DIFF_NOT_QUALIFIED",
  };
  let cleanupError: unknown;
  try {
    const localUsdcBeforeOverride = await readRecipientUsdcBalance(
      input.rpc,
      input.sender,
    );
    if (localUsdcBeforeOverride === undefined) {
      throw new Error("Local sender USDC balance is unavailable");
    }

    await requestLocal(input.rpc, "anvil_setBalance", [
      input.sender,
      toRpcQuantity(input.senderNativeBalanceOverrideAtomic),
    ]);
    const observedNativeBalance = parseRpcQuantity(
      await requestLocal(input.rpc, "eth_getBalance", [input.sender, "latest"]),
    );
    if (observedNativeBalance !== input.senderNativeBalanceOverrideAtomic) {
      throw new Error("Local sender balance override was not observed");
    }

    const localUsdcAfterOverride = await readRecipientUsdcBalance(
      input.rpc,
      input.sender,
    );
    if (
      localUsdcAfterOverride === undefined ||
      localUsdcAfterOverride !== localUsdcBeforeOverride
    ) {
      throw new Error(
        "Native-only sender preparation changed the USDC balance",
      );
    }

    const stateRevisionBefore = await readAnvilStateRevision(
      input.rpc,
      revisionContext,
    );
    try {
      const rawCall = await requestLocal(input.rpc, "eth_call", [
        callTransaction,
        "latest",
      ]);
      if (typeof rawCall !== "string" || !DATA_PATTERN.test(rawCall)) {
        call = { status: "UNAVAILABLE", failureReason: "MALFORMED_RESPONSE" };
      } else {
        call = {
          status: "SUCCEEDED",
          returnDataFingerprint: fingerprintReturnData(rawCall),
        };
      }
    } catch (error) {
      const failureReason = classifyRpcFailure(error);
      call = {
        status:
          failureReason === "EVM_REVERT" || failureReason === "SLIPPAGE_GUARD"
            ? "REVERTED"
            : "UNAVAILABLE",
        failureReason,
      };
    }
    try {
      const rawGas = await requestLocal(input.rpc, "eth_estimateGas", [
        callTransaction,
      ]);
      gasEstimate = {
        status: "AVAILABLE",
        gasUnits: parseRpcQuantity(rawGas).toString(),
      };
    } catch (error) {
      gasEstimate = {
        status: "UNAVAILABLE",
        failureReason: classifyRpcFailure(error),
      };
    }

    const stateRevisionAfter = await readAnvilStateRevision(
      input.rpc,
      revisionContext,
    );
    const executionRevisionChanged =
      stateRevisionBefore.status === "AVAILABLE" &&
      stateRevisionAfter.status === "AVAILABLE" &&
      stateRevisionBefore.fingerprint !== stateRevisionAfter.fingerprint;
    const stableExecutionRevision =
      baselineStateRevision.status === "AVAILABLE" &&
      stateRevisionBefore.status === "AVAILABLE" &&
      stateRevisionAfter.status === "AVAILABLE" &&
      stateRevisionBefore.fingerprint === stateRevisionAfter.fingerprint;
    if (stableExecutionRevision) stateRevision = stateRevisionBefore;

    if (executionRevisionChanged) {
      stateRevision = {
        status: "UNKNOWN",
        reason: "STATE_CHANGED_DURING_SIMULATION",
      };
      call = { status: "UNAVAILABLE", failureReason: "FORK_STATE_CHANGED" };
      gasEstimate = {
        status: "UNAVAILABLE",
        failureReason: "FORK_STATE_CHANGED",
      };
    }

    if (call.status !== "SUCCEEDED") {
      amountReceived = {
        status: "UNAVAILABLE",
        reason: "CALL_NOT_SUCCEEDED",
      };
    } else if (stableExecutionRevision) {
      const balanceBeforeAtomic = await readRecipientUsdcBalance(
        input.rpc,
        input.recipient,
      );
      if (balanceBeforeAtomic !== undefined) {
        try {
          const trace = await requestLocal(input.rpc, "debug_traceCall", [
            callTransaction,
            "latest",
            { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
          ]);
          amountReceived = await qualifyArbitrumOneRecipientBalanceDelta({
            rpc: input.rpc,
            trace,
            tokenAddress: input.tokenAddress,
            recipient: input.recipient,
            balanceBeforeAtomic,
          });
        } catch {
          amountReceived = {
            status: "UNAVAILABLE",
            reason: "STATE_DIFF_NOT_QUALIFIED",
          };
        }
      }
      const stateRevisionAfterQualification = await readAnvilStateRevision(
        input.rpc,
        revisionContext,
      );
      if (
        stateRevisionAfterQualification.status !== "AVAILABLE" ||
        stateRevisionAfterQualification.fingerprint !==
          stateRevisionBefore.fingerprint
      ) {
        stateRevision = {
          status: "UNKNOWN",
          reason:
            stateRevisionAfterQualification.status === "AVAILABLE"
              ? "STATE_CHANGED_DURING_SIMULATION"
              : "NO_QUALIFIED_ANVIL_STATE_REVISION_TOKEN",
        };
        if (stateRevisionAfterQualification.status === "AVAILABLE") {
          call = { status: "UNAVAILABLE", failureReason: "FORK_STATE_CHANGED" };
          gasEstimate = {
            status: "UNAVAILABLE",
            failureReason: "FORK_STATE_CHANGED",
          };
        }
        amountReceived = {
          status: "UNAVAILABLE",
          reason: "STATE_DIFF_NOT_QUALIFIED",
        };
      }
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    if (snapshotCreated) {
      try {
        const reverted = await requestLocal(input.rpc, "evm_revert", [
          snapshot,
        ]);
        if (reverted !== true) {
          cleanupError = new Error("Local fork snapshot could not be restored");
        } else {
          snapshotCreated = false;
          const [headAfter, balanceAfter, blockAfter] = await Promise.all([
            requestLocal(input.rpc, "eth_blockNumber", []),
            requestLocal(input.rpc, "eth_getBalance", [input.sender, "latest"]),
            requestLocal(input.rpc, "eth_getBlockByNumber", [
              input.sourceBlockTag,
              false,
            ]),
          ]);
          if (
            parseRpcQuantity(headAfter).toString() !== input.baseBlockNumber ||
            parseRpcQuantity(balanceAfter) !== input.senderBalanceAtBase ||
            !isRecord(blockAfter) ||
            typeof blockAfter.hash !== "string" ||
            blockAfter.hash.toLowerCase() !== input.baseBlockHash.toLowerCase()
          ) {
            cleanupError = new Error(
              "Local fork state did not return to its snapshot",
            );
          }
          const restoredStateRevision = await readAnvilStateRevision(
            input.rpc,
            revisionContext,
          );
          if (
            baselineStateRevision.status === "AVAILABLE" &&
            (restoredStateRevision.status !== "AVAILABLE" ||
              restoredStateRevision.fingerprint !==
                baselineStateRevision.fingerprint)
          ) {
            cleanupError = new Error(
              "Local fork complete state did not return to its snapshot",
            );
          }
        }
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (snapshotCreated || cleanupError !== undefined) {
    throw new Error("Local fork snapshot restoration failed");
  }
  return {
    call,
    gasEstimate,
    stateRevision,
    executionChainId: Number(LOCAL_FORK_CHAIN_ID),
    amountReceived,
  };
}

async function readRecipientUsdcBalance(
  rpc: ArbitrumRpcClient,
  recipient: string,
): Promise<string | undefined> {
  const data = `0x70a08231${recipient.slice(2).toLowerCase().padStart(64, "0")}`;
  try {
    const raw = await requestLocal(rpc, "eth_call", [
      { to: ARBITRUM_ONE_RUNTIME_PROFILE.deployments.usdcAddress, data },
      "latest",
    ]);
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(raw)) {
      return undefined;
    }
    return BigInt(raw).toString();
  } catch {
    return undefined;
  }
}

function providerNeutralStateRevision(revision: AnvilStateRevision) {
  if (revision.status === "AVAILABLE") {
    return {
      status: "AVAILABLE" as const,
      fingerprint: revision.fingerprint,
    };
  }
  return {
    status: "UNKNOWN" as const,
    reason:
      revision.reason === "STATE_CHANGED_DURING_SIMULATION"
        ? ("STATE_CHANGED_DURING_SIMULATION" as const)
        : ("NO_QUALIFIED_STATE_REVISION_TOKEN" as const),
  };
}

function quoteReconciliation(
  quoteAmountOutAtomic: string,
  amountReceived:
    | StateDiffAmountReceived
    | {
        readonly status: "UNAVAILABLE";
        readonly reason: "CALL_NOT_SUCCEEDED";
      },
) {
  if (amountReceived.status !== "AVAILABLE") {
    return {
      status: "UNAVAILABLE" as const,
      comparisonMethod: "ATOMIC_INTEGER_EQUALITY" as const,
      quoteAmountOutAtomic,
      reason: "SIMULATED_OUTPUT_UNAVAILABLE" as const,
    };
  }
  const difference =
    BigInt(amountReceived.amountReceivedAtomic) - BigInt(quoteAmountOutAtomic);
  if (difference === 0n) {
    return {
      status: "MATCHED" as const,
      comparisonMethod: "ATOMIC_INTEGER_EQUALITY" as const,
      quoteAmountOutAtomic,
      simulatedAmountReceivedAtomic: amountReceived.amountReceivedAtomic,
      differenceAtomic: "0" as const,
    };
  }
  return {
    status: "MISMATCHED" as const,
    comparisonMethod: "ATOMIC_INTEGER_EQUALITY" as const,
    quoteAmountOutAtomic,
    simulatedAmountReceivedAtomic: amountReceived.amountReceivedAtomic,
    differenceAtomic: difference.toString(),
  };
}

function buildUnknownOutcomeEvidence(
  input: AgentFlowCheckInput,
  quote: Quote,
  observedAt: string,
): GenericEvidence {
  const minimumReceived =
    input.intent.economicBoundary.availability === "available"
      ? convertAtomicAmountToHuman(
          input.intent.economicBoundary.minimumReceivedAtomic,
          input.tokenOutDecimals,
        )
      : undefined;
  return genericEvidenceSchema.parse({
    intent: {
      chainId: input.intent.chainId,
      protocol: input.intent.protocol,
      sender: input.intent.sender,
      tokenIn:
        input.intent.tokenIn.kind === "native"
          ? "native"
          : input.intent.tokenIn.address,
      tokenOut:
        input.intent.tokenOut.kind === "native"
          ? "native"
          : input.intent.tokenOut.address,
      amountIn: convertAtomicAmountToHuman(
        input.intent.amountInAtomic,
        input.tokenInDecimals,
      ),
      ...(minimumReceived === undefined ? {} : { minimumReceived }),
      minimumReceivedSource: input.intent.economicBoundary.source,
    },
    provider: {
      providerId: "arbitrum-one-local-fork",
      status: "UNKNOWN",
      integrationStatus: "OK",
      errors: {
        value: [],
        source: "rpc",
        reproducibility: "REPRODUCIBLE",
        blockNumber: quote.blockNumber,
        fetchedAt: observedAt,
      },
    },
    execution: { status: "UNKNOWN" },
    quote: {
      value: {
        estimatedAmountOut: quote.estimatedAmountOut,
        ...(quote.minimumAmountOut === undefined
          ? {}
          : { minimumAmountOut: quote.minimumAmountOut }),
      },
      source: "quote",
      reproducibility: "REPRODUCIBLE",
      blockNumber: quote.blockNumber,
      fetchedAt: observedAt,
    },
    action: {
      value: null,
      source: "unknown",
      reproducibility: "UNKNOWN",
    },
    receipt: { value: null, source: "unknown", reproducibility: "UNKNOWN" },
    outcome: { value: null, source: "unknown", reproducibility: "UNKNOWN" },
    assetChanges: {
      value: null,
      source: "unknown",
      reproducibility: "UNKNOWN",
    },
    assetChangeAssessment: "UNKNOWN",
    warnings: {
      value: [],
      source: "derived",
      reproducibility: "REPRODUCIBLE",
      blockNumber: quote.blockNumber,
      fetchedAt: observedAt,
    },
    simulation: {
      value: null,
      source: "unknown",
      reproducibility: "UNKNOWN",
      blockNumber: quote.blockNumber,
      fetchedAt: observedAt,
    },
    blockNumber: {
      value: quote.blockNumber,
      source: "rpc",
      reproducibility: "REPRODUCIBLE",
      blockNumber: quote.blockNumber,
      fetchedAt: observedAt,
    },
    capabilities: ["quote", "local_fork_call", "local_fork_gas_estimate"],
    provenance: {
      observedChainId: ARBITRUM_ONE_CHAIN_ID,
      fetchedAt: observedAt,
      mode: "LIVE",
      source: "rpc",
      simulationBlock: quote.blockNumber,
      runtime: {
        runtimeVersion: quote.runtimeVersion,
        runtimeRevision: quote.runtimeRevision,
      },
    },
    checkedScope: ["quote", "local_fork_call", "local_fork_gas_estimate"],
    unknownScope: [
      "protocol_execution_outcome",
      "recipient_balance_delta",
      "asset_changes",
      "fork_state_revision",
    ],
    providerData: {},
  });
}

function postSimulationFailureRunResult(
  input: AgentFlowCheckInput,
  quote: Quote,
  observedAt: string,
  code: "SOURCE_MISMATCH" | "FORK_STATE_CHANGED",
): FailedRunResult {
  const baseResult = projectGenericEvidenceToRunResult(
    input.runId,
    input.intent,
    buildUnknownOutcomeEvidence(input, quote, observedAt),
  );
  return failedRunResultSchema.parse({
    ...baseResult,
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "The local-fork simulation context could not be verified",
    error: {
      code,
      stage: "simulation",
      message:
        code === "SOURCE_MISMATCH"
          ? "The quote source does not match the verified execution context"
          : "The local fork state changed during simulation",
      retryable: false,
    },
    quote,
  });
}

async function requestLocal(
  rpc: ArbitrumRpcClient,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  if (!LOCAL_FORK_METHODS.has(method)) {
    throw new Error("Local fork RPC method is not permitted");
  }
  return rpc.request(method, params, { timeoutMs: LOCAL_RPC_TIMEOUT_MS });
}

function parseRpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !RPC_QUANTITY_PATTERN.test(value)) {
    throw new Error("Fork RPC returned a malformed quantity");
  }
  return BigInt(value);
}

function toRpcQuantity(value: bigint): string {
  if (value < 0n) throw new Error("Fork RPC quantity cannot be negative");
  return `0x${value.toString(16)}`;
}

function calculateSenderNativeBalanceOverrideAtomic(
  transactionValue: string,
): bigint {
  const transactionValueAtomic = parseRpcQuantity(transactionValue);
  if (
    transactionValueAtomic >
    MAX_NATIVE_BALANCE_ATOMIC - SENDER_NATIVE_GAS_HEADROOM_ATOMIC
  ) {
    throw new Error(
      "Local fork transaction value leaves no room for native gas headroom",
    );
  }
  return transactionValueAtomic + SENDER_NATIVE_GAS_HEADROOM_ATOMIC;
}

function fingerprintReturnData(value: string): string {
  return `sha256:${createHash("sha256").update(value.toLowerCase()).digest("hex")}`;
}

function classifyRpcFailure(error: unknown): LocalForkFailureReason {
  if (error instanceof NativeRpcClientError) {
    if (error.semanticReason === "INSUFFICIENT_NATIVE_BALANCE") {
      return "INSUFFICIENT_NATIVE_BALANCE";
    }
    if (error.semanticReason === "SLIPPAGE_GUARD") return "SLIPPAGE_GUARD";
    if (error.kind === "TIMEOUT") return "RPC_TIMEOUT";
    if (
      error.kind === "NETWORK_FAILURE" ||
      error.kind === "HTTP_FAILURE" ||
      error.kind === "ABORTED"
    ) {
      return "RPC_UNAVAILABLE";
    }
    if (error.kind !== "RPC_ERROR") return "MALFORMED_RESPONSE";
  } else if (error instanceof TypeError) {
    return "MALFORMED_RESPONSE";
  }
  if (isRecord(error)) {
    const rpcCode = error.rpcCode ?? error.code;
    const message = typeof error.message === "string" ? error.message : "";
    if (/insufficient funds for gas\s*\*\s*price\s*\+\s*value/i.test(message)) {
      return "INSUFFICIENT_NATIVE_BALANCE";
    }
    if (rpcCode === 3 || /execution reverted|revert/i.test(message)) {
      return "EVM_REVERT";
    }
  }
  return "RPC_UNAVAILABLE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

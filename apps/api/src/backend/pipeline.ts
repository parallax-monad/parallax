import type {
  AgentFlowCheckInput,
  AgentFlowPort,
  QuoteAgentFlowPort,
} from "../ports.js";
import type {
  BlockContext,
  ChainAdapter,
  FinalityStatus,
  PreparedGasEstimate,
} from "./chain-adapter.js";
import { isChainAdapterError } from "./chain-adapter.js";
import type {
  BackendCompositionRuntime,
  BackendOperationResult,
} from "./composition.js";
import type {
  ProtocolAdapter,
  UnsignedTransaction,
} from "./protocol-adapter.js";
import {
  PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY,
  type ProviderAdapter,
  ProviderAdapterError,
  type ProviderAdapterErrorCode,
  type ProviderEvaluationInput,
  type ProviderEvaluationResult,
  type ProviderSupportQuery,
} from "./provider-adapter.js";
import {
  createReceiptLifecycle,
  type ReceiptLifecycleHandle,
  type ReceiptOperationResult,
} from "./receipt-ports.js";

/** The normalized adapter evidence context passed to Core and Decision. */
export type BackendPipelineContext<
  NormalizedIntent,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
> = {
  readonly runId: string;
  readonly intent: NormalizedIntent;
  readonly chain: Chain;
  readonly protocol: Protocol;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: UnsignedTransaction<unknown>;
  readonly gasEstimate: PreparedGasEstimate;
  readonly finality: FinalityStatus;
  readonly providerResult: ProviderEvaluationResult;
  /** Optional provisional evidence projection for Core/Decision consumers. */
  readonly providerEvidence?: unknown;
  /**
   * Re-enters the same Chain → Protocol → Provider path for a child Run.
   *
   * This is deliberately an internal execution seam. It prepares and evaluates
   * the candidate, but does not invoke Core/Decision again; the composition that
   * owns the P0 gate decides how the child evidence is interpreted and stored.
   */
  readonly executeProviderPath?: (input: {
    readonly runId: string;
    readonly intent: NormalizedIntent;
  }) => Promise<
    BackendPipelineProviderExecution<NormalizedIntent, Chain, Protocol>
  >;
};

export type BackendPipelineProviderExecution<
  NormalizedIntent,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
> = {
  readonly runId: string;
  readonly intent: NormalizedIntent;
  readonly chain: Chain;
  readonly protocol: Protocol;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: UnsignedTransaction<unknown>;
  readonly gasEstimate: PreparedGasEstimate;
  readonly finality: FinalityStatus;
  readonly providerResult: ProviderEvaluationResult;
  readonly providerEvidence?: unknown;
  /** Backend-local supplementary Evidence kept outside Core/Decision input. */
  readonly supplementaryEvidence?: unknown;
};

/**
 * Exact execution material prepared by Backend for Provider evaluation.
 *
 * Provider-specific input builders receive this only after Chain and Protocol
 * have produced this execution's block context, quote, unsigned transaction,
 * gas preparation result, and finality. The gas preparation result may be an
 * explicit unavailable fact when the selected Provider owns its pinned gas
 * check; it is never an invented estimate. Providers may translate this to a
 * private shape, but the pipeline does not pass an independently supplied
 * Provider payload into this boundary.
 */
export type BackendPipelinePreparedExecution<NormalizedIntent> = {
  readonly runId: string;
  readonly intent: NormalizedIntent;
  readonly chainId: number;
  readonly protocol: string;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: UnsignedTransaction<unknown>;
  readonly gasEstimate: PreparedGasEstimate;
  readonly finality: FinalityStatus;
};

export type BackendReceiptBuilderInput<
  NormalizedIntent,
  CoreOutput,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
> = {
  readonly runId: string;
  readonly intent: NormalizedIntent;
  readonly coreOutput: CoreOutput;
  readonly decisionOutput: unknown;
  readonly context: BackendPipelineContext<NormalizedIntent, Chain, Protocol>;
};

export type BackendPipelineInput<RawInput> = {
  readonly rawInput: RawInput;
  readonly runId: string;
  readonly chainId: number;
  readonly protocol: string;
  readonly capability?: string;
  /** Action-Gate verification children do not need supplementary Trace. */
  readonly executionPurpose?: AgentFlowCheckInput["executionPurpose"];
  /** Narrow, application-owned context delivered only to Decision. */
  readonly decisionContext?: unknown;
};

type ProviderExecutionOptions = {
  /** Remediation child runs re-use the primary Provider path only. */
  readonly includeSupplementaryEvidence?: boolean;
};

export type BackendPipelineExecution<
  NormalizedIntent,
  CoreOutput,
  DecisionOutput,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
  _ProviderIntent,
  _ProviderInput,
> = {
  readonly runId: string;
  readonly intent: NormalizedIntent;
  readonly chain: Chain;
  readonly protocol: Protocol;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: UnsignedTransaction<unknown>;
  readonly gasEstimate: PreparedGasEstimate;
  readonly finality: FinalityStatus;
  readonly providerResult: ProviderEvaluationResult;
  /** Optional provisional evidence projection for Backend/API composition. */
  readonly providerEvidence?: unknown;
  /** Backend-local supplementary Evidence for the public projection seam. */
  readonly supplementaryEvidence?: unknown;
  readonly coreOutput: CoreOutput;
  readonly decisionOutput: DecisionOutput;
  readonly receiptLifecycle: ReceiptLifecycleHandle;
};

export type BackendPipelineDependencies<
  RawInput,
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
  ProviderIntent,
  ProviderInput = BackendPipelinePreparedExecution<NormalizedIntent>,
> = {
  readonly runtime: BackendCompositionRuntime<
    RawInput,
    NormalizedIntent,
    CoreOutput,
    DecisionInput,
    DecisionOutput,
    Chain,
    Protocol,
    ProviderIntent
  >;
  readonly buildDecisionInput?: (input: {
    readonly coreOutput: CoreOutput;
    readonly context: BackendPipelineContext<NormalizedIntent, Chain, Protocol>;
  }) => DecisionInput;
  readonly buildProviderInput?: (
    input: BackendPipelinePreparedExecution<NormalizedIntent>,
  ) => BackendOperationResult<ProviderInput>;
  readonly buildReceipt?: (
    input: BackendReceiptBuilderInput<
      NormalizedIntent,
      CoreOutput,
      Chain,
      Protocol
    >,
  ) => ReceiptOperationResult<unknown>;
  readonly receiptTimeoutMs?: number;
};

/**
 * Executes one deterministic Backend application path through the PR-A seams.
 *
 * This is an internal orchestration boundary: raw adapter payloads never cross
 * into a public API DTO. An explicit composition mapper may produce provisional
 * provider evidence, which `createBackendCheckFlow` attaches to the existing
 * RunResult boundary without making it a Core or Decision input contract.
 */
export class BackendPipeline<
  RawInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = CoreOutput,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = NormalizedIntent,
  ProviderInput = BackendPipelinePreparedExecution<NormalizedIntent>,
> {
  /** Public projection hook used by `createBackendCheckFlow`. */
  public readonly supplementaryEvidenceProjector: BackendCompositionRuntime<
    RawInput,
    NormalizedIntent,
    CoreOutput,
    DecisionInput,
    DecisionOutput,
    Chain,
    Protocol,
    ProviderIntent
  >["supplementaryEvidenceProjector"];

  private readonly buildDecisionInput: NonNullable<
    BackendPipelineDependencies<
      RawInput,
      NormalizedIntent,
      CoreOutput,
      DecisionInput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      ProviderInput
    >["buildDecisionInput"]
  >;
  private readonly buildProviderInput: NonNullable<
    BackendPipelineDependencies<
      RawInput,
      NormalizedIntent,
      CoreOutput,
      DecisionInput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      ProviderInput
    >["buildProviderInput"]
  >;

  public constructor(
    private readonly dependencies: BackendPipelineDependencies<
      RawInput,
      NormalizedIntent,
      CoreOutput,
      DecisionInput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      ProviderInput
    >,
  ) {
    this.supplementaryEvidenceProjector =
      dependencies.runtime.supplementaryEvidenceProjector;
    this.buildDecisionInput =
      dependencies.buildDecisionInput ??
      ((input) => input.coreOutput as unknown as DecisionInput);
    this.buildProviderInput =
      dependencies.buildProviderInput ??
      ((prepared) => prepared as unknown as ProviderInput);
  }

  public async execute(
    input: BackendPipelineInput<RawInput>,
  ): Promise<
    BackendPipelineExecution<
      NormalizedIntent,
      CoreOutput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      unknown
    >
  > {
    const normalized = await this.dependencies.runtime.normalize(
      input.rawInput,
    );
    return this.executeNormalized(normalized, input);
  }

  /** Executes adapter seams after the application has normalized the request. */
  public async executeNormalized(
    normalized: NormalizedIntent,
    input: BackendPipelineInput<RawInput>,
  ): Promise<
    BackendPipelineExecution<
      NormalizedIntent,
      CoreOutput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      unknown
    >
  > {
    const prepared = await this.prepareProviderExecution(normalized, input, {
      includeSupplementaryEvidence:
        input.executionPurpose !== "verification_child",
    });

    const context: BackendPipelineContext<NormalizedIntent, Chain, Protocol> = {
      runId: input.runId,
      intent: normalized,
      chain: prepared.chain,
      protocol: prepared.protocol,
      blockContext: prepared.blockContext,
      quote: prepared.quote,
      unsignedTransaction: prepared.unsignedTransaction,
      gasEstimate: prepared.gasEstimate,
      finality: prepared.finality,
      providerResult: prepared.providerResult,
      ...(prepared.providerEvidence === undefined
        ? {}
        : { providerEvidence: prepared.providerEvidence }),
      executeProviderPath: async (candidate) =>
        this.prepareProviderExecution(
          candidate.intent,
          {
            rawInput: candidate.intent as unknown as RawInput,
            runId: candidate.runId,
            chainId: input.chainId,
            protocol: input.protocol,
            capability: input.capability,
          },
          { includeSupplementaryEvidence: false },
        ),
    };
    const coreOutput = await this.dependencies.runtime.evaluate(
      normalized,
      context,
    );
    const decisionOutput = await this.dependencies.runtime.decide(
      this.buildDecisionInput({ coreOutput, context }),
      input.decisionContext === undefined
        ? context
        : { ...context, decisionContext: input.decisionContext },
    );
    const buildReceipt = this.dependencies.buildReceipt;
    const receiptLifecycle = createReceiptLifecycle({
      buildReceipt:
        buildReceipt === undefined
          ? undefined
          : () =>
              buildReceipt({
                runId: input.runId,
                intent: normalized,
                coreOutput,
                decisionOutput,
                context,
              }),
      signer: this.dependencies.runtime.receiptSigner,
      anchorer: this.dependencies.runtime.receiptAnchorer,
      timeoutMs: this.dependencies.receiptTimeoutMs,
    });

    return {
      runId: input.runId,
      intent: normalized,
      chain: prepared.chain,
      protocol: prepared.protocol,
      blockContext: prepared.blockContext,
      quote: prepared.quote,
      unsignedTransaction: prepared.unsignedTransaction,
      gasEstimate: prepared.gasEstimate,
      finality: prepared.finality,
      providerResult: prepared.providerResult,
      ...(prepared.providerEvidence === undefined
        ? {}
        : { providerEvidence: prepared.providerEvidence }),
      ...(prepared.supplementaryEvidence === undefined
        ? {}
        : { supplementaryEvidence: prepared.supplementaryEvidence }),
      coreOutput,
      decisionOutput,
      receiptLifecycle,
    };
  }

  private async prepareProviderExecution(
    normalized: NormalizedIntent,
    input: BackendPipelineInput<RawInput>,
    options: ProviderExecutionOptions = {},
  ): Promise<
    BackendPipelineProviderExecution<NormalizedIntent, Chain, Protocol>
  > {
    const chain = this.dependencies.runtime.resolveChain(input.chainId);
    const protocol = this.dependencies.runtime.resolveProtocol(
      input.chainId,
      input.protocol,
    );
    const providerQuery: ProviderSupportQuery<ProviderIntent> = {
      intent: normalized as unknown as ProviderIntent,
      chainId: input.chainId,
      protocol: input.protocol,
      capability: input.capability,
    };
    const provider = this.dependencies.runtime.resolveProvider(
      providerQuery,
    ) as ProviderAdapter<ProviderIntent, unknown>;

    await chain.connect();
    const blockContext = await chain.getBlockContext();
    const quote = await protocol.quote(normalized as never, { blockContext });
    const unsignedTransaction = await protocol.buildTransaction(
      normalized as never,
      { blockContext, quote },
    );
    let gasEstimate: PreparedGasEstimate;
    try {
      gasEstimate = await chain.estimateGas(unsignedTransaction.payload);
    } catch (error) {
      if (
        !isChainAdapterError(error) ||
        error.chainId !== input.chainId ||
        error.operation !== "estimateGas" ||
        (error.code !== "INSUFFICIENT_NATIVE_BALANCE" &&
          error.code !== "UNAVAILABLE" &&
          error.code !== "EXECUTION_REVERT") ||
        !provider.routingCapabilities?.includes(
          PROVIDER_OWNED_GAS_ESTIMATE_CAPABILITY,
        )
      ) {
        throw error;
      }

      // Only a matching, typed balance/RPC/revert preflight failure may
      // continue to a Provider that explicitly owns the pinned gas check.
      // This absence is not itself a gas observation; the Provider must still
      // perform and report its authoritative pinned check.
      gasEstimate = {
        status: "UNAVAILABLE",
        reason: "Chain-level gas preflight was unavailable",
      };
    }
    const finality = await chain.getFinality(blockContext);
    const preparedExecution: BackendPipelinePreparedExecution<NormalizedIntent> =
      {
        runId: input.runId,
        intent: normalized,
        chainId: input.chainId,
        protocol: input.protocol,
        blockContext,
        quote,
        unsignedTransaction:
          unsignedTransaction as UnsignedTransaction<unknown>,
        gasEstimate,
        finality,
      };
    const providerInput: ProviderEvaluationInput<
      ProviderIntent,
      ProviderInput
    > = {
      runId: input.runId,
      intent: normalized as unknown as ProviderIntent,
      chainId: input.chainId,
      protocol: input.protocol,
      input: await this.buildProviderInput(preparedExecution),
    };
    const providerResult = await this.dependencies.runtime.evaluateProvider(
      provider,
      providerInput,
    );
    const providerEvidence =
      this.dependencies.runtime.providerEvidenceMapper === undefined
        ? undefined
        : await this.dependencies.runtime.providerEvidenceMapper({
            normalizedIntent: normalized,
            preparedExecution,
            providerResult,
            mode: providerResult.mode,
          });
    let supplementaryEvidence: unknown;
    if (
      options.includeSupplementaryEvidence !== false &&
      this.dependencies.runtime.supplementaryEvidenceEvaluator !== undefined
    ) {
      try {
        supplementaryEvidence =
          await this.dependencies.runtime.supplementaryEvidenceEvaluator({
            normalizedIntent: normalized,
            preparedExecution,
            providerResult,
            ...(providerEvidence === undefined ? {} : { providerEvidence }),
          });
      } catch {
        // Supplementary Evidence is non-critical after the primary Provider
        // has completed. A rejected source must not discard Native facts.
        supplementaryEvidence = undefined;
      }
    }
    if (providerResult.status !== "success" && providerEvidence === undefined) {
      throw providerResultError(providerResult);
    }

    return {
      runId: input.runId,
      intent: normalized,
      chain,
      protocol,
      blockContext,
      quote,
      unsignedTransaction: unsignedTransaction as UnsignedTransaction<unknown>,
      gasEstimate,
      finality,
      providerResult,
      ...(providerEvidence === undefined ? {} : { providerEvidence }),
      ...(supplementaryEvidence === undefined ? {} : { supplementaryEvidence }),
    };
  }
}

/** Adapts a composition pipeline to the existing Check application port. */
export function createBackendCheckFlow<
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
  ProviderIntent,
  ProviderInput = BackendPipelinePreparedExecution<NormalizedIntent>,
>(options: {
  readonly pipeline: BackendPipeline<
    AgentFlowCheckInput,
    NormalizedIntent,
    CoreOutput,
    DecisionInput,
    DecisionOutput,
    Chain,
    Protocol,
    ProviderIntent,
    ProviderInput
  >;
  readonly project: (
    execution: BackendPipelineExecution<
      NormalizedIntent,
      CoreOutput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      ProviderInput
    >,
  ) => unknown;
  readonly capability?: string;
}): AgentFlowPort {
  return {
    async check(input) {
      const execution = await options.pipeline.executeNormalized(
        input.intent as unknown as NormalizedIntent,
        {
          rawInput: input,
          runId: input.runId,
          chainId: input.intent.chainId,
          protocol: input.intent.protocol,
          capability: options.capability,
          executionPurpose: input.executionPurpose,
          ...(input.expectationBaseline === undefined
            ? {}
            : {
                decisionContext: {
                  expectationBaseline: input.expectationBaseline,
                },
              }),
        },
      );
      const projected = withProviderEvidence(
        await options.project(execution),
        execution.providerEvidence,
      );
      if (
        execution.supplementaryEvidence === undefined ||
        options.pipeline.supplementaryEvidenceProjector === undefined
      ) {
        return projected;
      }
      try {
        return await options.pipeline.supplementaryEvidenceProjector({
          projected,
          supplementaryEvidence: execution.supplementaryEvidence,
        });
      } catch {
        return projected;
      }
    },
  };
}

/** Adapts only the Chain and Protocol seams to the existing Quote port. */
export function createBackendQuoteFlow<
  NormalizedIntent,
  Chain extends ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown>,
  ProviderIntent = unknown,
>(options: {
  readonly runtime: Pick<
    BackendCompositionRuntime<
      never,
      NormalizedIntent,
      unknown,
      unknown,
      unknown,
      Chain,
      Protocol,
      ProviderIntent
    >,
    "resolveChain" | "resolveProtocol"
  >;
  readonly project: (input: {
    readonly intent: NormalizedIntent;
    readonly chain: Chain;
    readonly protocol: Protocol;
    readonly blockContext: BlockContext;
    readonly quote: unknown;
  }) => unknown;
}): QuoteAgentFlowPort {
  return {
    async quote(input) {
      const chain = options.runtime.resolveChain(input.intent.chainId);
      const protocol = options.runtime.resolveProtocol(
        input.intent.chainId,
        input.intent.protocol,
      );
      await chain.connect();
      const blockContext = await chain.getBlockContext();
      const quote = await protocol.quote(input.intent as never, {
        blockContext,
      });
      return options.project({
        intent: input.intent as unknown as NormalizedIntent,
        chain,
        protocol,
        blockContext,
        quote,
      });
    },
  };
}

export type BackendPipelineOperationResult<T> = BackendOperationResult<T>;

function providerResultError(
  result: Exclude<ProviderEvaluationResult, { status: "success" }>,
): ProviderAdapterError {
  const code: ProviderAdapterErrorCode =
    result.status === "unsupported"
      ? "UNSUPPORTED"
      : result.status === "timeout"
        ? "TIMEOUT"
        : result.status === "unknown"
          ? "UNKNOWN"
          : result.status === "stale"
            ? "STALE"
            : "FAILED";
  return new ProviderAdapterError({
    providerId: result.provider.providerId,
    code,
    message: `Provider ${result.provider.providerId} returned ${result.status}; Core evaluation is unavailable`,
    retryable: code === "TIMEOUT",
  });
}

function withProviderEvidence(
  projected: unknown,
  providerEvidence: unknown,
): unknown {
  if (
    providerEvidence === undefined ||
    typeof projected !== "object" ||
    projected === null ||
    Array.isArray(projected)
  ) {
    return projected;
  }
  const projectedRecord = projected as Record<string, unknown>;
  const publicEvidence = Object.hasOwn(projectedRecord, "providerEvidence")
    ? projectedRecord.providerEvidence
    : providerEvidence;
  if (publicEvidence === undefined) return projected;
  return {
    ...projectedRecord,
    providerEvidence: redactPublicProviderEvidence(publicEvidence),
  };
}

/**
 * Provider Evidence may be needed by the internal Core/Decision path, but the
 * public Run boundary must not expose provider-owned raw payloads. Keep the
 * provider-neutral envelope and deliberately drop its private providerData
 * field, matching the orchestrator's public Evidence projection.
 */
function redactPublicProviderEvidence(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "providerData")
  ) {
    return value;
  }
  return { ...(value as Record<string, unknown>), providerData: {} };
}

import type {
  AgentFlowCheckInput,
  AgentFlowPort,
  QuoteAgentFlowPort,
} from "../ports.js";
import type {
  BlockContext,
  ChainAdapter,
  FinalityStatus,
  GasEstimate,
} from "./chain-adapter.js";
import type {
  BackendCompositionRuntime,
  BackendOperationResult,
} from "./composition.js";
import type {
  ProtocolAdapter,
  UnsignedTransaction,
} from "./protocol-adapter.js";
import {
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
  readonly gasEstimate: GasEstimate;
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
  readonly gasEstimate: GasEstimate;
  readonly finality: FinalityStatus;
  readonly providerResult: ProviderEvaluationResult;
  readonly providerEvidence?: unknown;
};

/**
 * Exact execution material prepared by Backend for Provider evaluation.
 *
 * Provider-specific input builders receive this only after Chain and Protocol
 * have produced this execution's block context, quote, unsigned transaction,
 * gas estimate, and finality. They may translate it to a private Provider
 * shape, but the pipeline does not pass an independently supplied Provider
 * payload into this boundary.
 */
export type BackendPipelinePreparedExecution<NormalizedIntent> = {
  readonly runId: string;
  readonly intent: NormalizedIntent;
  readonly chainId: number;
  readonly protocol: string;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly unsignedTransaction: UnsignedTransaction<unknown>;
  readonly gasEstimate: GasEstimate;
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
  /** Narrow, application-owned context delivered only to Decision. */
  readonly decisionContext?: unknown;
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
  readonly gasEstimate: GasEstimate;
  readonly finality: FinalityStatus;
  readonly providerResult: ProviderEvaluationResult;
  /** Optional provisional evidence projection for Backend/API composition. */
  readonly providerEvidence?: unknown;
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
    const prepared = await this.prepareProviderExecution(normalized, input);

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
        this.prepareProviderExecution(candidate.intent, {
          rawInput: candidate.intent as unknown as RawInput,
          runId: candidate.runId,
          chainId: input.chainId,
          protocol: input.protocol,
          capability: input.capability,
        }),
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
      coreOutput,
      decisionOutput,
      receiptLifecycle,
    };
  }

  private async prepareProviderExecution(
    normalized: NormalizedIntent,
    input: BackendPipelineInput<RawInput>,
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
    const gasEstimate = await chain.estimateGas(unsignedTransaction.payload);
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
          });
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
          ...(input.expectationBaseline === undefined
            ? {}
            : {
                decisionContext: {
                  expectationBaseline: input.expectationBaseline,
                },
              }),
        },
      );
      return withProviderEvidence(
        await options.project(execution),
        execution.providerEvidence,
      );
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
  return { ...(projected as Record<string, unknown>), providerEvidence };
}

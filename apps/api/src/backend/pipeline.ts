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
};

export type BackendPipelineInput<RawInput, ProviderInput> = {
  readonly rawInput: RawInput;
  readonly runId: string;
  readonly chainId: number;
  readonly protocol: string;
  readonly capability?: string;
  readonly providerInput: ProviderInput;
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
  readonly coreOutput: CoreOutput;
  readonly decisionOutput: DecisionOutput;
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
};

/**
 * Executes one deterministic Backend application path through the PR-A seams.
 *
 * This is an internal orchestration boundary: adapter payloads and Provider
 * results remain in the pipeline context and are never projected into a public
 * API DTO here. Core and Decision own that projection through their injected
 * ports.
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
      ProviderIntent
    >["buildDecisionInput"]
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
      ProviderIntent
    >,
  ) {
    this.buildDecisionInput =
      dependencies.buildDecisionInput ??
      ((input) => input.coreOutput as unknown as DecisionInput);
  }

  public async execute(
    input: BackendPipelineInput<RawInput, unknown>,
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
    input: BackendPipelineInput<RawInput, unknown>,
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
    const quote = await protocol.quote(normalized as never);
    const unsignedTransaction = await protocol.buildTransaction(
      normalized as never,
    );
    const gasEstimate = await chain.estimateGas(unsignedTransaction.payload);
    const finality = await chain.getFinality(blockContext);
    const providerInput: ProviderEvaluationInput<ProviderIntent, unknown> = {
      runId: input.runId,
      intent: normalized as unknown as ProviderIntent,
      chainId: input.chainId,
      protocol: input.protocol,
      input: input.providerInput,
    };
    const providerResult = await this.dependencies.runtime.evaluateProvider(
      provider,
      providerInput,
    );
    if (providerResult.status !== "success") {
      throw providerResultError(providerResult);
    }

    const context: BackendPipelineContext<NormalizedIntent, Chain, Protocol> = {
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
    };
    const coreOutput = await this.dependencies.runtime.evaluate(
      normalized,
      context,
    );
    const decisionOutput = await this.dependencies.runtime.decide(
      this.buildDecisionInput({ coreOutput, context }),
      context,
    );

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
      coreOutput,
      decisionOutput,
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
  ProviderInput = unknown,
>(options: {
  readonly pipeline: BackendPipeline<
    AgentFlowCheckInput,
    NormalizedIntent,
    CoreOutput,
    DecisionInput,
    DecisionOutput,
    Chain,
    Protocol,
    ProviderIntent
  >;
  readonly project: (
    execution: BackendPipelineExecution<
      NormalizedIntent,
      CoreOutput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent,
      unknown
    >,
  ) => unknown;
  readonly capability?: string;
  readonly providerInput?: (input: AgentFlowCheckInput) => ProviderInput;
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
          providerInput: options.providerInput?.(input) ?? input,
        },
      );
      return options.project(execution);
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
      const quote = await protocol.quote(input.intent as never);
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

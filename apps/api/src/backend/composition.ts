import type { RunStore } from "../store.js";
import type { ChainAdapter } from "./chain-adapter.js";
import type { ChainRegistry } from "./chain-registry.js";
import type { ProtocolAdapter } from "./protocol-adapter.js";
import type { ProtocolRegistry } from "./protocol-registry.js";
import type {
  ProviderAdapter,
  ProviderSupportQuery,
} from "./provider-adapter.js";
import type {
  ProviderRegistry,
  ProviderSelectionOptions,
} from "./provider-registry.js";
import type { ReceiptAnchorer, ReceiptSigner } from "./receipt-ports.js";

/** A dependency may be synchronous or asynchronous without changing the port. */
export type BackendOperationResult<Value> = Value | Promise<Value>;

export type NormalizationFunction<Input = unknown, Output = unknown> = (
  input: Input,
) => BackendOperationResult<Output>;

/**
 * The untrusted-input to normalized-domain boundary used by a composition.
 * Implementations should validate and normalize before calling Core.
 */
export type NormalizationBoundary<Input = unknown, Output = unknown> =
  | { normalize(input: Input): BackendOperationResult<Output> }
  | NormalizationFunction<Input, Output>;

/** Provider-agnostic Core dependency. */
export interface CorePort<Input = unknown, Output = unknown> {
  evaluate(input: Input): BackendOperationResult<Output>;
}

/** Decision dependency kept separate from Core and from provider selection. */
export interface DecisionPort<Input = unknown, Output = unknown> {
  decide(input: Input): BackendOperationResult<Output>;
}

export type BackendCompositionDependencies<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
> = {
  readonly chainRegistry: ChainRegistry<Chain>;
  readonly protocolRegistry: ProtocolRegistry<Protocol>;
  readonly providerRegistry: ProviderRegistry<ProviderIntent>;
  readonly normalization: NormalizationBoundary<
    NormalizationInput,
    NormalizedIntent
  >;
  readonly core: CorePort<NormalizedIntent, CoreOutput>;
  readonly decision: DecisionPort<DecisionInput, DecisionOutput>;
  readonly runStore: RunStore;
  readonly receiptSigner?: ReceiptSigner;
  readonly receiptAnchorer?: ReceiptAnchorer;
};

/**
 * Dependency-injected Backend composition.
 *
 * This class is intentionally a runtime container rather than a new pipeline:
 * API routes and business behavior stay unchanged until a later integration
 * work package chooses to consume these ports. Every selected adapter and every
 * domain dependency remains replaceable through the constructor.
 */
export class BackendCompositionRuntime<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
> {
  public readonly chainRegistry: ChainRegistry<Chain>;
  public readonly protocolRegistry: ProtocolRegistry<Protocol>;
  public readonly providerRegistry: ProviderRegistry<ProviderIntent>;
  public readonly normalization: NormalizationBoundary<
    NormalizationInput,
    NormalizedIntent
  >;
  public readonly core: CorePort<NormalizedIntent, CoreOutput>;
  public readonly decision: DecisionPort<DecisionInput, DecisionOutput>;
  public readonly runStore: RunStore;
  public readonly receiptSigner: ReceiptSigner | undefined;
  public readonly receiptAnchorer: ReceiptAnchorer | undefined;

  public constructor(
    dependencies: BackendCompositionDependencies<
      NormalizationInput,
      NormalizedIntent,
      CoreOutput,
      DecisionInput,
      DecisionOutput,
      Chain,
      Protocol,
      ProviderIntent
    >,
  ) {
    assertDependency(dependencies, "composition dependencies");
    assertDependency(dependencies.chainRegistry, "chainRegistry");
    assertMethod(dependencies.chainRegistry, "resolve", "chainRegistry");
    assertDependency(dependencies.protocolRegistry, "protocolRegistry");
    assertMethod(dependencies.protocolRegistry, "resolve", "protocolRegistry");
    assertDependency(dependencies.providerRegistry, "providerRegistry");
    assertMethod(dependencies.providerRegistry, "resolve", "providerRegistry");
    assertDependency(dependencies.normalization, "normalization");
    if (typeof dependencies.normalization !== "function") {
      assertMethod(dependencies.normalization, "normalize", "normalization");
    }
    assertDependency(dependencies.core, "core");
    assertMethod(dependencies.core, "evaluate", "core");
    assertDependency(dependencies.decision, "decision");
    assertMethod(dependencies.decision, "decide", "decision");
    assertDependency(dependencies.runStore, "runStore");
    for (const method of ["start", "complete", "fail", "get"] as const) {
      assertMethod(dependencies.runStore, method, "runStore");
    }
    if (
      dependencies.receiptSigner !== undefined &&
      typeof dependencies.receiptSigner.sign !== "function"
    ) {
      throw new TypeError("receiptSigner.sign must be a function");
    }
    if (
      dependencies.receiptAnchorer !== undefined &&
      typeof dependencies.receiptAnchorer.anchor !== "function"
    ) {
      throw new TypeError("receiptAnchorer.anchor must be a function");
    }

    this.chainRegistry = dependencies.chainRegistry;
    this.protocolRegistry = dependencies.protocolRegistry;
    this.providerRegistry = dependencies.providerRegistry;
    this.normalization = dependencies.normalization;
    this.core = dependencies.core;
    this.decision = dependencies.decision;
    this.runStore = dependencies.runStore;
    this.receiptSigner = dependencies.receiptSigner;
    this.receiptAnchorer = dependencies.receiptAnchorer;
  }

  /** Normalizes an untrusted boundary value before Core receives it. */
  public normalize(
    input: NormalizationInput,
  ): BackendOperationResult<NormalizedIntent> {
    return typeof this.normalization === "function"
      ? this.normalization(input)
      : this.normalization.normalize(input);
  }

  /** Resolves the exact requested Chain adapter without fallback. */
  public resolveChain(chainId: number): Chain {
    return this.chainRegistry.resolve(chainId);
  }

  /** Resolves the exact requested Chain/Protocol adapter without fallback. */
  public resolveProtocol(chainId: number, protocol: string): Protocol {
    return this.protocolRegistry.resolve(chainId, protocol);
  }

  /**
   * Resolves a Provider through its registry. Provider evaluation is not
   * performed here; selection remains side-effect free.
   */
  public resolveProvider(
    query: ProviderSupportQuery<ProviderIntent>,
    options?: ProviderSelectionOptions,
  ): ProviderAdapter<ProviderIntent, unknown> {
    return this.providerRegistry.resolve(query, options);
  }

  /** Delegates normalized input to the injected provider-agnostic Core. */
  public evaluate(input: NormalizedIntent): BackendOperationResult<CoreOutput> {
    return this.core.evaluate(input);
  }

  /** Delegates a decision input to the injected Decision dependency. */
  public decide(input: DecisionInput): BackendOperationResult<DecisionOutput> {
    return this.decision.decide(input);
  }
}

export type BackendComposition<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
> = BackendCompositionRuntime<
  NormalizationInput,
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain,
  Protocol,
  ProviderIntent
>;

export function createBackendComposition<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
>(
  dependencies: BackendCompositionDependencies<
    NormalizationInput,
    NormalizedIntent,
    CoreOutput,
    DecisionInput,
    DecisionOutput,
    Chain,
    Protocol,
    ProviderIntent
  >,
): BackendCompositionRuntime<
  NormalizationInput,
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain,
  Protocol,
  ProviderIntent
> {
  return new BackendCompositionRuntime(dependencies);
}

/** Naming alias for callers that refer to the composition as a runtime. */
export function createBackendRuntime<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
>(
  dependencies: BackendCompositionDependencies<
    NormalizationInput,
    NormalizedIntent,
    CoreOutput,
    DecisionInput,
    DecisionOutput,
    Chain,
    Protocol,
    ProviderIntent
  >,
): BackendCompositionRuntime<
  NormalizationInput,
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain,
  Protocol,
  ProviderIntent
> {
  return createBackendComposition(dependencies);
}

export type BackendRuntimeComposition<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
> = BackendCompositionRuntime<
  NormalizationInput,
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain,
  Protocol,
  ProviderIntent
>;

export type BackendDependencies<
  NormalizationInput = unknown,
  NormalizedIntent = unknown,
  CoreOutput = unknown,
  DecisionInput = unknown,
  DecisionOutput = unknown,
  Chain extends ChainAdapter = ChainAdapter,
  Protocol extends ProtocolAdapter<never, unknown, unknown> = ProtocolAdapter<
    never,
    unknown,
    unknown
  >,
  ProviderIntent = unknown,
> = BackendCompositionDependencies<
  NormalizationInput,
  NormalizedIntent,
  CoreOutput,
  DecisionInput,
  DecisionOutput,
  Chain,
  Protocol,
  ProviderIntent
>;

function assertDependency(
  value: unknown,
  label: string,
): asserts value is object {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    throw new TypeError(`${label} must be an object or function`);
  }
}

function assertMethod(value: object, method: string, label: string): void {
  if (typeof (value as Record<string, unknown>)[method] !== "function") {
    throw new TypeError(`${label}.${method} must be a function`);
  }
}

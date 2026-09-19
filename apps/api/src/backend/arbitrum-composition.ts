import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type CheckSwapRequest,
  type GenericEvidence,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
  type QuoteRequest,
} from "@parallax/contracts";
import { projectGenericEvidenceToRunResult } from "@parallax/orchestrator/agent-flow";
import type {
  CallerConstraint,
  ConstraintEvidence,
  QuoteContext,
  Verdict,
  VerifiedCandidate,
} from "@parallax/risk";
import {
  normalizeArbitrumCheckSwapRequest,
  normalizeArbitrumQuoteRequest,
} from "../normalization.js";
import {
  type BackendBootstrapInput,
  type BackendRuntime,
  bootstrapBackendRuntime,
} from "../runtime-config.js";
import type { RunStore } from "../store.js";
import { tokenDecimals } from "../token-decimals.js";
import {
  ArbitrumChainAdapter,
  type ArbitrumRpcClient,
  type ArbitrumTransaction,
} from "./arbitrum-chain-adapter.js";
import { CamelotV3ProtocolAdapter } from "./camelot-v3-protocol-adapter.js";
import type { BlockContext, ChainAdapter } from "./chain-adapter.js";
import { ChainRegistry } from "./chain-registry.js";
import {
  type BackendCompositionRuntime,
  type BackendProviderEvidenceMapper,
  type CorePort,
  createBackendComposition,
  type DecisionPort,
  type NormalizationBoundary,
} from "./composition.js";
import {
  mapNativeRpcProviderResult,
  NATIVE_RPC_ARBITRUM_PROVIDER_ID,
  type NativeRpcPreparedExecution,
} from "./native-rpc-evidence.js";
import { createNativeRpcProviderAdapter } from "./native-rpc-provider.js";
import {
  applyBackendP0Verdict,
  type BackendCurrentQuoteResult,
  buildBackendCurrentQuoteContext,
  evaluateBackendP0Risk,
} from "./p0-risk-integration.js";
import { ProtocolRegistry } from "./protocol-registry.js";
import type { ProviderEvaluationResult } from "./provider-adapter.js";
import {
  type ProviderAdapter,
  type ProviderEnvironment,
  ProviderRegistry,
} from "./provider-registry.js";
import type { ReceiptAnchorer, ReceiptSigner } from "./receipt-ports.js";

export type ArbitrumNormalizationInput = CheckSwapRequest | QuoteRequest;

/**
 * Backend-internal P0 Risk seam for the Arbitrum composition.
 *
 * It is deliberately not part of the public Check request: the selected quote /
 * Expectation Baseline is an independent input, and the current execution quote
 * is never promoted to it. When no `selectedQuote` is supplied the P0 gate fails
 * closed to `UNKNOWN`. Only constraints explicitly declared here are evaluated;
 * the Intent Economic Boundary never becomes one.
 */
export type ArbitrumP0RiskContext = {
  readonly selectedQuote?: QuoteContext;
  readonly constraints?: readonly CallerConstraint[];
  readonly constraintEvidence?: readonly ConstraintEvidence[];
  readonly verifiedRemediation?: VerifiedCandidate;
};

export type ArbitrumProductionCompositionOptions = {
  readonly runtime: BackendRuntime;
  readonly runStore: RunStore;
  /** Optional shared RPC seam for deterministic integration tests. */
  readonly rpcClient?: ArbitrumRpcClient;
  readonly chainAdapter?: ChainAdapter<ArbitrumTransaction>;
  readonly protocolAdapter?: CamelotV3ProtocolAdapter;
  readonly providers?: readonly ProviderAdapter<
    NormalizedSwapIntent,
    unknown
  >[];
  readonly providerEvidenceMapper?: BackendProviderEvidenceMapper;
  readonly providerEnvironment?: ProviderEnvironment;
  readonly normalization?: NormalizationBoundary<
    ArbitrumNormalizationInput,
    NormalizedSwapIntent
  >;
  readonly core?: CorePort<NormalizedSwapIntent, unknown, unknown>;
  readonly decision?: DecisionPort<unknown, unknown, unknown>;
  /**
   * Optional P0 Risk seam for the default decision only. A custom `decision`
   * continues to replace the default decision entirely.
   */
  readonly p0Risk?: ArbitrumP0RiskContext;
  readonly receiptSigner?: ReceiptSigner;
  readonly receiptAnchorer?: ReceiptAnchorer;
};

export type ArbitrumProductionComposition = BackendCompositionRuntime<
  ArbitrumNormalizationInput,
  NormalizedSwapIntent,
  unknown,
  unknown,
  unknown,
  ChainAdapter<ArbitrumTransaction>,
  CamelotV3ProtocolAdapter,
  NormalizedSwapIntent,
  unknown,
  unknown
>;

export type ArbitrumBackendBootstrapOptions = Omit<
  ArbitrumProductionCompositionOptions,
  "runtime"
> &
  BackendBootstrapInput;

export type ArbitrumBackendBootstrap = {
  readonly runtime: BackendRuntime;
  readonly composition: ArbitrumProductionComposition;
};

/**
 * Builds the production composition skeleton for Arbitrum Sepolia × Camelot V3.
 *
 * The chain endpoint and provider implementations remain explicit dependencies.
 * When an Arbitrum RPC endpoint is configured, the composition wires the
 * concrete NativeRpcProvider and Camelot adapter to that endpoint. Callers may
 * still replace either through explicit adapters/providers; without an
 * endpoint, provider selection remains empty and fails closed.
 */
export function createArbitrumProductionComposition(
  options: ArbitrumProductionCompositionOptions,
): ArbitrumProductionComposition {
  if ((options.core === undefined) !== (options.decision === undefined)) {
    throw new TypeError(
      "Arbitrum core and decision must be provided together when overriding defaults",
    );
  }
  const arbitrumConfig =
    options.runtime.config.arbitrum ??
    ({
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocolId: CAMELOT_V3_PROTOCOL_ID,
      rpcUrl: undefined,
    } as const);
  const chainAdapter =
    options.chainAdapter ??
    (options.rpcClient !== undefined
      ? new ArbitrumChainAdapter({ client: options.rpcClient })
      : arbitrumConfig.rpcUrl === undefined
        ? (() => {
            throw new Error(
              "Arbitrum RPC URL is required unless a controlled chain adapter is injected",
            );
          })()
        : new ArbitrumChainAdapter({
            rpcUrl: arbitrumConfig.rpcUrl,
          }));
  const protocolAdapter =
    options.protocolAdapter ??
    new CamelotV3ProtocolAdapter({
      ...(options.rpcClient === undefined
        ? { rpcUrl: arbitrumConfig.rpcUrl }
        : { rpcClient: options.rpcClient }),
      tokenOutDecimals: 18,
      runtimeVersion: "arbitrum-camelot-v3",
      runtimeRevision: "native-rpc",
    });
  const normalization = options.normalization ?? {
    normalize: (input: ArbitrumNormalizationInput): NormalizedSwapIntent => {
      const result =
        "economicBoundary" in input
          ? normalizeArbitrumCheckSwapRequest(
              input,
              options.runtime.tokenRegistry,
            )
          : normalizeArbitrumQuoteRequest(input, options.runtime.tokenRegistry);
      if (!result.success) throw new Error(result.error.message);
      return result.intent;
    },
  };

  const providers =
    options.providers === undefined
      ? options.rpcClient !== undefined || arbitrumConfig.rpcUrl !== undefined
        ? [
            createNativeRpcProviderAdapter({
              ...(options.rpcClient === undefined
                ? { rpcUrl: arbitrumConfig.rpcUrl }
                : { client: options.rpcClient }),
              mode: "LIVE",
            }),
          ]
        : []
      : [...options.providers];
  const providerEvidenceMapper =
    options.providerEvidenceMapper ??
    ((input) => {
      if (
        input.providerResult.provider.providerId !==
        NATIVE_RPC_ARBITRUM_PROVIDER_ID
      ) {
        return undefined;
      }
      const intent = input.normalizedIntent as NormalizedSwapIntent;
      return mapNativeRpcProviderResult({
        intent,
        tokenInDecimals: tokenDecimals(
          options.runtime,
          intent.tokenIn,
          intent.chainId,
        ),
        tokenOutDecimals: tokenDecimals(
          options.runtime,
          intent.tokenOut,
          intent.chainId,
        ),
        preparedExecution:
          input.preparedExecution as NativeRpcPreparedExecution<NormalizedSwapIntent>,
        providerResult: input.providerResult,
      });
    });

  const core =
    options.core ??
    ({
      evaluate: (_input: NormalizedSwapIntent, context?: unknown) => {
        if (
          context === null ||
          typeof context !== "object" ||
          !("providerEvidence" in context)
        ) {
          return undefined;
        }
        return (context as { readonly providerEvidence?: unknown })
          .providerEvidence;
      },
    } satisfies CorePort<NormalizedSwapIntent, unknown, unknown>);
  const decision =
    options.decision ??
    ({
      decide: (input: unknown, context?: unknown) => {
        const parsedEvidence = genericEvidenceSchema.safeParse(input);
        if (!parsedEvidence.success) {
          throw new Error(
            "Arbitrum default decision requires provider-neutral Evidence",
          );
        }
        if (
          context === null ||
          typeof context !== "object" ||
          !("runId" in context) ||
          !("intent" in context) ||
          typeof context.runId !== "string"
        ) {
          throw new Error(
            "Arbitrum default decision requires a Backend pipeline context",
          );
        }
        const pipelineContext = context as {
          readonly runId: string;
          readonly intent: NormalizedSwapIntent;
        };
        const evidence = parsedEvidence.data as GenericEvidence;
        // The public RunResult projection is unchanged; only the final verdict
        // is made to obey the P0 Risk verdict, so the legacy evaluator can
        // never report PROCEED over a P0 UNKNOWN.
        return applyBackendP0Verdict(
          projectGenericEvidenceToRunResult(
            pipelineContext.runId,
            pipelineContext.intent,
            evidence,
          ),
          arbitrumP0RiskVerdictOrUnknown(options, context, evidence),
        );
      },
    } satisfies DecisionPort<unknown, unknown, unknown>);

  return createBackendComposition({
    chainRegistry: new ChainRegistry([chainAdapter]),
    protocolRegistry: new ProtocolRegistry([
      {
        chainId: arbitrumConfig.chainId,
        protocol: arbitrumConfig.protocolId,
        adapter: protocolAdapter,
      },
    ]),
    providerRegistry: new ProviderRegistry(providers, {
      environment: options.providerEnvironment ?? "production",
    }),
    normalization,
    core,
    decision,
    runStore: options.runStore,
    receiptSigner: options.receiptSigner,
    receiptAnchorer: options.receiptAnchorer,
    providerEvidenceMapper,
  }) as ArbitrumProductionComposition;
}

/** Naming alias for callers that use the shorter Backend composition term. */
export const createArbitrumBackendComposition =
  createArbitrumProductionComposition;

/**
 * The Backend pipeline context fields the default decision's P0 gate consumes.
 * The pipeline always supplies them; a direct caller with a partial context
 * degrades to the fail-closed UNKNOWN verdict instead of throwing.
 */
type ArbitrumDecisionContext = {
  readonly runId: string;
  readonly intent: NormalizedSwapIntent;
  readonly blockContext: BlockContext;
  readonly quote: unknown;
  readonly providerResult: ProviderEvaluationResult;
};

/**
 * Builds this Run's current quote context from its own pinned execution
 * material and provider-neutral Evidence. A missing trusted tokenOut decimals
 * entry cannot produce a legal atomic output, so the context is reported
 * unavailable and the gate fails closed.
 */
function arbitrumCurrentQuote(
  options: ArbitrumProductionCompositionOptions,
  pipeline: ArbitrumDecisionContext,
  evidence: GenericEvidence,
): BackendCurrentQuoteResult {
  const intent = pipeline.intent;
  try {
    return buildBackendCurrentQuoteContext({
      intent,
      evidence,
      quote: pipeline.quote,
      blockNumber: pipeline.blockContext.blockNumber,
      observedAt: pipeline.providerResult.provider.observedAt,
      tokenOutDecimals: tokenDecimals(
        options.runtime,
        intent.tokenOut,
        intent.chainId,
      ),
    });
  } catch {
    return { status: "unavailable", reason: "QUOTE_UNAVAILABLE" };
  }
}

/**
 * Evaluates the P0 Risk gate for one Arbitrum execution.
 *
 * The current quote is this Run's own pinned execution quote; the selected
 * Expectation Baseline and every caller constraint come solely from the
 * injected `p0Risk` seam. Nothing here reads a raw RPC result, endpoint,
 * header, or credential.
 */
function arbitrumP0RiskVerdict(
  options: ArbitrumProductionCompositionOptions,
  context: unknown,
  evidence: GenericEvidence,
): Verdict {
  const pipeline = context as ArbitrumDecisionContext;
  const currentQuote = arbitrumCurrentQuote(options, pipeline, evidence);
  return evaluateBackendP0Risk({
    parentRunId: pipeline.runId,
    intent: pipeline.intent,
    evidence,
    ...(currentQuote.status === "available"
      ? { currentQuote: currentQuote.quote }
      : {}),
    ...(options.p0Risk ?? {}),
  }).verdict;
}

/**
 * Fail-closed P0 gate for the public Check path: a gate that cannot be
 * evaluated degrades to UNKNOWN rather than surfacing an internal Backend error
 * as a protocol-risk result.
 */
function arbitrumP0RiskVerdictOrUnknown(
  options: ArbitrumProductionCompositionOptions,
  context: unknown,
  evidence: GenericEvidence,
): Verdict {
  try {
    return arbitrumP0RiskVerdict(options, context, evidence);
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Bootstraps only the runtime descriptor and composition wiring. It deliberately
 * does not start an HTTP server, create a provider credential, or claim live
 * Camelot/Evidence/Receipt acceptance.
 */
export function bootstrapArbitrumBackend(
  options: ArbitrumBackendBootstrapOptions,
): ArbitrumBackendBootstrap {
  const runtime = bootstrapBackendRuntime({
    environment: options.environment,
    tokenRegistry: options.tokenRegistry,
  });
  const {
    environment: _environment,
    tokenRegistry: _tokenRegistry,
    ...compositionOptions
  } = options;
  return {
    runtime,
    composition: createArbitrumProductionComposition({
      ...compositionOptions,
      runtime,
    }),
  };
}

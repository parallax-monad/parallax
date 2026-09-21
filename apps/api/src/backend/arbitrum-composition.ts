import { createHash } from "node:crypto";
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
  type CheckSwapRequest,
  convertAtomicAmountToHuman,
  convertHumanAmountToAtomic,
  type ExpectationBaseline,
  expectationBaselineSchema,
  failedRunResultSchema,
  type GenericEvidence,
  genericEvidenceSchema,
  type NormalizedSwapIntent,
  normalizedSwapIntentSchema,
  type P0RunResult,
  p0RunResultSchema,
  type QuoteRequest,
  type RunResult,
  runDiffSchema,
  runResultSchema,
} from "@parallax/contracts";
import { projectGenericEvidenceToRunResult } from "@parallax/orchestrator/agent-flow";
import { buildVerifiedAdjustBaseline } from "@parallax/orchestrator/application";
import type {
  CallerConstraint,
  CandidateEvaluation,
  ConstraintEvidence,
  QuoteContext,
  SolverResult,
  Verdict,
  VerifiedCandidate,
} from "@parallax/risk";
import {
  evaluateConstraints,
  evaluateEvidence,
  solveSelectedTargetOutput,
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
import type { CheckRunRecord, RunStore } from "../store.js";
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
  backendEvidenceState,
  buildBackendCurrentQuoteContext,
  evaluateBackendP0Risk,
} from "./p0-risk-integration.js";
import type { BackendPipelineProviderExecution } from "./pipeline.js";
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
 * The caller-selected quote reaches this seam as an independent Check context;
 * the current execution quote is never promoted to the Expectation Baseline.
 * When no valid baseline is supplied the P0 gate fails closed to `UNKNOWN`.
 * Only explicitly declared constraints are evaluated; the Intent Economic
 * Boundary never becomes one.
 */
export type ArbitrumP0RiskContext = {
  readonly constraints?: readonly CallerConstraint[];
  readonly constraintEvidence?: readonly ConstraintEvidence[];
  readonly verifiedRemediation?: VerifiedCandidate;
  /** Explicit bounded search; no production-wide maximum is invented. */
  readonly remediation?: ArbitrumP0RemediationOptions;
};

export type ArbitrumP0RemediationOptions = {
  readonly maxAmountInAtomic: string;
  readonly initialStepAtomic: string;
  readonly maxEvaluations: number;
  /** Optional candidate-specific constraint measurement from the owner. */
  readonly constraintEvidenceForCandidate?: (input: {
    readonly intent: NormalizedSwapIntent;
    readonly quote: QuoteContext;
    readonly evidence: GenericEvidence;
  }) => readonly ConstraintEvidence[] | Promise<readonly ConstraintEvidence[]>;
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
      decide: async (input: unknown, context?: unknown) => {
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
        const pipelineContext = context as ArbitrumDecisionContext;
        const evidence = parsedEvidence.data as GenericEvidence;
        const projection = await evaluateArbitrumP0Decision(
          options,
          pipelineContext,
          evidence,
        );
        const projectedRun = runResultSchema.parse({
          ...projectGenericEvidenceToRunResult(
            pipelineContext.runId,
            pipelineContext.intent,
            evidence,
          ),
          p0: projectArbitrumP0RunResult(
            pipelineContext.intent,
            projection.risk,
            projection.selectedQuote,
            projection.solver,
          ),
        });
        const projected = applyBackendP0Verdict(
          projectedRun,
          projection.risk.verdict,
        );
        return projectVerifiedArbitrumRemediation(
          projected,
          projection.solver,
          options.runStore,
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
  readonly decisionContext?: {
    readonly expectationBaseline?: ExpectationBaseline;
  };
  readonly executeProviderPath?: (input: {
    readonly runId: string;
    readonly intent: NormalizedSwapIntent;
  }) => Promise<
    BackendPipelineProviderExecution<
      NormalizedSwapIntent,
      ChainAdapter<ArbitrumTransaction>,
      CamelotV3ProtocolAdapter
    >
  >;
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
 * Converts the caller-selected quote into the Risk-owned baseline context.
 * Identity and provenance are derived only from the provider-neutral quote
 * contract and exact trusted token decimals; malformed or unconvertible input
 * is omitted so the P0 gate remains UNKNOWN.
 */
function arbitrumSelectedQuote(
  options: ArbitrumProductionCompositionOptions,
  pipeline: ArbitrumDecisionContext,
): QuoteContext | undefined {
  const parsed = expectationBaselineSchema.safeParse(
    pipeline.decisionContext?.expectationBaseline,
  );
  if (!parsed.success) return undefined;

  const baseline = parsed.data;
  const quote = baseline.quote;
  if (quote.fetchedAt === undefined) return undefined;

  try {
    const amountIn = convertHumanAmountToAtomic(
      baseline.amountIn,
      tokenDecimals(options.runtime, baseline.tokenIn, baseline.chainId),
    );
    const amountOut = convertHumanAmountToAtomic(
      quote.estimatedAmountOut,
      tokenDecimals(options.runtime, baseline.tokenOut, baseline.chainId),
    );
    if (!amountIn.success || !amountOut.success) return undefined;

    const identity = {
      chainId: baseline.chainId,
      protocol: baseline.protocol,
      tokenIn: assetKey(baseline.tokenIn),
      tokenOut: assetKey(baseline.tokenOut),
      amountInAtomic: amountIn.amountAtomic,
      amountOutAtomic: amountOut.amountAtomic,
      blockNumber: quote.blockNumber,
      observedAt: quote.fetchedAt,
      runtimeVersion: quote.runtimeVersion,
      runtimeRevision: quote.runtimeRevision,
    };
    return {
      chainId: identity.chainId,
      protocol: identity.protocol,
      tokenIn: identity.tokenIn,
      tokenOut: identity.tokenOut,
      amountInAtomic: identity.amountInAtomic,
      amountOutAtomic: identity.amountOutAtomic,
      quoteId: fingerprint([
        identity.chainId,
        identity.protocol,
        identity.tokenIn,
        identity.tokenOut,
        identity.amountInAtomic,
        identity.amountOutAtomic,
        identity.blockNumber,
        identity.observedAt,
        identity.runtimeVersion,
        identity.runtimeRevision,
      ]),
      runtimeVersion: identity.runtimeVersion,
      runtimeRevision: identity.runtimeRevision,
      provenance: `source=quote;runtime=${identity.runtimeVersion}@${identity.runtimeRevision}`,
      blockNumber: identity.blockNumber,
      observedAt: identity.observedAt,
    };
  } catch {
    return undefined;
  }
}

function projectArbitrumP0RunResult(
  intent: NormalizedSwapIntent,
  risk: ReturnType<typeof evaluateBackendP0Risk>,
  selectedQuote: QuoteContext | undefined,
  solver: SolverResult | undefined,
): P0RunResult {
  const boundary = intent.economicBoundary;
  const transactionProtection = {
    status: risk.base.economicBoundary,
    ...(boundary.availability === "available"
      ? {
          minimumReceivedAtomic: boundary.minimumReceivedAtomic,
          source: boundary.source,
        }
      : { source: boundary.source }),
  };
  const expectationBaseline =
    selectedQuote === undefined
      ? { status: "MISSING" as const }
      : {
          status: "AVAILABLE" as const,
          chainId: selectedQuote.chainId,
          protocol: selectedQuote.protocol,
          tokenIn: selectedQuote.tokenIn,
          tokenOut: selectedQuote.tokenOut,
          amountInAtomic: selectedQuote.amountInAtomic,
          amountOutAtomic: selectedQuote.amountOutAtomic,
          quoteId: selectedQuote.quoteId,
          blockNumber: selectedQuote.blockNumber,
          observedAt: selectedQuote.observedAt,
          provenance: selectedQuote.provenance,
        };

  return p0RunResultSchema.parse({
    expectationBaseline,
    quoteFidelity: risk.quoteFidelity,
    cause: { status: "NOT_VERIFIED" },
    constraints: risk.constraints,
    evidenceState: risk.evidenceState,
    transactionProtection,
    remediation: projectRemediation(solver),
  });
}

function projectRemediation(
  solver: SolverResult | undefined,
): P0RunResult["remediation"] {
  if (solver === undefined) return { status: "NOT_RUN" };
  if (solver.status === "PROPOSED") {
    return { status: "UNVERIFIED", evaluations: solver.evaluations };
  }
  if (solver.status === "NO_VALID_CANDIDATE") {
    return {
      status: "NO_VALID_CANDIDATE",
      evaluations: solver.evaluations,
    };
  }
  if (solver.status === "UNKNOWN") {
    return {
      status: "UNKNOWN",
      reason: solver.reason,
      evaluations: solver.evaluations,
    };
  }

  const candidate = solver.candidate;
  const verification = candidate.verification;
  return {
    status: "VERIFIED",
    parentRunId: verification.parentRunId,
    childRunId: verification.childRunId,
    amountInAtomic: candidate.amountInAtomic,
    amountOutAtomic: candidate.amountOutAtomic,
    quoteId: candidate.quoteId,
    verificationBlock: verification.verificationBlock,
    verificationTime: verification.verificationTime,
    provenance: verification.provenance,
    checkedScope: [...verification.checkedScope],
  };
}

type ArbitrumProviderExecution = BackendPipelineProviderExecution<
  NormalizedSwapIntent,
  ChainAdapter<ArbitrumTransaction>,
  CamelotV3ProtocolAdapter
>;

type ArbitrumP0Decision = {
  readonly risk: ReturnType<typeof evaluateBackendP0Risk>;
  readonly selectedQuote?: QuoteContext;
  readonly solver?: SolverResult;
};

/**
 * Runs the P0 gate and, when explicitly configured, a bounded remediation
 * search. Candidate executions reuse the pipeline's exact provider path and
 * are persisted as terminal child Runs before their proof is accepted.
 */
async function evaluateArbitrumP0Decision(
  options: ArbitrumProductionCompositionOptions,
  pipeline: ArbitrumDecisionContext,
  evidence: GenericEvidence,
): Promise<ArbitrumP0Decision> {
  const currentQuote = arbitrumCurrentQuote(options, pipeline, evidence);
  const selectedQuote = arbitrumSelectedQuote(options, pipeline);
  const baseInput = {
    parentRunId: pipeline.runId,
    intent: pipeline.intent,
    evidence,
    ...(currentQuote.status === "available"
      ? { currentQuote: currentQuote.quote }
      : {}),
    ...(options.p0Risk ?? {}),
    ...(selectedQuote === undefined ? {} : { selectedQuote }),
  };
  const risk = evaluateBackendP0Risk(baseInput);
  const remediation = options.p0Risk?.remediation;
  if (
    remediation === undefined ||
    selectedQuote === undefined ||
    pipeline.executeProviderPath === undefined ||
    backendEvidenceState(evidence) !== "VERIFIED" ||
    (risk.verdict !== "STOP" && risk.verdict !== "ADJUST")
  ) {
    return {
      risk,
      ...(selectedQuote === undefined ? {} : { selectedQuote }),
    };
  }

  let solver: SolverResult;
  try {
    solver = await solveSelectedTargetOutput({
      parentRunId: pipeline.runId,
      selected: selectedQuote,
      startingAmountInAtomic: pipeline.intent.amountInAtomic,
      maxAmountInAtomic: remediation.maxAmountInAtomic,
      initialStepAtomic: remediation.initialStepAtomic,
      maxEvaluations: remediation.maxEvaluations,
      evaluate: async (amountInAtomic) =>
        evaluateArbitrumCandidate(
          options,
          pipeline,
          amountInAtomic,
          risk.verdict,
        ),
    });
  } catch {
    return {
      risk,
      selectedQuote,
      solver: {
        status: "UNKNOWN",
        reason: "EVALUATOR_FAILURE",
        evaluations: 0,
      },
    };
  }

  if (solver.status !== "VERIFIED") return { risk, selectedQuote, solver };
  return {
    risk: evaluateBackendP0Risk({
      ...baseInput,
      verifiedRemediation: solver.candidate,
    }),
    selectedQuote,
    solver,
  };
}

/**
 * Projects a verified candidate through the existing RunResult Action Gate
 * boundary. Provider Evidence remains provider-owned; P0 remediation is
 * represented by the canonical RunResult Evidence/Action fields instead of
 * being nested under GenericEvidence.providerData.
 */
async function projectVerifiedArbitrumRemediation(
  projected: RunResult,
  solver: SolverResult | undefined,
  runStore: RunStore,
): Promise<RunResult> {
  if (
    projected.status !== "completed" ||
    projected.verdict !== "STOP" ||
    solver?.status !== "VERIFIED"
  ) {
    return projected;
  }

  let childRecord: CheckRunRecord | undefined;
  try {
    childRecord = await runStore.get(solver.candidate.verification.childRunId);
  } catch {
    return projected;
  }

  if (
    childRecord?.status !== "completed" ||
    childRecord.result.status !== "completed"
  ) {
    return projected;
  }

  try {
    return buildVerifiedAdjustBaseline(projected, childRecord.result, {
      before: projected.intent.amountInAtomic,
      after: solver.candidate.amountInAtomic,
    });
  } catch {
    return projected;
  }
}

async function evaluateArbitrumCandidate(
  options: ArbitrumProductionCompositionOptions,
  parent: ArbitrumDecisionContext,
  amountInAtomic: string,
  parentVerdict: Verdict,
): Promise<CandidateEvaluation> {
  const executeProviderPath = parent.executeProviderPath;
  if (executeProviderPath === undefined) {
    return { status: "UNKNOWN", evidenceState: "UNAVAILABLE" };
  }
  const intent = normalizedSwapIntentSchema.parse({
    ...parent.intent,
    amountInAtomic,
  });
  const childRunId = childRunIdFor(parent.runId, amountInAtomic);
  let execution: ArbitrumProviderExecution;
  try {
    execution = await executeProviderPath({ runId: childRunId, intent });
  } catch {
    return { status: "QUOTE_FAILED", evidenceState: "UNAVAILABLE" };
  }
  const parsedEvidence = genericEvidenceSchema.safeParse(
    execution.providerEvidence,
  );
  if (!parsedEvidence.success) {
    return { status: "UNKNOWN", evidenceState: "UNAVAILABLE" };
  }
  const childEvidence = parsedEvidence.data;
  if (
    !providerEvidenceMatchesCandidateIntent(
      childEvidence,
      intent,
      options.runtime,
    )
  ) {
    return { status: "UNKNOWN", evidenceState: "UNAVAILABLE" };
  }
  const childPipeline: ArbitrumDecisionContext = {
    runId: childRunId,
    intent,
    blockContext: execution.blockContext,
    quote: execution.quote,
    providerResult: execution.providerResult,
  };
  const childQuote = arbitrumCurrentQuote(
    options,
    childPipeline,
    childEvidence,
  );
  const evidenceState = backendEvidenceState(childEvidence);
  if (childQuote.status !== "available") {
    await persistChildRun(
      options,
      parent,
      intent,
      childRunId,
      childEvidence,
      parentVerdict,
      "UNKNOWN",
    );
    return { status: "UNKNOWN", evidenceState };
  }

  const candidateConstraintEvidence =
    options.p0Risk?.remediation?.constraintEvidenceForCandidate === undefined
      ? undefined
      : await options.p0Risk.remediation.constraintEvidenceForCandidate({
          intent,
          quote: childQuote.quote,
          evidence: childEvidence,
        });
  // The solver, not child Quote Fidelity, compares this candidate with the
  // original exact-input selected baseline. Reusing that baseline here would
  // make every legitimate amountIn change INCOMPATIBLE. The child instead
  // re-runs the provider-neutral base Risk plus explicit caller constraints.
  const childBaseRisk = evaluateEvidence(childEvidence);
  const childConstraints = evaluateConstraints(
    options.p0Risk?.constraints ?? [],
    candidateConstraintEvidence ?? [],
  );
  const childRisk = {
    verdict: childVerificationVerdict(
      childBaseRisk.verdict,
      evidenceState,
      childConstraints,
    ),
    constraints: childConstraints,
  };
  const persisted = await persistChildRun(
    options,
    parent,
    intent,
    childRunId,
    childEvidence,
    parentVerdict,
    childRisk.verdict,
  );
  if (evidenceState !== "VERIFIED") {
    return { status: "UNKNOWN", evidenceState };
  }

  const childResult = projectGenericEvidenceToRunResult(
    childRunId,
    intent,
    childEvidence,
  );
  const verification = persisted
    ? candidateVerification(
        parent,
        intent,
        execution,
        childEvidence,
        childQuote.quote,
        childRisk,
        childResult,
      )
    : undefined;
  return {
    status: "QUOTED",
    evidenceState,
    quote: childQuote.quote,
    ...(verification === undefined ? {} : { verification }),
  };
}

async function persistChildRun(
  options: ArbitrumProductionCompositionOptions,
  parent: ArbitrumDecisionContext,
  intent: NormalizedSwapIntent,
  childRunId: string,
  evidence: GenericEvidence,
  parentVerdict: Verdict,
  verdict: Verdict,
): Promise<boolean> {
  let started = false;
  let diff: ReturnType<typeof runDiffSchema.parse> | undefined;
  try {
    diff = runDiffSchema.parse({
      previousRunId: parent.runId,
      previousVerdict: parentVerdict,
      changedFields: [
        {
          field: "amountInAtomic",
          before: parent.intent.amountInAtomic,
          after: intent.amountInAtomic,
        },
      ],
    });
    const child = applyBackendP0Verdict(
      projectGenericEvidenceToRunResult(childRunId, intent, evidence),
      verdict,
    );
    const persisted = runResultSchema.parse({
      ...child,
      parentRunId: parent.runId,
      diff,
    });
    await options.runStore.start(childRunId, intent, parent.runId);
    started = true;
    await options.runStore.complete(persisted);
    return true;
  } catch {
    if (started && diff !== undefined) {
      try {
        await options.runStore.fail(
          childRunId,
          "INVALID_AGENT_FLOW_RESPONSE",
          failedRunResultSchema.parse({
            runId: childRunId,
            parentRunId: parent.runId,
            intent,
            replayMode: false,
            status: "integration_error",
            systemStatus: "INTEGRATION_ERROR",
            verdict: "UNKNOWN",
            summary: "The P0 verification child could not be finalized",
            error: {
              code: "INVALID_RESPONSE",
              stage: "unknown",
              message: "The P0 verification child could not be finalized",
              retryable: false,
            },
            diff,
            ruleResults: [],
            recommendedActions: [],
            irrelevantActions: [],
            evidence: [],
            scope: [
              {
                key: "P0-CHECK-SIMULATION-001",
                label: "P0 verification child",
                status: "unknown",
                reason: "REQUIRED_CHECK_INTERRUPTED",
              },
            ],
          }),
        );
      } catch {
        // A store that cannot terminalize the child cannot produce a proof.
      }
    }
    return false;
  }
}

function candidateVerification(
  parent: ArbitrumDecisionContext,
  intent: NormalizedSwapIntent,
  execution: ArbitrumProviderExecution,
  evidence: GenericEvidence,
  quote: QuoteContext,
  childRisk: ChildVerificationRisk,
  childResult: RunResult,
): VerifiedCandidate["verification"] | undefined {
  if (
    childResult.status !== "completed" ||
    childRisk.verdict !== "PROCEED" ||
    evidence.provider.status !== "SUCCESS" ||
    backendEvidenceState(evidence) !== "VERIFIED"
  ) {
    return undefined;
  }
  const transactionProtectionOutcome = candidateTransactionProtectionOutcome(
    intent,
    childResult,
    execution.runId,
    quote.quoteId,
  );
  if (
    intent.economicBoundary.availability === "available" &&
    transactionProtectionOutcome?.status !== "PASS"
  ) {
    return undefined;
  }
  return {
    preparedUnsignedTxFingerprint: fingerprint(execution.unsignedTransaction),
    preparedAmountInAtomic: intent.amountInAtomic,
    providerStatus: evidence.provider.status,
    riskVerdict: childRisk.verdict,
    parentRunId: parent.runId,
    childRunId: execution.runId,
    childStatus: "completed",
    childAmountInAtomic: intent.amountInAtomic,
    childAmountOutAtomic: quote.amountOutAtomic,
    childQuoteId: quote.quoteId,
    verificationBlock: quote.blockNumber,
    verificationTime: quote.observedAt,
    provenance: quote.provenance,
    checkedScope: evidence.checkedScope,
    constraintOutcomes: childRisk.constraints.map((item) => ({
      declarationId: item.declarationId,
      name: item.name,
      status: item.status,
      childRunId: execution.runId,
      candidateQuoteId: quote.quoteId,
    })),
    ...(transactionProtectionOutcome === undefined
      ? {}
      : { transactionProtectionOutcome }),
    isReplay: false,
    isMock: false,
    actionGateVerified: true,
  };
}

function candidateTransactionProtectionOutcome(
  intent: NormalizedSwapIntent,
  childResult: RunResult,
  childRunId: string,
  candidateQuoteId: string,
): VerifiedCandidate["verification"]["transactionProtectionOutcome"] {
  if (intent.economicBoundary.availability !== "available") {
    return undefined;
  }

  const economic = childResult.ruleResults.find(
    (rule) => rule.ruleId === "P0-ECONOMIC-001",
  );
  const status =
    economic?.status === "PASS"
      ? "PASS"
      : economic?.status === "FAIL"
        ? "FAIL"
        : "UNKNOWN";
  return { status, childRunId, candidateQuoteId };
}

function providerEvidenceMatchesCandidateIntent(
  evidence: GenericEvidence,
  intent: NormalizedSwapIntent,
  runtime: BackendRuntime,
): boolean {
  try {
    const tokenInDecimals = tokenDecimals(
      runtime,
      intent.tokenIn,
      intent.chainId,
    );
    const tokenOutDecimals = tokenDecimals(
      runtime,
      intent.tokenOut,
      intent.chainId,
    );
    const boundary = intent.economicBoundary;
    const expectedMinimumReceived =
      boundary.availability === "available"
        ? convertAtomicAmountToHuman(
            boundary.minimumReceivedAtomic,
            tokenOutDecimals,
          )
        : undefined;

    return (
      evidence.intent.chainId === intent.chainId &&
      evidence.intent.protocol === intent.protocol &&
      evidence.intent.sender.toLowerCase() === intent.sender.toLowerCase() &&
      evidence.intent.tokenIn.toLowerCase() === assetKey(intent.tokenIn) &&
      evidence.intent.tokenOut.toLowerCase() === assetKey(intent.tokenOut) &&
      evidence.intent.amountIn ===
        convertAtomicAmountToHuman(intent.amountInAtomic, tokenInDecimals) &&
      evidence.intent.minimumReceivedSource === boundary.source &&
      evidence.intent.minimumReceived === expectedMinimumReceived
    );
  } catch {
    return false;
  }
}

function assetKey(asset: NormalizedSwapIntent["tokenIn"]): string {
  return asset.kind === "native" ? "native" : asset.address.toLowerCase();
}

type ChildVerificationRisk = {
  readonly verdict: Verdict;
  readonly constraints: ReturnType<typeof evaluateConstraints>;
};

function childVerificationVerdict(
  baseVerdict: Verdict,
  evidenceState: ReturnType<typeof backendEvidenceState>,
  constraints: ReturnType<typeof evaluateConstraints>,
): Verdict {
  if (
    evidenceState !== "VERIFIED" ||
    constraints.some((item) => item.status === "UNKNOWN")
  ) {
    return "UNKNOWN";
  }
  if (
    baseVerdict !== "PROCEED" ||
    constraints.some((item) => item.status === "FAIL")
  ) {
    return "STOP";
  }
  return "PROCEED";
}

function childRunIdFor(parentRunId: string, amountInAtomic: string): string {
  const suffix = createHash("sha256")
    .update(`${parentRunId}:p0-child:${amountInAtomic}`)
    .digest("hex")
    .slice(0, 24);
  return `${parentRunId}:p0-child:${suffix}`;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
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

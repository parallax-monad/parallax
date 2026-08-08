import { createHash } from "node:crypto";
import {
  type AssetReference,
  convertAtomicAmountToHuman,
  type EvidenceItem,
  type EvidenceRef,
  evidenceItemSchema,
  type FailedRunResult,
  failedRunResultSchema,
  type NormalizedSwapIntent,
  type P0ReasonCode,
  type RuleResult,
  type RunResult,
  runResultSchema,
  type ScopeDisclosure,
} from "@parallax/contracts";
import {
  classifyLiveError,
  type NormalizedKuruEvidence,
  type NormalizedKuruSwapIntent,
  type NormalizedMossError,
  runKuruLiveSwap,
  type Sourced,
} from "@parallax/moss-bridge";
import { evaluateKuruEvidence } from "@parallax/risk";

export type LiveAgentFlowRuntime = {
  rpcUrl: string;
  runtimePath?: string;
  runtimeVersion: string;
  runtimeRevision: string;
};

export type LiveAgentFlowInput = {
  runId: string;
  intent: NormalizedSwapIntent;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  moss: LiveAgentFlowRuntime;
};

export type KuruLiveRunner = typeof runKuruLiveSwap;

/** Error shape consumed by the API's Integration Error mapper. */
export class LiveAgentFlowError extends Error {
  public readonly code:
    | "MOSS_UNAVAILABLE"
    | "RPC_UNAVAILABLE"
    | "TIMEOUT"
    | "INTERNAL_ERROR";
  public readonly integrationStatus: string;
  public readonly source: string;
  public readonly stage?: string;
  public readonly partialRunResult?: FailedRunResult;

  public constructor(input: {
    code: "MOSS_UNAVAILABLE" | "RPC_UNAVAILABLE" | "TIMEOUT" | "INTERNAL_ERROR";
    message: string;
    integrationStatus: string;
    source: string;
    stage?: string;
    cause?: unknown;
    partialRunResult?: FailedRunResult;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "LiveAgentFlowError";
    this.code = input.code;
    this.integrationStatus = input.integrationStatus;
    this.source = input.source;
    this.stage = input.stage;
    this.partialRunResult = input.partialRunResult;
  }
}

export class UnsupportedKuruAgentFlowError extends Error {
  public readonly code = "UNSUPPORTED" as const;

  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedKuruAgentFlowError";
  }
}

/**
 * Workstream D's real Agent Flow boundary.
 *
 * Moss stays behind the bridge and Risk stays behind its deterministic API.
 * This class only adapts the normalized API Intent into the live Kuru call and
 * projects the resulting Evidence + Risk result into the shared Run contract.
 */
export class KuruLiveAgentFlow {
  public constructor(
    private readonly runner: KuruLiveRunner = runKuruLiveSwap,
  ) {}

  public async check(input: LiveAgentFlowInput): Promise<RunResult> {
    if (input.moss.runtimePath === undefined) {
      throw new LiveAgentFlowError({
        code: "MOSS_UNAVAILABLE",
        message: "The configured Moss runtime path is missing",
        integrationStatus: "UNAVAILABLE",
        source: "moss",
      });
    }

    if (input.intent.protocol !== "kuru" || input.intent.chainId !== 143) {
      throw unsupportedIntentError();
    }

    let live: Awaited<ReturnType<KuruLiveRunner>>;
    try {
      live = await this.runner({
        runId: input.runId,
        intent: toMossIntent(
          input.intent,
          input.tokenInDecimals,
          input.tokenOutDecimals,
        ),
        rpcUrl: input.moss.rpcUrl,
        runtimePath: input.moss.runtimePath,
        runtimeVersion: input.moss.runtimeVersion,
        runtimeRevision: input.moss.runtimeRevision,
      });
    } catch (error) {
      throw toLiveAgentFlowError(error);
    }

    assertLiveProvenance(
      live.evidence,
      live.runtime,
      live.observedChainId,
      live.simulatorPinnedBlock,
      input.moss,
    );

    const evidence = withSimulatorPinnedBlock(
      live.evidence,
      live.simulatorPinnedBlock,
    );

    if (live.observedChainId === undefined) {
      throw new LiveAgentFlowError({
        code: "RPC_UNAVAILABLE",
        message: "The configured RPC did not return a chain ID",
        integrationStatus: "UNAVAILABLE",
        source: "rpc",
        stage: "DISCOVER",
      });
    }

    const integrationError = firstIntegrationError(evidence);
    if (integrationError !== undefined) {
      const flowError = toLiveAgentFlowError(integrationError, {
        stage: integrationError.stage,
        source: integrationError.source,
      });
      throw new LiveAgentFlowError({
        code: flowError.code,
        message: flowError.message,
        integrationStatus: flowError.integrationStatus,
        source: flowError.source,
        stage: flowError.stage,
        cause: flowError,
        partialRunResult: buildIntegrationErrorResult(
          input.runId,
          input.intent,
          evidence,
          flowError,
        ),
      });
    }
    if (evidence.integrationStatus !== "OK") {
      const flowError = toLiveAgentFlowError(
        {
          code: evidence.integrationStatus,
          message:
            "Live Evidence reported an integration failure without details",
          integrationStatus: evidence.integrationStatus,
          source: "moss",
        },
        { stage: lastFailedStage(live) },
      );
      throw new LiveAgentFlowError({
        code: flowError.code,
        message: flowError.message,
        integrationStatus: flowError.integrationStatus,
        source: flowError.source,
        stage: flowError.stage,
        cause: flowError,
        partialRunResult: buildIntegrationErrorResult(
          input.runId,
          input.intent,
          evidence,
          flowError,
        ),
      });
    }

    const risk = evaluateKuruEvidence(evidence);
    return buildRunResult(input.runId, input.intent, evidence, risk);
  }
}

function toMossIntent(
  intent: NormalizedSwapIntent,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): NormalizedKuruSwapIntent {
  const boundary = intent.economicBoundary;
  return {
    chainId: String(intent.chainId),
    sender: intent.sender,
    tokenIn: toMossAsset(intent.tokenIn),
    tokenOut: toMossAsset(intent.tokenOut),
    amountIn: convertAtomicAmountToHuman(
      intent.amountInAtomic,
      tokenInDecimals,
    ),
    ...(boundary.availability === "available"
      ? {
          minimumReceived: convertAtomicAmountToHuman(
            boundary.minimumReceivedAtomic,
            tokenOutDecimals,
          ),
          minimumReceivedSource: boundary.source,
        }
      : { minimumReceivedSource: "unavailable" }),
  };
}

function toMossAsset(asset: AssetReference): string {
  return asset.kind === "native" ? "native" : asset.address;
}

function assertLiveProvenance(
  evidence: NormalizedKuruEvidence,
  runtimeIdentity: {
    runtimeVersion: string;
    runtimeRevision: string;
    checkoutRevision?: string;
    packageVersions: Record<string, string>;
  },
  observedChainId: number | undefined,
  simulatorPinnedBlock: string | undefined,
  runtime: LiveAgentFlowRuntime,
): void {
  const requiredPackages = [
    "@themoss/core",
    "@themoss/erc",
    "@themoss/protocol-kuru",
    "@themoss/simulator",
    "@themoss/system",
  ];
  if (
    !/^[0-9a-f]{40}$/i.test(runtime.runtimeRevision) ||
    (observedChainId !== undefined && observedChainId !== 143) ||
    !/^\d+$/.test(simulatorPinnedBlock ?? "") ||
    runtimeIdentity.runtimeVersion !== runtime.runtimeVersion ||
    runtimeIdentity.runtimeRevision !== runtime.runtimeRevision ||
    runtimeIdentity.checkoutRevision !== runtime.runtimeRevision ||
    requiredPackages.some(
      (name) =>
        runtimeIdentity.packageVersions[name] !== runtime.runtimeVersion,
    ) ||
    evidence.replayMode !== false ||
    evidence.isReplay !== false ||
    evidence.isMock !== false ||
    evidence.runtimeVersion !== runtime.runtimeVersion ||
    evidence.runtimeRevision !== runtime.runtimeRevision ||
    (evidence.simulatorPinnedBlock !== undefined &&
      evidence.simulatorPinnedBlock !== simulatorPinnedBlock)
  ) {
    throw new LiveAgentFlowError({
      code: "INTERNAL_ERROR",
      message: "Live Agent Flow returned mismatched runtime provenance",
      integrationStatus: "INTEGRATION_ERROR",
      source: "moss",
    });
  }
}

function withSimulatorPinnedBlock(
  evidence: NormalizedKuruEvidence,
  simulatorPinnedBlock: string | undefined,
): NormalizedKuruEvidence {
  if (evidence.simulatorPinnedBlock === simulatorPinnedBlock) return evidence;
  return { ...evidence, simulatorPinnedBlock };
}

function firstIntegrationError(
  evidence: NormalizedKuruEvidence,
): NormalizedMossError | undefined {
  if (evidence.integrationStatus !== "OK") {
    return evidence.errors.value?.find(
      (error) => error.integrationStatus !== "OK",
    );
  }

  return undefined;
}

function lastFailedStage(
  live: Awaited<ReturnType<KuruLiveRunner>>,
): NormalizedMossError["stage"] {
  return [...live.stages].reverse().find((stage) => !stage.success)?.stage;
}

function toLiveAgentFlowError(
  error: unknown,
  context: {
    stage?: NormalizedMossError["stage"];
    source?: NormalizedMossError["source"];
  } = {},
): LiveAgentFlowError {
  if (error instanceof LiveAgentFlowError) return error;

  const classified = classifyLiveError(error, context);
  const source = classified.source;
  if (
    /MOSS_RUNTIME_PATH|Moss runtime at .* missing|does not contain a Moss checkout/i.test(
      classified.message,
    )
  ) {
    return new LiveAgentFlowError({
      code: "MOSS_UNAVAILABLE",
      message: classified.message,
      integrationStatus: "UNAVAILABLE",
      source: "moss",
      cause: error,
    });
  }
  const code =
    classified.code === "TIMEOUT"
      ? "TIMEOUT"
      : classified.integrationStatus === "UNAVAILABLE" && source === "rpc"
        ? "RPC_UNAVAILABLE"
        : classified.integrationStatus === "UNAVAILABLE"
          ? "MOSS_UNAVAILABLE"
          : "INTERNAL_ERROR";

  return new LiveAgentFlowError({
    code,
    message: classified.message,
    integrationStatus: classified.integrationStatus,
    source,
    stage: classified.stage,
    cause: error,
  });
}

function unsupportedIntentError(): UnsupportedKuruAgentFlowError {
  return new UnsupportedKuruAgentFlowError(
    "Live Kuru Agent Flow supports Monad Kuru checks only",
  );
}

type CollectedLiveEvidence = {
  quote?: EvidenceRef;
  receipt?: EvidenceRef;
  outcome?: EvidenceRef;
  assetChanges?: EvidenceRef;
  coverage?: EvidenceRef;
};

function collectLiveEvidence(
  collector: EvidenceCollector,
  evidence: NormalizedKuruEvidence,
  partial: boolean,
): CollectedLiveEvidence {
  const prefix = partial ? "Partial live" : "Live";
  const quote = collector.addGenericEvidence(
    "quote",
    evidence.quote,
    "QUOTE",
    `${prefix} Kuru quote Evidence`,
    { routeInputRole: "ROUTE_QUOTE" },
  );
  collector.addGenericEvidence(
    "action",
    evidence.action,
    "ACTION",
    `${prefix} Kuru action Evidence`,
    { routeInputRole: "ROUTE_ACTION" },
  );
  const receipt = collector.addGenericEvidence(
    "receipt",
    evidence.receipt,
    "SIMULATE",
    `${prefix} simulation receipt Evidence`,
    { simulationInputRole: "SIMULATION_RECEIPT" },
  );
  const outcome = collector.addGenericEvidence(
    "outcome",
    evidence.outcome,
    "SIMULATE",
    `${prefix} simulation outcome Evidence`,
    { simulationInputRole: "RECIPIENT_BALANCE_SNAPSHOT" },
  );
  const assetChanges = collector.addGenericEvidence(
    "asset-changes",
    evidence.assetChanges,
    "SIMULATE",
    `${prefix} simulation asset-change Evidence`,
    { simulationInputRole: "ASSET_CHANGE_SET" },
    evidence.assetChangeAssessment === "EXPLAINED" &&
      evidence.assetChanges.value !== null
      ? "confirmed"
      : undefined,
  );
  const coverage = collector.addGenericEvidence(
    "simulation-coverage",
    evidence.simulationCoverage,
    "SIMULATE",
    `${prefix} simulation coverage Evidence`,
  );
  collector.addGenericEvidence(
    "warnings",
    evidence.warnings,
    "SIMULATE",
    `${prefix} simulation warnings Evidence`,
  );
  return { quote, receipt, outcome, assetChanges, coverage };
}

function buildRunResult(
  runId: string,
  intent: NormalizedSwapIntent,
  evidence: NormalizedKuruEvidence,
  risk: ReturnType<typeof evaluateKuruEvidence>,
): RunResult {
  const collector = new EvidenceCollector(evidence);
  const { quote, receipt, outcome, assetChanges, coverage } =
    collectLiveEvidence(collector, evidence, false);

  const noRoute =
    evidence.executionStatus === "NO_ROUTE"
      ? collector.noRouteClassification(intent, evidence)
      : undefined;
  const pathComplete =
    risk.evidenceCompleteness === "COMPLETE" || noRoute !== undefined;

  const completeness = collector.addGenericEvidence(
    "completeness",
    {
      ...evidence.simulationCoverage,
      value: pathComplete ? {} : null,
      source: "derived",
      reproducibility: "REPRODUCIBLE",
    },
    "SIMULATE",
    "Live P0 Evidence completeness",
    { coreRole: "EVIDENCE_COMPLETENESS" },
    pathComplete ? "confirmed" : "unknown",
  );

  const route = buildRoute(intent, quote, evidence);
  const simulatedOutput =
    intent.economicBoundary.availability === "available" &&
    evidence.executionStatus === "SUCCESS"
      ? collector.simulatedTokenOut(intent, evidence, {
          receipt,
          outcome,
          assetChanges,
        })
      : undefined;

  const completenessRule = completenessRuleResult(
    pathComplete ? "COMPLETE" : risk.evidenceCompleteness,
    completeness,
    evidence,
    noRoute,
  );
  const executionRule = executionRuleResult(
    evidence,
    route,
    quote,
    noRoute,
    coverage,
  );
  const economicRule = economicRuleResult(intent, evidence, simulatedOutput);
  const ruleResults = [completenessRule, executionRule, economicRule];
  const scope = buildScope(ruleResults, evidence, noRoute);
  const verdict = effectiveVerdict(risk.verdict, ruleResults, scope);

  return runResultSchema.parse({
    runId,
    replayMode: false,
    intent,
    ...(evidence.simulatorPinnedBlock
      ? { simulatorPinnedBlock: evidence.simulatorPinnedBlock }
      : {}),
    status: "completed",
    systemStatus: "OK",
    verdict,
    summary: summaryFor(verdict, ruleResults),
    ruleResults,
    recommendedActions: [],
    irrelevantActions: [],
    evidence: collector.items,
    scope,
    route,
  });
}

function buildIntegrationErrorResult(
  runId: string,
  intent: NormalizedSwapIntent,
  evidence: NormalizedKuruEvidence,
  flowError: LiveAgentFlowError,
): FailedRunResult {
  const collector = new EvidenceCollector(evidence);
  const { quote } = collectLiveEvidence(collector, evidence, true);

  const route = buildRoute(intent, quote, evidence);
  const executionPreserved =
    route.availability === "available" && quote !== undefined;
  const ruleResults: RuleResult[] = executionPreserved
    ? [
        {
          ruleId: "P0-EXECUTION-001",
          status: "PASS",
          evidenceRefs: [quote],
          actionEvaluations: [],
        },
      ]
    : [];

  return failedRunResultSchema.parse({
    runId,
    replayMode: false,
    intent,
    ...(evidence.simulatorPinnedBlock
      ? { simulatorPinnedBlock: evidence.simulatorPinnedBlock }
      : {}),
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "The check could not be completed",
    error: integrationErrorForFlowError(flowError),
    ruleResults,
    recommendedActions: [],
    irrelevantActions: [],
    evidence: collector.items,
    scope: integrationScope(evidence, flowError.stage, executionPreserved),
    ...(route.availability === "available" ? { route } : {}),
  });
}

function integrationErrorForFlowError(
  error: LiveAgentFlowError,
): FailedRunResult["error"] {
  switch (error.code) {
    case "MOSS_UNAVAILABLE":
      return {
        code: "MOSS_UNAVAILABLE",
        stage: integrationErrorStage(error.stage),
        message: "The Moss runtime was unavailable",
        retryable: true,
      };
    case "RPC_UNAVAILABLE":
      return {
        code: "RPC_UNAVAILABLE",
        stage: integrationErrorStage(error.stage),
        message: "The RPC dependency was unavailable",
        retryable: true,
      };
    case "TIMEOUT":
      return {
        code: "TIMEOUT",
        stage: integrationErrorStage(error.stage),
        message: "Agent Flow timed out",
        retryable: true,
      };
    default:
      return {
        code: "INTERNAL_ERROR",
        stage: integrationErrorStage(error.stage),
        message: "Agent Flow failed internally",
        retryable: false,
      };
  }
}

function integrationErrorStage(
  value: string | undefined,
): FailedRunResult["error"]["stage"] {
  switch (value?.toUpperCase()) {
    case "QUOTE":
      return "quote";
    case "ACTION":
      return "action";
    case "SIMULATE":
    case "SIMULATION":
      return "simulation";
    case "NORMALIZATION":
      return "normalization";
    default:
      return "unknown";
  }
}

function integrationScope(
  evidence: NormalizedKuruEvidence,
  stage: string | undefined,
  executionPreserved: boolean,
): ScopeDisclosure {
  const normalizedStage = stage?.toUpperCase();
  const actionEntered = evidence.action.value !== null;
  const simulationEntered =
    evidence.receipt.value !== null ||
    evidence.outcome.value !== null ||
    evidence.assetChanges.value !== null;
  const simulationTerminalBeforeEntry = [
    "DISCOVER",
    "LOAD",
    "QUOTE",
    "ACTION",
  ].includes(normalizedStage ?? "");
  const actionNotEntered = ["DISCOVER", "LOAD", "QUOTE"].includes(
    normalizedStage ?? "",
  );

  return [
    {
      key: "P0-EXECUTION-001",
      label: "Execution result",
      ...(executionPreserved
        ? { status: "checked" as const }
        : {
            status: "unknown" as const,
            reason: "REQUIRED_CHECK_INTERRUPTED" as const,
          }),
    },
    integrationStageScope(
      "P0-CHECK-ACTION-001",
      "Action construction",
      actionEntered,
      actionNotEntered,
    ),
    integrationStageScope(
      "P0-CHECK-SIMULATION-001",
      "Moss simulation",
      simulationEntered,
      simulationTerminalBeforeEntry,
    ),
    integrationStageScope(
      "P0-CHECK-SIMULATION-COVERAGE-001",
      "Simulation coverage",
      evidence.simulationCoverage.value !== null,
      simulationTerminalBeforeEntry,
    ),
  ];
}

function integrationStageScope(
  key:
    | "P0-CHECK-ACTION-001"
    | "P0-CHECK-SIMULATION-001"
    | "P0-CHECK-SIMULATION-COVERAGE-001",
  label: string,
  checked: boolean,
  notEntered: boolean,
): ScopeDisclosure[number] {
  if (checked) return { key, label, status: "checked" };
  if (notEntered) {
    return {
      key,
      label,
      status: "not_checked",
      reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
    };
  }
  return {
    key,
    label,
    status: "unknown",
    reason: "REQUIRED_CHECK_INTERRUPTED",
  };
}

function buildRoute(
  intent: NormalizedSwapIntent,
  quote: EvidenceRef | undefined,
  evidence: NormalizedKuruEvidence,
) {
  if (
    quote !== undefined &&
    evidence.quote.value !== null &&
    isTrustedRef(quote)
  ) {
    return {
      availability: "available" as const,
      protocol: intent.protocol,
      path: [intent.tokenIn, intent.tokenOut],
      source: quote.source as "moss" | "quote" | "derived",
      ...(quote.blockNumber ? { blockNumber: quote.blockNumber } : {}),
      evidenceRef: quote,
    };
  }

  if (evidence.executionStatus === "NO_ROUTE") {
    return {
      availability: "unavailable" as const,
      reason: "No verified Kuru market path was available",
    };
  }

  return {
    availability: "unknown" as const,
    reason: "A trusted Kuru route could not be established",
  };
}

function completenessRuleResult(
  completeness: ReturnType<typeof evaluateKuruEvidence>["evidenceCompleteness"],
  evidence: EvidenceRef | undefined,
  normalized: NormalizedKuruEvidence,
  noRoute: EvidenceRef | undefined,
): RuleResult {
  if (
    (completeness === "COMPLETE" || noRoute !== undefined) &&
    evidence !== undefined
  ) {
    return {
      ruleId: "P0-EVIDENCE-001",
      status: "PASS",
      evidenceRefs: [evidence],
      actionEvaluations: [],
    };
  }

  return {
    ruleId: "P0-EVIDENCE-001",
    status: "UNKNOWN",
    reasonCode: evidenceReasonCode(normalized),
    evidenceRefs: [],
    actionEvaluations: [],
  };
}

function executionRuleResult(
  evidence: NormalizedKuruEvidence,
  route: ReturnType<typeof buildRoute>,
  quote: EvidenceRef | undefined,
  noRoute: EvidenceRef | undefined,
  coverage: EvidenceRef | undefined,
): RuleResult {
  if (
    evidence.executionStatus === "SUCCESS" &&
    route.availability === "available" &&
    quote !== undefined
  ) {
    return {
      ruleId: "P0-EXECUTION-001",
      status: "PASS",
      evidenceRefs: [quote],
      actionEvaluations: [],
    };
  }

  if (evidence.executionStatus === "NO_ROUTE" && noRoute !== undefined) {
    return {
      ruleId: "P0-EXECUTION-001",
      status: "FAIL",
      reasonCode: "NO_ROUTE_FOUND",
      evidenceRefs: [noRoute],
      actionEvaluations: [],
    };
  }

  return {
    ruleId: "P0-EXECUTION-001",
    status: "UNKNOWN",
    reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED",
    evidenceRefs: coverage ? [coverage] : [],
    actionEvaluations: [],
  };
}

function economicRuleResult(
  intent: NormalizedSwapIntent,
  evidence: NormalizedKuruEvidence,
  simulatedOutput: SimulatedTokenOutResult | undefined,
): RuleResult {
  if (intent.economicBoundary.availability === "unavailable") {
    return {
      ruleId: "P0-ECONOMIC-001",
      status: "NOT_APPLICABLE",
      applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
      evidenceRefs: [],
      actionEvaluations: [],
    };
  }

  if (evidence.executionStatus === "NO_ROUTE") {
    return {
      ruleId: "P0-ECONOMIC-001",
      status: "NOT_APPLICABLE",
      applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
      evidenceRefs: [],
      actionEvaluations: [],
    };
  }

  if (simulatedOutput !== undefined) {
    const amount = simulatedOutput.amountReceivedAtomic;
    const minimum = intent.economicBoundary.minimumReceivedAtomic;
    if (BigInt(amount) >= BigInt(minimum)) {
      return {
        ruleId: "P0-ECONOMIC-001",
        status: "PASS",
        evidenceRefs: [simulatedOutput.reference],
        actionEvaluations: [],
      };
    }
    return {
      ruleId: "P0-ECONOMIC-001",
      status: "FAIL",
      reasonCode: "OUTPUT_BELOW_BOUNDARY",
      evidenceRefs: [simulatedOutput.reference],
      actionEvaluations: [],
    };
  }

  return {
    ruleId: "P0-ECONOMIC-001",
    status: "UNKNOWN",
    reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE",
    evidenceRefs: [],
    actionEvaluations: [],
  };
}

function effectiveVerdict(
  riskVerdict: ReturnType<typeof evaluateKuruEvidence>["verdict"],
  ruleResults: RuleResult[],
  scope: ScopeDisclosure,
) {
  if (
    ruleResults.some((rule) => rule.status === "UNKNOWN") ||
    scope.some((item) => item.status === "unknown")
  ) {
    return "UNKNOWN" as const;
  }

  const execution = ruleResults.find(
    (rule) => rule.ruleId === "P0-EXECUTION-001",
  );
  const economic = ruleResults.find(
    (rule) => rule.ruleId === "P0-ECONOMIC-001",
  );
  if (execution?.status === "FAIL" || economic?.status === "FAIL") {
    return "STOP" as const;
  }
  // Risk Engine ADJUST is only a candidate until a verified Action Gate
  // proves a before/after Run. A bare ADJUST would violate the contract by
  // exposing no executable recommendedActions.
  if (riskVerdict === "ADJUST") return "STOP" as const;
  return riskVerdict;
}

function summaryFor(
  verdict: ReturnType<typeof evaluateKuruEvidence>["verdict"],
  ruleResults: RuleResult[],
): string {
  if (
    verdict === "STOP" &&
    ruleResults.some(
      (rule) => rule.ruleId === "P0-EXECUTION-001" && rule.status === "FAIL",
    )
  ) {
    return "No verified Kuru market path was available";
  }
  if (
    verdict === "STOP" &&
    ruleResults.some(
      (rule) => rule.ruleId === "P0-ECONOMIC-001" && rule.status === "FAIL",
    )
  ) {
    return "Simulated output was below the declared Economic Boundary";
  }
  if (verdict === "UNKNOWN") {
    return "Live check could not establish a trustworthy result";
  }
  if (verdict === "PROCEED") {
    return "Live Evidence satisfied the checked P0 scope";
  }
  return `Live check completed with verdict ${verdict}`;
}

function buildScope(
  ruleResults: RuleResult[],
  evidence: NormalizedKuruEvidence,
  noRoute: EvidenceRef | undefined,
): ScopeDisclosure {
  const ruleScope: ScopeDisclosure = ruleResults.map(
    (rule): ScopeDisclosure[number] => {
      if (rule.status === "PASS" || rule.status === "FAIL") {
        return {
          key: rule.ruleId,
          label: labelFor(rule.ruleId),
          status: "checked",
        };
      }
      if (rule.status === "NOT_APPLICABLE") {
        return {
          key: rule.ruleId,
          label: labelFor(rule.ruleId),
          status: "not_checked",
          reason:
            rule.applicabilityReasonCode === "BOUNDARY_NOT_PROVIDED"
              ? "PRECONDITION_ABSENT"
              : "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
        };
      }
      return {
        key: rule.ruleId,
        label: labelFor(rule.ruleId),
        status: "unknown",
        reason:
          rule.ruleId === "P0-EXECUTION-001"
            ? "CLASSIFICATION_INCOMPLETE"
            : "REQUIRED_EVIDENCE_UNAVAILABLE",
      };
    },
  );

  const terminalStage =
    noRoute !== undefined && evidence.executionStatus === "NO_ROUTE"
      ? evidence.errors.value?.find((error) => error.code === "NO_ROUTE")
          ?.stage === "ACTION"
        ? "ACTION"
        : "QUOTE"
      : undefined;
  const actionScope = stageScope(
    "P0-CHECK-ACTION-001",
    "Action construction",
    evidence.action.value !== null || terminalStage === "ACTION",
    terminalStage === "QUOTE",
  );
  const simulationScope = stageScope(
    "P0-CHECK-SIMULATION-001",
    "Moss simulation",
    evidence.receipt.value !== null || evidence.outcome.value !== null,
    terminalStage !== undefined,
  );
  const coverageScope = stageScope(
    "P0-CHECK-SIMULATION-COVERAGE-001",
    "Simulation coverage",
    evidence.simulationCoverage.value !== null,
    terminalStage !== undefined,
  );

  return [...ruleScope, actionScope, simulationScope, coverageScope];
}

function stageScope(
  key:
    | "P0-CHECK-ACTION-001"
    | "P0-CHECK-SIMULATION-001"
    | "P0-CHECK-SIMULATION-COVERAGE-001",
  label: string,
  checked: boolean,
  notEntered: boolean,
): ScopeDisclosure[number] {
  if (checked) return { key, label, status: "checked" };
  if (notEntered) {
    return {
      key,
      label,
      status: "not_checked",
      reason: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
    };
  }
  return {
    key,
    label,
    status: "unknown",
    reason: "REQUIRED_EVIDENCE_UNAVAILABLE",
  };
}

function labelFor(ruleId: RuleResult["ruleId"]): string {
  switch (ruleId) {
    case "P0-EVIDENCE-001":
      return "Evidence completeness";
    case "P0-EXECUTION-001":
      return "Execution result";
    case "P0-ECONOMIC-001":
      return "Economic boundary";
  }
}

function evidenceReasonCode(evidence: NormalizedKuruEvidence): P0ReasonCode {
  if (evidence.simulationCoverage.value?.halted === true) {
    return "SIMULATION_HALTED";
  }
  if (evidence.simulationCoverage.value?.complete !== true) {
    return "SIMULATION_COVERAGE_MISSING";
  }
  if (evidence.warnings.value !== null && evidence.warnings.value.length > 0) {
    return "UNCLASSIFIED_WARNING";
  }
  if (
    evidence.assetChanges.value !== null &&
    evidence.assetChangeAssessment !== "EXPLAINED" &&
    evidence.assetChangeAssessment !== "NOT_APPLICABLE"
  ) {
    return "UNEXPLAINED_ASSET_CHANGE";
  }
  if (
    [evidence.quote, evidence.action, evidence.receipt, evidence.outcome].some(
      (field) => field.source === "unknown",
    )
  ) {
    return "EVIDENCE_SOURCE_UNKNOWN";
  }
  if (
    [evidence.quote, evidence.action, evidence.receipt, evidence.outcome].some(
      (field) => field.reproducibility !== "REPRODUCIBLE",
    )
  ) {
    return "EVIDENCE_NOT_REPRODUCIBLE";
  }
  return "CRITICAL_EVIDENCE_MISSING";
}

function isTrustedRef(reference: EvidenceRef): boolean {
  return (
    reference.source !== "unknown" &&
    reference.source !== "mock" &&
    reference.source !== "external" &&
    reference.reproducibility === "REPRODUCIBLE" &&
    reference.isMock === false
  );
}

class EvidenceCollector {
  public readonly items: EvidenceItem[] = [];

  public constructor(private readonly normalized: NormalizedKuruEvidence) {}

  public addGenericEvidence(
    suffix: string,
    field: Sourced<unknown>,
    stage: "QUOTE" | "ACTION" | "SIMULATE",
    summary: string,
    extra: Record<string, unknown> = {},
    explicitStatus?: "confirmed" | "warning" | "unknown",
  ): EvidenceRef | undefined {
    const status =
      explicitStatus ??
      (field.value === null
        ? "unknown"
        : Array.isArray(field.value) && field.value.length > 0
          ? "warning"
          : "confirmed");
    const item = evidenceItemSchema.parse({
      key: `${this.normalized.mossCommit ?? "live"}:${suffix}`,
      ...provenance(this.normalized, field),
      kind: "generic",
      status,
      summary,
      source: field.source,
      stage,
      ...extra,
    });
    this.items.push(item);
    return evidenceRef(item);
  }

  public noRouteClassification(
    intent: NormalizedSwapIntent,
    evidence: NormalizedKuruEvidence,
  ): EvidenceRef | undefined {
    const error = evidence.errors.value?.find(
      (candidate) => candidate.code === "NO_ROUTE",
    );
    if (
      error === undefined ||
      (error.source !== "moss" && error.source !== "quote")
    ) {
      return undefined;
    }

    const stage = error.stage === "ACTION" ? "ACTION" : "QUOTE";
    const blockNumber = evidence.blockNumber.value ?? undefined;
    const raw = evidenceItemSchema.parse({
      key: `${evidence.mossCommit ?? "live"}:no-route-raw`,
      ...provenance(evidence, evidence.blockNumber),
      ...(blockNumber ? { blockNumber } : {}),
      kind: "no_route_raw_output",
      status: "confirmed",
      summary: error.message,
      source: error.source,
      stage,
      payloadRef: {
        locator: `live://${evidence.mossCommit ?? "unknown"}/${stage}/error`,
        encoding: "json",
        fingerprint: `sha256:${createHash("sha256")
          .update(JSON.stringify(error))
          .digest("hex")}`,
      },
    });
    this.items.push(raw);

    const classification = evidenceItemSchema.parse({
      key: `${evidence.mossCommit ?? "live"}:no-route-classification`,
      ...provenance(evidence, evidence.blockNumber),
      ...(blockNumber ? { blockNumber } : {}),
      kind: "no_route_classification",
      status: "confirmed",
      summary: "Kuru reported that no verified market route was available",
      source: "derived",
      stage,
      protocol: intent.protocol,
      chainId: intent.chainId,
      sender: intent.sender,
      recipient: intent.recipient,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountInAtomic: intent.amountInAtomic,
      rawEvidenceKey: raw.key,
      normalizedCode: "NO_ROUTE",
      normalizedMessage: error.message,
      normalizedSource: error.source,
      normalizationKind: error.normalization,
      normalizerVersion: "moss-bridge-normalize-live/v1",
      integrationStatus: "OK",
    });
    this.items.push(classification);
    return evidenceRef(classification);
  }

  public simulatedTokenOut(
    intent: NormalizedSwapIntent,
    evidence: NormalizedKuruEvidence,
    inputs: {
      receipt?: EvidenceRef;
      outcome?: EvidenceRef;
      assetChanges?: EvidenceRef;
    },
  ): SimulatedTokenOutResult | undefined {
    const extracted = extractSimulatedTokenOut(intent, evidence);
    if (extracted === undefined) return undefined;

    const inputEvidenceRefs = [
      inputs.receipt,
      inputs.outcome,
      inputs.assetChanges,
    ]
      .filter((reference): reference is EvidenceRef => reference !== undefined)
      .filter((reference) => {
        const item = this.items.find(
          (candidate) => candidate.key === reference.key,
        );
        return item?.kind === "generic" && item.status === "confirmed";
      });
    if (inputEvidenceRefs.length === 0) return undefined;

    const item = evidenceItemSchema.parse({
      key: `${evidence.mossCommit ?? "live"}:simulated-token-out`,
      ...provenance(evidence, evidence.blockNumber),
      kind: "simulated_token_out",
      status: "confirmed",
      summary: "Simulated recipient tokenOut amount",
      source: "derived",
      stage: "SIMULATE",
      tokenOut: intent.tokenOut,
      recipient: intent.recipient,
      amountReceivedAtomic: extracted.amountReceivedAtomic,
      derivation: extracted.derivation,
      derivationVersion: "recipient-token-out/v1",
      inputEvidenceRefs,
    });
    this.items.push(item);
    if (item.kind !== "simulated_token_out") {
      throw new Error("Expected simulated tokenOut Evidence");
    }
    return {
      reference: evidenceRef(item),
      amountReceivedAtomic: item.amountReceivedAtomic,
    };
  }
}

function provenance(
  normalized: NormalizedKuruEvidence,
  field: { blockNumber?: string; reproducibility: string },
): Record<string, unknown> {
  return {
    ...(field.blockNumber ? { blockNumber: field.blockNumber } : {}),
    ...(normalized.simulatorPinnedBlock
      ? { simulatorPinnedBlock: normalized.simulatorPinnedBlock }
      : {}),
    runtimeVersion: normalized.runtimeVersion,
    runtimeRevision: normalized.runtimeRevision,
    reproducibility: field.reproducibility,
    isReplay: false,
    isMock: false,
  };
}

function evidenceRef(item: EvidenceItem): EvidenceRef {
  return {
    key: item.key,
    source: item.source,
    stage: item.stage,
    blockNumber: item.blockNumber,
    simulatorPinnedBlock: item.simulatorPinnedBlock,
    runtimeVersion: item.runtimeVersion,
    runtimeRevision: item.runtimeRevision,
    fixtureId: item.fixtureId,
    reproducibility: item.reproducibility,
    isReplay: item.isReplay,
    isMock: item.isMock,
  };
}

type SimulatedTokenOut = {
  amountReceivedAtomic: string;
  derivation: "recipient_balance_delta" | "asset_change";
};

type SimulatedTokenOutResult = {
  reference: EvidenceRef;
  amountReceivedAtomic: string;
};

function extractSimulatedTokenOut(
  intent: NormalizedSwapIntent,
  evidence: NormalizedKuruEvidence,
): SimulatedTokenOut | undefined {
  const outcome = isRecord(evidence.outcome.value)
    ? exactOutputFromRecord(evidence.outcome.value, intent, evidence)
    : undefined;
  if (outcome !== undefined) {
    return outcome;
  }

  if (
    evidence.assetChanges.value === null ||
    evidence.assetChangeAssessment !== "EXPLAINED"
  ) {
    return undefined;
  }
  for (const change of evidence.assetChanges.value) {
    if (!isRecord(change) || !isExplicitTokenTransfer(change)) continue;
    if (
      typeof change.to !== "string" ||
      change.to.toLowerCase() !== intent.recipient.toLowerCase()
    ) {
      continue;
    }
    const token = tokenFromRecord(change);
    if (!sameAssetString(token, intent.tokenOut)) continue;
    const amount = firstString(change, [
      "amountReceivedAtomic",
      "amountAtomic",
      "amount",
      "value",
    ]);
    if (amount !== undefined && /^\d+$/.test(amount) && amount !== "0") {
      return { amountReceivedAtomic: amount, derivation: "asset_change" };
    }
  }
  return undefined;
}

function exactOutputFromRecord(
  value: Record<string, unknown>,
  intent: NormalizedSwapIntent,
  evidence: NormalizedKuruEvidence,
): SimulatedTokenOut | undefined {
  const amountReceivedAtomic = firstString(value, ["amountReceivedAtomic"]);
  const amount =
    amountReceivedAtomic ??
    firstString(value, [
      "amountOutAtomic",
      "tokenOutAmountAtomic",
      // Moss Kuru's normalized swap outcome uses atomic `amountOut`.
      "amountOut",
    ]);
  const recordedRecipient = firstString(value, ["recipient"]);
  const inferredRecipient =
    recordedRecipient === undefined &&
    evidence.assetChangeAssessment === "EXPLAINED" &&
    intent.recipient.toLowerCase() === intent.sender.toLowerCase()
      ? intent.recipient
      : undefined;
  const recipient = recordedRecipient ?? inferredRecipient;
  const token = tokenFromRecord(value);
  if (
    amount === undefined ||
    !/^\d+$/.test(amount) ||
    amount === "0" ||
    recipient === undefined ||
    recipient.toLowerCase() !== intent.recipient.toLowerCase() ||
    !sameAssetString(token, intent.tokenOut)
  ) {
    return undefined;
  }
  return {
    amountReceivedAtomic: amount,
    derivation:
      amountReceivedAtomic === undefined
        ? "asset_change"
        : "recipient_balance_delta",
  };
}

function isExplicitTokenTransfer(value: Record<string, unknown>): boolean {
  return (
    value.kind === "erc20Transfer" ||
    value.kind === "tokenTransfer" ||
    value.kind === "assetChange"
  );
}

function tokenFromRecord(value: Record<string, unknown>): string | undefined {
  const candidate = value.tokenOut ?? value.token ?? value.address;
  if (typeof candidate === "string") return candidate;
  if (
    isRecord(candidate) &&
    candidate.kind === "erc20" &&
    typeof candidate.address === "string"
  ) {
    return candidate.address;
  }
  if (isRecord(candidate) && candidate.kind === "native") return "native";
  return undefined;
}

function sameAssetString(
  value: string | undefined,
  asset: AssetReference,
): boolean {
  if (value === undefined) return false;
  return asset.kind === "native"
    ? value === "native" || value === "MON"
    : value.toLowerCase() === asset.address.toLowerCase();
}

function firstString(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

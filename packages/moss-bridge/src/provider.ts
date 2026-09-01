import {
  type EvidenceEvaluationInput,
  type EvidenceField,
  type EvidenceProvider,
  EvidenceProviderError,
  type GenericEvidence,
  type GenericEvidenceMode,
  type GenericProviderFailure,
  type GenericProviderStatus,
  type GenericQuoteOutput,
  type GenericSwapIntent,
  genericEvidenceSchema,
} from "@parallax/contracts";
import { classifyLiveError } from "./errors.js";
import { KURU_PROTOCOL, MONAD_CHAIN_ID } from "./kuru.js";
import { runKuruLiveSwap } from "./live-kuru.js";
import type {
  JsonValue,
  LiveKuruResult,
  NormalizedKuruEvidence,
  NormalizedKuruSwapIntent,
  NormalizedMossError,
  RuntimeIdentity,
  Sourced,
  StageRecord,
} from "./types.js";

export type KuruLiveRunner = typeof runKuruLiveSwap;

/** Moss runtime configuration consumed by the provider (Kuru live path). */
export type MossProviderRuntime = {
  rpcUrl: string;
  runtimePath?: string;
  runtimeVersion: string;
  runtimeRevision: string;
};

export type MossProviderOptions = {
  runtime: MossProviderRuntime;
  runner?: KuruLiveRunner;
};

const PROVIDER_ID = "moss-kuru";

/**
 * MossProvider: the Moss/Kuru evidence provider.
 *
 * Owns every Moss-specific concern of the live check path: invoking the Kuru
 * live runtime, validating runtime provenance truthfulness, merging the
 * simulator pinned block, classifying integration failures, and mapping the
 * normalized Moss output into the generic Evidence contract. No
 * `NormalizedKuruEvidence` escapes through `evaluate`.
 *
 * A NO_ROUTE terminal result is legal evidence and never requires a
 * simulatorPinnedBlock; provider failures are either thrown (no evidence at
 * all) or surfaced as `provider.integrationStatus !== "OK"` with a classified
 * failure and `provider.status = FAILED`.
 */
export class MossProvider implements EvidenceProvider {
  public readonly providerId = PROVIDER_ID;
  private readonly runner: KuruLiveRunner;

  public constructor(private readonly options: MossProviderOptions) {
    this.runner = options.runner ?? runKuruLiveSwap;
  }

  public supports(intent: GenericSwapIntent): boolean {
    return (
      intent.protocol === KURU_PROTOCOL &&
      intent.chainId === Number(MONAD_CHAIN_ID)
    );
  }

  public async evaluate(
    input: EvidenceEvaluationInput,
  ): Promise<GenericEvidence> {
    const runtime = this.options.runtime;
    if (runtime.runtimePath === undefined) {
      throw new EvidenceProviderError({
        providerId: this.providerId,
        code: "UNAVAILABLE",
        integrationStatus: "UNAVAILABLE",
        source: "moss",
        message: "The configured Moss runtime path is missing",
      });
    }
    if (!this.supports(input.intent)) {
      throw new EvidenceProviderError({
        providerId: this.providerId,
        code: "UNSUPPORTED",
        message: "Live Kuru Agent Flow supports Monad Kuru checks only",
      });
    }

    let live: LiveKuruResult;
    try {
      live = await this.runner({
        runId: input.runId,
        intent: toMossIntent(input.intent),
        rpcUrl: runtime.rpcUrl,
        runtimePath: runtime.runtimePath,
        runtimeVersion: runtime.runtimeVersion,
        runtimeRevision: runtime.runtimeRevision,
      });
    } catch (error) {
      throw toProviderError(error);
    }

    const noRoute = live.evidence.executionStatus === "NO_ROUTE";
    assertLiveProvenance(
      live.evidence,
      live.runtime,
      live.observedChainId,
      live.simulatorPinnedBlock,
      runtime,
      !noRoute && live.evidence.integrationStatus === "OK",
    );

    if (live.observedChainId === undefined) {
      throw new EvidenceProviderError({
        providerId: this.providerId,
        code: "UNAVAILABLE",
        integrationStatus: "UNAVAILABLE",
        source: "rpc",
        stage: "DISCOVER",
        message: "The configured RPC did not return a chain ID",
      });
    }

    const evidence = withSimulatorPinnedBlock(
      live.evidence,
      live.simulatorPinnedBlock,
    );
    return toGenericEvidence(evidence, {
      stages: live.stages,
      runtime: live.runtime,
      observedChainId: live.observedChainId,
    });
  }
}

export type GenericEvidenceContext = {
  stages?: StageRecord[];
  runtime?: RuntimeIdentity;
  observedChainId?: number;
};

/**
 * Provider Adapter: maps normalized Moss/Kuru evidence into the generic
 * Evidence contract without losing provenance, freshness, failure semantics,
 * capability, or Live/Replay/Mock truthfulness.
 *
 * Status layering: `provider.status` is the provider evaluation status
 * (FAILED on integration failure, SUCCESS for verified outcomes including
 * NO_ROUTE and REVERTED, UNKNOWN when the execution outcome is undetermined),
 * `provider.integrationStatus` preserves the legacy 4-state integration
 * health, and `execution.status` stays the independent protocol outcome.
 */
export function toGenericEvidence(
  evidence: NormalizedKuruEvidence,
  context: GenericEvidenceContext = {},
): GenericEvidence {
  const failure = evidenceFailure(evidence, context.stages);
  const runtimeBlock = runtimeProvenance(evidence, context);
  return genericEvidenceSchema.parse({
    intent: genericIntent(evidence.intent),
    provider: {
      providerId: PROVIDER_ID,
      status: providerEvaluationStatus(evidence),
      integrationStatus: evidence.integrationStatus,
      ...(failure === undefined ? {} : { failure }),
      errors: toEvidenceField(evidence.errors),
    },
    execution: { status: evidence.executionStatus },
    quote: toQuoteField(evidence.quote),
    action: toEvidenceField(evidence.action),
    receipt: toEvidenceField(evidence.receipt),
    outcome: toEvidenceField(evidence.outcome),
    assetChanges: toEvidenceField(evidence.assetChanges),
    assetChangeAssessment: evidence.assetChangeAssessment,
    warnings: toEvidenceField(evidence.warnings),
    simulation: toEvidenceField(evidence.simulationCoverage),
    blockNumber: toEvidenceField(evidence.blockNumber),
    capabilities: ["quote", "action", "simulate"],
    provenance: {
      ...(context.observedChainId === undefined
        ? {}
        : { observedChainId: context.observedChainId }),
      ...(evidence.fetchedAt === undefined
        ? {}
        : { fetchedAt: evidence.fetchedAt }),
      mode: evidenceMode(evidence),
      source: evidence.source,
      ...(evidence.simulatorPinnedBlock === undefined
        ? {}
        : { simulationBlock: evidence.simulatorPinnedBlock }),
      ...(runtimeBlock === undefined ? {} : { runtime: runtimeBlock }),
    },
    ...evidenceScope(evidence),
    providerData: providerData(evidence, context),
  });
}

/**
 * Provider evaluation status. Integration failures dominate; a verified
 * execution outcome (SUCCESS / NO_ROUTE / REVERTED) is SUCCESS; an
 * undetermined outcome (execution UNKNOWN, e.g. unsupported receipt or
 * incomplete coverage) is UNKNOWN. STALE/UNSUPPORTED are not produced by the
 * Moss path.
 */
function providerEvaluationStatus(
  evidence: NormalizedKuruEvidence,
): GenericProviderStatus {
  if (evidence.integrationStatus !== "OK") return "FAILED";
  switch (evidence.executionStatus) {
    case "SUCCESS":
    case "NO_ROUTE":
    case "REVERTED":
      return "SUCCESS";
    default:
      return "UNKNOWN";
  }
}

/**
 * Normalized evidence truthfulness mode. Replay dominates over mock so the
 * Risk replay gate keeps its historical semantics for every Moss-produced
 * evidence shape.
 */
function evidenceMode(evidence: NormalizedKuruEvidence): GenericEvidenceMode {
  if (evidence.replayMode) return "RECORDED_REPLAY";
  if (evidence.isMock ?? false) return "MOCK";
  return "LIVE";
}

/**
 * Provider-specific runtime provenance (Moss runtime identity + evidence
 * baseline commit). Absent on recorded evidence without runtime identity.
 */
function runtimeProvenance(
  evidence: NormalizedKuruEvidence,
  context: GenericEvidenceContext,
): GenericEvidence["provenance"]["runtime"] | undefined {
  const runtime = {
    ...(evidence.runtimeVersion === undefined
      ? {}
      : { runtimeVersion: evidence.runtimeVersion }),
    ...(evidence.runtimeRevision === undefined
      ? {}
      : { runtimeRevision: evidence.runtimeRevision }),
    ...(context.runtime?.checkoutRevision === undefined
      ? {}
      : { checkoutRevision: context.runtime.checkoutRevision }),
    ...(evidence.mossCommit === undefined
      ? {}
      : { commit: evidence.mossCommit }),
    ...(context.runtime?.packageVersions === undefined
      ? {}
      : { packageVersions: context.runtime.packageVersions }),
  };
  return Object.keys(runtime).length === 0 ? undefined : runtime;
}

function evidenceFailure(
  evidence: NormalizedKuruEvidence,
  stages: StageRecord[] | undefined,
): GenericProviderFailure | undefined {
  if (evidence.integrationStatus === "OK") return undefined;
  const detailed = evidence.errors.value?.find(
    (error) => error.integrationStatus !== "OK",
  );
  if (detailed !== undefined) return detailed;
  return {
    code: evidence.integrationStatus,
    message: "Live Evidence reported an integration failure without details",
    integrationStatus: evidence.integrationStatus,
    source: "moss",
    normalization: "PRESERVED",
    ...(lastFailedStage(stages) === undefined
      ? {}
      : { stage: lastFailedStage(stages) }),
  };
}

function evidenceScope(evidence: NormalizedKuruEvidence): {
  checkedScope: string[];
  unknownScope: string[];
} {
  const checked: string[] = [];
  const unknown: string[] = [];
  const stages: Array<[string, boolean]> = [
    ["quote", evidence.quote.value !== null],
    ["action", evidence.action.value !== null],
    [
      "simulation",
      evidence.receipt.value !== null || evidence.outcome.value !== null,
    ],
    ["simulation-coverage", evidence.simulationCoverage.value !== null],
  ];
  for (const [stage, isChecked] of stages) {
    (isChecked ? checked : unknown).push(stage);
  }
  if (evidence.executionStatus === "NO_ROUTE") checked.push("no-route");
  return { checkedScope: checked, unknownScope: unknown };
}

function providerData(
  evidence: NormalizedKuruEvidence,
  context: GenericEvidenceContext,
): Record<string, unknown> {
  return {
    ...(evidence.mossVersion === undefined
      ? {}
      : { mossVersion: evidence.mossVersion }),
    ...(evidence.approval.value === null
      ? {}
      : { approval: evidence.approval.value }),
    ...(evidence.gas.value === null ? {} : { gas: evidence.gas.value }),
    ...(evidence.revertReason.value === null
      ? {}
      : { revertReason: evidence.revertReason.value }),
    ...(context.stages === undefined
      ? {}
      : {
          stages: context.stages.map((stage) => ({
            stage: stage.stage,
            success: stage.success,
            ...(stage.blockNumber === undefined
              ? {}
              : { blockNumber: stage.blockNumber }),
            startedAt: stage.startedAt,
            finishedAt: stage.finishedAt,
          })),
        }),
    limitations: evidence.limitations,
    walletAffordabilityChecked: evidence.walletAffordabilityChecked,
  };
}

function genericIntent(intent: NormalizedKuruSwapIntent): GenericSwapIntent {
  return {
    chainId: Number(intent.chainId),
    protocol: "kuru",
    sender: intent.sender,
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    amountIn: intent.amountIn,
    ...(intent.minimumReceived === undefined
      ? {}
      : { minimumReceived: intent.minimumReceived }),
    minimumReceivedSource: intent.minimumReceivedSource,
  };
}

function toMossIntent(intent: GenericSwapIntent): NormalizedKuruSwapIntent {
  return {
    chainId: String(intent.chainId),
    sender: intent.sender,
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    amountIn: intent.amountIn,
    ...(intent.minimumReceived === undefined
      ? {}
      : { minimumReceived: intent.minimumReceived }),
    minimumReceivedSource: intent.minimumReceivedSource,
  };
}

function toEvidenceField<T>(field: Sourced<T>): EvidenceField<T> {
  return {
    value: field.value,
    source: field.source,
    reproducibility: field.reproducibility,
    ...(field.blockNumber === undefined
      ? {}
      : { blockNumber: field.blockNumber }),
    ...(field.fetchedAt === undefined ? {} : { fetchedAt: field.fetchedAt }),
    ...(field.formula === undefined ? {} : { formula: field.formula }),
    ...(field.limitation === undefined ? {} : { limitation: field.limitation }),
  };
}

function toQuoteField(
  field: Sourced<JsonValue>,
): EvidenceField<GenericQuoteOutput> {
  const value = quoteOutput(field.value);
  return { ...toEvidenceField(field), value };
}

/**
 * Only plain decimal strings are projected into the typed quote output.
 * Anything else maps to `null` so Risk and the Quote projection keep their
 * previous fail-closed behavior (UNKNOWN / QUOTE_UNAVAILABLE) instead of
 * rejecting the whole evidence.
 */
function quoteOutput(value: JsonValue | null): GenericQuoteOutput | null {
  if (!isRecord(value)) return null;
  const estimatedAmountOut = value.estimatedAmountOut;
  if (
    typeof estimatedAmountOut !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(estimatedAmountOut)
  ) {
    return null;
  }
  const minimumAmountOut = value.minimumAmountOut;
  return {
    estimatedAmountOut,
    ...(typeof minimumAmountOut === "string" && minimumAmountOut.trim() !== ""
      ? { minimumAmountOut }
      : {}),
  };
}

function toProviderError(error: unknown): EvidenceProviderError {
  const classified = classifyLiveError(error);
  if (
    /MOSS_RUNTIME_PATH|Moss runtime at .* missing|does not contain a Moss checkout/i.test(
      classified.message,
    )
  ) {
    return new EvidenceProviderError({
      providerId: PROVIDER_ID,
      code: "UNAVAILABLE",
      message: classified.message,
      integrationStatus: "UNAVAILABLE",
      source: "moss",
      stage: classified.stage,
      retryable: false,
      cause: error,
    });
  }
  const code =
    classified.code === "TIMEOUT"
      ? "TIMEOUT"
      : classified.integrationStatus === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : "INTEGRATION_ERROR";
  return new EvidenceProviderError({
    providerId: PROVIDER_ID,
    code,
    message: classified.message,
    integrationStatus: classified.integrationStatus,
    source: classified.source,
    stage: classified.stage,
    retryable: classified.retryable,
    cause: error,
  });
}

type RuntimeProvenanceIdentity = {
  runtimeVersion: string;
  runtimeRevision: string;
  checkoutRevision?: string;
  packageVersions: Record<string, string>;
};

const REQUIRED_RUNTIME_PACKAGES = [
  "@themoss/core",
  "@themoss/erc",
  "@themoss/protocol-kuru",
  "@themoss/simulator",
  "@themoss/system",
];

export function hasMismatchedRuntimeProvenance(
  evidence: NormalizedKuruEvidence,
  runtimeIdentity: RuntimeProvenanceIdentity,
  observedChainId: number | undefined,
  runtime: MossProviderRuntime,
): boolean {
  return (
    !/^[0-9a-f]{40}$/i.test(runtime.runtimeRevision) ||
    (observedChainId !== undefined && observedChainId !== 143) ||
    runtimeIdentity.runtimeVersion !== runtime.runtimeVersion ||
    runtimeIdentity.runtimeRevision !== runtime.runtimeRevision ||
    runtimeIdentity.checkoutRevision !== runtime.runtimeRevision ||
    REQUIRED_RUNTIME_PACKAGES.some(
      (name) =>
        runtimeIdentity.packageVersions[name] !== runtime.runtimeVersion,
    ) ||
    evidence.replayMode !== false ||
    evidence.isReplay !== false ||
    evidence.isMock !== false ||
    evidence.runtimeVersion !== runtime.runtimeVersion ||
    evidence.runtimeRevision !== runtime.runtimeRevision
  );
}

/**
 * Live truthfulness gate: the observed runtime identity, chain, pinned block
 * and Live/Replay/Mock flags must match the configured identity, or the
 * evaluation fails closed. NO_ROUTE may legitimately precede Simulation, so
 * its pinned block is not required.
 */
export function assertLiveProvenance(
  evidence: NormalizedKuruEvidence,
  runtimeIdentity: RuntimeProvenanceIdentity,
  observedChainId: number | undefined,
  simulatorPinnedBlock: string | undefined,
  runtime: MossProviderRuntime,
  requireSimulatorPinnedBlock = true,
): void {
  if (
    hasMismatchedRuntimeProvenance(
      evidence,
      runtimeIdentity,
      observedChainId,
      runtime,
    ) ||
    (requireSimulatorPinnedBlock &&
      !/^\d+$/.test(simulatorPinnedBlock ?? "")) ||
    (evidence.simulatorPinnedBlock !== undefined &&
      evidence.simulatorPinnedBlock !== simulatorPinnedBlock)
  ) {
    throw new EvidenceProviderError({
      providerId: PROVIDER_ID,
      code: "INTERNAL_ERROR",
      message: "Live Agent Flow returned mismatched runtime provenance",
      integrationStatus: "INTEGRATION_ERROR",
      source: "moss",
    });
  }
}

export function withSimulatorPinnedBlock(
  evidence: NormalizedKuruEvidence,
  simulatorPinnedBlock: string | undefined,
): NormalizedKuruEvidence {
  if (evidence.simulatorPinnedBlock === simulatorPinnedBlock) return evidence;
  return { ...evidence, simulatorPinnedBlock };
}

export function firstIntegrationError(
  evidence: NormalizedKuruEvidence,
): NormalizedMossError | undefined {
  if (evidence.integrationStatus !== "OK") {
    return evidence.errors.value?.find(
      (error) => error.integrationStatus !== "OK",
    );
  }
  return undefined;
}

export function lastFailedStage(
  stages: StageRecord[] | undefined,
): NormalizedMossError["stage"] | undefined {
  if (stages === undefined) return undefined;
  return [...stages].reverse().find((stage) => !stage.success)?.stage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

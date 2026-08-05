/**
 * Single canonical Live acceptance gate. `liveSuccess` and `P0_LIVE_READY` are
 * always derived from this one gate so the artifact, fixture decision, and the
 * P0 candidate can never drift apart.
 */

export type LiveAcceptanceGate = {
  discoverOk: boolean;
  loadOk: boolean;
  quoteRouteAvailable: boolean;
  actionTransactionNonEmpty: boolean;
  simulateCoversAllActions: boolean;
  transactionIdentityMatched: boolean;
  simulationNotHalted: boolean;
  noUnmatchedResult: boolean;
  noMissingTransaction: boolean;
  notReverted: boolean;
  receiptPresent: boolean;
  outcomeParsed: boolean;
  flipOrderUpdatedNotBlocking: boolean;
  runtimeProvenanceComplete: boolean;
  blockProvenanceComplete: boolean;
  isReplayFalse: boolean;
  isMockFalse: boolean;
  executionSucceeded: boolean;
};

export type P0DecisionCandidate =
  | "P0_LIVE_READY"
  | "P0_LIVE_BLOCKED_PORTABLE_RUNTIME"
  | "P0_LIVE_BLOCKED_SIMULATION";

/** Structural subset of a live run consumed by the acceptance gate. */
export type LiveAcceptanceResult = {
  stages: Array<{
    stage: string;
    success: boolean;
    error?: { code?: string };
  }>;
  evidence: {
    quote: { value: unknown };
    action: { value: unknown };
    simulationCoverage: {
      value: {
        expectedTransactions?: number;
        observedResults?: number;
        unmatchedResultIndexes: unknown[];
        missingTransactionIndexes: unknown[];
        halted?: boolean;
        complete?: boolean;
      } | null;
    };
    receipt: { value: unknown };
    outcome: { value: unknown };
    warnings: { value?: unknown };
    blockNumber: { value: unknown };
    isReplay?: boolean;
    isMock?: boolean;
    executionStatus: string;
    runtimeVersion?: string;
    runtimeRevision?: string;
  };
};

type DeclaredRuntime = { runtimeVersion: string; runtimeRevision: string };

export function evaluateLiveAcceptance(
  result: LiveAcceptanceResult,
  declared: DeclaredRuntime,
): LiveAcceptanceGate {
  const evidence = result.evidence;
  const coverage = evidence.simulationCoverage.value;
  const stageOk = (stage: string): boolean =>
    result.stages.some(
      (record) => record.stage === stage && record.success === true,
    );

  return {
    discoverOk: stageOk("DISCOVER"),
    loadOk: stageOk("LOAD"),
    quoteRouteAvailable: evidence.quote.value !== null,
    actionTransactionNonEmpty:
      Array.isArray(evidence.action.value) && evidence.action.value.length > 0,
    simulateCoversAllActions:
      coverage?.expectedTransactions === coverage?.observedResults,
    transactionIdentityMatched:
      coverage?.missingTransactionIndexes.length === 0 &&
      coverage?.unmatchedResultIndexes.length === 0,
    simulationNotHalted: coverage?.halted !== true,
    noUnmatchedResult: coverage?.unmatchedResultIndexes.length === 0,
    noMissingTransaction: coverage?.missingTransactionIndexes.length === 0,
    notReverted: evidence.executionStatus !== "REVERTED",
    receiptPresent: evidence.receipt.value !== null,
    outcomeParsed: evidence.outcome.value !== null,
    flipOrderUpdatedNotBlocking: !JSON.stringify(
      evidence.warnings.value ?? [],
    ).includes("FlipOrderUpdated"),
    runtimeProvenanceComplete:
      evidence.runtimeVersion === declared.runtimeVersion &&
      evidence.runtimeRevision === declared.runtimeRevision,
    blockProvenanceComplete: evidence.blockNumber.value !== null,
    isReplayFalse: evidence.isReplay === false,
    isMockFalse: evidence.isMock === false,
    executionSucceeded: evidence.executionStatus === "SUCCESS",
  };
}

export function liveSuccessOf(acceptance: LiveAcceptanceGate): boolean {
  return Object.values(acceptance).every(Boolean);
}

/**
 * P0 candidate derived from the same acceptance gate as `liveSuccess`.
 * P0_LIVE_READY is emitted only when every acceptance condition holds;
 * otherwise the blocker is portable-runtime (only for explicit
 * UNAVAILABLE/INTEGRATION_ERROR stage failures) or simulation.
 */
export function p0DecisionCandidate(
  result: LiveAcceptanceResult,
  declared: DeclaredRuntime,
): P0DecisionCandidate {
  if (liveSuccessOf(evaluateLiveAcceptance(result, declared))) {
    return "P0_LIVE_READY";
  }

  const failedStage = result.stages.find((stage) => !stage.success);
  const code = failedStage?.error?.code;
  if (code === "UNAVAILABLE" || code === "INTEGRATION_ERROR") {
    return "P0_LIVE_BLOCKED_PORTABLE_RUNTIME";
  }
  return "P0_LIVE_BLOCKED_SIMULATION";
}

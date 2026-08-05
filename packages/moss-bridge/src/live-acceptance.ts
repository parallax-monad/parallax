/**
 * Single canonical Live acceptance gate. `liveSuccess` and `P0_LIVE_READY` are
 * always derived from this one gate so the artifact, fixture decision, and the
 * P0 candidate can never drift apart.
 */

import { MONAD_CHAIN_ID } from "./kuru.js";

export type LiveAcceptanceGate = {
  integrationStatusOk: boolean;
  chainIdCorrect: boolean;
  discoverOk: boolean;
  loadOk: boolean;
  quoteRouteAvailable: boolean;
  actionTransactionNonEmpty: boolean;
  simulateCoversAllActions: boolean;
  transactionIdentityMatched: boolean;
  simulationNotHalted: boolean;
  coverageComplete: boolean;
  noUnmatchedResult: boolean;
  noMissingTransaction: boolean;
  notReverted: boolean;
  receiptPresent: boolean;
  outcomeParsed: boolean;
  flipOrderUpdatedNotBlocking: boolean;
  warningsEmpty: boolean;
  assetChangesExplained: boolean;
  runtimeProvenanceComplete: boolean;
  blockProvenanceComplete: boolean;
  isReplayFalse: boolean;
  isMockFalse: boolean;
  simulatorPinnedBlockComplete: boolean;
  executionSucceeded: boolean;
};

export type P0DecisionCandidate =
  | "P0_LIVE_READY"
  | "P0_LIVE_BLOCKED_PORTABLE_RUNTIME"
  | "P0_LIVE_BLOCKED_SIMULATION";

/** Structural subset of a live run consumed by the acceptance gate. */
export type LiveAcceptanceResult = {
  /** Chain ID observed from the RPC used for this run. */
  observedChainId?: number;
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
    assetChangeAssessment:
      | "EXPLAINED"
      | "UNEXPLAINED"
      | "UNKNOWN"
      | "NOT_APPLICABLE";
    blockNumber: { value: unknown };
    isReplay?: boolean;
    isMock?: boolean;
    simulatorPinnedBlock?: string;
    executionStatus: string;
    integrationStatus: string;
    runtimeVersion?: string;
    runtimeRevision?: string;
  };
  simulatorPinnedBlock?: string;
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
    integrationStatusOk: evidence.integrationStatus === "OK",
    chainIdCorrect: result.observedChainId === Number(MONAD_CHAIN_ID),
    discoverOk: stageOk("DISCOVER"),
    loadOk: stageOk("LOAD"),
    quoteRouteAvailable: present(evidence.quote.value),
    actionTransactionNonEmpty:
      Array.isArray(evidence.action.value) && evidence.action.value.length > 0,
    simulateCoversAllActions:
      coverage?.expectedTransactions === coverage?.observedResults,
    transactionIdentityMatched:
      coverage?.missingTransactionIndexes.length === 0 &&
      coverage?.unmatchedResultIndexes.length === 0,
    simulationNotHalted: coverage?.halted !== true,
    coverageComplete: coverage?.complete === true,
    noUnmatchedResult: coverage?.unmatchedResultIndexes.length === 0,
    noMissingTransaction: coverage?.missingTransactionIndexes.length === 0,
    notReverted: evidence.executionStatus !== "REVERTED",
    receiptPresent: present(evidence.receipt.value),
    outcomeParsed: present(evidence.outcome.value),
    flipOrderUpdatedNotBlocking: !JSON.stringify(
      evidence.warnings.value ?? [],
    ).includes("FlipOrderUpdated"),
    warningsEmpty:
      Array.isArray(evidence.warnings.value) &&
      evidence.warnings.value.length === 0,
    assetChangesExplained:
      evidence.assetChangeAssessment === "EXPLAINED" ||
      evidence.assetChangeAssessment === "NOT_APPLICABLE",
    runtimeProvenanceComplete:
      evidence.runtimeVersion === declared.runtimeVersion &&
      evidence.runtimeRevision === declared.runtimeRevision,
    blockProvenanceComplete: isBlockNumber(evidence.blockNumber.value),
    isReplayFalse: evidence.isReplay === false,
    isMockFalse: evidence.isMock === false,
    simulatorPinnedBlockComplete:
      isBlockNumber(result.simulatorPinnedBlock) &&
      evidence.simulatorPinnedBlock === result.simulatorPinnedBlock,
    executionSucceeded: evidence.executionStatus === "SUCCESS",
  };
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function isBlockNumber(value: unknown): boolean {
  return typeof value === "string" && /^\d+$/.test(value);
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

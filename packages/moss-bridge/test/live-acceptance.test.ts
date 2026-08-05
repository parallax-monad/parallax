import { describe, expect, it } from "vitest";
import {
  evaluateLiveAcceptance,
  type LiveAcceptanceResult,
  liveSuccessOf,
  p0DecisionCandidate,
} from "../src/index.js";

const DECLARED = { runtimeVersion: "0.1.0", runtimeRevision: "d09b38c" };

/** A run whose acceptance gate passes completely. */
function passingResult(): LiveAcceptanceResult {
  return {
    observedChainId: 143,
    stages: [
      { stage: "DISCOVER", success: true },
      { stage: "LOAD", success: true },
      { stage: "QUOTE", success: true },
      { stage: "ACTION", success: true },
      { stage: "SIMULATE", success: true },
    ],
    simulatorPinnedBlock: "92820000",
    evidence: {
      quote: { value: { estimatedAmountOut: "1" } },
      action: { value: [{ method: "swap" }] },
      simulationCoverage: {
        value: {
          expectedTransactions: 1,
          observedResults: 1,
          unmatchedResultIndexes: [],
          missingTransactionIndexes: [],
          halted: false,
          complete: true,
        },
      },
      receipt: { value: { status: "success" } },
      outcome: { value: { amountReceivedAtomic: "1" } },
      warnings: { value: [] },
      assetChangeAssessment: "NOT_APPLICABLE",
      blockNumber: { value: "92820000" },
      isReplay: false,
      isMock: false,
      simulatorPinnedBlock: "92820000",
      executionStatus: "SUCCESS",
      integrationStatus: "OK",
      runtimeVersion: DECLARED.runtimeVersion,
      runtimeRevision: DECLARED.runtimeRevision,
    },
  };
}

describe("live acceptance gate", () => {
  it("reports P0_LIVE_READY only when the full gate passes", () => {
    const result = passingResult();
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(liveSuccessOf(acceptance)).toBe(true);
    expect(p0DecisionCandidate(result, DECLARED)).toBe("P0_LIVE_READY");
  });

  it("fails liveSuccess when a receipt is absent despite SUCCESS coverage", () => {
    const result = passingResult();
    result.evidence.receipt = { value: null };
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.receiptPresent).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
    expect(p0DecisionCandidate(result, DECLARED)).not.toBe("P0_LIVE_READY");
  });

  it("fails liveSuccess when runtime provenance is missing despite SUCCESS", () => {
    const result = passingResult();
    result.evidence.runtimeRevision = undefined;
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.runtimeProvenanceComplete).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
    expect(p0DecisionCandidate(result, DECLARED)).not.toBe("P0_LIVE_READY");
  });

  it("fails liveSuccess when the simulator pinned block is unavailable", () => {
    const result = passingResult();
    result.simulatorPinnedBlock = undefined;
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.simulatorPinnedBlockComplete).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
  });

  it("fails liveSuccess when Evidence and API pinned blocks disagree", () => {
    const result = passingResult();
    result.evidence.simulatorPinnedBlock = "92820001";
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.simulatorPinnedBlockComplete).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
  });

  it("fails liveSuccess when the RPC is on the wrong chain", () => {
    const result = passingResult() as LiveAcceptanceResult & {
      observedChainId: number;
    };
    result.observedChainId = 1;
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.chainIdCorrect).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
    expect(p0DecisionCandidate(result, DECLARED)).not.toBe("P0_LIVE_READY");
  });

  it("fails liveSuccess when asset changes are not explained", () => {
    const result = passingResult();
    result.evidence.assetChangeAssessment = "UNKNOWN";
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.assetChangesExplained).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
  });

  it("keeps an outcome-parsing failure from being P0-ready", () => {
    const result = passingResult();
    result.evidence.outcome = { value: null };
    expect(liveSuccessOf(evaluateLiveAcceptance(result, DECLARED))).toBe(false);
    expect(p0DecisionCandidate(result, DECLARED)).not.toBe("P0_LIVE_READY");
  });

  it("classifies a halted FlipOrderUpdated simulation as simulation-blocked", () => {
    const result = passingResult();
    result.evidence.simulationCoverage = {
      value: {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        missingTransactionIndexes: [],
        halted: true,
        complete: false,
      },
    };
    result.evidence.receipt = { value: null };
    result.evidence.outcome = { value: null };
    result.evidence.executionStatus = "UNKNOWN";
    result.evidence.warnings = {
      value: [{ code: "RECEIPT_FAILED", message: "FlipOrderUpdated" }],
    };
    const acceptance = evaluateLiveAcceptance(result, DECLARED);
    expect(acceptance.simulationNotHalted).toBe(false);
    expect(liveSuccessOf(acceptance)).toBe(false);
    expect(p0DecisionCandidate(result, DECLARED)).toBe(
      "P0_LIVE_BLOCKED_SIMULATION",
    );
  });

  it("classifies an explicit UNAVAILABLE stage as portable-runtime blocked", () => {
    const result = passingResult();
    result.stages = [
      { stage: "DISCOVER", success: true },
      {
        stage: "SIMULATE",
        success: false,
        error: { code: "UNAVAILABLE" },
      },
    ];
    result.evidence.executionStatus = "UNKNOWN";
    expect(p0DecisionCandidate(result, DECLARED)).toBe(
      "P0_LIVE_BLOCKED_PORTABLE_RUNTIME",
    );
  });

  it("classifies a TIMEOUT stage as simulation-blocked, never READY", () => {
    const result = passingResult();
    result.stages = [
      { stage: "DISCOVER", success: true },
      {
        stage: "QUOTE",
        success: false,
        error: { code: "TIMEOUT" },
      },
    ];
    result.evidence.executionStatus = "UNKNOWN";
    expect(p0DecisionCandidate(result, DECLARED)).toBe(
      "P0_LIVE_BLOCKED_SIMULATION",
    );
  });
});

import {
  type NormalizedKuruEvidence,
  normalizeRecordedKuruEvidence,
} from "@parallax/moss-bridge";
import { describe, expect, it } from "vitest";
import { evaluateKuruEvidence } from "../src/index.js";

function sourced<T>(
  value: T | null,
  source: NormalizedKuruEvidence["quote"]["source"],
  reproducibility: NormalizedKuruEvidence["quote"]["reproducibility"] = "REPRODUCIBLE",
): NormalizedKuruEvidence["quote"] & { value: T | null } {
  return {
    value,
    source,
    reproducibility,
    blockNumber: "1",
  } as NormalizedKuruEvidence["quote"] & { value: T | null };
}

function evidence(
  overrides: Partial<NormalizedKuruEvidence> = {},
): NormalizedKuruEvidence {
  return {
    protocol: "kuru",
    intent: {
      chainId: "143",
      sender: "0xcccccccccccccccccccccccccccccccccccccccc",
      tokenIn: "MON",
      tokenOut: "USDC",
      amountIn: "1",
    },
    integrationStatus: "OK",
    executionStatus: "SUCCESS",
    quote: sourced({ estimatedAmountOut: "10" }, "quote"),
    action: sourced({}, "moss"),
    receipt: sourced({}, "moss"),
    outcome: sourced({}, "moss"),
    assetChanges: sourced([], "moss"),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: sourced([], "moss"),
    revertReason: sourced(null, "unknown"),
    gas: sourced(["1"], "moss"),
    simulationCoverage: {
      value: {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      source: "derived",
      reproducibility: "REPRODUCIBLE",
      blockNumber: "1",
    },
    errors: sourced([], "moss"),
    blockNumber: sourced("1", "rpc"),
    mossVersion: "test",
    mossCommit: "test",
    source: "moss",
    replayMode: false,
    approval: sourced("NOT_APPLICABLE", "derived"),
    walletAffordabilityChecked: false,
    limitations: [],
    ...overrides,
  };
}

describe("deterministic Kuru decisions", () => {
  it("does not turn integration errors into protocol risk", () => {
    expect(
      evaluateKuruEvidence(evidence({ integrationStatus: "INTEGRATION_ERROR" }))
        .verdict,
    ).toBe("UNKNOWN");
  });

  it("returns proceed for complete successful evidence without an economic boundary", () => {
    const result = evaluateKuruEvidence(evidence());
    expect(result.economicBoundary).toBe("NOT_APPLICABLE");
    expect(result.verdict).toBe("PROCEED");
    expect(result.reasons).toEqual([
      "No blocking evidence was found within the checked scope.",
    ]);
  });

  it("returns proceed only with an explicit passing boundary", () => {
    expect(
      evaluateKuruEvidence(
        evidence({
          intent: {
            ...evidence().intent,
            minimumReceived: "9",
            minimumReceivedSource: "user_declared",
          },
        }),
      ).verdict,
    ).toBe("PROCEED");
  });

  it("maps no route to stop", () => {
    expect(
      evaluateKuruEvidence(evidence({ executionStatus: "NO_ROUTE" })).verdict,
    ).toBe("STOP");
  });

  it("maps structured quote no-route evidence to stop", () => {
    const normalized = normalizeRecordedKuruEvidence({
      intent: evidence().intent,
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
        errors: { quote: "no verified Kuru market path" },
      },
      blockNumber: "1",
      mossVersion: "test",
    });
    expect(normalized.executionStatus).toBe("NO_ROUTE");
    expect(evaluateKuruEvidence(normalized).verdict).toBe("STOP");
  });

  it("does not guess that a generic revert means an insufficient balance", () => {
    const result = evaluateKuruEvidence(
      evidence({ executionStatus: "REVERTED" }),
    );
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.actions).toEqual([]);
  });

  it("returns unknown when critical evidence is missing", () => {
    expect(
      evaluateKuruEvidence(
        evidence({
          receipt: sourced(null, "unknown"),
          intent: {
            ...evidence().intent,
            minimumReceived: "9",
            minimumReceivedSource: "user_declared",
          },
        }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("keeps decode-revert-data integration failures unknown", () => {
    const normalized = normalizeRecordedKuruEvidence({
      intent: evidence().intent,
      raw: {
        discover: null,
        load: null,
        quote: null,
        action: null,
        simulation: null,
        errors: { simulate: "failed to decode revert data" },
      },
      blockNumber: "1",
      mossVersion: "test",
    });
    expect(normalized.integrationStatus).toBe("INTEGRATION_ERROR");
    expect(evaluateKuruEvidence(normalized).verdict).toBe("UNKNOWN");
  });

  it("returns adjust when a supplied boundary is not met", () => {
    const result = evaluateKuruEvidence(
      evidence({
        intent: {
          ...evidence().intent,
          minimumReceived: "11",
          minimumReceivedSource: "user_declared",
        },
      }),
    );
    expect(result.verdict).toBe("ADJUST");
    expect(result.actions).toEqual([
      "Adjust amount, route, or protocol, then re-run the check.",
    ]);
    expect(result.actions.join(" ").toLowerCase()).not.toMatch(
      /acceptance boundary|lower minimum|minimumreceived/,
    );
  });

  it("returns unknown when a supplied boundary cannot be evaluated", () => {
    const result = evaluateKuruEvidence(
      evidence({
        quote: sourced({ estimatedAmountOut: "not-a-decimal" }, "quote"),
        intent: {
          ...evidence().intent,
          minimumReceived: "9",
          minimumReceivedSource: "user_declared",
        },
      }),
    );
    expect(result.economicBoundary).toBe("UNKNOWN");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("returns unknown for partial or halted simulation coverage", () => {
    const result = evaluateKuruEvidence(
      evidence({
        simulationCoverage: {
          value: {
            expectedTransactions: 2,
            observedResults: 1,
            unmatchedResultIndexes: [],
            halted: true,
            complete: false,
            missingTransactionIndexes: [1],
            haltReason: "execution halted",
          },
          source: "derived",
          reproducibility: "REPRODUCIBLE",
          blockNumber: "1",
        },
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails closed when simulation coverage is null", () => {
    const result = evaluateKuruEvidence(
      evidence({
        simulationCoverage: {
          value: null,
          source: "unknown",
          reproducibility: "UNKNOWN",
        },
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails closed when critical evidence source is unknown", () => {
    expect(
      evaluateKuruEvidence(
        evidence({ quote: sourced({ estimatedAmountOut: "10" }, "unknown") }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("fails closed when critical evidence reproducibility is unknown", () => {
    expect(
      evaluateKuruEvidence(
        evidence({
          quote: sourced({ estimatedAmountOut: "10" }, "quote", "UNKNOWN"),
        }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("does not proceed on mock-sourced critical evidence", () => {
    expect(
      evaluateKuruEvidence(
        evidence({ quote: sourced({ estimatedAmountOut: "10" }, "mock") }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("blocks completeness on non-empty unexplained asset changes", () => {
    const result = evaluateKuruEvidence(
      evidence({
        assetChanges: sourced([{ kind: "nativeTransfer" }], "moss"),
        assetChangeAssessment: "UNKNOWN",
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("blocks completeness on explicitly unexplained asset changes", () => {
    const result = evaluateKuruEvidence(
      evidence({
        assetChanges: sourced([{ kind: "nativeTransfer" }], "moss"),
        assetChangeAssessment: "UNEXPLAINED",
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("treats unavailable minimumReceived as not applicable", () => {
    const result = evaluateKuruEvidence(
      evidence({
        intent: {
          ...evidence().intent,
          minimumReceivedSource: "unavailable",
        },
      }),
    );
    expect(result.economicBoundary).toBe("NOT_APPLICABLE");
    expect(result.verdict).toBe("PROCEED");
  });

  it("treats original_swap minimumReceived as a real boundary", () => {
    expect(
      evaluateKuruEvidence(
        evidence({
          intent: {
            ...evidence().intent,
            minimumReceived: "11",
            minimumReceivedSource: "original_swap",
          },
        }),
      ).verdict,
    ).toBe("ADJUST");
  });

  it("only accepts demo_preset boundary in replay mode", () => {
    expect(
      evaluateKuruEvidence(
        evidence({
          replayMode: false,
          intent: {
            ...evidence().intent,
            minimumReceived: "9",
            minimumReceivedSource: "demo_preset",
          },
        }),
      ).verdict,
    ).toBe("UNKNOWN");
    expect(
      evaluateKuruEvidence(
        evidence({
          replayMode: true,
          intent: {
            ...evidence().intent,
            minimumReceived: "9",
            minimumReceivedSource: "demo_preset",
          },
        }),
      ).verdict,
    ).toBe("PROCEED");
  });

  it("returns unknown for inconsistent minimumReceived source states", () => {
    const invalidCases: Array<Partial<NormalizedKuruEvidence["intent"]>> = [
      { minimumReceived: "9" },
      { minimumReceived: "9", minimumReceivedSource: "unavailable" },
      { minimumReceivedSource: "user_declared" },
      { minimumReceivedSource: "original_swap" },
    ];
    for (const intent of invalidCases) {
      expect(
        evaluateKuruEvidence(
          evidence({
            intent: { ...evidence().intent, ...intent },
          }),
        ).verdict,
      ).toBe("UNKNOWN");
    }
  });
});

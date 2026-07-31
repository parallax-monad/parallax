import {
  type NormalizedKuruEvidence,
  normalizeRecordedKuruEvidence,
} from "@parallax/moss-bridge";
import { describe, expect, it } from "vitest";
import { evaluateKuruEvidence } from "../src/index.js";

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
    quote: { value: { estimatedAmountOut: "10" }, source: "quote" },
    action: { value: {}, source: "moss" },
    receipt: { value: {}, source: "moss" },
    outcome: { value: {}, source: "moss" },
    assetChanges: { value: [], source: "moss" },
    warnings: { value: [], source: "moss" },
    revertReason: { value: null, source: "unknown" },
    gas: { value: ["1"], source: "moss" },
    simulationCoverage: {
      value: {
        expectedTransactions: 1,
        observedResults: 1,
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      source: "derived",
    },
    errors: { value: [], source: "moss" },
    blockNumber: { value: "1", source: "rpc" },
    mossVersion: "test",
    source: "moss",
    replayMode: false,
    approval: { value: "NOT_APPLICABLE", source: "derived" },
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
        evidence({ intent: { ...evidence().intent, minimumReceived: "9" } }),
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
          receipt: { value: null, source: "unknown" },
          intent: { ...evidence().intent, minimumReceived: "9" },
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
      evidence({ intent: { ...evidence().intent, minimumReceived: "11" } }),
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
        quote: {
          value: { estimatedAmountOut: "not-a-decimal" },
          source: "quote",
        },
        intent: { ...evidence().intent, minimumReceived: "9" },
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
            halted: true,
            complete: false,
            missingTransactionIndexes: [1],
            haltReason: "execution halted",
          },
          source: "derived",
        },
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails closed when simulation coverage is null", () => {
    const result = evaluateKuruEvidence(
      evidence({ simulationCoverage: { value: null, source: "unknown" } }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });
});

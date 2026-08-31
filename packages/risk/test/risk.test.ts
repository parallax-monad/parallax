import type {
  EvidenceField,
  GenericEvidence,
  GenericProviderError,
  GenericSimulationCoverage,
  JsonValue,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { evaluateEvidence } from "../src/index.js";

const sender = "0xcccccccccccccccccccccccccccccccccccccccc";

function field<T>(
  value: T | null,
  source: EvidenceField<unknown>["source"] = "quote",
  reproducibility: EvidenceField<unknown>["reproducibility"] = "REPRODUCIBLE",
): EvidenceField<T> {
  return { value, source, reproducibility, blockNumber: "1" };
}

function evidence(overrides: Partial<GenericEvidence> = {}): GenericEvidence {
  return {
    status: "SUCCESS",
    intent: {
      chainId: 143,
      protocol: "kuru",
      sender,
      tokenIn: "MON",
      tokenOut: "USDC",
      amountIn: "1",
      minimumReceivedSource: "unavailable",
    },
    provider: {
      providerId: "moss-kuru",
      status: "OK",
      errors: field<GenericProviderError[]>([], "moss"),
    },
    execution: { status: "SUCCESS" },
    quote: field({ estimatedAmountOut: "10" }, "quote"),
    action: field<JsonValue[]>([], "moss"),
    receipt: field({}, "moss"),
    outcome: field({}, "moss"),
    assetChanges: field<JsonValue[]>([], "moss"),
    assetChangeAssessment: "NOT_APPLICABLE",
    warnings: field<JsonValue[]>([], "moss"),
    simulation: field<GenericSimulationCoverage>(
      {
        expectedTransactions: 1,
        observedResults: 1,
        unmatchedResultIndexes: [],
        halted: false,
        complete: true,
        missingTransactionIndexes: [],
      },
      "derived",
    ),
    blockNumber: field("1", "rpc"),
    capabilities: ["quote", "action", "simulate"],
    provenance: {
      replayMode: false,
      isReplay: false,
      isMock: false,
      source: "moss",
    },
    checkedScope: ["quote", "action", "simulation", "simulation-coverage"],
    unknownScope: [],
    providerData: {},
    ...overrides,
  };
}

function intent(overrides: Partial<GenericEvidence["intent"]> = {}) {
  return { ...evidence().intent, ...overrides };
}

describe("deterministic generic Risk decisions", () => {
  it("does not turn integration errors into protocol risk", () => {
    expect(
      evaluateEvidence(
        evidence({
          status: "FAILED",
          provider: { ...evidence().provider, status: "INTEGRATION_ERROR" },
        }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("returns proceed for complete successful evidence without an economic boundary", () => {
    const result = evaluateEvidence(evidence());
    expect(result.economicBoundary).toBe("NOT_APPLICABLE");
    expect(result.verdict).toBe("PROCEED");
    expect(result.reasons).toEqual([
      "No blocking evidence was found within the checked scope.",
    ]);
  });

  it("returns proceed only with an explicit passing boundary", () => {
    expect(
      evaluateEvidence(
        evidence({
          intent: intent({
            minimumReceived: "9",
            minimumReceivedSource: "user_declared",
          }),
        }),
      ).verdict,
    ).toBe("PROCEED");
  });

  it("maps no route to stop", () => {
    expect(
      evaluateEvidence(evidence({ execution: { status: "NO_ROUTE" } })).verdict,
    ).toBe("STOP");
  });

  it("does not guess that a generic revert means an insufficient balance", () => {
    const result = evaluateEvidence(
      evidence({ execution: { status: "REVERTED" } }),
    );
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.actions).toEqual([]);
  });

  it("returns unknown when critical evidence is missing", () => {
    expect(
      evaluateEvidence(
        evidence({
          receipt: field(null, "unknown"),
          intent: intent({
            minimumReceived: "9",
            minimumReceivedSource: "user_declared",
          }),
        }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("keeps provider integration failures unknown", () => {
    const result = evaluateEvidence(
      evidence({
        status: "FAILED",
        provider: {
          ...evidence().provider,
          status: "INTEGRATION_ERROR",
          failure: {
            stage: "SIMULATE",
            code: "INTEGRATION_ERROR",
            message: "failed to decode revert data",
            integrationStatus: "INTEGRATION_ERROR",
            source: "moss",
            normalization: "PRESERVED",
          },
        },
      }),
    );
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("returns adjust when a supplied boundary is not met", () => {
    const result = evaluateEvidence(
      evidence({
        intent: intent({
          minimumReceived: "11",
          minimumReceivedSource: "user_declared",
        }),
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
    const result = evaluateEvidence(
      evidence({
        quote: field({ estimatedAmountOut: "not-a-decimal" }, "quote"),
        intent: intent({
          minimumReceived: "9",
          minimumReceivedSource: "user_declared",
        }),
      }),
    );
    expect(result.economicBoundary).toBe("UNKNOWN");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("returns unknown for partial or halted simulation coverage", () => {
    const result = evaluateEvidence(
      evidence({
        simulation: field<GenericSimulationCoverage>(
          {
            expectedTransactions: 2,
            observedResults: 1,
            unmatchedResultIndexes: [],
            halted: true,
            complete: false,
            missingTransactionIndexes: [1],
            haltReason: "execution halted",
          },
          "derived",
        ),
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails closed when simulation coverage is null", () => {
    const result = evaluateEvidence(
      evidence({
        simulation: {
          value: null,
          source: "unknown",
          reproducibility: "UNKNOWN",
        },
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails closed when empty warnings have unknown source", () => {
    const result = evaluateEvidence(
      evidence({ warnings: field([], "unknown") }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails closed when empty warnings have unknown reproducibility", () => {
    const result = evaluateEvidence(
      evidence({ warnings: field([], "moss", "UNKNOWN") }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("does not proceed on mock-sourced empty warnings", () => {
    const result = evaluateEvidence(evidence({ warnings: field([], "mock") }));
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("allows empty trusted reproducible warnings to pass provenance", () => {
    const result = evaluateEvidence(evidence({ warnings: field([], "moss") }));
    expect(result.evidenceCompleteness).toBe("COMPLETE");
    expect(result.verdict).toBe("PROCEED");
  });

  it("fails closed when critical evidence source is unknown", () => {
    expect(
      evaluateEvidence(
        evidence({ quote: field({ estimatedAmountOut: "10" }, "unknown") }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("fails closed when critical evidence reproducibility is unknown", () => {
    expect(
      evaluateEvidence(
        evidence({
          quote: field({ estimatedAmountOut: "10" }, "quote", "UNKNOWN"),
        }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("does not proceed on mock-sourced critical evidence", () => {
    expect(
      evaluateEvidence(
        evidence({ quote: field({ estimatedAmountOut: "10" }, "mock") }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("blocks completeness on non-empty unexplained asset changes", () => {
    const result = evaluateEvidence(
      evidence({
        assetChanges: field([{ kind: "nativeTransfer" }], "moss"),
        assetChangeAssessment: "UNKNOWN",
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("blocks completeness on explicitly unexplained asset changes", () => {
    const result = evaluateEvidence(
      evidence({
        assetChanges: field([{ kind: "nativeTransfer" }], "moss"),
        assetChangeAssessment: "UNEXPLAINED",
      }),
    );
    expect(result.evidenceCompleteness).toBe("MISSING");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("treats unavailable minimumReceived as not applicable", () => {
    const result = evaluateEvidence(
      evidence({
        intent: intent({ minimumReceivedSource: "unavailable" }),
      }),
    );
    expect(result.economicBoundary).toBe("NOT_APPLICABLE");
    expect(result.verdict).toBe("PROCEED");
  });

  it("treats original_swap minimumReceived as a real boundary", () => {
    expect(
      evaluateEvidence(
        evidence({
          intent: intent({
            minimumReceived: "11",
            minimumReceivedSource: "original_swap",
          }),
        }),
      ).verdict,
    ).toBe("ADJUST");
  });

  it("only accepts demo_preset boundary in replay mode", () => {
    expect(
      evaluateEvidence(
        evidence({
          provenance: { ...evidence().provenance, replayMode: false },
          intent: intent({
            minimumReceived: "9",
            minimumReceivedSource: "demo_preset",
          }),
        }),
      ).verdict,
    ).toBe("UNKNOWN");
    expect(
      evaluateEvidence(
        evidence({
          provenance: { ...evidence().provenance, replayMode: true },
          intent: intent({
            minimumReceived: "9",
            minimumReceivedSource: "demo_preset",
          }),
        }),
      ).verdict,
    ).toBe("PROCEED");
  });

  it("returns unknown for inconsistent minimumReceived source states", () => {
    const invalidCases: Array<Partial<GenericEvidence["intent"]>> = [
      { minimumReceived: "9" },
      { minimumReceived: "9", minimumReceivedSource: "unavailable" },
      { minimumReceivedSource: "user_declared" },
      { minimumReceivedSource: "original_swap" },
    ];
    for (const partial of invalidCases) {
      expect(
        evaluateEvidence(
          evidence({
            intent: intent(partial),
          }),
        ).verdict,
      ).toBe("UNKNOWN");
    }
  });
});

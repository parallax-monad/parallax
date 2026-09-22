import { describe, expect, it } from "vitest";
import { evaluateBackendGoldenPathAssertions } from "./backend-golden-path-assertions.js";

const completePath = {
  httpStatus: 200,
  runStatus: "completed" as const,
  persistedRunRoundTrip: true,
  baselineStatus: "AVAILABLE" as const,
  baselineIdentityMatches: true,
  providerEvidenceReachedP0Risk: true,
  providerExecutionVerified: true,
  selectedQuoteRemainsExpectationOnly: true,
  publicSurfaceSafe: true,
  evidenceState: "INCOMPLETE" as const,
  quoteFidelityStatus: "UNKNOWN" as const,
  quoteFidelityReason: "EVIDENCE_NOT_VERIFIED" as const,
  verdict: "UNKNOWN" as const,
  causeStatus: "NOT_VERIFIED" as const,
  unknownScope: ["receipt", "outcome", "assetChanges", "simulation"],
  remediationConfigured: false,
  remediationStatus: "NOT_RUN" as const,
  remediationHasChildRun: false,
};

describe("Backend Golden Path acceptance assertions", () => {
  it("accepts a completed path while recording expected fail-closed UNKNOWN", () => {
    const result = evaluateBackendGoldenPathAssertions(completePath);

    expect(result.integrationExercise).toBe("COMPLETE");
    expect(result.gateStatus).toBe("EXERCISE_COMPLETE_REVIEW_REQUIRED");
    expect(result.expectedFailClosedUnknown).toBe(true);
    expect(result.remediation).toEqual({
      configured: false,
      status: "NOT_RUN",
      childLifecycle: "NOT_RUN",
    });
  });

  it("does not call an incomplete public path a completed exercise", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      baselineIdentityMatches: false,
    });

    expect(result.integrationExercise).toBe("INCOMPLETE");
    expect(result.gateStatus).toBe("NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP");
    expect(result.expectedFailClosedUnknown).toBe(true);
  });

  it("requires a verified live provider handoff and expectation-only baseline", () => {
    const providerGap = evaluateBackendGoldenPathAssertions({
      ...completePath,
      providerExecutionVerified: false,
    });
    const constraintGap = evaluateBackendGoldenPathAssertions({
      ...completePath,
      selectedQuoteRemainsExpectationOnly: false,
    });

    expect(providerGap.integrationExercise).toBe("INCOMPLETE");
    expect(constraintGap.integrationExercise).toBe("INCOMPLETE");
  });

  it("does not classify a different UNKNOWN reason as the expected evidence gap", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      quoteFidelityReason: "MISSING_BASELINE",
    });

    expect(result.integrationExercise).toBe("COMPLETE");
    expect(result.expectedFailClosedUnknown).toBe(false);
  });

  it("derives child lifecycle from the observed remediation result", () => {
    const result = evaluateBackendGoldenPathAssertions({
      ...completePath,
      evidenceState: "VERIFIED",
      quoteFidelityStatus: "VERIFIED",
      quoteFidelityReason: undefined,
      verdict: "PROCEED",
      causeStatus: "NOT_VERIFIED",
      remediationConfigured: true,
      remediationStatus: "VERIFIED",
      remediationHasChildRun: true,
    });

    expect(result.expectedFailClosedUnknown).toBe(false);
    expect(result.remediation).toEqual({
      configured: true,
      status: "VERIFIED",
      childLifecycle: "VERIFIED",
    });
  });
});

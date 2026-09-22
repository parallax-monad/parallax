export type GoldenPathAssertionInput = {
  readonly httpStatus: number;
  readonly runStatus: "completed" | "failed" | "started" | undefined;
  readonly persistedRunRoundTrip: boolean;
  readonly baselineStatus: "AVAILABLE" | "MISSING" | undefined;
  readonly baselineIdentityMatches: boolean;
  readonly providerEvidenceReachedP0Risk: boolean;
  /** Provider execution must be a live, successful, scope-complete handoff. */
  readonly providerExecutionVerified: boolean;
  /** The selected quote is an expectation baseline, not an implicit constraint. */
  readonly selectedQuoteRemainsExpectationOnly: boolean;
  readonly publicSurfaceSafe: boolean;
  readonly evidenceState:
    | "VERIFIED"
    | "INCOMPLETE"
    | "UNAVAILABLE"
    | "STALE"
    | "UNVERIFIED"
    | undefined;
  readonly quoteFidelityStatus: "VERIFIED" | "UNKNOWN" | undefined;
  readonly quoteFidelityReason:
    | "MISSING_BASELINE"
    | "INCOMPATIBLE"
    | "INVALID_AMOUNT"
    | "EVIDENCE_NOT_VERIFIED"
    | undefined;
  readonly verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN" | undefined;
  readonly causeStatus: "NOT_VERIFIED" | undefined;
  readonly unknownScope: readonly string[];
  readonly remediationConfigured: boolean;
  readonly remediationStatus:
    | "NOT_RUN"
    | "UNVERIFIED"
    | "NO_VALID_CANDIDATE"
    | "UNKNOWN"
    | "VERIFIED"
    | undefined;
  readonly remediationHasChildRun: boolean;
};

export type GoldenPathAssertionResult = {
  readonly integrationExercise: "COMPLETE" | "INCOMPLETE";
  readonly gateStatus:
    | "EXERCISE_COMPLETE_REVIEW_REQUIRED"
    | "NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP";
  readonly expectedFailClosedUnknown: boolean;
  readonly remediation: {
    readonly configured: boolean;
    readonly status: GoldenPathAssertionInput["remediationStatus"];
    readonly childLifecycle:
      | "NOT_RUN"
      | "NOT_VERIFIED"
      | "VERIFIED"
      | "INVALID";
  };
};

/**
 * Separates the assembled-path exercise from the P0 decision outcome.
 *
 * A concrete Native RPC surface is intentionally partial. It can complete the
 * HTTP/pipeline path while Risk remains UNKNOWN because required Evidence is
 * missing or unsupported. That outcome is recorded as fail-closed; it is not
 * treated as an integration failure and it is not promoted to a P0 PASS.
 */
export function evaluateBackendGoldenPathAssertions(
  input: GoldenPathAssertionInput,
): GoldenPathAssertionResult {
  const integrationComplete =
    input.httpStatus === 200 &&
    input.runStatus === "completed" &&
    input.persistedRunRoundTrip &&
    input.baselineStatus === "AVAILABLE" &&
    input.baselineIdentityMatches &&
    input.providerEvidenceReachedP0Risk &&
    input.providerExecutionVerified &&
    input.selectedQuoteRemainsExpectationOnly &&
    input.publicSurfaceSafe;

  const expectedFailClosedUnknown =
    input.evidenceState !== undefined &&
    input.evidenceState !== "VERIFIED" &&
    input.unknownScope.length > 0 &&
    input.quoteFidelityStatus === "UNKNOWN" &&
    input.quoteFidelityReason === "EVIDENCE_NOT_VERIFIED" &&
    input.verdict === "UNKNOWN" &&
    input.causeStatus === "NOT_VERIFIED";

  const remediationChildLifecycle =
    input.remediationStatus === "VERIFIED"
      ? input.remediationHasChildRun
        ? "VERIFIED"
        : "INVALID"
      : input.remediationStatus === "NOT_RUN"
        ? "NOT_RUN"
        : "NOT_VERIFIED";

  return {
    integrationExercise: integrationComplete ? "COMPLETE" : "INCOMPLETE",
    gateStatus: integrationComplete
      ? "EXERCISE_COMPLETE_REVIEW_REQUIRED"
      : "NOT_PASS_INTEGRATION_OR_ACCEPTANCE_GAP",
    expectedFailClosedUnknown,
    remediation: {
      configured: input.remediationConfigured,
      status: input.remediationStatus,
      childLifecycle: remediationChildLifecycle,
    },
  };
}

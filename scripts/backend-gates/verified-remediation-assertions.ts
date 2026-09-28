/**
 * Pure feasibility classification for the Issue #107 Verified Remediation gate.
 *
 * The gate must be able to say, from recorded evidence alone, whether a real
 * live scenario actually reached `VERIFIED` — and if it did not, exactly which
 * frozen precondition stopped it. Nothing in this module may upgrade an
 * `UNKNOWN`, `INCOMPLETE`, `UNVERIFIED`, `NO_VALID_CANDIDATE`, or `NOT_RUN`
 * observation into a verified remediation. There is deliberately no override,
 * no caller-supplied verdict, and no "force" input: the only way to reach
 * `reachable: true` is the full conjunction of recorded proof facts.
 */

export const VERIFIED_REMEDIATION_BLOCKER_CODES = [
  "EVIDENCE_STATE_NOT_VERIFIED",
  "LIVE_PROVIDER_STATUS_NOT_SUCCESS",
  "REMEDIATION_BRANCH_NOT_ENTERED",
  "REMEDIATION_NOT_VERIFIED",
  "VERIFIED_WITHOUT_TERMINAL_CHILD_RUN",
  "CHILD_RECHECK_NOT_PROCEED",
  "TRANSACTION_PROTECTION_IS_ECONOMIC_BOUNDARY",
  "CHILD_SIMULATED_OUTPUT_UNAVAILABLE",
  "CONSTRAINT_ROUTE_NOT_SIZE_REMEDIABLE",
] as const;

export type VerifiedRemediationBlockerCode =
  (typeof VERIFIED_REMEDIATION_BLOCKER_CODES)[number];

export type VerifiedRemediationEvidenceState =
  | "VERIFIED"
  | "INCOMPLETE"
  | "UNAVAILABLE"
  | "STALE"
  | "UNVERIFIED"
  | undefined;

export type VerifiedRemediationStatus =
  | "NOT_RUN"
  | "UNVERIFIED"
  | "NO_VALID_CANDIDATE"
  | "UNKNOWN"
  | "VERIFIED"
  | undefined;

export type VerifiedRemediationObservation = {
  /** The gate supplied a bounded solver configuration for this Run. */
  readonly remediationConfigured: boolean;
  readonly evidenceState: VerifiedRemediationEvidenceState;
  /** `GenericEvidence.provider.status` observed for this Run. */
  readonly providerStatus: string | undefined;
  readonly verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN" | undefined;
  readonly transactionProtectionStatus:
    | "PASS"
    | "FAIL"
    | "UNKNOWN"
    | "NOT_APPLICABLE"
    | undefined;
  readonly callStatus:
    | "SUCCEEDED"
    | "REVERTED"
    | "UNAVAILABLE"
    | "NOT_RUN"
    | undefined;
  readonly unknownScope: readonly string[];
  readonly remediationStatus: VerifiedRemediationStatus;
  readonly remediationChildRunId: string | undefined;
  /** Child re-check Risk verdict, when a terminal child Run was produced. */
  readonly childRiskVerdict:
    | "PROCEED"
    | "ADJUST"
    | "STOP"
    | "UNKNOWN"
    | undefined;
  /**
   * HTTP status of the real live Run whose declared Economic Boundary is above
   * the current quote output. It is the boundary-FAIL probe: Transaction
   * Protection for a declared boundary is bound verbatim into the prepared
   * calldata, so that Run cannot complete successfully.
   */
  readonly boundaryAboveQuoteHttpStatus: number | undefined;
  readonly boundaryAboveQuoteRunStatus:
    | "completed"
    | "failed"
    | "started"
    | "integration_error"
    | undefined;
  /** Caller constraint evaluation path that may remediate a failed constraint. */
  readonly constraintRoute?:
    | "NOT_CONFIGURED"
    | "CONFIGURED_SIZE_IMPROVING"
    | "CONFIGURED_NOT_SIZE_IMPROVING";
};

export type VerifiedRemediationFeasibility = {
  readonly status: "VERIFIED" | "NOT_REACHABLE";
  readonly reachable: boolean;
  readonly childLifecycle: "NOT_RUN" | "NOT_VERIFIED" | "VERIFIED" | "INVALID";
  readonly blockers: readonly VerifiedRemediationBlockerCode[];
};

/**
 * Structural, code-referenced explanation of each blocker. These references are
 * reviewed alongside the live capture so a reader can trace every claim to the
 * frozen implementation instead of trusting a summary.
 */
export const VERIFIED_REMEDIATION_BLOCKER_REFERENCES: Readonly<
  Record<
    VerifiedRemediationBlockerCode,
    { readonly summary: string; readonly sources: readonly string[] }
  >
> = {
  EVIDENCE_STATE_NOT_VERIFIED: {
    summary:
      "The remediation branch only runs when the Run's provider-neutral EvidenceState is VERIFIED. A live Native RPC Run never reaches it: the mapper records a deliberately partial surface, so the derived state is INCOMPLETE and the branch is skipped before any candidate is quoted.",
    sources: [
      "apps/api/src/backend/arbitrum-composition.ts:evaluateArbitrumP0Decision",
      "apps/api/src/backend/p0-risk-integration.ts:backendEvidenceState",
    ],
  },
  LIVE_PROVIDER_STATUS_NOT_SUCCESS: {
    summary:
      "backendEvidenceState requires GenericEvidence.provider.status === SUCCESS. The merged live provider mappers cannot report that truthfully: a fully successful Native RPC result is mapped to UNKNOWN because no receipt, outcome, or asset-change evidence was observed, and the Tenderly mapper keeps outcome/assetChanges null and marks LIVE field provenance as external (which backendEvidenceState also rejects).",
    sources: [
      "apps/api/src/backend/native-rpc-evidence.ts:genericProviderStatus",
      "apps/api/src/backend/tenderly-evidence.ts:mapTenderlyProviderResult",
    ],
  },
  REMEDIATION_BRANCH_NOT_ENTERED: {
    summary:
      "A bounded solver configuration was supplied for the Run, yet no candidate was ever evaluated: the guard returned before solving, so the public remediation projection stays NOT_RUN rather than UNVERIFIED, NO_VALID_CANDIDATE, or VERIFIED.",
    sources: [
      "apps/api/src/backend/arbitrum-composition.ts:evaluateArbitrumP0Decision",
    ],
  },
  REMEDIATION_NOT_VERIFIED: {
    summary:
      "The Run's public remediation projection is UNVERIFIED, NO_VALID_CANDIDATE, UNKNOWN, or absent. A proposed, failed, or unknown candidate is not a verified remediation and must never be reported as one.",
    sources: [
      "apps/api/src/backend/arbitrum-composition.ts:projectRemediation",
      "packages/risk/src/p0-solver.ts:solveSelectedTargetOutput",
    ],
  },
  VERIFIED_WITHOUT_TERMINAL_CHILD_RUN: {
    summary:
      "A VERIFIED remediation projection requires the terminal child Run that carried the re-check. A claim without a child Run identity is invalid rather than verified.",
    sources: [
      "packages/risk/src/p0-solver.ts:validVerification",
      "apps/api/src/backend/arbitrum-composition.ts:persistChildRun",
    ],
  },
  CHILD_RECHECK_NOT_PROCEED: {
    summary:
      "The candidate proof is only accepted when the child re-check's own Risk verdict is PROCEED. A child whose verdict is STOP, ADJUST, or UNKNOWN cannot back a verified remediation.",
    sources: [
      "packages/risk/src/p0-diagnosis.ts:verificationBound",
      "apps/api/src/backend/arbitrum-composition.ts:childVerificationVerdict",
    ],
  },
  TRANSACTION_PROTECTION_IS_ECONOMIC_BOUNDARY: {
    summary:
      "A declared economic boundary is bound verbatim into the prepared calldata as amountOutMinimum. Therefore Economic Boundary FAIL implies a prepared transaction whose floor exceeds the quoted output, and the live Run terminates as an integration error instead of producing a completed ADJUST diagnosis. On the live Camelot path the Risk verdict ADJUST — the only verdict the frozen remediation objective targets — is unreachable.",
    sources: [
      "apps/api/src/backend/camelot-v3-protocol-adapter.ts:transactionProtection",
      "packages/risk/src/verdict.ts:evaluateEvidence",
    ],
  },
  CHILD_SIMULATED_OUTPUT_UNAVAILABLE: {
    summary:
      "Even with a VERIFIED evidence state, admitting a verified remediation requires the child Run's P0-ECONOMIC-001 to be PASS, which requires simulated tokenOut Evidence derived from evidence.outcome or evidence.assetChanges. No merged provider mapper produces those fields, so the proof cannot be assembled.",
    sources: [
      "apps/api/src/backend/arbitrum-composition.ts:candidateTransactionProtectionOutcome",
      "packages/orchestrator/agent-flow/index.ts:economicRuleResult",
      "packages/orchestrator/agent-flow/index.ts:extractSimulatedTokenOut",
    ],
  },
  CONSTRAINT_ROUTE_NOT_SIZE_REMEDIABLE: {
    summary:
      "The alternative child-verification route needs a real measured caller constraint that FAILs at the Run amountIn and PASSes at a larger candidate amountIn, because the frozen solver only searches upward. Every supported constraint metric degrades as size grows, and maxTotalCost has no reviewed derivation at all, so no legitimate measurement can satisfy it.",
    sources: [
      "packages/risk/src/p0-solver.ts:solveSelectedTargetOutput",
      "packages/risk/src/p0-diagnosis.ts:evaluateConstraints",
    ],
  },
};

function hasChildRunId(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Classifies a recorded live observation. `reachable: true` requires the full
 * conjunction of recorded proof facts; every missing fact is reported as an
 * explicit blocker instead of being folded into a softer status.
 */
export function evaluateVerifiedRemediationFeasibility(
  observation: VerifiedRemediationObservation,
): VerifiedRemediationFeasibility {
  const childLifecycle: VerifiedRemediationFeasibility["childLifecycle"] =
    observation.remediationStatus === "VERIFIED"
      ? hasChildRunId(observation.remediationChildRunId)
        ? "VERIFIED"
        : "INVALID"
      : observation.remediationStatus === "NOT_RUN"
        ? "NOT_RUN"
        : "NOT_VERIFIED";

  // A verified remediation is only ever the conjunction of an actually
  // verified parent Evidence state, an actually verified child re-check, and a
  // terminal child Run distinct from the parent. A `VERIFIED` projection
  // without those facts is invalid, never reachable.
  const reachable =
    observation.remediationStatus === "VERIFIED" &&
    hasChildRunId(observation.remediationChildRunId) &&
    observation.childRiskVerdict === "PROCEED" &&
    observation.evidenceState === "VERIFIED";

  if (reachable) {
    return {
      status: "VERIFIED",
      reachable: true,
      childLifecycle,
      blockers: [],
    };
  }

  const blockers = new Set<VerifiedRemediationBlockerCode>();
  if (observation.evidenceState !== "VERIFIED") {
    blockers.add("EVIDENCE_STATE_NOT_VERIFIED");
  }
  if (
    observation.providerStatus !== undefined &&
    observation.providerStatus !== "SUCCESS"
  ) {
    blockers.add("LIVE_PROVIDER_STATUS_NOT_SUCCESS");
  }
  if (observation.remediationStatus === "NOT_RUN") {
    if (observation.remediationConfigured) {
      blockers.add("REMEDIATION_BRANCH_NOT_ENTERED");
    }
  } else if (observation.remediationStatus !== "VERIFIED") {
    blockers.add("REMEDIATION_NOT_VERIFIED");
  } else {
    if (!hasChildRunId(observation.remediationChildRunId)) {
      blockers.add("VERIFIED_WITHOUT_TERMINAL_CHILD_RUN");
    }
    if (observation.childRiskVerdict !== "PROCEED") {
      blockers.add("CHILD_RECHECK_NOT_PROCEED");
    }
  }
  if (
    observation.boundaryAboveQuoteHttpStatus !== undefined &&
    (observation.boundaryAboveQuoteHttpStatus !== 200 ||
      observation.boundaryAboveQuoteRunStatus !== "completed")
  ) {
    blockers.add("TRANSACTION_PROTECTION_IS_ECONOMIC_BOUNDARY");
  }
  if (
    observation.callStatus === "SUCCEEDED" &&
    ["receipt", "outcome", "assetChanges"].every((scope) =>
      observation.unknownScope.includes(scope),
    )
  ) {
    blockers.add("CHILD_SIMULATED_OUTPUT_UNAVAILABLE");
  }
  if (
    observation.constraintRoute !== undefined &&
    observation.constraintRoute !== "CONFIGURED_SIZE_IMPROVING"
  ) {
    blockers.add("CONSTRAINT_ROUTE_NOT_SIZE_REMEDIABLE");
  }

  return {
    status: "NOT_REACHABLE",
    reachable: false,
    childLifecycle,
    blockers: VERIFIED_REMEDIATION_BLOCKER_CODES.filter((code) =>
      blockers.has(code),
    ),
  };
}

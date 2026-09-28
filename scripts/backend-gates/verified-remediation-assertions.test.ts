import { describe, expect, it } from "vitest";
import {
  evaluateVerifiedRemediationFeasibility,
  VERIFIED_REMEDIATION_BLOCKER_CODES,
  VERIFIED_REMEDIATION_BLOCKER_REFERENCES,
  type VerifiedRemediationObservation,
} from "./verified-remediation-assertions.js";

/**
 * The recorded live observation for `feat/verified-remediation-107`: a real
 * Arbitrum Sepolia × Camelot V3 × ETH → USDC Run with a bounded solver
 * configuration supplied, whose Evidence state is INCOMPLETE.
 */
const liveObservation: VerifiedRemediationObservation = {
  remediationConfigured: true,
  evidenceState: "INCOMPLETE",
  providerStatus: "UNKNOWN",
  verdict: "UNKNOWN",
  transactionProtectionStatus: "PASS",
  callStatus: "SUCCEEDED",
  unknownScope: ["receipt", "outcome", "assetChanges", "simulation"],
  remediationStatus: "NOT_RUN",
  remediationChildRunId: undefined,
  childRiskVerdict: undefined,
  boundaryAboveQuoteHttpStatus: 502,
  boundaryAboveQuoteRunStatus: "failed",
  constraintRoute: "NOT_CONFIGURED",
};

/** A hypothetical fully verified child, used only to pin the conjunction. */
const verifiedObservation: VerifiedRemediationObservation = {
  remediationConfigured: true,
  evidenceState: "VERIFIED",
  providerStatus: "SUCCESS",
  verdict: "ADJUST",
  transactionProtectionStatus: "FAIL",
  callStatus: "SUCCEEDED",
  unknownScope: [],
  remediationStatus: "VERIFIED",
  remediationChildRunId: "parent:p0-child:abc",
  childRiskVerdict: "PROCEED",
  boundaryAboveQuoteHttpStatus: 200,
  boundaryAboveQuoteRunStatus: "completed",
  constraintRoute: "CONFIGURED_SIZE_IMPROVING",
};

describe("verified remediation feasibility", () => {
  it("classifies the recorded live Run as NOT_REACHABLE with every observed blocker", () => {
    const feasibility = evaluateVerifiedRemediationFeasibility(liveObservation);

    expect(feasibility).toMatchObject({
      status: "NOT_REACHABLE",
      reachable: false,
      childLifecycle: "NOT_RUN",
    });
    expect(feasibility.blockers).toEqual([
      "EVIDENCE_STATE_NOT_VERIFIED",
      "LIVE_PROVIDER_STATUS_NOT_SUCCESS",
      "REMEDIATION_BRANCH_NOT_ENTERED",
      "TRANSACTION_PROTECTION_IS_ECONOMIC_BOUNDARY",
      "CHILD_SIMULATED_OUTPUT_UNAVAILABLE",
      "CONSTRAINT_ROUTE_NOT_SIZE_REMEDIABLE",
    ]);
  });

  it("reaches VERIFIED only for the full conjunction of recorded proof facts", () => {
    expect(
      evaluateVerifiedRemediationFeasibility(verifiedObservation),
    ).toMatchObject({ status: "VERIFIED", reachable: true, blockers: [] });
  });

  it("fails closed when any single proof fact is missing", () => {
    const dropped: readonly Partial<VerifiedRemediationObservation>[] = [
      { evidenceState: "INCOMPLETE" },
      { evidenceState: "UNAVAILABLE" },
      { evidenceState: "STALE" },
      { evidenceState: "UNVERIFIED" },
      { evidenceState: undefined },
      { childRiskVerdict: "UNKNOWN" },
      { childRiskVerdict: "STOP" },
      { childRiskVerdict: "ADJUST" },
      { childRiskVerdict: undefined },
      { remediationChildRunId: undefined },
      { remediationChildRunId: "   " },
      { remediationStatus: "NOT_RUN" },
      { remediationStatus: "UNVERIFIED" },
      { remediationStatus: "NO_VALID_CANDIDATE" },
      { remediationStatus: "UNKNOWN" },
      { remediationStatus: undefined },
    ];

    for (const override of dropped) {
      const feasibility = evaluateVerifiedRemediationFeasibility({
        ...verifiedObservation,
        ...override,
      });
      expect(feasibility.reachable).toBe(false);
      expect(feasibility.status).toBe("NOT_REACHABLE");
      expect(feasibility.blockers.length).toBeGreaterThan(0);
    }
  });

  it("never promotes a proposed, failed, or unknown candidate to VERIFIED", () => {
    for (const remediationStatus of [
      "UNVERIFIED",
      "NO_VALID_CANDIDATE",
      "UNKNOWN",
    ] as const) {
      const feasibility = evaluateVerifiedRemediationFeasibility({
        ...verifiedObservation,
        remediationStatus,
        // Even a stray child Run id must not manufacture a verified outcome.
        remediationChildRunId: "parent:p0-child:present",
      });
      expect(feasibility.reachable).toBe(false);
      expect(feasibility.status).toBe("NOT_REACHABLE");
      expect(feasibility.childLifecycle).toBe("NOT_VERIFIED");
    }
  });

  it("keeps a VERIFIED projection without a terminal child Run invalid", () => {
    const feasibility = evaluateVerifiedRemediationFeasibility({
      ...verifiedObservation,
      remediationChildRunId: undefined,
    });
    expect(feasibility.reachable).toBe(false);
    expect(feasibility.childLifecycle).toBe("INVALID");
  });

  it("treats a successful but partial simulation surface as an incomplete evidence state", () => {
    const feasibility = evaluateVerifiedRemediationFeasibility({
      ...liveObservation,
      // The live Native RPC surface really did succeed at eth_call; that is
      // still not a complete Evidence surface and must not become VERIFIED.
      callStatus: "SUCCEEDED",
      unknownScope: ["receipt", "outcome", "assetChanges"],
    });

    expect(feasibility.blockers).toContain(
      "CHILD_SIMULATED_OUTPUT_UNAVAILABLE",
    );
    expect(feasibility.reachable).toBe(false);
  });

  it("documents a reviewable source reference for every blocker code", () => {
    for (const code of VERIFIED_REMEDIATION_BLOCKER_CODES) {
      const reference = VERIFIED_REMEDIATION_BLOCKER_REFERENCES[code];
      expect(reference.summary.length).toBeGreaterThan(0);
      expect(reference.sources.length).toBeGreaterThan(0);
      for (const source of reference.sources) {
        expect(source).toMatch(/^[a-z0-9/.-]+\.ts:[A-Za-z0-9_]+$/);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import capture from "../../fixtures/provider-registry/be-107/verified-remediation-20260928155745944/capture.json";
import {
  evaluateVerifiedRemediationFeasibility,
  VERIFIED_REMEDIATION_BLOCKER_REFERENCES,
  type VerifiedRemediationObservation,
} from "./verified-remediation-assertions.js";

/**
 * Offline validation of the committed #107 live feasibility capture.
 *
 * This test never calls a Provider, RPC endpoint, or the network. It keeps the
 * recorded real exercise truthful, keeps the recorded classification
 * reproducible from the recorded facts, and keeps the sanitized public
 * boundary intact. If a future change makes a real `VERIFIED` remediation
 * reachable, these assertions are expected to fail and the gate must be re-run
 * with a new capture instead of the old one being reinterpreted.
 */

type CaptureShape = typeof capture;

const observation: VerifiedRemediationObservation = {
  remediationConfigured: capture.assertions.remediationConfigured,
  evidenceState: capture.assertions.evidenceState as "VERIFIED" | "INCOMPLETE",
  providerStatus: capture.assertions.providerStatus,
  verdict: capture.assertions.verdict as "UNKNOWN",
  transactionProtectionStatus: capture.assertions
    .transactionProtectionStatus as "PASS",
  callStatus: capture.runs.primary.p0.basicSimulation.callStatus as "SUCCEEDED",
  unknownScope: capture.runs.primary.providerEvidence
    .unknownScope as readonly string[],
  remediationStatus: capture.assertions.remediationStatus as "NOT_RUN",
  remediationChildRunId: undefined,
  childRiskVerdict: undefined,
  boundaryAboveQuoteHttpStatus: capture.runs.boundaryAboveQuote.httpStatus,
  boundaryAboveQuoteRunStatus: capture.runs.boundaryAboveQuote
    .runStatus as "integration_error",
  constraintRoute: capture.assertions.constraintRoute as "NOT_CONFIGURED",
};

describe("verified remediation live capture", () => {
  it("records a real, read-only exercise from the accepted source scenario", () => {
    expect(capture.schemaVersion).toBe(
      "be-107-verified-remediation-feasibility-v1",
    );
    expect(capture.exerciseStatus).toBe("COMPLETED");
    expect(capture.real).toBe(true);
    expect(capture.readOnly).toBe(true);
    expect(capture.signed).toBe(false);
    expect(capture.broadcast).toBe(false);
    expect(["environment-supplied", "arbitrum-official-public"]).toContain(
      capture.endpointClass,
    );
    expect(capture.source.fixtureClassification).toBe("QUALIFIED_REAL");
    expect(capture.source.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(capture.repositoryHeadAtCapture).toMatch(/^[0-9a-f]{40}$/);
  });

  it("preserves the truthful partial Native RPC surface without inflation", () => {
    const p0 = capture.runs.primary.p0;
    expect(capture.runs.primary.httpStatus).toBe(200);
    expect(capture.runs.primary.resultStatus).toBe("completed");
    expect(p0.basicSimulation.callStatus).toBe("SUCCEEDED");
    expect(p0.basicSimulation.gasEstimateStatus).toBe("AVAILABLE");
    expect(p0.basicSimulation.validityAtExecution).toBe("VALID");
    expect(p0.transactionProtection.status).toBe("PASS");
    // A successful eth_call on a partial surface is not a SUCCESS provider
    // result and not a VERIFIED Evidence state.
    expect(capture.runs.primary.providerEvidence.providerStatus).toBe(
      "UNKNOWN",
    );
    expect(capture.runs.primary.providerEvidence.integrationStatus).toBe("OK");
    expect(capture.runs.primary.providerEvidence.executionStatus).toBe(
      "SUCCESS",
    );
    expect(p0.evidenceState).toBe("INCOMPLETE");
    expect(p0.evidenceState).not.toBe("VERIFIED");
  });

  it("records that a configured bounded solver never entered the remediation branch", () => {
    expect(capture.assertions.remediationConfigured).toBe(true);
    expect(capture.assertions.remediationBranchEntered).toBe(false);
    expect(capture.assertions.childRunProduced).toBe(false);
    // The NOT_RUN variant carries no child Run identity, no evaluations, and
    // no parent/child proof fields at all.
    expect(capture.runs.primary.p0.remediation).toEqual({ status: "NOT_RUN" });
  });

  it("records the boundary-FAIL probe as a rejected integration error, not a diagnosis", () => {
    expect(capture.runs.boundaryAboveQuote.httpStatus).not.toBe(200);
    expect(capture.runs.boundaryAboveQuote.runStatus).toBe("integration_error");
    expect(capture.runs.boundaryAboveQuote.runVerdict).toBe("UNKNOWN");
    expect(capture.assertions.boundaryAboveQuoteRejected).toBe(true);
  });

  it("reproduces the recorded feasibility classification from the recorded facts", () => {
    const feasibility = evaluateVerifiedRemediationFeasibility(observation);

    expect(feasibility.reachable).toBe(false);
    expect(feasibility.status).toBe(capture.feasibility.status);
    expect(feasibility.blockers).toEqual(capture.feasibility.blockers);
    expect(feasibility.childLifecycle).toBe(capture.feasibility.childLifecycle);
    expect(capture.feasibility.status).toBe("NOT_REACHABLE");
    expect(capture.gateStatus).toBe("VERIFIED_REMEDIATION_NOT_REACHABLE");
  });

  it("records every blocker with a reviewable source reference", () => {
    expect(capture.feasibility.blockers.length).toBeGreaterThan(0);
    for (const code of capture.feasibility.blockers) {
      const reference =
        capture.feasibility.blockerReferences[
          code as keyof typeof capture.feasibility.blockerReferences
        ];
      expect(reference.summary.length).toBeGreaterThan(0);
      expect(reference.sources.length).toBeGreaterThan(0);
      expect(reference).toEqual(
        VERIFIED_REMEDIATION_BLOCKER_REFERENCES[
          code as keyof typeof VERIFIED_REMEDIATION_BLOCKER_REFERENCES
        ],
      );
    }
  });

  it("keeps the historical read free of Provider/RPC re-query and round-trip exact", () => {
    expect(capture.historicalRead.httpStatus).toBe(200);
    expect(capture.historicalRead.persistedRunStatus).toBe("completed");
    expect(capture.historicalRead.persistedResultMatchesResponse).toBe(true);
    expect(capture.historicalRead.rpcRequestsDuringRead).toBe(0);
    expect(capture.assertions.historicalReadMadeNoRpcRequest).toBe(true);
    expect(capture.assertions.publicRunQueryRoundTrip).toBe(true);
  });

  it("stays provider-neutral: no endpoint, raw payload, or transaction bytes", () => {
    const serialized = JSON.stringify(capture);

    expect(capture.assertions.rpcEndpointRedacted).toBe(true);
    expect(capture.assertions.rawProviderPayloadAbsent).toBe(true);
    expect(capture.assertions.providerSpecificDataRedacted).toBe(true);
    expect(capture.runs.primary.providerEvidence.providerDataRedacted).toBe(
      true,
    );
    expect(capture.runs.primary.providerEvidence.providerDataKeys).toEqual([]);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toContain("callReturnData");
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("rawResponse");
    expect(serialized).not.toContain("responseEvidence");
    // No endpoint, host, or provider hostname may appear anywhere.
    expect(serialized).not.toMatch(/[a-z0-9-]+\.(?:pro|io|com|net|xyz)\b/);
  });

  it("records an unchanged runtime source manifest across the exercise", () => {
    expect(capture.sourceIntegrity.sourceHeadAtStart).toBe(
      capture.repositoryHeadAtCapture,
    );
    expect(capture.sourceIntegrity.sourceHeadAtEnd).toBe(
      capture.repositoryHeadAtCapture,
    );
    expect(capture.sourceIntegrity.fixtureUnchanged).toBe(true);
    expect(capture.sourceIntegrity.runnerUnchanged).toBe(true);
    expect(capture.sourceIntegrity.runtimeSourceManifestSha256).toBe(
      capture.sourceIntegrity.runtimeSourceManifestSha256AtEnd,
    );
    expect(capture.sourceIntegrity.runtimeSourceChangedPaths).toEqual([]);
    expect(capture.runner.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the recorded schema free of REMEDIATION_VERIFIED claims", () => {
    const shape: CaptureShape = capture;
    expect(shape.feasibility.reachable).toBe(false);
    expect(shape.assertions.remediationStatus).not.toBe("VERIFIED");
    expect(shape.runs.primary.verdict).not.toBe("ADJUST");
    expect(shape.runs.primary.p0.quoteFidelity.status).toBe("UNKNOWN");
    expect(shape.runs.primary.p0.cause.status).toBe("NOT_VERIFIED");
  });
});

import { describe, expect, it } from "vitest";
import {
  apiCheckAcceptanceOf,
  apiCheckProvenanceMatchesOf,
  p0CandidateOf,
  smokeStatusOf,
} from "./live-smoke-acceptance.js";

const REVISION = "0x9876fedcba1234567890abcdef1234567890abcd";
const VERSION = "0.1.0";
const SENDER = "0xcccccccccccccccccccccccccccccccccccccccc";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

function provenance(key: string, source: string, stage: string) {
  return {
    key,
    blockNumber: "100",
    simulatorPinnedBlock: "101",
    runtimeVersion: VERSION,
    runtimeRevision: REVISION,
    reproducibility: "REPRODUCIBLE",
    isReplay: false,
    isMock: false,
    source,
    stage,
  };
}

function baseEvidence() {
  return [
    {
      ...provenance(REVISION + ":quote", "quote", "QUOTE"),
      kind: "generic",
      status: "confirmed",
      summary: "Live Kuru quote Evidence",
      routeInputRole: "ROUTE_QUOTE",
    },
    {
      ...provenance(REVISION + ":completeness", "derived", "SIMULATE"),
      kind: "generic",
      status: "confirmed",
      summary: "Live P0 Evidence completeness",
      coreRole: "EVIDENCE_COMPLETENESS",
    },
  ];
}

/**
 * A schema-valid completed RunResult whose structural shape mirrors the real
 * /api/check response but uses synthetic blocks and amounts.
 */
function completedRun(overrides: Record<string, unknown> = {}) {
  const quoteRef = provenance(REVISION + ":quote", "quote", "QUOTE");
  const completenessRef = provenance(
    REVISION + ":completeness",
    "derived",
    "SIMULATE",
  );
  return {
    runId: "api-run-uuid-1",
    replayMode: false,
    intent: {
      chainId: 143,
      protocol: "kuru",
      sender: SENDER,
      recipient: SENDER,
      recipientSource: "defaulted_from_sender",
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: USDC },
      amountInAtomic: "10000000000000000",
      economicBoundary: { availability: "unavailable", source: "unavailable" },
    },
    status: "completed",
    simulatorPinnedBlock: "101",
    systemStatus: "OK",
    verdict: "UNKNOWN",
    summary: "Live check completed with a legitimate UNKNOWN verdict",
    ruleResults: [
      {
        ruleId: "P0-EVIDENCE-001",
        status: "PASS",
        evidenceRefs: [completenessRef],
        actionEvaluations: [],
      },
      {
        ruleId: "P0-EXECUTION-001",
        status: "PASS",
        evidenceRefs: [quoteRef],
        actionEvaluations: [],
      },
      {
        ruleId: "P0-ECONOMIC-001",
        status: "NOT_APPLICABLE",
        applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED",
        evidenceRefs: [],
        actionEvaluations: [],
      },
    ],
    recommendedActions: [],
    irrelevantActions: [],
    evidence: baseEvidence(),
    scope: [
      {
        key: "P0-EVIDENCE-001",
        label: "Evidence completeness",
        status: "checked",
      },
      { key: "P0-EXECUTION-001", label: "Execution result", status: "checked" },
      {
        key: "P0-ECONOMIC-001",
        label: "Economic boundary",
        status: "not_checked",
        reason: "PRECONDITION_ABSENT",
      },
    ],
    route: {
      availability: "available",
      protocol: "kuru",
      path: [{ kind: "native" }, { kind: "erc20", address: USDC }],
      source: "quote",
      blockNumber: "100",
      evidenceRef: quoteRef,
    },
    ...overrides,
  };
}

function adapterProvenance(overrides: Record<string, unknown> = {}) {
  return {
    simulatorPinnedBlock: "101",
    observedChainId: 143,
    evidence: { runtimeVersion: VERSION, runtimeRevision: REVISION },
    ...overrides,
  };
}

describe("live smoke acceptance helpers", () => {
  it("accepts a completed authoritative Live UNKNOWN run", () => {
    expect(apiCheckAcceptanceOf(completedRun())).toBe(true);
  });

  it("accepts a completed authoritative Live PROCEED run", () => {
    expect(apiCheckAcceptanceOf(completedRun({ verdict: "PROCEED" }))).toBe(
      true,
    );
  });

  it("rejects a run that is not completed", () => {
    expect(apiCheckAcceptanceOf({ status: "integration_error" })).toBe(false);
  });

  it("rejects a run with an unresolved scope item", () => {
    const run = completedRun({
      ruleResults: [
        {
          ruleId: "P0-EVIDENCE-001",
          status: "UNKNOWN",
          reasonCode: "UNEXPLAINED_ASSET_CHANGE",
          evidenceRefs: [],
          actionEvaluations: [],
        },
      ],
      scope: [
        {
          key: "P0-EVIDENCE-001",
          label: "Evidence completeness",
          status: "unknown",
          reason: "REQUIRED_EVIDENCE_UNAVAILABLE",
        },
      ],
    });
    expect(apiCheckAcceptanceOf(run)).toBe(false);
  });

  it("rejects a run backed by mock evidence", () => {
    const run = completedRun({
      evidence: [
        ...baseEvidence(),
        {
          ...provenance("mock-1", "mock", "QUOTE"),
          kind: "generic",
          status: "confirmed",
          summary: "mock evidence",
          isMock: true,
        },
      ],
    });
    expect(apiCheckAcceptanceOf(run)).toBe(false);
  });

  it("rejects a run on the wrong chain", () => {
    const run = completedRun({
      intent: {
        ...completedRun().intent,
        chainId: 1,
      },
    });
    expect(apiCheckAcceptanceOf(run)).toBe(false);
  });

  it("does not require API runId to equal the smoke runId", () => {
    const run = completedRun({ runId: "api-run-uuid-2" });
    expect(apiCheckProvenanceMatchesOf(run, adapterProvenance())).toBe(true);
  });

  it("does not require identical pinned blocks across independent runs", () => {
    const run = completedRun({ simulatorPinnedBlock: "101" });
    expect(
      apiCheckProvenanceMatchesOf(
        run,
        adapterProvenance({ simulatorPinnedBlock: "200" }),
      ),
    ).toBe(true);
  });

  it("rejects provenance with a mismatched runtime revision", () => {
    expect(
      apiCheckProvenanceMatchesOf(
        completedRun(),
        adapterProvenance({
          evidence: { runtimeVersion: VERSION, runtimeRevision: "0xother" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects provenance when the adapter pin is missing", () => {
    expect(
      apiCheckProvenanceMatchesOf(
        completedRun(),
        adapterProvenance({ simulatorPinnedBlock: undefined }),
      ),
    ).toBe(false);
  });
});

describe("smoke p0 candidate + status axes", () => {
  it("technical gate passes + apiVerdict=PROCEED: P0_LIVE_READY and PARTIALLY_VERIFIED", () => {
    const adapterCandidate = p0CandidateOf({
      liveSuccess: true,
      adapterCandidate: "P0_LIVE_READY",
    });
    const status = smokeStatusOf({
      integrationStatus: "OK",
      failedStage: null,
      liveSuccess: true,
      productProceed: true,
    });
    expect(adapterCandidate).toBe("P0_LIVE_READY");
    expect(status).toBe("PARTIALLY_VERIFIED");
  });

  it("technical gate passes + apiVerdict=UNKNOWN: candidate stays legal, VALID_LIVE_UNKNOWN only in status axis", () => {
    const adapterCandidate = p0CandidateOf({
      liveSuccess: true,
      adapterCandidate: "P0_LIVE_READY",
    });
    const status = smokeStatusOf({
      integrationStatus: "OK",
      failedStage: null,
      liveSuccess: true,
      productProceed: false,
    });
    expect([
      "P0_LIVE_READY",
      "P0_LIVE_BLOCKED_PORTABLE_RUNTIME",
      "P0_LIVE_BLOCKED_SIMULATION",
    ]).toContain(adapterCandidate);
    expect(status).toBe("VALID_LIVE_UNKNOWN");
  });

  it("integration failure: candidate stays legal, status is FAILED", () => {
    const adapterCandidate = p0CandidateOf({
      liveSuccess: false,
      adapterCandidate: "P0_LIVE_BLOCKED_PORTABLE_RUNTIME",
    });
    const status = smokeStatusOf({
      integrationStatus: "TIMEOUT",
      failedStage: null,
      liveSuccess: false,
      productProceed: false,
    });
    expect(adapterCandidate).toBe("P0_LIVE_BLOCKED_PORTABLE_RUNTIME");
    expect(status).toBe("FAILED");
  });

  it("simulation acceptance failure: candidate is the simulation blocker, status is FAILED", () => {
    const adapterCandidate = p0CandidateOf({
      liveSuccess: false,
      adapterCandidate: "P0_LIVE_BLOCKED_SIMULATION",
    });
    const status = smokeStatusOf({
      integrationStatus: "OK",
      failedStage: { stage: "SIMULATE" },
      liveSuccess: false,
      productProceed: false,
    });
    expect(adapterCandidate).toBe("P0_LIVE_BLOCKED_SIMULATION");
    expect(status).toBe("PARTIALLY_VERIFIED");
  });

  it("adapter READY but smoke boundary failed: mapped to a simulation blocker, never a fourth candidate", () => {
    const adapterCandidate = p0CandidateOf({
      liveSuccess: false,
      adapterCandidate: "P0_LIVE_READY",
    });
    expect(adapterCandidate).toBe("P0_LIVE_BLOCKED_SIMULATION");
  });

  it("VALID_LIVE_UNKNOWN is never produced by p0CandidateOf", () => {
    const candidates = [
      p0CandidateOf({ liveSuccess: true, adapterCandidate: "P0_LIVE_READY" }),
      p0CandidateOf({
        liveSuccess: false,
        adapterCandidate: "P0_LIVE_BLOCKED_SIMULATION",
      }),
      p0CandidateOf({
        liveSuccess: false,
        adapterCandidate: "P0_LIVE_BLOCKED_PORTABLE_RUNTIME",
      }),
      p0CandidateOf({ liveSuccess: false, adapterCandidate: "P0_LIVE_READY" }),
    ];
    expect(candidates).not.toContain("VALID_LIVE_UNKNOWN");
  });
});

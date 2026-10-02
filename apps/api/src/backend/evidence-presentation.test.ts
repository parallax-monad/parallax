import {
  type FailedRunResult,
  genericEvidenceSchema,
  runResultSchema,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { projectEvidencePresentation } from "./evidence-presentation.js";
import type { TraceRpcEvidenceResult } from "./trace-rpc-evidence-source.js";

const observedAt = "2026-10-02T01:00:00.000Z";
const quoteTime = "2026-10-02T00:59:00.000Z";
const sender = `0x${"1".repeat(40)}`;
const token = `0x${"2".repeat(40)}`;

function result(): FailedRunResult {
  const field = (value: unknown) => ({
    value,
    source: "rpc",
    reproducibility: "REPRODUCIBLE",
    blockNumber: "42",
    fetchedAt: observedAt,
  });
  const run: FailedRunResult = {
    runId: "presentation-run",
    replayMode: false,
    intent: {
      chainId: 421614,
      protocol: "camelot-v3",
      sender,
      recipient: sender,
      recipientSource: "defaulted_from_sender",
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: token },
      amountInAtomic: "1",
      economicBoundary: { availability: "unavailable", source: "unavailable" },
    },
    status: "integration_error",
    systemStatus: "INTEGRATION_ERROR",
    verdict: "UNKNOWN",
    summary: "Partial observations",
    error: {
      code: "MOSS_UNAVAILABLE",
      stage: "simulation",
      message: "Unavailable",
      retryable: false,
    },
    ruleResults: [],
    recommendedActions: [],
    irrelevantActions: [],
    scope: [
      {
        key: "P0-CHECK-SIMULATION-001",
        label: "Simulation",
        status: "unknown",
        reason: "REQUIRED_EVIDENCE_UNAVAILABLE",
      },
    ],
    evidence: ["quote", "receipt"].map((name) => ({
      key: `live:${name}`,
      kind: "generic",
      status: name === "quote" ? "confirmed" : "unknown",
      summary: name,
      stage: name === "quote" ? "QUOTE" : "SIMULATE",
      source: "rpc",
      blockNumber: "42",
      reproducibility: "REPRODUCIBLE",
      isReplay: false,
      isMock: false,
    })),
    providerEvidence: genericEvidenceSchema.parse({
      intent: {
        chainId: 421614,
        protocol: "camelot-v3",
        sender,
        tokenIn: "native",
        tokenOut: token,
        amountIn: "1",
        minimumReceivedSource: "unavailable",
      },
      provider: {
        providerId: "not-used-for-inference",
        status: "UNKNOWN",
        integrationStatus: "OK",
        errors: field([]),
      },
      execution: { status: "UNKNOWN" },
      quote: { ...field({ estimatedAmountOut: "1" }), fetchedAt: quoteTime },
      action: field([]),
      receipt: field(null),
      outcome: field(null),
      assetChanges: field(null),
      assetChangeAssessment: "UNKNOWN",
      warnings: field([]),
      simulation: field(null),
      blockNumber: field("42"),
      capabilities: [],
      checkedScope: [],
      unknownScope: ["receipt"],
      provenance: { mode: "LIVE", source: "rpc", fetchedAt: observedAt },
      providerData: {},
    }),
    p0: {
      expectationBaseline: { status: "MISSING" },
      quoteFidelity: { status: "UNKNOWN", reason: "MISSING_BASELINE" },
      cause: { status: "NOT_VERIFIED" },
      constraints: [],
      evidenceState: "INCOMPLETE",
      transactionProtection: { status: "UNKNOWN", source: "unavailable" },
      remediation: { status: "NOT_RUN" },
      basicSimulation: {
        call: {
          status: "SUCCEEDED",
          returnDataFingerprint: `sha256:${"a".repeat(64)}`,
        },
        gasEstimate: { status: "UNAVAILABLE" },
        blockNumber: "42",
        observedAt,
        validityAtExecution: "UNKNOWN",
        preparedTransactionFingerprint: `sha256:${"b".repeat(64)}`,
        failureStage: "GAS_ESTIMATE",
        uncheckedCapabilities: ["receipt", "traces"],
      },
    },
  };
  return run;
}

function trace(): TraceRpcEvidenceResult {
  return {
    status: "unknown",
    source: {
      sourceId: "trace-rpc",
      sourceVersion: "trace-rpc-test",
      mode: "RECORDED_REPLAY",
      observedAt,
    },
    freshness: { status: "not_checked" },
    binding: {
      runId: "presentation-run",
      chainId: 421614,
      protocol: "camelot-v3",
      transactionFingerprint: `sha256:${"b".repeat(64)}`,
      blockContext: { blockNumber: "42", observedAt: quoteTime },
    },
    capabilities: {
      callTracer: { status: "unknown", reason: "timeout" },
      prestateTracerDiff: {
        status: "unavailable",
        reason: "method_unsupported",
      },
    },
    checkedScope: ["trace-rpc.chain", "trace-rpc.pinned-block"],
    unknownScope: ["trace-rpc.callTracer"],
    unavailableScope: ["trace-rpc.prestateTracer.diffMode"],
  };
}

describe("Backend Evidence presentation", () => {
  it("does not present mock or non-reproducible Evidence as checked", () => {
    const run = result();
    run.evidence[0].source = "mock";
    run.evidence[0].isMock = true;
    expect(projectEvidencePresentation(run).items[0]).toMatchObject({
      status: "unknown",
      mode: "MOCK",
    });
    run.evidence[0].source = "rpc";
    run.evidence[0].isMock = false;
    run.evidence[0].reproducibility = "NOT_REPRODUCIBLE";
    expect(projectEvidencePresentation(run).items[0].status).toBe("unknown");
  });

  it("preserves source replay mode without relabeling the live API Run as replay", () => {
    const run = result();
    if (!run.providerEvidence) throw new Error("missing fixture provider");
    run.providerEvidence.provenance.mode = "RECORDED_REPLAY";
    expect(projectEvidencePresentation(run).items[0].mode).toBe(
      "RECORDED_REPLAY",
    );
    expect(run.replayMode).toBe(false);
  });

  it("a reverted call is a checked failure observation, never a success verdict", () => {
    const run = result();
    if (!run.p0?.basicSimulation) throw new Error("missing fixture simulation");
    run.p0.basicSimulation.call = { status: "REVERTED" };
    expect(projectEvidencePresentation(run).capabilities[0].status).toBe(
      "checked",
    );
    expect(run.verdict).toBe("UNKNOWN");
  });
  it("uses field-specific acquisition time without changing decision evidence", () => {
    const run = result();
    const before = structuredClone(run);
    const view = projectEvidencePresentation(run);
    expect(view.items[0]).toMatchObject({
      evidenceKey: "live:quote",
      status: "checked",
      sourceCategory: "quote",
      observedAt: quoteTime,
    });
    expect(view.items[1]).toMatchObject({
      status: "unknown",
      reason: "evidence_unknown",
    });
    expect(view.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "native-rpc.eth_call",
          status: "checked",
          observedAt,
        }),
        expect.objectContaining({
          key: "native-rpc.estimateGas",
          status: "unavailable",
          reason: "rpc_unavailable",
        }),
        expect.objectContaining({
          key: "native-rpc.receipt",
          status: "not_checked",
          reason: "outside_baseline",
        }),
      ]),
    );
    expect(run).toEqual(before);
    expect(view.capabilities[0].blockContext?.status).toBe("requested");
    run.evidence[0].blockNumber = "43";
    expect(
      projectEvidencePresentation(run).items[0].observedAt,
    ).toBeUndefined();
  });

  it("does not infer timestamp or Native identity from missing/legacy fields", () => {
    const run = result();
    delete run.providerEvidence?.quote.fetchedAt;
    delete run.p0?.basicSimulation;
    expect(
      projectEvidencePresentation(run).items[0].observedAt,
    ).toBeUndefined();
    expect(projectEvidencePresentation(run).capabilities).toEqual([]);
    run.evidence[0].key = "unrelated:quote";
    expect(
      projectEvidencePresentation(run).items[0].observedAt,
    ).toBeUndefined();
    delete run.providerEvidence;
    expect(
      projectEvidencePresentation(run).items[0].observedAt,
    ).toBeUndefined();
  });

  it("does not attach observation time to a check that never ran", () => {
    const run = result();
    if (!run.p0?.basicSimulation) throw new Error("missing fixture simulation");
    run.p0.basicSimulation.call = { status: "NOT_RUN" };
    const call = projectEvidencePresentation(run).capabilities[0];
    expect(call.status).toBe("not_checked");
    expect(call.observedAt).toBeUndefined();
  });

  it("preserves Native timeout during block revalidation", () => {
    const run = result();
    if (!run.p0?.basicSimulation || !run.providerEvidence)
      throw new Error("missing fixture");
    run.p0.basicSimulation.failureStage = "BLOCK";
    run.providerEvidence.provider.failure = {
      code: "TIMEOUT",
      message: "RPC timed out",
      integrationStatus: "TIMEOUT",
      source: "rpc",
      normalization: "PRESERVED",
    };
    const view = projectEvidencePresentation(run);
    expect(
      view.capabilities.find((item) => item.key === "native-rpc.estimateGas"),
    ).toMatchObject({ status: "unavailable", reason: "timeout" });
    expect(run.p0.basicSimulation.failureStage).toBe("BLOCK");
    expect(run.verdict).toBe("UNKNOWN");
    delete run.providerEvidence.provider.failure;
    expect(
      projectEvidencePresentation(run).capabilities.find(
        (item) => item.key === "native-rpc.estimateGas",
      ),
    ).toMatchObject({ status: "unavailable", reason: "context_unverified" });
  });

  it("keeps Trace unknown/unavailable independent of Native and excludes raw extras", () => {
    const run = result();
    if (!run.providerEvidence) throw new Error("missing fixture provider");
    run.providerEvidence.providerData.traceRpc = JSON.parse(
      JSON.stringify({
        ...trace(),
        endpoint: "https://secret.invalid/private-key",
        raw: { storage: "private" },
      }),
    );
    const view = projectEvidencePresentation(run);
    expect(view.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "trace-rpc.callTracer",
          sourceCategory: "trace_rpc",
          status: "unknown",
          reason: "timeout",
          mode: "RECORDED_REPLAY",
          observedAt,
        }),
        expect.objectContaining({
          key: "trace-rpc.prestateTracer.diffMode",
          status: "unavailable",
          reason: "method_unsupported",
        }),
        expect.objectContaining({
          key: "native-rpc.eth_call",
          status: "checked",
          mode: "LIVE",
        }),
      ]),
    );
    expect(JSON.stringify(view)).not.toContain("private");
    expect(
      runResultSchema.parse({ ...run, evidencePresentation: view }).verdict,
    ).toBe("UNKNOWN");
  });

  it("omits malformed Trace rather than inventing capabilities", () => {
    const run = result();
    if (!run.providerEvidence) throw new Error("missing fixture provider");
    run.providerEvidence.providerData.traceRpc = {
      status: "success",
      endpoint: "private",
    };
    expect(
      projectEvidencePresentation(run).capabilities.every(
        (item) => item.sourceCategory !== "trace_rpc",
      ),
    ).toBe(true);
  });

  it.each([
    ["unknown", "timeout"],
    ["unavailable", "rpc_unavailable"],
    ["unknown", "context_unverified"],
  ] as const)(
    "preserves pinned-block context failure %s/%s",
    (status, reason) => {
      const run = result();
      if (!run.providerEvidence) throw new Error("missing fixture provider");
      const failure = { status, reason };
      const scopes = [
        "trace-rpc.pinned-block",
        "trace-rpc.callTracer",
        "trace-rpc.prestateTracer.diffMode",
      ];
      run.providerEvidence.providerData.traceRpc = JSON.parse(
        JSON.stringify({
          ...trace(),
          status: status === "unavailable" ? "unavailable" : "unknown",
          capabilities: { callTracer: failure, prestateTracerDiff: failure },
          checkedScope: ["trace-rpc.chain"],
          unknownScope: status === "unknown" ? scopes : [],
          unavailableScope: status === "unavailable" ? scopes : [],
        }),
      );
      const view = projectEvidencePresentation(run);
      expect(
        view.capabilities.find((item) => item.key === "trace-rpc.pinned-block"),
      ).toMatchObject({
        status,
        reason,
        blockContext: { status: "requested" },
      });
      expect(
        view.capabilities.find((item) => item.key === "trace-rpc.chain"),
      ).toMatchObject({ status: "checked" });
    },
  );

  it("preserves an initial chain timeout without inventing a block check", () => {
    const run = result();
    if (!run.providerEvidence) throw new Error("missing fixture provider");
    run.providerEvidence.providerData.traceRpc = JSON.parse(
      JSON.stringify({
        ...trace(),
        capabilities: {
          callTracer: { status: "unknown", reason: "timeout" },
          prestateTracerDiff: { status: "unknown", reason: "timeout" },
        },
        checkedScope: [],
        unknownScope: [
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unavailableScope: [],
      }),
    );
    const view = projectEvidencePresentation(run);
    expect(
      view.capabilities.find((item) => item.key === "trace-rpc.chain"),
    ).toMatchObject({ status: "unknown", reason: "timeout" });
    expect(
      view.capabilities.find((item) => item.key === "trace-rpc.pinned-block"),
    ).toMatchObject({ status: "unknown", reason: "not_recorded" });
  });

  it("does not copy matching tracer failures into checked context", () => {
    const run = result();
    if (!run.providerEvidence) throw new Error("missing fixture provider");
    run.providerEvidence.providerData.traceRpc = JSON.parse(
      JSON.stringify({
        ...trace(),
        capabilities: {
          callTracer: { status: "unknown", reason: "timeout" },
          prestateTracerDiff: { status: "unknown", reason: "timeout" },
        },
        unknownScope: [
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unavailableScope: [],
      }),
    );
    for (const item of projectEvidencePresentation(run).capabilities.filter(
      (item) =>
        item.key === "trace-rpc.chain" || item.key === "trace-rpc.pinned-block",
    )) {
      expect(item.status).toBe("checked");
      expect(item.reason).toBeUndefined();
    }
  });
});

import { describe, expect, it } from "vitest";
import type { TraceRpcEvidenceResult } from "./trace-rpc-evidence-source.js";
import { projectTraceRpcEvidence } from "./trace-rpc-public.js";

function evidence(): TraceRpcEvidenceResult {
  return {
    status: "success",
    source: {
      sourceId: "trace-rpc",
      sourceVersion: "trace-rpc-test",
      mode: "RECORDED_REPLAY",
      observedAt: "2026-09-28T00:00:00.000Z",
    },
    freshness: { status: "not_checked" },
    binding: {
      runId: "run-1",
      chainId: 421614,
      protocol: "camelot",
      transactionFingerprint:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      blockContext: { blockNumber: "123" },
    },
    capabilities: {
      callTracer: {
        status: "observed",
        executionStatus: "succeeded",
        gasUsed: "0x5208",
        output: "0x1234",
        resultFingerprint:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      },
      prestateTracerDiff: {
        status: "observed",
        diffMode: true,
        preAddressCount: 1,
        postAddressCount: 2,
        changedAddresses: ["0x1111111111111111111111111111111111111111"],
        resultFingerprint:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      },
    },
    checkedScope: [
      "trace-rpc.chain",
      "trace-rpc.pinned-block",
      "trace-rpc.callTracer",
      "trace-rpc.prestateTracer.diffMode",
    ],
    unknownScope: [],
    unavailableScope: [],
  };
}

describe("Trace RPC public projection", () => {
  it("preserves normalized failure reasons and omits raw call output", () => {
    const observed = projectTraceRpcEvidence(evidence());

    expect(observed).toMatchObject({
      capabilities: {
        callTracer: {
          status: "observed",
          executionStatus: "succeeded",
          gasUsed: "0x5208",
          resultFingerprint:
            "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        },
      },
    });
    expect(JSON.stringify(observed)).not.toContain("0x1234");

    const base = evidence();
    const failure: TraceRpcEvidenceResult = {
      ...base,
      status: "partial",
      capabilities: {
        ...base.capabilities,
        callTracer: {
          status: "unavailable",
          reason: "rpc_unavailable",
        },
      },
      checkedScope: [
        "trace-rpc.chain",
        "trace-rpc.pinned-block",
        "trace-rpc.prestateTracer.diffMode",
      ],
      unavailableScope: ["trace-rpc.callTracer"],
    };
    const projected = projectTraceRpcEvidence(failure);

    expect(projected).toMatchObject({
      capabilities: {
        callTracer: { status: "unavailable", reason: "rpc_unavailable" },
      },
    });
  });

  it("rejects an unnormalized failure diagnostic at the public boundary", () => {
    const base = evidence();
    const result = {
      ...base,
      capabilities: {
        ...base.capabilities,
        callTracer: {
          status: "unavailable",
          reason: "upstream endpoint diagnostic",
        },
      },
    } as unknown;

    expect(projectTraceRpcEvidence(result)).toBeUndefined();
  });

  it("rejects status and scope combinations that do not describe the capabilities", () => {
    const base = evidence();
    const inconsistent = {
      ...base,
      status: "partial",
      checkedScope: [
        "trace-rpc.chain",
        "trace-rpc.pinned-block",
        "trace-rpc.callTracer",
      ],
    } as unknown;

    expect(projectTraceRpcEvidence(inconsistent)).toBeUndefined();
  });

  it("rejects non-invalid evidence without a binding", () => {
    const unbound = evidence();
    delete (unbound as { binding?: unknown }).binding;

    expect(projectTraceRpcEvidence(unbound)).toBeUndefined();
  });

  it("rejects unknown scopes and non-canonical fingerprints", () => {
    const base = evidence();
    const unknownScope = {
      ...base,
      checkedScope: [...base.checkedScope, "trace-rpc.endpoint-diagnostic"],
    } as unknown;
    const malformedFingerprint = {
      ...base,
      binding: {
        ...base.binding,
        transactionFingerprint: "upstream error: fingerprint unavailable",
      },
    } as unknown;

    expect(projectTraceRpcEvidence(unknownScope)).toBeUndefined();
    expect(projectTraceRpcEvidence(malformedFingerprint)).toBeUndefined();
  });

  it("accepts a context failure with no observed checked scope", () => {
    const base = evidence();
    const contextFailure: TraceRpcEvidenceResult = {
      ...base,
      status: "unknown",
      capabilities: {
        callTracer: { status: "unknown", reason: "context_unverified" },
        prestateTracerDiff: {
          status: "unknown",
          reason: "context_unverified",
        },
      },
      checkedScope: [],
      unknownScope: [
        "trace-rpc.callTracer",
        "trace-rpc.prestateTracer.diffMode",
      ],
      unavailableScope: [],
    };

    expect(projectTraceRpcEvidence(contextFailure)).toMatchObject({
      status: "unknown",
      checkedScope: [],
      unknownScope: [
        "trace-rpc.callTracer",
        "trace-rpc.prestateTracer.diffMode",
      ],
    });
  });

  it("accepts a context failure after chain identity was observed", () => {
    const base = evidence();
    const contextFailure: TraceRpcEvidenceResult = {
      ...base,
      status: "unknown",
      capabilities: {
        callTracer: { status: "unknown", reason: "malformed_response" },
        prestateTracerDiff: {
          status: "unknown",
          reason: "malformed_response",
        },
      },
      checkedScope: ["trace-rpc.chain"],
      unknownScope: [
        "trace-rpc.pinned-block",
        "trace-rpc.callTracer",
        "trace-rpc.prestateTracer.diffMode",
      ],
      unavailableScope: [],
    };

    expect(projectTraceRpcEvidence(contextFailure)).toMatchObject({
      status: "unknown",
      checkedScope: ["trace-rpc.chain"],
      unknownScope: [
        "trace-rpc.pinned-block",
        "trace-rpc.callTracer",
        "trace-rpc.prestateTracer.diffMode",
      ],
    });
  });
});

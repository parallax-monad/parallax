import { describe, expect, test } from "vitest";
import { evidenceCoverage } from "./evidence-coverage";

const fingerprint = `sha256:${"a".repeat(64)}`;
const base = {
  runId: "run-92",
  intent: { chainId: 421614, protocol: "camelot-v3" },
  p0: {
    basicSimulation: {
      blockNumber: "313622358",
      observedAt: "2026-09-28T13:32:51.866Z",
      preparedTransactionFingerprint: fingerprint,
      uncheckedCapabilities: ["receipt", "outcome", "traces"],
    },
  },
  providerEvidence: {
    provider: { providerId: "native-rpc-arbitrum", status: "SUCCESS" },
    provenance: {
      mode: "LIVE",
      source: "rpc",
      fetchedAt: "2026-09-28T13:32:51.866Z",
      simulationBlock: "313622358",
    },
    checkedScope: ["native-rpc.eth_call", "native-rpc.estimateGas"],
    unknownScope: ["receipt", "outcome", "simulation"],
    providerData: {},
  },
};

const trace = {
  status: "success",
  source: {
    sourceId: "trace-rpc",
    sourceVersion: "trace-rpc-evidence-source-v1",
    mode: "LIVE",
    observedAt: "2026-09-28T13:32:55.832Z",
  },
  freshness: { status: "not_checked" },
  binding: {
    runId: "run-92",
    chainId: 421614,
    protocol: "camelot-v3",
    transactionFingerprint: fingerprint,
    blockContext: { blockNumber: "313622358" },
  },
  capabilities: {
    callTracer: { status: "observed" },
    prestateTracerDiff: { status: "observed" },
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

function withTrace(value: unknown) {
  return {
    ...base,
    providerEvidence: {
      ...base.providerEvidence,
      providerData: { traceRpc: value },
    },
  };
}

describe("public Evidence coverage projection", () => {
  test("keeps Native-only coverage distinct from unattempted capabilities", () => {
    const result = evidenceCoverage(base);
    expect(result.notice).toBeUndefined();
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceId: "native-rpc-arbitrum",
      role: "primary",
      blockNumber: "313622358",
      observedAt: "2026-09-28T13:32:51.866Z",
    });
    expect(result.sources[0].checked.map((item) => item.en)).toEqual([
      "Contract call",
      "Gas estimate",
    ]);
    expect(result.sources[0].notChecked.map((item) => item.en)).toEqual([
      "Transaction receipt",
      "Final outcome",
      "Execution trace",
    ]);
    expect(result.sources[0].unknown.map((item) => item.label.en)).toEqual([
      "Complete simulation",
    ]);
  });

  test("accepts same-transaction Trace as supplementary without carrying raw fields", () => {
    const result = evidenceCoverage(
      withTrace({ ...trace, rawPayload: "RAW_RPC_SECRET" }),
    );
    expect(result.sources).toHaveLength(2);
    expect(result.sources[1]).toMatchObject({
      sourceId: "trace-rpc",
      role: "supplementary",
      status: "success",
      blockNumber: "313622358",
      observedAt: "2026-09-28T13:32:55.832Z",
    });
    expect(result.sources[1].notChecked.map((item) => item.en)).toEqual([
      "Block freshness",
    ]);
    expect(JSON.stringify(result)).not.toContain("RAW_RPC_SECRET");
  });

  test("keeps partial Trace timeout unknown while preserving observed facts", () => {
    const result = evidenceCoverage(
      withTrace({
        ...trace,
        status: "partial",
        capabilities: {
          callTracer: { status: "unknown", reason: "timeout" },
          prestateTracerDiff: { status: "observed" },
        },
        checkedScope: [
          "trace-rpc.chain",
          "trace-rpc.pinned-block",
          "trace-rpc.prestateTracer.diffMode",
        ],
        unknownScope: ["trace-rpc.callTracer"],
      }),
    );
    expect(result.sources[0].checked).toHaveLength(2);
    expect(result.sources[1].checked.map((item) => item.en)).toContain(
      "State changes",
    );
    expect(result.sources[1].unknown[0]).toMatchObject({
      label: { en: "Execution trace" },
      reason: { en: "The check timed out" },
    });
  });

  test("distinguishes unsupported Trace from unknown Trace", () => {
    const unavailable = evidenceCoverage(
      withTrace({
        ...trace,
        status: "unavailable",
        capabilities: {
          callTracer: { status: "unavailable", reason: "method_unsupported" },
          prestateTracerDiff: {
            status: "unavailable",
            reason: "method_unsupported",
          },
        },
        checkedScope: ["trace-rpc.chain", "trace-rpc.pinned-block"],
        unavailableScope: [
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
      }),
    );
    expect(unavailable.sources[1].unknown).toEqual([]);
    expect(unavailable.sources[1].unavailable).toHaveLength(2);

    const unknown = evidenceCoverage(
      withTrace({
        ...trace,
        status: "unknown",
        capabilities: {
          callTracer: { status: "unknown", reason: "rpc_unavailable" },
          prestateTracerDiff: { status: "unknown", reason: "rpc_unavailable" },
        },
        checkedScope: ["trace-rpc.chain", "trace-rpc.pinned-block"],
        unknownScope: [
          "trace-rpc.callTracer",
          "trace-rpc.prestateTracer.diffMode",
        ],
      }),
    );
    expect(unknown.sources[1].unknown).toHaveLength(2);
    expect(unknown.sources[1].unavailable).toEqual([]);
  });

  test("fails closed on mismatched or malformed public Trace fields", () => {
    for (const value of [
      { ...trace, binding: { ...trace.binding, runId: "another-run" } },
      {
        ...trace,
        binding: { ...trace.binding, transactionFingerprint: "bad" },
      },
      { ...trace, capabilities: undefined },
      { ...trace, checkedScope: ["trace-rpc.callTracer", "raw.rpc.secret"] },
      { ...trace, status: "success", unknownScope: ["trace-rpc.callTracer"] },
    ]) {
      const result = evidenceCoverage(withTrace(value));
      expect(result.sources).toHaveLength(1);
      expect(result.notice).toBeDefined();
    }
  });

  test("shows an invalid Trace context as unknown without a verified block", () => {
    const result = evidenceCoverage(
      withTrace({
        ...trace,
        status: "invalid",
        binding: undefined,
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
      }),
    );
    expect(result.sources[1].status).toBe("invalid");
    expect(result.sources[1].checked).toEqual([]);
    expect(result.sources[1].blockNumber).toBeUndefined();
    expect(result.sources[1].unknown).toHaveLength(2);
  });

  test("does not turn a malformed primary source into checked Evidence", () => {
    const result = evidenceCoverage({
      ...base,
      providerEvidence: { ...base.providerEvidence, checkedScope: "all" },
    });
    expect(result.sources).toEqual([]);
    expect(result.notice).toBeDefined();
  });
});

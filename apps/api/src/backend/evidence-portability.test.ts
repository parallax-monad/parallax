import { describe, expect, it } from "vitest";
import canonicalCapture from "../../../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
import {
  compareEvidencePortability,
  EVIDENCE_PORTABILITY_FACTS,
  EvidencePortabilityError,
  type EvidencePortabilityRecord,
  fingerprintHexData,
  type PortabilityFactName,
} from "./evidence-portability.js";
import { createCanonicalNativeRpcEvaluationInput } from "./native-rpc-canonical-exercise.js";
import { NativeRpcClientError } from "./native-rpc-client.js";
import { NATIVE_RPC_CAPABILITIES } from "./native-rpc-evidence.js";
import { createNativeRpcProvider } from "./native-rpc-provider.js";
import {
  evaluateProviderAdapter,
  type ProviderEvaluationResult,
} from "./provider-adapter.js";
import {
  createTraceRpcEvidenceSource,
  type TraceRpcClient,
  type TraceRpcEvidenceResult,
} from "./trace-rpc-evidence-source.js";

const capture = canonicalCapture;
const TX = capture.observations.preparedSwap.tx;
const ROUTE = capture.observations.preparedSwap.route;
const BLOCK_TAG = capture.observations.pinnedBlock.number;
const BLOCK_HASH = capture.observations.pinnedBlock.hash;
const BLOCK_NUMBER = BigInt(BLOCK_TAG).toString();
const CALL_OUTPUT = capture.observations.preparedSwap.ethCall.result;
const NATIVE_GAS = capture.observations.preparedSwap.ethEstimateGas.result;
const TRACED_GAS = "0x3bed4";
const OTHER_ADDRESS = `0x${"44".repeat(20)}`;
const STORAGE_SENTINEL = "sentinel-raw-tracer-storage-value";
const RUN_ID = "run-91-unit";
const OBSERVED_AT = "2026-09-28T12:00:00.000Z";

const evaluation = createCanonicalNativeRpcEvaluationInput(capture, RUN_ID);

type NativeHandler = (method: string) => Promise<unknown>;
type TraceHandler = (
  method: string,
  params: readonly unknown[],
) => Promise<unknown>;

async function canonicalNativeHandler(method: string): Promise<unknown> {
  switch (method) {
    case "eth_chainId":
      return "0x66eee";
    case "eth_getBlockByNumber":
      return { number: BLOCK_TAG, hash: BLOCK_HASH };
    case "eth_call":
      return CALL_OUTPUT;
    case "eth_estimateGas":
      return NATIVE_GAS;
    case "eth_blockNumber":
      return `0x${(BigInt(BLOCK_NUMBER) + 25n).toString(16)}`;
    default:
      throw new Error(`Unexpected Native RPC method: ${method}`);
  }
}

async function canonicalTraceHandler(
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  if (method === "eth_chainId") return "0x66eee";
  if (method === "eth_getBlockByNumber") {
    return { number: BLOCK_TAG, hash: BLOCK_HASH };
  }
  if (method === "debug_traceCall") {
    const config = params[2] as { tracer?: string };
    if (config.tracer === "callTracer") {
      return {
        type: "CALL",
        from: TX.from,
        to: TX.to,
        input: TX.data,
        value: TX.value,
        gasUsed: TRACED_GAS,
        output: CALL_OUTPUT,
      };
    }
    return {
      pre: {
        [TX.from.toLowerCase()]: {
          balance: "0x1",
          storage: { "0x00": STORAGE_SENTINEL },
        },
      },
      post: {
        [ROUTE.pool]: { storage: { "0x00": STORAGE_SENTINEL } },
        [OTHER_ADDRESS]: { balance: "0x2" },
      },
    };
  }
  throw new Error(`Unexpected trace RPC method: ${method}`);
}

async function evaluateNative(
  handler: NativeHandler = canonicalNativeHandler,
): Promise<ProviderEvaluationResult> {
  const adapter = createNativeRpcProvider({
    mode: "LIVE",
    client: { request: (method) => handler(method) },
    now: () => OBSERVED_AT,
    checkFreshness: true,
    maxBlockLag: 0,
  });
  return evaluateProviderAdapter(adapter, evaluation);
}

async function evaluateTrace(
  handler: TraceHandler = canonicalTraceHandler,
): Promise<TraceRpcEvidenceResult> {
  const client: TraceRpcClient = {
    request: (method, params = []) => handler(method, params),
  };
  const source = createTraceRpcEvidenceSource({
    mode: "LIVE",
    client,
    now: () => OBSERVED_AT,
  });
  return source.evaluate(evaluation);
}

function fact(record: EvidencePortabilityRecord, name: PortabilityFactName) {
  const entry = record.facts.find((candidate) => candidate.fact === name);
  if (entry === undefined) throw new Error(`Missing portability fact: ${name}`);
  return entry;
}

describe("evidence portability comparison", () => {
  it("compares one prepared transaction context across the primary and supplementary sources", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();
    const record = compareEvidencePortability({
      nativeRpc,
      traceRpc,
      preparedExecution: evaluation.input,
    });

    expect(nativeRpc.status).toBe("stale");
    expect(traceRpc.status).toBe("success");
    expect(record.version).toBe("evidence-portability-v1");
    expect(record.facts.map((entry) => entry.fact)).toEqual([
      ...EVIDENCE_PORTABILITY_FACTS,
    ]);
    expect(record.binding).toEqual({
      runId: RUN_ID,
      chainId: 421614,
      protocol: "camelot-v3",
      preparedTransactionFingerprint: traceRpc.binding?.transactionFingerprint,
      preparedTransaction: {
        from: TX.from,
        to: TX.to,
        data: TX.data,
        value: TX.value,
      },
      blockContext: evaluation.input.blockContext,
    });

    const call = fact(record, "call");
    expect(call.nativeRpc).toEqual({
      state: "checked",
      detail: { returnDataFingerprint: fingerprintHexData(CALL_OUTPUT) },
    });
    expect(call.traceRpc.state).toBe("checked");
    expect(call.traceRpc.detail?.outputFingerprint).toBe(
      fingerprintHexData(CALL_OUTPUT),
    );
    expect(call.agreement).toBe("equal");

    const gas = fact(record, "gas");
    expect(gas.nativeRpc.detail?.gasUnits).toBe(BigInt(NATIVE_GAS).toString());
    expect(gas.nativeRpc.detail?.measurement).toBe("eth_estimateGas");
    expect(gas.traceRpc.detail?.gasUnits).toBe(BigInt(TRACED_GAS).toString());
    expect(gas.traceRpc.detail?.measurement).toBe(
      "debug_traceCall.callTracer.gasUsed",
    );
    // The two gas observations use different measurement semantics, so a
    // difference is recorded as a fact rather than failing the comparison.
    expect(gas.agreement).toBe("different");

    const trace = fact(record, "trace");
    expect(trace.nativeRpc).toEqual({
      state: "unavailable",
      reason: "capability_not_in_source_scope",
      detail: { capability: "traces", declaredUnchecked: true },
    });
    expect(trace.traceRpc.state).toBe("checked");
    expect(trace.traceRpc.detail?.executionStatus).toBe("succeeded");
    expect(trace.agreement).toBe("not_comparable");

    const stateDiff = fact(record, "stateDiff");
    expect(stateDiff.nativeRpc).toEqual({
      state: "unavailable",
      reason: "capability_not_in_source_scope",
      detail: { capability: "state-diff", declaredUnchecked: true },
    });
    expect(stateDiff.traceRpc.state).toBe("checked");
    expect(stateDiff.traceRpc.detail).toMatchObject({
      diffMode: true,
      preAddressCount: 1,
      postAddressCount: 2,
      changedAddressCount: 3,
    });
    expect(stateDiff.agreement).toBe("not_comparable");

    const block = fact(record, "block");
    expect(block.nativeRpc.detail?.blockNumber).toBe(BLOCK_NUMBER);
    expect(block.nativeRpc.detail?.blockHash).toBe(BLOCK_HASH);
    expect(block.traceRpc.detail?.blockNumber).toBe(BLOCK_NUMBER);
    expect(block.traceRpc.detail?.blockHash).toBe(BLOCK_HASH);
    expect(block.agreement).toBe("equal");

    const freshness = fact(record, "freshness");
    expect(freshness.nativeRpc.state).toBe("checked");
    expect(freshness.nativeRpc.detail?.freshnessStatus).toBe("stale");
    expect(freshness.traceRpc).toEqual({
      state: "unavailable",
      reason: "source_did_not_check_freshness",
      detail: { freshnessStatus: "not_checked" },
    });
    expect(freshness.agreement).toBe("not_comparable");

    const provenance = fact(record, "provenance");
    expect(provenance.nativeRpc.detail).toMatchObject({
      sourceId: "native-rpc-arbitrum",
      mode: "LIVE",
      observedAt: OBSERVED_AT,
    });
    expect(provenance.traceRpc.detail).toMatchObject({
      sourceId: "trace-rpc",
      mode: "LIVE",
      observedAt: OBSERVED_AT,
    });
    expect(provenance.agreement).toBe("not_comparable");

    expect(record.sources.nativeRpc.checkedScope).toEqual([
      "portability.call",
      "portability.gas",
      "portability.block",
      "portability.freshness",
      "portability.provenance",
    ]);
    expect(record.sources.nativeRpc.unavailableScope).toEqual([
      "portability.trace",
      "portability.stateDiff",
    ]);
    expect(record.sources.traceRpc.checkedScope).toEqual([
      "portability.call",
      "portability.gas",
      "portability.trace",
      "portability.stateDiff",
      "portability.block",
      "portability.provenance",
    ]);
    expect(record.sources.traceRpc.unavailableScope).toEqual([
      "portability.freshness",
    ]);
    expect(record.scope).toEqual({
      nativeRpcPrimaryBaseline: true,
      traceSupplementaryOnly: true,
      providerRanking: false,
      providerScoring: false,
      providerVoting: false,
      providerConsensus: false,
      automaticFallback: false,
      unsignedReadOnly: true,
    });
  });

  it("stays provider-neutral and free of ranking, scoring, or voting fields", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();
    const record = compareEvidencePortability({
      nativeRpc,
      traceRpc,
      preparedExecution: evaluation.input,
    });
    const serialized = JSON.stringify(record);

    // Raw tracer account/storage content stays behind the source boundary; only
    // counts and fingerprints cross into the shared record.
    expect(serialized).not.toContain(STORAGE_SENTINEL);
    expect(serialized).not.toContain(ROUTE.pool.toLowerCase());
    expect(Object.keys(record)).toEqual([
      "version",
      "binding",
      "sources",
      "facts",
      "scope",
    ]);

    for (const entry of record.facts) {
      expect(Object.keys(entry).sort()).toEqual([
        "agreement",
        "fact",
        "nativeRpc",
        "traceRpc",
      ]);
      expect(["equal", "different", "not_comparable"]).toContain(
        entry.agreement,
      );
      for (const side of [entry.nativeRpc, entry.traceRpc]) {
        expect(["checked", "unknown", "unavailable"]).toContain(side.state);
        expect(
          Object.keys(side).every((key) =>
            ["state", "reason", "detail"].includes(key),
          ),
        ).toBe(true);
      }
    }
  });

  it("keeps a missing supplementary capability UNKNOWN instead of padding it to parity", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace(async (method, params) => {
      const config = params[2] as { tracer?: string } | undefined;
      if (method === "debug_traceCall" && config?.tracer === "callTracer") {
        throw new NativeRpcClientError("RPC_ERROR", "invalid params", -32602);
      }
      return canonicalTraceHandler(method, params);
    });
    const record = compareEvidencePortability({
      nativeRpc,
      traceRpc,
      preparedExecution: evaluation.input,
    });

    expect(traceRpc.status).toBe("partial");
    expect(fact(record, "trace").traceRpc).toEqual({
      state: "unknown",
      reason: "invalid_parameters",
    });
    expect(fact(record, "call").traceRpc).toEqual({
      state: "unknown",
      reason: "invalid_parameters",
    });
    expect(record.sources.traceRpc.checkedScope).toEqual([
      "portability.stateDiff",
      "portability.block",
      "portability.provenance",
    ]);
    expect(record.sources.traceRpc.unknownScope).toEqual([
      "portability.call",
      "portability.gas",
      "portability.trace",
    ]);
    expect(record.sources.traceRpc.unavailableScope).toEqual([
      "portability.freshness",
    ]);
  });

  it("keeps a capability the endpoint provably cannot serve UNAVAILABLE", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace(async (method, params) => {
      const config = params[2] as { tracer?: string } | undefined;
      if (method === "debug_traceCall" && config?.tracer === "callTracer") {
        throw new NativeRpcClientError(
          "RPC_ERROR",
          "method unsupported",
          -32601,
        );
      }
      return canonicalTraceHandler(method, params);
    });
    const record = compareEvidencePortability({
      nativeRpc,
      traceRpc,
      preparedExecution: evaluation.input,
    });

    expect(fact(record, "trace").traceRpc).toEqual({
      state: "unavailable",
      reason: "method_unsupported",
    });
    expect(record.sources.traceRpc.unavailableScope).toEqual([
      "portability.call",
      "portability.gas",
      "portability.trace",
      "portability.freshness",
    ]);
  });

  it("keeps a declared-but-unobserved primary capability UNKNOWN, not UNAVAILABLE", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();
    const record = compareEvidencePortability({
      nativeRpc: {
        ...nativeRpc,
        capabilities: [...NATIVE_RPC_CAPABILITIES, "traces"],
      },
      traceRpc,
      preparedExecution: evaluation.input,
    });

    expect(fact(record, "trace").nativeRpc).toEqual({
      state: "unknown",
      reason: "capability_declared_without_observation",
      detail: { capability: "traces" },
    });
  });

  it("keeps an unobserved primary call fact UNKNOWN while the supplementary source stays checked", async () => {
    const nativeRpc = await evaluateNative(async (method) => {
      if (method === "eth_call") {
        throw new NativeRpcClientError("RPC_ERROR", "execution reverted", 3);
      }
      return canonicalNativeHandler(method);
    });
    const traceRpc = await evaluateTrace();
    const record = compareEvidencePortability({
      nativeRpc,
      traceRpc,
      preparedExecution: evaluation.input,
    });

    const call = fact(record, "call");
    expect(call.nativeRpc.state).toBe("unknown");
    expect(call.nativeRpc.reason).toBe("observation_failed");
    expect(call.traceRpc.state).toBe("checked");
    expect(call.agreement).toBe("not_comparable");
    expect(record.sources.nativeRpc.unknownScope).toContain("portability.call");
  });

  it("fails closed when the supplementary source is bound to another run", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();
    const binding = traceRpc.binding;
    if (binding === undefined) throw new Error("Expected a trace binding");

    expect(() =>
      compareEvidencePortability({
        nativeRpc,
        traceRpc: {
          ...traceRpc,
          binding: { ...binding, runId: "run-91-other" },
        },
        preparedExecution: evaluation.input,
      }),
    ).toThrow(EvidencePortabilityError);
  });

  it("fails closed when the supplementary source observed a different pinned block", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();
    const binding = traceRpc.binding;
    if (binding === undefined) throw new Error("Expected a trace binding");

    expect(() =>
      compareEvidencePortability({
        nativeRpc,
        traceRpc: {
          ...traceRpc,
          binding: {
            ...binding,
            blockContext: { ...binding.blockContext, blockNumber: "1" },
          },
        },
        preparedExecution: evaluation.input,
      }),
    ).toThrow(/block_binding_mismatch/);
  });

  it("fails closed when the primary result names another run", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();
    const drifted = JSON.parse(
      JSON.stringify(nativeRpc),
    ) as ProviderEvaluationResult;
    const evidence = drifted.responseEvidence;
    if (evidence.kind !== "redacted_snapshot") {
      throw new Error("Expected a redacted snapshot");
    }
    const snapshot = evidence.snapshot;
    if (
      snapshot === null ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot)
    ) {
      throw new Error("Expected a snapshot object");
    }
    (snapshot as Record<string, unknown>).runId = "run-91-other";

    expect(() =>
      compareEvidencePortability({
        nativeRpc: drifted,
        traceRpc,
        preparedExecution: evaluation.input,
      }),
    ).toThrow(/run_binding_mismatch/);
  });

  it("fails closed when the prepared transaction no longer matches the trace binding", async () => {
    const nativeRpc = await evaluateNative();
    const traceRpc = await evaluateTrace();

    expect(() =>
      compareEvidencePortability({
        nativeRpc,
        traceRpc,
        preparedExecution: {
          ...evaluation.input,
          unsignedTransaction: {
            kind: "unsigned",
            payload: {
              ...evaluation.input.unsignedTransaction.payload,
              data: "0xdeadbeef",
            },
          },
        },
      }),
    ).toThrow(/prepared_transaction_mismatch/);
  });
});

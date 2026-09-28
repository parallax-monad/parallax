import { describe, expect, it } from "vitest";
import { compareEvidencePortability } from "../../apps/api/src/backend/evidence-portability.js";
import { createCanonicalNativeRpcEvaluationInput } from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import { createNativeRpcProvider } from "../../apps/api/src/backend/native-rpc-provider.js";
import { evaluateProviderAdapter } from "../../apps/api/src/backend/provider-adapter.js";
import {
  createTraceRpcEvidenceSource,
  type TraceRpcClient,
} from "../../apps/api/src/backend/trace-rpc-evidence-source.js";
import canonicalCapture from "../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
import { assertPortabilityQualifications } from "./evidence-portability-probe.js";

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
const RUN_ID = "be-091-portability-offline";
const OBSERVED_AT = "2026-09-28T12:00:00.000Z";

const evaluation = createCanonicalNativeRpcEvaluationInput(capture, RUN_ID);

/**
 * Fully offline reproduction of the live qualification path: both sources run
 * against the accepted #77 prepared transaction and pinned block, with the
 * canonical eth_call result and the accepted #98 trace shape as controlled
 * responses. No network access is performed.
 */
async function runPortabilityQualification(traceCallOutput = CALL_OUTPUT) {
  const nativeAdapter = createNativeRpcProvider({
    mode: "LIVE",
    client: {
      async request(method) {
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
      },
    },
    now: () => OBSERVED_AT,
    checkFreshness: true,
    maxBlockLag: 0,
  });
  const nativeRpc = await evaluateProviderAdapter(nativeAdapter, evaluation);

  const client: TraceRpcClient = {
    async request(method, params = []) {
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
            output: traceCallOutput,
          };
        }
        return {
          pre: { [TX.from.toLowerCase()]: { balance: "0x1" } },
          post: {
            [ROUTE.pool]: { balance: "0x2" },
            [OTHER_ADDRESS]: { balance: "0x3" },
          },
        };
      }
      throw new Error(`Unexpected trace RPC method: ${method}`);
    },
  };
  const traceRpc = await createTraceRpcEvidenceSource({
    mode: "LIVE",
    client,
    now: () => OBSERVED_AT,
  }).evaluate(evaluation);

  const record = compareEvidencePortability({
    nativeRpc,
    traceRpc,
    preparedExecution: evaluation.input,
  });

  return { record, nativeRpc, traceRpc };
}

describe("evidence portability probe qualification", () => {
  it("accepts one same-transaction comparison across the primary and supplementary sources", async () => {
    const { record, nativeRpc, traceRpc } = await runPortabilityQualification();

    expect(() =>
      assertPortabilityQualifications({
        record,
        evaluation,
        canonical: capture,
        nativeRpc,
        traceRpc,
      }),
    ).not.toThrow();

    // The probe must not require identical fields: the estimate and the traced
    // consumption stay a recorded difference.
    const gas = record.facts.find((entry) => entry.fact === "gas");
    expect(gas?.agreement).toBe("different");
    expect(nativeRpc.status).toBe("stale");
  });

  it("rejects a supplementary call output that diverges from the accepted canonical result", async () => {
    const { record, nativeRpc, traceRpc } = await runPortabilityQualification(
      `0x${"00".repeat(32)}`,
    );

    expect(() =>
      assertPortabilityQualifications({
        record,
        evaluation,
        canonical: capture,
        nativeRpc,
        traceRpc,
      }),
    ).toThrow(/accepted canonical call output/);
  });

  it("rejects a record that pads the primary source to trace parity", async () => {
    const { record, nativeRpc, traceRpc } = await runPortabilityQualification();

    const padded = {
      ...record,
      facts: record.facts.map((entry) =>
        entry.fact === "trace"
          ? {
              ...entry,
              nativeRpc: {
                state: "checked" as const,
                detail: { capability: "traces" },
              },
            }
          : entry,
      ),
    };

    expect(() =>
      assertPortabilityQualifications({
        record: padded,
        evaluation,
        canonical: capture,
        nativeRpc,
        traceRpc,
      }),
    ).toThrow(/must not publish a checked trace capability/);
  });
});

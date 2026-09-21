import { describe, expect, it } from "vitest";
import canonicalCapture from "../../../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
import {
  type CanonicalNativeRpcCapture,
  createCanonicalNativeRpcEvaluationInput,
} from "./native-rpc-canonical-exercise.js";
import { createNativeRpcProvider } from "./native-rpc-provider.js";
import { evaluateProviderAdapter } from "./provider-adapter.js";

describe("canonical Native RPC exercise input", () => {
  it("binds the accepted transaction, quote, sender, and pinned block into the Provider input", () => {
    const evaluation = createCanonicalNativeRpcEvaluationInput(
      canonicalCapture as CanonicalNativeRpcCapture,
      "be-078-canonical-exercise-test",
    );
    const capture = canonicalCapture as CanonicalNativeRpcCapture;
    const preparedSwap = capture.observations.preparedSwap;

    expect(evaluation).toMatchObject({
      runId: "be-078-canonical-exercise-test",
      chainId: 421614,
      protocol: "camelot-v3",
      input: {
        runId: "be-078-canonical-exercise-test",
        chainId: 421614,
        protocol: "camelot-v3",
        blockContext: {
          blockNumber: "310131879",
          blockHash: capture.observations.pinnedBlock.hash,
        },
        quote: {
          estimatedAmountOut: "0.015882896725531551",
          source: "quote",
          blockNumber: "310131879",
          runtimeVersion: "arbitrum-camelot-v3",
          runtimeRevision: "native-rpc",
        },
        gasEstimate: { gasUnits: preparedSwap.estimatedGas },
        finality: { status: "unknown" },
      },
    });
    expect(evaluation.input.quote).not.toHaveProperty("minimumAmountOut");
    // The block timestamp establishes the deadline, not an observation time.
    expect(evaluation.input.blockContext).not.toHaveProperty("observedAt");
    expect(evaluation.input.intent).toEqual(evaluation.intent);
    expect(evaluation.input.intent.economicBoundary).toEqual({
      availability: "unavailable",
      source: "unavailable",
    });
    expect(evaluation.input.intent.sender).toBe(preparedSwap.tx.from);
    expect(evaluation.input.unsignedTransaction).toEqual({
      kind: "unsigned",
      payload: {
        from: preparedSwap.tx.from,
        to: preparedSwap.tx.to,
        data: preparedSwap.tx.data,
        value: preparedSwap.tx.value,
      },
    });
    expect(evaluation.input.unsignedTransaction.payload).not.toHaveProperty(
      "chainId",
    );
  });

  it("rejects a capture that is not the accepted real canonical scenario", () => {
    expect(() =>
      createCanonicalNativeRpcEvaluationInput(
        {
          ...(canonicalCapture as CanonicalNativeRpcCapture),
          classification: "PARTIALLY_QUALIFIED",
        },
        "be-078-invalid-capture",
      ),
    ).toThrow(/QUALIFIED_REAL/);
  });

  it("fails closed when the prepared transaction diverges from its calldata", () => {
    const capture = canonicalCapture as CanonicalNativeRpcCapture;
    expect(() =>
      createCanonicalNativeRpcEvaluationInput(
        {
          ...capture,
          observations: {
            ...capture.observations,
            preparedSwap: {
              ...capture.observations.preparedSwap,
              tx: {
                ...capture.observations.preparedSwap.tx,
                value: "0x1",
              },
            },
          },
        },
        "be-078-divergent-transaction",
      ),
    ).toThrow(/calldata does not match/);
  });

  it("exercises the canonical prepared transaction through the Provider boundary", async () => {
    const capture = canonicalCapture as CanonicalNativeRpcCapture;
    const preparedSwap = capture.observations.preparedSwap;
    const blockTag = capture.observations.pinnedBlock.number;
    const requests: { method: string; params: readonly unknown[] }[] = [];
    const adapter = createNativeRpcProvider({
      mode: "LIVE",
      now: () => "2026-09-21T00:00:00.000Z",
      client: {
        async request(method, params = []) {
          requests.push({ method, params });
          switch (method) {
            case "eth_chainId":
              return "0x66eee";
            case "eth_getBlockByNumber":
              return {
                number: blockTag,
                hash: capture.observations.pinnedBlock.hash,
              };
            case "eth_call":
              return preparedSwap.ethCall.result;
            case "eth_estimateGas":
              return preparedSwap.ethEstimateGas.result;
            default:
              throw new Error(`Unexpected RPC method: ${method}`);
          }
        },
      },
    });
    const input = createCanonicalNativeRpcEvaluationInput(
      capture,
      "be-078-canonical-provider-test",
    );

    const result = await evaluateProviderAdapter(adapter, input);

    expect(result).toMatchObject({
      status: "success",
      provider: { providerId: "native-rpc-arbitrum" },
    });
    expect(result.candidateFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidatePath: "nativeRpc.ethCall.returnData",
          status: "observed",
          value: preparedSwap.ethCall.result,
        }),
        expect.objectContaining({
          candidatePath: "nativeRpc.estimateGas.gasUnits",
          status: "observed",
          value: preparedSwap.estimatedGas,
        }),
      ]),
    );
    expect(requests).toEqual([
      { method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: [blockTag, false] },
      {
        method: "eth_call",
        params: [input.input.unsignedTransaction.payload, blockTag],
      },
      {
        method: "eth_estimateGas",
        params: [input.input.unsignedTransaction.payload, blockTag],
      },
    ]);
  });
});

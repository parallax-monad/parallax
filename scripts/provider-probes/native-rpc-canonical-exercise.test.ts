import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCanonicalNativeRpcEvaluationInput } from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import { createNativeRpcProvider } from "../../apps/api/src/backend/native-rpc-provider.js";
import { evaluateProviderAdapter } from "../../apps/api/src/backend/provider-adapter.js";
import canonicalCapture from "../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
import {
  assertAcceptedSourceFixture,
  validateCanonicalProviderResult,
} from "./native-rpc-canonical-exercise.js";

const acceptedSourceBytes = readFileSync(
  new URL(
    "../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json",
    import.meta.url,
  ),
);

const evaluation = createCanonicalNativeRpcEvaluationInput(
  canonicalCapture,
  "gas-regression",
);

async function evaluate(gas = "0x426b5") {
  const adapter = createNativeRpcProvider({
    mode: "LIVE",
    client: {
      async request(method) {
        switch (method) {
          case "eth_chainId":
            return "0x66eee";
          case "eth_getBlockByNumber":
            return canonicalCapture.observations.pinnedBlock;
          case "eth_call":
            return canonicalCapture.observations.preparedSwap.ethCall.result;
          case "eth_estimateGas":
            return gas;
          default:
            throw new Error("Unexpected method");
        }
      },
    },
  });
  return evaluateProviderAdapter(adapter, evaluation);
}

describe("canonical exercise result validation", () => {
  it("rejects a same-path tampered source before it can become canonical PASS", () => {
    const tamperedSource = Buffer.from(
      acceptedSourceBytes
        .toString("utf8")
        .replace(
          '"source": "https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/"',
          '"source": "https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/altered"',
        ),
    );

    // The source remains valid JSON and the canonical transaction fields remain
    // internally consistent; only its accepted source identity has changed.
    expect(() => JSON.parse(tamperedSource.toString("utf8"))).not.toThrow();
    expect(() => assertAcceptedSourceFixture(tamperedSource)).toThrow(
      /accepted BE-063 source fixture/,
    );
  });

  it("accepts a different positive gas estimate and retains both observations", async () => {
    const result = await evaluate();
    expect(result.status).toBe("success");
    expect(
      validateCanonicalProviderResult(result, evaluation, canonicalCapture),
    ).toEqual({
      historicalGasUnits: "272052",
      observedGasUnits: "272053",
      differenceGasUnits: "1",
    });
  });

  it("still rejects zero gas instead of declaring a successful exercise", async () => {
    const result = await evaluate("0x0");
    expect(() =>
      validateCanonicalProviderResult(result, evaluation, canonicalCapture),
    ).toThrow();
  });

  it("does not relax pinned call result validation", async () => {
    const result = await evaluate();
    if (result.responseEvidence.kind !== "redacted_snapshot")
      throw new Error("Missing snapshot");
    const snapshot = result.responseEvidence.snapshot as Record<
      string,
      string | Record<string, string>
    >;
    const changed = {
      ...result,
      responseEvidence: {
        ...result.responseEvidence,
        snapshot: {
          ...snapshot,
          methods: {
            ...(snapshot.methods as Record<string, string>),
            eth_call: "0x00",
          },
        },
      },
    };
    expect(() =>
      validateCanonicalProviderResult(changed, evaluation, canonicalCapture),
    ).toThrow(/observations differ/);
  });
});

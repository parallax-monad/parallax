import type { NormalizedKuruEvidence } from "@parallax/moss-bridge";
import { describe, expect, it } from "vitest";
import { evaluateKuruEvidence } from "../src/index.js";

function evidence(
  overrides: Partial<NormalizedKuruEvidence> = {},
): NormalizedKuruEvidence {
  return {
    protocol: "kuru",
    intent: {
      chainId: "143",
      sender: "0xcccccccccccccccccccccccccccccccccccccccc",
      tokenIn: "MON",
      tokenOut: "USDC",
      amountIn: "1",
    },
    integrationStatus: "OK",
    executionStatus: "SUCCESS",
    quote: { value: { estimatedAmountOut: "10" }, source: "quote" },
    action: { value: {}, source: "moss" },
    receipt: { value: {}, source: "moss" },
    outcome: { value: {}, source: "moss" },
    assetChanges: { value: [], source: "moss" },
    warnings: { value: [], source: "moss" },
    revertReason: { value: null, source: "unknown" },
    gas: { value: ["1"], source: "moss" },
    blockNumber: { value: "1", source: "rpc" },
    mossVersion: "test",
    source: "moss",
    replayMode: false,
    approval: { value: "NOT_APPLICABLE", source: "derived" },
    walletAffordabilityChecked: false,
    limitations: [],
    ...overrides,
  };
}

describe("deterministic Kuru decisions", () => {
  it("does not turn integration errors into protocol risk", () => {
    expect(
      evaluateKuruEvidence(evidence({ integrationStatus: "INTEGRATION_ERROR" }))
        .verdict,
    ).toBe("UNKNOWN");
  });

  it("does not turn success into proceed without minimum received", () => {
    expect(evaluateKuruEvidence(evidence()).verdict).toBe("UNKNOWN");
  });

  it("returns proceed only with an explicit passing boundary", () => {
    expect(
      evaluateKuruEvidence(
        evidence({ intent: { ...evidence().intent, minimumReceived: "9" } }),
      ).verdict,
    ).toBe("PROCEED");
  });

  it("maps no route to stop", () => {
    expect(
      evaluateKuruEvidence(evidence({ executionStatus: "NO_ROUTE" })).verdict,
    ).toBe("STOP");
  });

  it("does not guess that a generic revert means an insufficient balance", () => {
    const result = evaluateKuruEvidence(
      evidence({ executionStatus: "REVERTED" }),
    );
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.actions).toEqual([]);
  });

  it("returns unknown when critical evidence is missing", () => {
    expect(
      evaluateKuruEvidence(
        evidence({
          receipt: { value: null, source: "unknown" },
          intent: { ...evidence().intent, minimumReceived: "9" },
        }),
      ).verdict,
    ).toBe("UNKNOWN");
  });

  it("returns adjust when a supplied boundary is not met", () => {
    expect(
      evaluateKuruEvidence(
        evidence({ intent: { ...evidence().intent, minimumReceived: "11" } }),
      ).verdict,
    ).toBe("ADJUST");
  });
});

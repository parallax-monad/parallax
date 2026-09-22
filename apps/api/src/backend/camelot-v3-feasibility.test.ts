import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  CAMELOT_V3_PROTOCOL_ID,
} from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import {
  controlledCamelotV3TargetScenarios,
  createCamelotV3FeasibilityEntryPoint,
} from "./camelot-v3-feasibility.js";

describe("Camelot V3 feasibility entry point", () => {
  it("records controlled target scenarios without claiming real pair, pool, or Evidence values", () => {
    expect(controlledCamelotV3TargetScenarios.length).toBeGreaterThan(0);
    expect(controlledCamelotV3TargetScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "CONTROLLED_FIXTURE",
          chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
          protocolId: CAMELOT_V3_PROTOCOL_ID,
          execution: "replaceable-seam",
        }),
      ]),
    );
    for (const scenario of controlledCamelotV3TargetScenarios) {
      expect(scenario.real).toBe(false);
      expect(scenario.pair).toBe("unconfigured");
      expect(scenario.pool).toBe("unconfigured");
      expect(scenario.evidence).toBe("not-recorded");
    }
  });

  it("exposes the scenario records alongside a replaceable protocol adapter", () => {
    const entryPoint = createCamelotV3FeasibilityEntryPoint();

    expect(entryPoint.chainId).toBe(ARBITRUM_SEPOLIA_CHAIN_ID);
    expect(entryPoint.protocolId).toBe(CAMELOT_V3_PROTOCOL_ID);
    expect(entryPoint.scenarios).toBe(controlledCamelotV3TargetScenarios);
    expect(entryPoint.protocolAdapter.protocolId).toBe(CAMELOT_V3_PROTOCOL_ID);
  });
});

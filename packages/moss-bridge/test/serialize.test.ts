import { describe, expect, it } from "vitest";
import { normalizeMossError, toJsonValue } from "../src/index.js";

describe("evidence serialization", () => {
  it("serializes nested bigint values as strings", () => {
    const serialized = toJsonValue({ amount: 7n, nested: [3n, { gas: 11n }] });
    expect(serialized).toEqual({ amount: "7", nested: ["3", { gas: "11" }] });
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("keeps no-route separate from integration failure", () => {
    expect(
      normalizeMossError("no verified Kuru market path", { stage: "QUOTE" }),
    ).toMatchObject({
      code: "NO_ROUTE",
      integrationStatus: "OK",
    });
    // Without an explicit QUOTE/ACTION stage a route-like message is an
    // integration failure, not a confirmed no-route classification.
    expect(normalizeMossError("no verified Kuru market path")).toMatchObject({
      code: "INTEGRATION_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
    expect(normalizeMossError("transport failed")).toMatchObject({
      code: "INTEGRATION_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
    expect(normalizeMossError("failed to decode revert data")).toMatchObject({
      code: "INTEGRATION_ERROR",
      integrationStatus: "INTEGRATION_ERROR",
    });
  });
});

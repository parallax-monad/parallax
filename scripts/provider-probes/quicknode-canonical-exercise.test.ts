import { describe, expect, it } from "vitest";
import type { CanonicalNativeRpcCapture } from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import canonicalCapture from "../../fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
import {
  assertNode22,
  validateQuickNodeCallTrace,
  validateQuickNodeStateDiff,
} from "./quicknode-canonical-exercise.js";

const capture = canonicalCapture as CanonicalNativeRpcCapture;
const preparedSwap = capture.observations.preparedSwap;

describe("QuickNode canonical trace validation", () => {
  it("requires Node 22 for durable evidence", () => {
    expect(() => assertNode22("v22.23.2")).not.toThrow();
    expect(() => assertNode22("v24.14.0")).toThrow(/Node 22/);
  });

  it("accepts a call trace bound to the accepted canonical transaction", () => {
    const result = validateQuickNodeCallTrace(
      {
        type: "CALL",
        from: preparedSwap.tx.from,
        to: preparedSwap.tx.to,
        input: preparedSwap.tx.data,
        value: preparedSwap.tx.value,
        gasUsed: "0x3bed4",
        output: preparedSwap.ethCall.result,
      },
      capture,
    );

    expect(result).toMatchObject({
      status: "OBSERVED",
      gasUsed: "0x3bed4",
      output: preparedSwap.ethCall.result,
    });
    expect(result.resultSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed when callTracer output diverges", () => {
    expect(() =>
      validateQuickNodeCallTrace(
        {
          type: "CALL",
          from: preparedSwap.tx.from,
          to: preparedSwap.tx.to,
          input: preparedSwap.tx.data,
          value: preparedSwap.tx.value,
          gasUsed: "0x1",
          output: `0x${"00".repeat(32)}`,
        },
        capture,
      ),
    ).toThrow(/canonical transaction/);
  });

  it.each([
    ["from", { from: preparedSwap.tx.to }],
    ["to", { to: preparedSwap.tx.from }],
    ["calldata", { input: "0x" }],
    ["value", { value: "0x0" }],
  ])("rejects a call trace with divergent %s", (_field, change) => {
    expect(() =>
      validateQuickNodeCallTrace(
        {
          type: "CALL",
          from: preparedSwap.tx.from,
          to: preparedSwap.tx.to,
          input: preparedSwap.tx.data,
          value: preparedSwap.tx.value,
          gasUsed: "0x1",
          output: preparedSwap.ethCall.result,
          ...change,
        },
        capture,
      ),
    ).toThrow(/canonical transaction/);
  });

  it("rejects a reverted call trace even if its echoed fields match", () => {
    expect(() =>
      validateQuickNodeCallTrace(
        {
          type: "CALL",
          from: preparedSwap.tx.from,
          to: preparedSwap.tx.to,
          input: preparedSwap.tx.data,
          value: preparedSwap.tx.value,
          gasUsed: "0x1",
          output: preparedSwap.ethCall.result,
          error: "execution reverted",
        },
        capture,
      ),
    ).toThrow(/canonical transaction/);
  });

  it("requires the canonical pool and both route tokens in the state diff", () => {
    const route = preparedSwap.route;

    const result = validateQuickNodeStateDiff(
      {
        pre: {
          [preparedSwap.tx.from]: { balance: "0x1" },
        },
        post: {
          [route.pool]: { storage: { "0x00": "0x01" } },
          [route.tokenIn]: { storage: { "0x00": "0x01" } },
          [route.tokenOut]: { storage: { "0x00": "0x01" } },
        },
      },
      capture,
    );

    expect(result).toMatchObject({
      status: "OBSERVED",
      diffMode: true,
      postAddressCount: 3,
    });
  });

  it("fails closed when canonical state-transition addresses are missing", () => {
    expect(() =>
      validateQuickNodeStateDiff(
        {
          pre: {
            [preparedSwap.tx.from]: { balance: "0x1" },
          },
          post: {
            [preparedSwap.route.pool]: { storage: { "0x00": "0x01" } },
          },
        },
        capture,
      ),
    ).toThrow(/missing canonical address/);
  });

  it("rejects empty poststate entries for canonical addresses", () => {
    const route = preparedSwap.route;
    expect(() =>
      validateQuickNodeStateDiff(
        {
          pre: { [preparedSwap.tx.from]: { balance: "0x1" } },
          post: {
            [route.pool]: {},
            [route.tokenIn]: { storage: { "0x00": "0x01" } },
            [route.tokenOut]: { storage: { "0x00": "0x01" } },
          },
        },
        capture,
      ),
    ).toThrow(/no change/);
  });
});

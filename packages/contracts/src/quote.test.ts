import { describe, expect, it } from "vitest";
import { quoteRequestSchema, quoteResultSchema } from "./quote.js";

const request = {
  chainId: 143,
  protocol: "kuru" as const,
  sender: "0x1111111111111111111111111111111111111111",
  tokenIn: { kind: "native" as const },
  tokenOut: {
    kind: "erc20" as const,
    address: "0x2222222222222222222222222222222222222222",
  },
  amountIn: "0.01",
};

describe("quote contract", () => {
  it("accepts an exact-input Monad Kuru quote request", () => {
    expect(quoteRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects Quote request fields outside the ticket scope", () => {
    expect(
      quoteRequestSchema.safeParse({ ...request, slippage: "0.5" }).success,
    ).toBe(false);
  });

  it("returns a quote with human-readable decimal amounts and provenance", () => {
    expect(
      quoteResultSchema.parse({
        status: "available",
        quote: {
          estimatedAmountOut: "0.000223",
          minimumAmountOut: "0.000221",
          source: "quote",
          blockNumber: "91383505",
          runtimeVersion: "0.1.0",
          runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        },
      }),
    ).toMatchObject({
      status: "available",
      quote: { estimatedAmountOut: "0.000223" },
    });
  });

  it("rejects an available Quote without a stage block", () => {
    expect(() =>
      quoteResultSchema.parse({
        status: "available",
        quote: {
          estimatedAmountOut: "0.000223",
          source: "quote",
          runtimeVersion: "0.1.0",
          runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        },
      }),
    ).toThrow();
  });

  it("rejects a minimum output above the estimate", () => {
    expect(
      quoteResultSchema.safeParse({
        status: "available",
        quote: {
          estimatedAmountOut: "1",
          minimumAmountOut: "1.01",
          source: "quote",
          blockNumber: "91383505",
          runtimeVersion: "0.1.0",
          runtimeRevision: "d09b38cbc44ee7f5722c5d09e7224f7750187762",
        },
      }).success,
    ).toBe(false);
  });

  it("represents a verified no-route quote without fabricating an amount", () => {
    expect(
      quoteResultSchema.parse({
        status: "unavailable",
        reason: "NO_ROUTE",
      }),
    ).toEqual({ status: "unavailable", reason: "NO_ROUTE" });
  });
});

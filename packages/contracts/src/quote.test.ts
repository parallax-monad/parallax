import { describe, expect, it } from "vitest";
import type { QuoteProvenance } from "./quote.js";
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

const provenance: QuoteProvenance = {
  version: 1,
  profileId: "arbitrum-one-camelot-v3",
  sourceChainId: 42161,
  sourceBlock: {
    number: "515758698",
    hash: `0x${"ab".repeat(32)}`,
    timestamp: "1792264607",
    observedAt: "2026-10-17T19:17:33.990Z",
  },
  inputAsset: {
    chainId: 42161,
    asset: { kind: "native" },
    symbol: "ETH",
    decimals: 18,
    decimalsSource: "chain_config",
  },
  outputAsset: {
    chainId: 42161,
    asset: {
      kind: "erc20",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    },
    symbol: "USDC",
    decimals: 6,
    decimalsSource: "onchain_verified",
    verifiedAtBlock: "515758698",
  },
  amountInAtomic: "1000000000000000",
  amountOutAtomic: "2413423",
  route: {
    protocol: "camelot-v3",
    kind: "direct",
    poolAddress: "0xb1026b8e7276e7ac75410f1fcbbe21796e8f7526",
    tokenPath: [
      "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    ],
  },
  quoteSource: {
    kind: "quoter",
    protocol: "camelot-v3",
    address: "0x0Fc73040b26E9bC8514fA028D998E73A254Fa76E",
  },
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

  it("accepts a complete, versioned pinned-block provenance envelope", () => {
    expect(
      quoteResultSchema.parse({
        status: "available",
        quote: {
          estimatedAmountOut: "2.413423",
          source: "quote",
          blockNumber: provenance.sourceBlock.number,
          fetchedAt: provenance.sourceBlock.observedAt,
          runtimeVersion: "arbitrum-one-camelot-v3",
          runtimeRevision: "native-rpc",
          provenance,
        },
      }),
    ).toMatchObject({ status: "available", quote: { provenance } });
  });

  it("keeps provenance optional for legacy quote payloads", () => {
    const parsed = quoteResultSchema.parse({
      status: "available",
      quote: {
        estimatedAmountOut: "0.000223",
        source: "quote",
        blockNumber: "91383505",
        runtimeVersion: "0.1.0",
        runtimeRevision: "legacy-runtime",
      },
    });
    expect(parsed.status).toBe("available");
    if (parsed.status === "available") {
      expect(parsed.quote).not.toHaveProperty("provenance");
    }
  });

  it("rejects mismatched route assets and top-level block provenance", () => {
    const quote = {
      estimatedAmountOut: "2.413423",
      source: "quote",
      blockNumber: provenance.sourceBlock.number,
      fetchedAt: provenance.sourceBlock.observedAt,
      runtimeVersion: "arbitrum-one-camelot-v3",
      runtimeRevision: "native-rpc",
      provenance,
    };
    expect(
      quoteResultSchema.safeParse({
        status: "available",
        quote: {
          ...quote,
          provenance: {
            ...provenance,
            route: {
              ...provenance.route,
              tokenPath: [
                provenance.route.tokenPath[0],
                "0x1111111111111111111111111111111111111111",
              ],
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      quoteResultSchema.safeParse({
        status: "available",
        quote: { ...quote, blockNumber: "515758699" },
      }).success,
    ).toBe(false);
  });
});

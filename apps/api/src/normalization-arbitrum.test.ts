import { describe, expect, it } from "vitest";
import {
  normalizeArbitrumCheckSwapRequest,
  normalizeArbitrumQuoteRequest,
} from "./normalization.js";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const registry = createTrustedTokenRegistry({
  chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
  tokens: [
    {
      chainId: 421614,
      address: usdc,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "307414719",
    },
  ],
});

const base = {
  chainId: 421614,
  protocol: "camelot-v3" as const,
  sender,
  tokenIn: { kind: "native" as const },
  tokenOut: { kind: "erc20" as const, address: usdc },
  amountIn: "1.5",
};

describe("Arbitrum intent normalization", () => {
  it("normalizes Camelot Sepolia exact-input amounts using trusted metadata", () => {
    const result = normalizeArbitrumCheckSwapRequest(
      {
        ...base,
        economicBoundary: {
          availability: "unavailable",
          source: "unavailable",
        },
      },
      registry,
    );

    expect(result).toEqual({
      success: true,
      intent: expect.objectContaining({
        chainId: 421614,
        protocol: "camelot-v3",
        amountInAtomic: "1500000000000000000",
      }),
    });
  });

  it("shares normalization for quote requests and rejects Monad chain IDs", () => {
    expect(normalizeArbitrumQuoteRequest(base, registry).success).toBe(true);
    expect(
      normalizeArbitrumQuoteRequest({ ...base, chainId: 143 }, registry),
    ).toMatchObject({
      success: false,
      error: { code: "UNSUPPORTED_CHAIN", field: "chainId" },
    });
  });
});

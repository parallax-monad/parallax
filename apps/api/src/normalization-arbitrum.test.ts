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

describe("Arbitrum reverse ERC-20 normalization", () => {
  // Real addresses recorded by the merged #103 USDC -> WETH qualification.
  const reverseUsdc = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
  const reverseWeth = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
  const reverseRegistry = createTrustedTokenRegistry({
    chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
    tokens: [
      {
        chainId: 421614,
        address: reverseUsdc,
        symbol: "USDC",
        decimals: 18,
        decimalsSource: "onchain_verified",
        verifiedAtBlock: "313915415",
      },
      {
        chainId: 421614,
        address: reverseWeth,
        symbol: "WETH",
        decimals: 18,
        decimalsSource: "onchain_verified",
        verifiedAtBlock: "313915415",
      },
    ],
  });
  const reverseRequest = {
    chainId: 421614,
    protocol: "camelot-v3" as const,
    sender,
    tokenIn: { kind: "erc20" as const, address: reverseUsdc },
    tokenOut: { kind: "erc20" as const, address: reverseWeth },
    amountIn: "0.001",
  };

  it("normalizes the qualified USDC -> WETH intent with trusted 18-decimal metadata", () => {
    const result = normalizeArbitrumQuoteRequest(
      reverseRequest,
      reverseRegistry,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.intent).toMatchObject({
        chainId: 421614,
        protocol: "camelot-v3",
        tokenIn: { kind: "erc20" },
        tokenOut: { kind: "erc20" },
        amountInAtomic: "1000000000000000",
      });
    }
    expect(
      normalizeArbitrumCheckSwapRequest(
        {
          ...reverseRequest,
          economicBoundary: {
            availability: "unavailable",
            source: "unavailable",
          },
        },
        reverseRegistry,
      ).success,
    ).toBe(true);
  });

  it("fails closed when the ERC-20 input is not in the trusted registry", () => {
    expect(
      normalizeArbitrumQuoteRequest(
        { ...reverseRequest, tokenIn: { kind: "erc20", address: usdc } },
        reverseRegistry,
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNSUPPORTED_TOKEN", field: "tokenIn" },
    });
  });
});

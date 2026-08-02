import { checkSwapRequestSchema } from "@parallax/contracts";
import { describe, expect, it } from "vitest";
import { normalizeCheckSwapRequest } from "./normalization.js";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const sender = "0x1111111111111111111111111111111111111111";
const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const mon = { kind: "native" as const };
const usdc = { kind: "erc20" as const, address: usdcAddress };

const registry = createTrustedTokenRegistry({
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: usdcAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "90000000",
    },
  ],
});

function request(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof checkSwapRequestSchema.parse> {
  return checkSwapRequestSchema.parse({
    chainId: 143,
    protocol: "kuru",
    sender,
    tokenIn: mon,
    tokenOut: usdc,
    amountIn: "1.5",
    economicBoundary: {
      availability: "unavailable",
      source: "unavailable",
    },
    ...overrides,
  });
}

describe("normalizeCheckSwapRequest", () => {
  it("creates the authoritative atomic-unit intent", () => {
    const result = normalizeCheckSwapRequest(
      request({
        tokenOut: {
          kind: "erc20",
          address: usdcAddress.toUpperCase().replace("0X", "0x"),
        },
        economicBoundary: {
          availability: "available",
          minimumReceived: "20.5",
          source: "user_declared",
        },
      }),
      registry,
    );

    expect(result).toEqual({
      success: true,
      intent: {
        chainId: 143,
        protocol: "kuru",
        sender,
        recipient: sender,
        recipientSource: "defaulted_from_sender",
        tokenIn: mon,
        tokenOut: usdc,
        amountInAtomic: "1500000000000000000",
        economicBoundary: {
          availability: "available",
          minimumReceivedAtomic: "20500000",
          source: "user_declared",
        },
      },
    });
  });

  it("preserves an explicit intended recipient", () => {
    const recipient = "0x2222222222222222222222222222222222222222";

    expect(
      normalizeCheckSwapRequest(request({ recipient }), registry),
    ).toMatchObject({
      success: true,
      intent: { sender, recipient, recipientSource: "explicit" },
    });
  });

  it("preserves an explicit unavailable boundary", () => {
    expect(normalizeCheckSwapRequest(request(), registry)).toMatchObject({
      success: true,
      intent: {
        economicBoundary: {
          availability: "unavailable",
          source: "unavailable",
        },
      },
    });
  });

  it("rejects an unsupported chain", () => {
    expect(
      normalizeCheckSwapRequest(request({ chainId: 1 }), registry),
    ).toMatchObject({
      success: false,
      error: { code: "UNSUPPORTED_CHAIN", field: "chainId" },
    });
  });

  it("rejects a token outside the trusted registry", () => {
    expect(
      normalizeCheckSwapRequest(
        request({
          tokenOut: {
            kind: "erc20",
            address: "0x3333333333333333333333333333333333333333",
          },
        }),
        registry,
      ),
    ).toMatchObject({
      success: false,
      error: { code: "UNSUPPORTED_TOKEN", field: "tokenOut" },
    });
  });

  it("rejects input precision beyond tokenIn decimals", () => {
    expect(
      normalizeCheckSwapRequest(
        request({
          tokenIn: usdc,
          tokenOut: mon,
          amountIn: "1.0000001",
        }),
        registry,
      ),
    ).toMatchObject({
      success: false,
      error: {
        code: "TOO_MANY_DECIMAL_PLACES",
        field: "amountIn",
      },
    });
  });

  it("rejects Minimum Received precision beyond tokenOut decimals", () => {
    expect(
      normalizeCheckSwapRequest(
        request({
          economicBoundary: {
            availability: "available",
            minimumReceived: "0.0000001",
            source: "user_declared",
          },
        }),
        registry,
      ),
    ).toMatchObject({
      success: false,
      error: {
        code: "TOO_MANY_DECIMAL_PLACES",
        field: "economicBoundary.minimumReceived",
      },
    });
  });
});

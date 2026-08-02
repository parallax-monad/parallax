import { describe, expect, it } from "vitest";
import { tokenRegistryConfigSchema, tokenRegistryKey } from "./index.js";

const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

const registryConfig = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: usdcAddress,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};

describe("token registry contract", () => {
  it("uses a canonical chain-aware and case-insensitive key", () => {
    expect(
      tokenRegistryKey(143, {
        kind: "erc20",
        address: usdcAddress.toUpperCase().replace("0X", "0x"),
      }),
    ).toBe(`143:${usdcAddress}`);
  });

  it("rejects tokens whose chain is not configured", () => {
    const result = tokenRegistryConfigSchema.safeParse({
      ...registryConfig,
      tokens: [{ ...registryConfig.tokens[0], chainId: 1 }],
    });

    expect(result.success).toBe(false);
  });
});

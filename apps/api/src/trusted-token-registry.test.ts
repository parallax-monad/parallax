import { describe, expect, it } from "vitest";
import { createTrustedTokenRegistry } from "./trusted-token-registry.js";

const usdcAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const mon = { kind: "native" as const };

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

describe("trusted token registry", () => {
  it("resolves native metadata from chain config", () => {
    expect(registry.resolve(143, mon)).toEqual({
      chainId: 143,
      asset: mon,
      symbol: "MON",
      decimals: 18,
      decimalsSource: "chain_config",
    });
  });

  it("resolves ERC-20 metadata case-insensitively", () => {
    expect(
      registry.resolve(143, {
        kind: "erc20",
        address: usdcAddress.toUpperCase().replace("0X", "0x"),
      }),
    ).toMatchObject({
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified",
      verifiedAtBlock: "90000000",
    });
  });
});

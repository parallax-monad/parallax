import {
  type TokenRegistryConfig,
  type TrustedTokenRegistry,
  tokenRegistryConfigSchema,
  tokenRegistryKey,
} from "@parallax/contracts";

/**
 * Builds a read-only registry from backend-owned configuration. ERC-20 entries
 * must already have been verified onchain; this factory performs no RPC calls.
 */
export function createTrustedTokenRegistry(
  input: TokenRegistryConfig,
): TrustedTokenRegistry {
  const config = tokenRegistryConfigSchema.parse(input);
  const chains = new Map(config.chains.map((chain) => [chain.chainId, chain]));
  const tokens = new Map(
    config.tokens.map((token) => [
      tokenRegistryKey(token.chainId, {
        kind: "erc20",
        address: token.address,
      }),
      token,
    ]),
  );

  return {
    hasChain(chainId) {
      return chains.has(chainId);
    },
    resolve(chainId, asset) {
      const chain = chains.get(chainId);
      if (!chain) return undefined;

      if (asset.kind === "native") {
        return {
          chainId,
          asset,
          symbol: chain.symbol,
          decimals: chain.decimals,
          decimalsSource: "chain_config",
        };
      }

      const token = tokens.get(tokenRegistryKey(chainId, asset));
      if (!token) return undefined;

      return {
        chainId,
        asset: {
          kind: "erc20",
          address: token.address,
        },
        symbol: token.symbol,
        decimals: token.decimals,
        decimalsSource: token.decimalsSource,
        verifiedAtBlock: token.verifiedAtBlock,
      };
    },
  };
}

/**
 * API helper functions for multi-chain support and expectation baseline
 */

export const MONAD_CHAIN_ID = 143;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

export const MONAD_USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const ARBITRUM_SEPOLIA_USDC_ADDRESS =
  "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
export const ARBITRUM_SEPOLIA_WETH_ADDRESS =
  "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";

/**
 * Get the appropriate chain ID based on protocol
 */
export function getChainIdForProtocol(protocol: string): number {
  if (protocol === "camelot-v3") {
    return ARBITRUM_SEPOLIA_CHAIN_ID;
  }
  return MONAD_CHAIN_ID;
}

/**
 * Get native token symbol for a given chain
 */
export function getNativeTokenSymbol(chainId: number): string {
  if (chainId === ARBITRUM_SEPOLIA_CHAIN_ID) {
    return "ETH";
  }
  return "MON";
}

/**
 * Get USDC address for a given chain
 */
export function getUsdcAddress(chainId: number): string {
  if (chainId === ARBITRUM_SEPOLIA_CHAIN_ID) {
    return ARBITRUM_SEPOLIA_USDC_ADDRESS;
  }
  return MONAD_USDC_ADDRESS;
}

/**
 * Convert token symbol to asset reference for API
 */
export function symbolToAsset(symbol: string, chainId: number) {
  const nativeSymbol = getNativeTokenSymbol(chainId);

  if (symbol === nativeSymbol || symbol === "MON" || symbol === "ETH") {
    return { kind: "native" as const };
  }

  if (symbol === "USDC") {
    return {
      kind: "erc20" as const,
      address: getUsdcAddress(chainId),
    };
  }

  if (symbol === "WETH" && chainId === ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(
      "WETH asset metadata must come from the Backend route configuration",
    );
  }

  throw new Error(`Unsupported token: ${symbol} on chain ${chainId}`);
}

/**
 * Convert asset reference to token symbol
 */
export function assetToSymbol(asset: unknown, chainId: number): string {
  const obj =
    typeof asset === "object" && asset !== null
      ? (asset as Record<string, unknown>)
      : undefined;

  if (obj?.kind === "native") {
    return getNativeTokenSymbol(chainId);
  }

  const address =
    typeof obj?.address === "string" ? obj.address.toLowerCase() : undefined;

  if (address === MONAD_USDC_ADDRESS.toLowerCase()) return "USDC";
  if (address === ARBITRUM_SEPOLIA_USDC_ADDRESS.toLowerCase()) return "USDC";
  if (address === ARBITRUM_SEPOLIA_WETH_ADDRESS.toLowerCase()) return "WETH";

  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "unknown";
}

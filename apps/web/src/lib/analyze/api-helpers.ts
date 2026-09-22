/**
 * API helper functions for multi-chain support and expectation baseline
 */

export const MONAD_CHAIN_ID = 143;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

export const MONAD_USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const ARBITRUM_SEPOLIA_USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

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
  
  throw new Error(`Unsupported token: ${symbol} on chain ${chainId}`);
}

/**
 * Convert asset reference to token symbol
 */
export function assetToSymbol(asset: unknown, chainId: number): string {
  const obj = typeof asset === "object" && asset !== null
    ? (asset as Record<string, unknown>)
    : undefined;
    
  if (obj?.kind === "native") {
    return getNativeTokenSymbol(chainId);
  }
  
  const address = typeof obj?.address === "string" 
    ? obj.address.toLowerCase() 
    : undefined;
    
  if (address === MONAD_USDC_ADDRESS.toLowerCase()) return "USDC";
  if (address === ARBITRUM_SEPOLIA_USDC_ADDRESS.toLowerCase()) return "USDC";
  
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "unknown";
}

/**
 * Get token decimals for display conversion
 */
export function getTokenDecimals(symbol: string, chainId: number): number {
  if (symbol === "USDC") return 6;
  if (symbol === getNativeTokenSymbol(chainId)) return 18;
  return 18; // default
}

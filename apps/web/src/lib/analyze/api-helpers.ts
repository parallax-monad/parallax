/**
 * Chain helpers shared by the analyze service.
 *
 * The token maps that used to live here were dead duplicates of the private
 * `asset()`/`symbol()` pair in `service.ts` and were WETH-blind. Only the chain
 * routing helper is still imported, so the duplicates were removed.
 */

export const MONAD_CHAIN_ID = 143;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * Get the appropriate chain ID based on protocol
 */
export function getChainIdForProtocol(protocol: string): number {
  if (protocol === "camelot-v3") {
    return ARBITRUM_SEPOLIA_CHAIN_ID;
  }
  return MONAD_CHAIN_ID;
}

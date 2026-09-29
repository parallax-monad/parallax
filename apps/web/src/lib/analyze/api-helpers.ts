export const MONAD_CHAIN_ID = 143;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

export function getChainIdForProtocol(protocol: string): number {
  return protocol === "camelot-v3" ? ARBITRUM_SEPOLIA_CHAIN_ID : MONAD_CHAIN_ID;
}

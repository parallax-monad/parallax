import {
  assetIdentity,
  type NormalizedSwapIntent,
  type TokenMetadataPair,
  type TrustedTokenRegistry,
  tokenMetadataPairSchema,
} from "@parallax/contracts";

/** Resolve before execution; parsing detaches the snapshot from registry objects. */
export function resolveTokenMetadata(
  registry: TrustedTokenRegistry,
  intent: Pick<NormalizedSwapIntent, "chainId" | "tokenIn" | "tokenOut">,
): TokenMetadataPair {
  const pair = tokenMetadataPairSchema.parse({
    tokenIn: registry.resolve(intent.chainId, intent.tokenIn),
    tokenOut: registry.resolve(intent.chainId, intent.tokenOut),
  });
  for (const field of ["tokenIn", "tokenOut"] as const) {
    if (
      assetIdentity({
        chainId: pair[field].chainId,
        asset: pair[field].asset,
      }) !== assetIdentity({ chainId: intent.chainId, asset: intent[field] })
    ) {
      throw new Error("Resolved metadata does not match the requested asset");
    }
  }
  return pair;
}

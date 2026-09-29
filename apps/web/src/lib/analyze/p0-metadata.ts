/** Public, read-only projection of the Backend's trusted P0 token registry. */
export type P0Token = {
  asset: { kind: "native" } | { kind: "erc20"; address: string };
  symbol: string;
  decimals: number;
  decimalsSource: "chain_config" | "onchain_verified";
  verifiedAtBlock?: string;
};

export type P0Metadata = {
  chainId: 421614;
  protocol: "camelot-v3";
  tokenIn: P0Token;
  tokenOut: P0Token;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function token(value: unknown): P0Token | undefined {
  const candidate = record(value);
  const asset = record(candidate?.asset);
  const symbol = candidate?.symbol;
  const decimals = candidate?.decimals;
  const decimalsSource = candidate?.decimalsSource;
  if (
    typeof symbol !== "string" ||
    !symbol ||
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    (decimalsSource !== "chain_config" && decimalsSource !== "onchain_verified")
  )
    return undefined;
  if (asset?.kind === "native" && decimalsSource === "chain_config") {
    return { asset: { kind: "native" }, symbol, decimals, decimalsSource };
  }
  if (
    asset?.kind === "erc20" &&
    typeof asset.address === "string" &&
    /^0x[0-9a-f]{40}$/i.test(asset.address) &&
    decimalsSource === "onchain_verified" &&
    typeof candidate?.verifiedAtBlock === "string" &&
    /^\d+$/.test(candidate.verifiedAtBlock)
  ) {
    return {
      asset: { kind: "erc20", address: asset.address },
      symbol,
      decimals,
      decimalsSource,
      verifiedAtBlock: candidate.verifiedAtBlock,
    };
  }
  return undefined;
}

export async function fetchP0Metadata(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<P0Metadata | undefined> {
  try {
    const response = await fetcher("/api/p0/metadata", { signal });
    if (!response.ok) return undefined;
    const payload = record(await response.json());
    const tokenIn = token(payload?.tokenIn);
    const tokenOut = token(payload?.tokenOut);
    if (
      payload?.chainId !== 421614 ||
      payload.protocol !== "camelot-v3" ||
      tokenIn?.asset.kind !== "native" ||
      tokenIn.symbol !== "ETH" ||
      tokenOut?.asset.kind !== "erc20" ||
      tokenOut.symbol !== "USDC"
    )
      return undefined;
    return { chainId: 421614, protocol: "camelot-v3", tokenIn, tokenOut };
  } catch {
    return undefined;
  }
}

export function matchesToken(value: unknown, token: P0Token): boolean {
  const asset = record(value);
  if (token.asset.kind === "native") return asset?.kind === "native";
  return (
    asset?.kind === "erc20" &&
    typeof asset.address === "string" &&
    asset.address.toLowerCase() === token.asset.address.toLowerCase()
  );
}

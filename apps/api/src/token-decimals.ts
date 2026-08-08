import type { AssetReference } from "@parallax/contracts";
import type { BackendRuntime } from "./runtime-config.js";

export function tokenDecimals(
  runtime: BackendRuntime,
  asset: AssetReference,
  chainId: number,
): number {
  const metadata = runtime.tokenRegistry.resolve(chainId, asset);
  if (metadata === undefined) {
    throw new Error("Normalized token metadata is no longer available");
  }
  return metadata.decimals;
}

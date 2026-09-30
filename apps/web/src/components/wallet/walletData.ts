import { runEvidence } from "@/lib/analyze/fixtures";
import { validateForm } from "@/lib/analyze/form";
import { DEFAULT_SENDER } from "@/lib/analyze/service";
import type { Protocol } from "@/lib/analyze/types";

/** Fixed read-only identity. No key material exists anywhere in this flow. */
const displayAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;
export const DEMO_ADDRESS = displayAddress(DEFAULT_SENDER);
export const DEMO_RECIPIENT = displayAddress(DEFAULT_SENDER);

/** The demo picks the route for the user, so the swap sheet stays wallet-like. */
export { DEMO_PROTOCOL, DEMO_SLIPPAGE } from "@/lib/analyze/form";

export type WalletAsset = {
  symbol: string;
  name: string;
  /** Demo balance, aligned with the recorded sender balance in the fixtures. */
  balance: number;
  price: number;
};

export const ASSETS: readonly WalletAsset[] = [
  { symbol: "MON", name: "Monad", balance: 1800, price: 0.42 },
  { symbol: "USDC", name: "USD Coin", balance: 500, price: 1 },
];

export function assetFor(symbol: string): WalletAsset | undefined {
  return ASSETS.find((asset) => asset.symbol === symbol);
}

export function balanceOf(symbol: string): number {
  return assetFor(symbol)?.balance ?? 0;
}

export const TOTAL_BALANCE_USD = ASSETS.reduce(
  (sum, asset) => sum + asset.balance * asset.price,
  0,
);

const USD = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatUsd = (value: number) => `$${USD.format(value)}`;

/**
 * Inline "you receive" estimate for the swap sheet. It reads the same
 * normalized evidence the pre-sign check reads, so the sheet can never show a
 * number the check contradicts. An unexecutable path returns undefined, not 0.
 */
export function estimateOutput(request: {
  protocol: Protocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: string;
}): number | undefined {
  const validation = validateForm({
    ...request,
    minimumReceived: "",
  });
  if (!validation.valid) return undefined;

  const evidence = runEvidence({
    protocol: request.protocol,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: validation.values.amountIn,
    slippage: validation.values.slippage,
  });

  return evidence.executionStatus === "SUCCESS"
    ? evidence.expectedOutput
    : undefined;
}

/** Token amounts keep up to 4 decimals and drop trailing zeroes. */
export function formatAmount(value: number): string {
  return Number(value.toFixed(4)).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
}

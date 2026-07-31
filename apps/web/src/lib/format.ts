export function formatUsd(value: number | null): string {
  if (value === null) return "不可用";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number | null, digits = 2): string {
  if (value === null) return "不可用";
  return `${value.toFixed(digits)}%`;
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function formatBps(bps: number): string {
  return `${bps.toFixed(0)} bps（${bpsToPercent(bps).toFixed(2)}%）`;
}

export function formatGwei(wei: string): string {
  try {
    const value = BigInt(wei);
    const gwei = Number(value / 1_000_000n) / 1000;
    return `${gwei.toFixed(3)} gwei`;
  } catch {
    return "不可用";
  }
}

import type { Severity, SourceKind } from "@/lib/types";

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
  info: "#888888",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "嚴重",
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};

const SOURCE_LABEL: Record<SourceKind, string> = {
  kuru: "Kuru 實時",
  moss: "Moss 模擬",
  onchain: "鏈上",
  static: "靜態資料",
  fixture: "樣例數據",
};

const SOURCE_CLASS: Record<SourceKind, string> = {
  kuru: "border-accent/40 text-accent",
  moss: "border-[#c29cff]/40 text-[#c29cff]",
  onchain: "border-[#75c6ff]/40 text-[#75c6ff]",
  static: "border-line-strong text-faint",
  fixture: "border-[#f4a9d5]/40 text-[#f4a9d5]",
};

export const LEVEL_CLASS: Record<string, string> = {
  low: "border-risk-low/50 text-risk-low",
  moderate: "border-risk-moderate/50 text-risk-moderate",
  elevated: "border-risk-elevated/50 text-risk-elevated",
  high: "border-risk-high/50 text-risk-high",
  unknown: "border-line-strong text-faint",
};

export const LEVEL_TEXT: Record<string, string> = {
  low: "text-risk-low",
  moderate: "text-risk-moderate",
  elevated: "text-risk-elevated",
  high: "text-risk-high",
  unknown: "text-faint",
};

export function SourceTag({ source }: { source: SourceKind }) {
  return (
    <span
      className={`ml-1.5 inline-block whitespace-nowrap border px-1.5 py-px text-[8.5px] uppercase tracking-[0.06em] ${SOURCE_CLASS[source]}`}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function RiskBadge({ level }: { level: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-ink-rail px-2 py-[3px] text-[9px] font-bold uppercase leading-tight tracking-[0.05em] ${LEVEL_CLASS[level] ?? LEVEL_CLASS.unknown}`}
    >
      <i className="h-1.5 w-1.5 rounded-full bg-current" />
      {level}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      aria-hidden="true"
      className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ background: SEVERITY_COLOR[severity] }}
    />
  );
}

export { SEVERITY_LABEL };

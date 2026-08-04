import type { Language } from "../lib/i18n";

export const EVIDENCE_TRACE_MARKERS = [
  { label: "EXECUTION REPLAY" },
  { label: "BOUNDARY CHECK" },
  { label: "INTENT" },
  { label: "ROUTE" },
  { label: "SIMULATION" },
  { label: "PROVENANCE" },
] as const;

export function getEvidenceTraceAriaLabel(language: Language) {
  return language === "zh-CN"
    ? "回放证据轨迹；拖动可旋转"
    : "Replay evidence trace; drag to rotate";
}

import type { Language } from "../lib/i18n";

export const EVIDENCE_TRACE_MARKERS = [
  { label: "Kuru" },
  { label: "PancakeSwap V2 / V3" },
  { label: "WMON" },
  { label: "ERC-20 / native MON" },
  { label: "ERC-721" },
  { label: "ERC-1155" },
] as const;

export function getEvidenceTraceAriaLabel(language: Language) {
  return language === "zh-CN"
    ? "协议路径星图；拖动可旋转"
    : "Protocol route constellation; drag to rotate";
}

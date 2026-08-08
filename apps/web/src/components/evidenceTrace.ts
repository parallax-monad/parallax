import type { Language } from "../lib/i18n";

export const AMBIENT_STAR_COLORS = ["#ffffff", "#eeeaff"] as const;

export const EVIDENCE_TRACE_MARKERS = [
  { label: "Kuru", color: "#42ffd0" },
  { label: "PancakeSwap V2 / V3", color: "#b784ff" },
  { label: "WMON", color: "#ffd36a" },
  { label: "ERC-20 / native MON", color: "#69d7ff" },
  { label: "ERC-721", color: "#d98cff" },
  { label: "ERC-1155", color: "#ff7d9f" },
] as const;

export function getExpandedMarkerEdgeScale(width: number) {
  const wideScreenProgress = Math.min(
    Math.max((width - 1440) / (2149 - 1440), 0),
    1,
  );
  return 1 + wideScreenProgress * 0.12;
}

export function getProtocolLabelOffset(
  dispersedX: number,
  markerSize: number,
  labelWidth: number,
  markerExpansion: number,
) {
  const inwardDirection = dispersedX < 0 ? 1 : -1;
  return (
    inwardDirection * (markerSize * 0.65 + labelWidth / 2) * markerExpansion
  );
}

export function getEvidenceTraceAriaLabel(language: Language) {
  return language === "zh-CN"
    ? "协议路径星图；拖动可旋转"
    : "Protocol route constellation; drag to rotate";
}

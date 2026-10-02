import type { Language } from "../lib/i18n";

export const AMBIENT_STAR_COLORS = ["#ffffff", "#eeeaff"] as const;

export const EVIDENCE_TRACE_MARKERS = [
  { label: "Camelot V3", color: "#42ffd0" },
  { label: "Arbitrum Sepolia", color: "#b784ff" },
  { label: "WETH", color: "#ffd36a" },
  { label: "USDC", color: "#69d7ff" },
  { label: "ETH", color: "#d98cff" },
  { label: "Native Balance", color: "#ff7d9f" },
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
    ? "Arbitrum Sepolia 协议路径星图；拖动可旋转"
    : "Arbitrum Sepolia protocol constellation; drag to rotate";
}

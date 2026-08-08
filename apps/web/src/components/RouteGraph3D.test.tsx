import { describe, expect, test } from "vitest";
import * as evidenceTrace from "./evidenceTrace";
import {
  EVIDENCE_TRACE_MARKERS,
  getEvidenceTraceAriaLabel,
  getExpandedMarkerEdgeScale,
} from "./evidenceTrace";

describe("RouteGraph3D", () => {
  test("describes the hero visualization as a protocol route", () => {
    expect(getEvidenceTraceAriaLabel("en")).toContain("Protocol route");
    expect(getEvidenceTraceAriaLabel("en")).not.toContain("DeFi ecosystem");
  });

  test("uses protocol and asset names instead of repeated evidence stages", () => {
    const labels = EVIDENCE_TRACE_MARKERS.map((marker) => marker.label);

    expect(labels).toEqual([
      "Kuru",
      "PancakeSwap V2 / V3",
      "WMON",
      "ERC-20 / native MON",
      "ERC-721",
      "ERC-1155",
    ]);
    expect(labels).not.toContain("BOUNDARY CHECK");
  });

  test("gives each protocol or asset a distinct restrained route color", () => {
    expect(evidenceTrace).toHaveProperty("AMBIENT_STAR_COLORS", [
      "#ffffff",
      "#eeeaff",
    ]);
    expect(EVIDENCE_TRACE_MARKERS.map((marker) => marker.color)).toEqual([
      "#42ffd0",
      "#b784ff",
      "#ffd36a",
      "#69d7ff",
      "#d98cff",
      "#ff7d9f",
    ]);
  });

  test("caps wide-screen edge movement after the 67 percent viewport", () => {
    expect(getExpandedMarkerEdgeScale(1440)).toBe(1);
    expect(getExpandedMarkerEdgeScale(1920)).toBeGreaterThan(1);
    expect(getExpandedMarkerEdgeScale(2149)).toBeCloseTo(1.12, 5);
    expect(getExpandedMarkerEdgeScale(2880)).toBeCloseTo(1.12, 5);
  });

  test("moves protocol labels inward as the constellation expands", () => {
    expect(evidenceTrace.getProtocolLabelOffset(-82, 8.4, 12, 0)).toBe(0);
    expect(evidenceTrace.getProtocolLabelOffset(-82, 8.4, 12, 1)).toBeCloseTo(
      11.46,
      5,
    );
    expect(evidenceTrace.getProtocolLabelOffset(88, 7.8, 28, 1)).toBeCloseTo(
      -19.07,
      5,
    );
  });
});

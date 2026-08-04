import { describe, expect, test } from "vitest";
import {
  EVIDENCE_TRACE_MARKERS,
  getEvidenceTraceAriaLabel,
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
});

import { describe, expect, test } from "vitest";
import {
  EVIDENCE_TRACE_MARKERS,
  getEvidenceTraceAriaLabel,
} from "./evidenceTrace";

describe("RouteGraph3D", () => {
  test("describes the hero visualization as an evidence trace", () => {
    expect(getEvidenceTraceAriaLabel("en")).toContain("Replay evidence trace");
    expect(getEvidenceTraceAriaLabel("en")).not.toContain("DeFi ecosystem");
  });

  test("uses replay evidence stages instead of protocol names", () => {
    const labels = EVIDENCE_TRACE_MARKERS.map((marker) => marker.label);

    expect(labels).toEqual([
      "EXECUTION REPLAY",
      "BOUNDARY CHECK",
      "INTENT",
      "ROUTE",
      "SIMULATION",
      "PROVENANCE",
    ]);
  });
});

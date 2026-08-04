import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("landing visual direction", () => {
  test("uses a near-black Monad theme instead of a light page", () => {
    const tailwind = readFileSync(
      new URL("../tailwind.config.js", import.meta.url),
      "utf8",
    );
    const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

    expect(tailwind).toContain('DEFAULT: "#05050a"');
    expect(tailwind).toContain('DEFAULT: "#836ef9"');
    expect(css).toContain("--space-black: #05050a");
    expect(css).toContain("color-scheme: dark");
    expect(css).not.toContain("linear-gradient(180deg, #fafafa");
  });

  test("keeps ambient stars white while route markers use restrained colors", () => {
    const graph = readFileSync(
      new URL("./components/RouteGraph3D.tsx", import.meta.url),
      "utf8",
    );

    expect(graph).toContain(
      'const AMBIENT_STAR_COLORS = ["#ffffff", "#eeeaff"]',
    );
    expect(
      graph.match(/color: EVIDENCE_TRACE_MARKERS\[\d\]\.color/g),
    ).toHaveLength(6);
    expect(graph).toContain("context.fillStyle = config.color");
    expect(graph).toContain(
      "getExpandedMarkerEdgeScale(container.clientWidth)",
    );
    expect(graph).toContain(
      'marker.kind === "protocol" ? lerp(1, edgeScale, 0.45) : 1',
    );
    expect(graph).toContain(
      "group.position.x *= lerp(1, markerEdgeScale, markerExpansion)",
    );
    expect(graph).toContain("label.position.set(0, config.size * 1.15, 0)");
    expect(graph).toMatch(
      /getProtocolLabelOffset\(\s*marker\.config\.dispersed\[0\],\s*marker\.config\.size,\s*marker\.label\.scale\.x,\s*markerExpansion,?\s*\)/,
    );
    expect(graph).not.toContain('new THREE.Color("#ccff00")');
  });
});

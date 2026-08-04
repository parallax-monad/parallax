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

  test("keeps ambient stars white while protocol bodies carry purple", () => {
    const graph = readFileSync(
      new URL("./components/RouteGraph3D.tsx", import.meta.url),
      "utf8",
    );

    expect(graph).toContain(
      'const AMBIENT_STAR_COLORS = ["#ffffff", "#eeeaff"]',
    );
    expect(graph).toContain('const PROTOCOL_LABEL_COLOR = "#c4baff"');
    expect(graph).toContain('const SIGNAL_LABEL_COLOR = "#e3e6ff"');
    expect(graph).toContain('color: "#836ef9"');
    expect(graph).not.toContain('new THREE.Color("#ccff00")');
  });
});

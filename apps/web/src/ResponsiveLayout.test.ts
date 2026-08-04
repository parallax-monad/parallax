import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("short mobile hero", () => {
  test("provides a compact layout that keeps the receipt verdict visible", () => {
    const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

    expect(css).toContain("@media (max-width: 720px) and (max-height: 720px)");
    expect(css).toContain(".hero-receipt-verdict");
  });
});

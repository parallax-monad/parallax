import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("Chinese heading punctuation", () => {
  test("keeps full stops out of every JSX heading in the web source", () => {
    const sourceDirectory = dirname(fileURLToPath(import.meta.url));
    const headings = collectTsxFiles(sourceDirectory).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/<(h[1-6])\b[\s\S]*?<\/\1>/g)].map(
        (match) => match[0],
      );
    });

    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading).not.toContain("。");
    }
  });

  test("labels the generated verdict distribution as illustrative", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("illustrative replay result");
    expect(source).toContain("演示用回放结果");
    expect(source).not.toContain("recent replay receipt");
    expect(source).not.toContain("近期交易回放");
  });
});

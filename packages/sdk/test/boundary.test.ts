import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sdkPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies?: Record<string, string> };

const allowedSourceImports = new Set(["@parallax/contracts"]);
const allowedExampleImports = new Set(["@parallax/sdk"]);
const importPatterns = [
  /(?:^|[\s;])(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs,
  /(?:^|[\s;])import\s*["']([^"']+)["']/gs,
  /\bimport\s*\(\s*["']([^"']+)["']/gs,
  /\brequire\s*\(\s*["']([^"']+)["']/gs,
];

function sourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => fileURLToPath(new URL(entry.name, directory)));
}

function bareImports(source: string): string[] {
  const imports: string[] = [];
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined && !specifier.startsWith(".")) {
        imports.push(specifier);
      }
    }
  }
  return imports;
}

function disallowedImports(files: string[], allowed: Set<string>): string[] {
  return files.flatMap((file) =>
    bareImports(readFileSync(file, "utf8"))
      .filter((specifier) => !allowed.has(specifier))
      .map((specifier) => `${file} imports ${specifier}`),
  );
}

describe("SDK public boundary", () => {
  const source = sourceFiles(new URL("../src/", import.meta.url)).filter(
    (file) => !file.endsWith(".test.ts"),
  );
  const examples = sourceFiles(new URL("../examples/", import.meta.url));

  it("depends only on canonical Contracts and Zod", () => {
    expect(Object.keys(sdkPackage.dependencies ?? {}).sort()).toEqual([
      "@parallax/contracts",
      "zod",
    ]);
    expect(
      disallowedImports(source, new Set([...allowedSourceImports, "zod"])),
    ).toEqual([]);
  });

  it("keeps the reference consumer on the public SDK surface", () => {
    expect(examples.length).toBeGreaterThan(0);
    expect(disallowedImports(examples, allowedExampleImports)).toEqual([]);
  });
});

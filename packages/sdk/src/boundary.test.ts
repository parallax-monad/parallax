import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Bare specifiers the SDK is allowed to reach. Everything else — Provider
 * implementations, the Risk engine, QuickNode, Explorer, the API app, or any
 * chain/RPC client — is a boundary violation, not a review preference.
 */
const ALLOWED_SOURCE_SPECIFIERS = ["@parallax/contracts", "zod"];
const ALLOWED_TEST_SPECIFIERS = [
  ...ALLOWED_SOURCE_SPECIFIERS,
  "vitest",
  "node:fs",
  "node:url",
];
const ALLOWED_EXAMPLE_SPECIFIERS = ["@parallax/sdk", "@parallax/contracts"];

const FORBIDDEN_PREFIXES = [
  "@parallax/risk",
  "@parallax/orchestrator",
  "@parallax/moss-bridge",
  "@parallax/api",
  "@parallax/web",
  "hono",
  "pg",
  "viem",
  "ethers",
];

const STATIC_IMPORT_PATTERN =
  /(?:^|[\s;])(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs;
const SIDE_EFFECT_IMPORT_PATTERN = /(?:^|[\s;])import\s*["']([^"']+)["']/gs;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']/gs;
const REQUIRE_PATTERN = /\brequire\s*\(\s*["']([^"']+)["']/gs;

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [
    STATIC_IMPORT_PATTERN,
    SIDE_EFFECT_IMPORT_PATTERN,
    DYNAMIC_IMPORT_PATTERN,
    REQUIRE_PATTERN,
  ]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function typescriptFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => fileURLToPath(new URL(entry.name, directory)));
}

function sourceViolations(files: string[], allowed: string[]): string[] {
  return files.flatMap((file) =>
    importSpecifiers(readFileSync(file, "utf8"))
      .filter(
        (specifier) =>
          !specifier.startsWith(".") && !allowed.includes(specifier),
      )
      .map((specifier) => `${file} imports ${specifier}`),
  );
}

describe("SDK import boundary", () => {
  const srcFiles = typescriptFiles(new URL("./", import.meta.url));
  const sourceFiles = srcFiles.filter((file) => !file.endsWith(".test.ts"));
  const testFiles = srcFiles.filter((file) => file.endsWith(".test.ts"));
  const exampleFiles = typescriptFiles(
    new URL("../examples/", import.meta.url),
  );

  it("finds the SDK sources it is meant to guard", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(exampleFiles.length).toBeGreaterThan(0);
  });

  it("imports only canonical contracts, zod, and relative modules", () => {
    expect(sourceViolations(sourceFiles, ALLOWED_SOURCE_SPECIFIERS)).toEqual(
      [],
    );
  });

  it("keeps tests and the reference example inside the same boundary", () => {
    expect(sourceViolations(testFiles, ALLOWED_TEST_SPECIFIERS)).toEqual([]);
    expect(sourceViolations(exampleFiles, ALLOWED_EXAMPLE_SPECIFIERS)).toEqual(
      [],
    );
  });

  it("never reaches Provider, Risk, QuickNode, or Explorer code", () => {
    const hits = [...sourceFiles, ...testFiles, ...exampleFiles].flatMap(
      (file) =>
        importSpecifiers(readFileSync(file, "utf8"))
          .filter((specifier) =>
            FORBIDDEN_PREFIXES.some(
              (prefix) =>
                specifier === prefix || specifier.startsWith(`${prefix}/`),
            ),
          )
          .map((specifier) => `${file} imports ${specifier}`),
    );
    expect(hits).toEqual([]);
  });

  it("depends only on @parallax/contracts and zod", () => {
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      "@parallax/contracts",
      "zod",
    ]);
    expect(packageJson.devDependencies ?? {}).toEqual({});
  });
});

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoProductionRuntimeSourceChanges,
  assertUnchangedBackendGoldenPathSource,
  captureBackendGoldenPathProvenance,
} from "./backend-golden-path-provenance.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("Backend Golden Path source provenance", () => {
  it("covers the live Backend and risk runtime source", () => {
    const provenance = captureBackendGoldenPathProvenance(REPO_ROOT);
    const paths = new Set(provenance.files.map((file) => file.path));

    expect(paths.has("apps/api/src/backend/arbitrum-composition.ts")).toBe(
      true,
    );
    expect(paths.has("packages/risk/src/index.ts")).toBe(true);
    expect(provenance.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails when the runtime source manifest changes", () => {
    const before = captureBackendGoldenPathProvenance(REPO_ROOT);

    expect(() =>
      assertUnchangedBackendGoldenPathSource(before, {
        ...before,
        manifestSha256: "changed",
      }),
    ).toThrow("source changed during execution");
  });

  it("rejects modified production runtime source but allows harness changes", () => {
    const before = captureBackendGoldenPathProvenance(REPO_ROOT);

    expect(() =>
      assertNoProductionRuntimeSourceChanges({
        ...before,
        changedPaths: ["scripts/backend-gates/backend-golden-path-live.ts"],
      }),
    ).not.toThrow();
    expect(() =>
      assertNoProductionRuntimeSourceChanges({
        ...before,
        changedPaths: ["apps/api/src/application.ts"],
      }),
    ).toThrow("clean production runtime source");
  });
});

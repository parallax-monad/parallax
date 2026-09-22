import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertUnchangedSource,
  captureSourceProvenance,
} from "./native-rpc-source-provenance.js";

const roots: string[] = [];
function repository() {
  const root = mkdtempSync(join(tmpdir(), "native-rpc-provenance-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(join(root, "package.json"), "{}");
  execFileSync("git", ["add", "package.json"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "test",
    ],
    { cwd: root },
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Native RPC source provenance", () => {
  it("records uncommitted runtime sources, detects changes, and excludes local credentials", () => {
    const root = repository();
    const clean = captureSourceProvenance(root);
    expect(clean.worktreeDirty).toBe(false);
    mkdirSync(join(root, "apps/api/src/backend"), { recursive: true });
    const builder = "apps/api/src/backend/native-rpc-canonical-exercise.ts";
    writeFileSync(join(root, builder), "export const version = 1;");
    writeFileSync(join(root, ".env"), "SECRET=sentinel-do-not-record");
    const before = captureSourceProvenance(root);
    expect(before.worktreeDirty).toBe(true);
    expect(before.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: builder,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      ]),
    );
    expect(JSON.stringify(before)).not.toMatch(/sentinel|\.env/);
    expect(() =>
      assertUnchangedSource(before, captureSourceProvenance(root)),
    ).not.toThrow();
    writeFileSync(join(root, builder), "export const version = 2;");
    const after = captureSourceProvenance(root);
    expect(after.repositoryHead).toBe(before.repositoryHead);
    expect(after.manifestSha256).not.toBe(before.manifestSha256);
    expect(() => assertUnchangedSource(before, after)).toThrow(
      /source changed/,
    );
  });
});

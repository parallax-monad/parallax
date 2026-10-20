import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const runnerPath = resolve(scriptDirectory, "run-host.mjs");

describe("Arbitrum One fork host runner", () => {
  it("loads the quote harness with native Node TypeScript support, without tsx", () => {
    const isolatedGitDir = mkdtempSync(
      join(tmpdir(), "parallax-fork-host-runner-git-"),
    );
    try {
      const gitInit = spawnSync("git", ["init", "--bare", isolatedGitDir], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(gitInit.error).toBeUndefined();
      expect(gitInit.status).toBe(0);

      const env = {
        PATH: process.env.PATH ?? "",
        GIT_DIR: isolatedGitDir,
        ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
        ...(process.env.USER === undefined ? {} : { USER: process.env.USER }),
      };
      const result = spawnSync(
        process.execPath,
        [
          "--disable-warning=ExperimentalWarning",
          "--experimental-strip-types",
          "--experimental-transform-types",
          runnerPath,
          "start",
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env,
          timeout: 30_000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("UPSTREAM_ENDPOINT_REQUIRED:");
      expect(result.stderr).not.toMatch(/tsx|esbuild|@esbuild/i);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(isolatedGitDir, { recursive: true, force: true });
    }
  });
});

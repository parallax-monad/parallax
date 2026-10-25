import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
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
    const fakeDockerDirectory = mkdtempSync(
      join(repositoryRoot, ".tmp-parallax-fork-host-runner-docker-"),
    );
    try {
      writeFileSync(
        join(fakeDockerDirectory, "docker"),
        ["#!/bin/sh", "exit 0", ""].join("\n"),
        { mode: 0o755 },
      );
      const gitInit = spawnSync("git", ["init", "--bare", isolatedGitDir], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(gitInit.error).toBeUndefined();
      expect(gitInit.status).toBe(0);

      const env = {
        PATH: [fakeDockerDirectory, process.env.PATH ?? ""]
          .filter((part) => part !== "")
          .join(delimiter),
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
      rmSync(fakeDockerDirectory, { recursive: true, force: true });
    }
  });

  it("reports a sanitized Git metadata failure when manager import cannot resolve Git", () => {
    const fakeGitDirectory = mkdtempSync(
      join(repositoryRoot, ".tmp-parallax-fork-host-runner-fake-git-"),
    );
    try {
      writeFileSync(
        join(fakeGitDirectory, "git"),
        "#!/bin/sh\nprintf '%s\\n' 'GIT_STDERR_SENTINEL' >&2\nexit 73\n",
        { mode: 0o755 },
      );
      const env = {
        PATH: [fakeGitDirectory, process.env.PATH ?? ""]
          .filter((part) => part !== "")
          .join(delimiter),
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
      expect(result.stderr).toContain("GIT_METADATA_UNAVAILABLE:");
      expect(result.stderr).toContain("rev-parse exited with status 73");
      expect(result.stderr).toContain(".git pointer");
      expect(result.stderr).not.toContain("ReferenceError");
      expect(result.stderr).not.toContain("GIT_STDERR_SENTINEL");
      expect(result.stdout).toBe("");
    } finally {
      rmSync(fakeGitDirectory, { recursive: true, force: true });
    }
  });
});

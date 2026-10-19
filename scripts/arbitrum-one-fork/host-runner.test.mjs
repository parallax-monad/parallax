import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const runnerPath = resolve(scriptDirectory, "run-host.mjs");

describe("Arbitrum One fork host runner", () => {
  it("loads the quote harness with native Node TypeScript support, without tsx", () => {
    const env = {
      PATH: process.env.PATH ?? "",
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
  });
});

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Hash the Backend/runtime source that the exercise loads, plus its package
// and lockfile inputs. Local configuration and RPC credentials stay outside
// this manifest; their values must never enter the capture.
const SOURCE_PATHS = [
  "apps/api/src",
  "packages/contracts/src",
  "packages/moss-bridge/src",
  "packages/orchestrator/agent-flow",
  "packages/orchestrator/application",
  "packages/risk/src",
  "scripts/backend-gates/backend-golden-path-assertions.ts",
  "scripts/backend-gates/backend-golden-path-live.ts",
  "scripts/backend-gates/backend-golden-path-provenance.ts",
  "package.json",
  "apps/api/package.json",
  "packages/contracts/package.json",
  "packages/moss-bridge/package.json",
  "packages/orchestrator/package.json",
  "packages/risk/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "apps/api/tsconfig.json",
  "packages/contracts/tsconfig.json",
  "packages/moss-bridge/tsconfig.json",
  "packages/orchestrator/tsconfig.json",
  "packages/risk/tsconfig.json",
] as const;
const PRODUCTION_RUNTIME_PREFIXES = [
  "apps/api/src/",
  "packages/contracts/src/",
  "packages/moss-bridge/src/",
  "packages/orchestrator/agent-flow/",
  "packages/orchestrator/application/",
  "packages/risk/src/",
] as const;

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function captureBackendGoldenPathProvenance(repoRoot: string) {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  const paths = [
    ...new Set(
      git(
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...SOURCE_PATHS,
      )
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .filter((path) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))
    .sort();
  const changedPaths = git(
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...SOURCE_PATHS,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
  const files = paths.map((path) => ({
    path,
    sha256: sha256(readFileSync(join(repoRoot, path))),
  }));
  return {
    repositoryHead: git("rev-parse", "HEAD").trim(),
    worktreeDirty:
      git("status", "--porcelain", "--untracked-files=all").length > 0,
    changedPaths,
    nodeVersion: process.version,
    files,
    manifestSha256: sha256(JSON.stringify(files)),
  };
}

export function assertNoProductionRuntimeSourceChanges(
  provenance: ReturnType<typeof captureBackendGoldenPathProvenance>,
): void {
  const changedRuntimePaths = provenance.changedPaths.filter((path) =>
    PRODUCTION_RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
  if (changedRuntimePaths.length > 0) {
    throw new Error(
      `Backend Golden Path requires clean production runtime source: ${changedRuntimePaths.join(", ")}`,
    );
  }
}

export function assertUnchangedBackendGoldenPathSource(
  before: ReturnType<typeof captureBackendGoldenPathProvenance>,
  after: ReturnType<typeof captureBackendGoldenPathProvenance>,
): void {
  if (
    before.repositoryHead !== after.repositoryHead ||
    before.manifestSha256 !== after.manifestSha256
  ) {
    throw new Error("Backend Golden Path source changed during execution");
  }
}

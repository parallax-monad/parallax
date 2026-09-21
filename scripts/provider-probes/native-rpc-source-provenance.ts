import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cover the runner, Backend runtime and Contracts source, plus dependency/build
// inputs. Keep local configuration and RPC credentials outside this allowlist.
const SOURCE_PATHS = [
  "apps/api/src/backend",
  "packages/contracts/src",
  "scripts/provider-probes/native-rpc-canonical-exercise.ts",
  "scripts/provider-probes/native-rpc-source-provenance.ts",
  "package.json",
  "apps/api/package.json",
  "packages/contracts/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "apps/api/tsconfig.json",
  "packages/contracts/tsconfig.json",
];

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function captureSourceProvenance(repoRoot: string) {
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
  const files = paths.map((path) => ({
    path,
    sha256: sha256(readFileSync(join(repoRoot, path))),
  }));
  return {
    repositoryHead: git("rev-parse", "HEAD").trim(),
    worktreeDirty:
      git("status", "--porcelain", "--untracked-files=all").length > 0,
    nodeVersion: process.version,
    files,
    manifestSha256: sha256(JSON.stringify(files)),
  };
}

export function assertUnchangedSource(
  before: ReturnType<typeof captureSourceProvenance>,
  after: ReturnType<typeof captureSourceProvenance>,
): void {
  if (
    before.repositoryHead !== after.repositoryHead ||
    before.manifestSha256 !== after.manifestSha256
  ) {
    throw new Error("Native RPC exercise source changed during execution");
  }
}

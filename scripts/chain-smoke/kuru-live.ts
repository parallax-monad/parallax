/**
 * Kuru MON -> USDC live smoke.
 *
 * Runs the full live chain discover -> load -> quote -> action -> simulate
 * against a pinned Moss runtime and a read-only Monad RPC. Never signs or
 * broadcasts. Always writes sanitized evidence to the gitignored
 * `.smoke-live/<run-id>/` directory (raw.json, normalized.json, metadata.json),
 * whether the run succeeds or fails. The formal
 * `fixtures/chain-evidence/kuru/live-success-mon-to-usdc/` fixture is written
 * only when every acceptance condition passes.
 *
 * Timeout model (two layers):
 *   - Vitest outer testTimeout: 120s (vitest.smoke.config.ts)
 *   - Adapter internal: 30s per stage, 90s whole chain, both shorter than the
 *     outer deadline so TIMEOUT is captured, logged, and persisted before the
 *     test runner can kill the process. A timeout maps to
 *     integrationStatus=TIMEOUT / executionStatus=UNKNOWN, never to STOP.
 *
 * Required environment variables (values are never printed):
 *   MOSS_RPC_URL         - read-only Monad mainnet RPC
 *   MOSS_RUNTIME_PATH    - pinned Moss checkout with built workspace packages
 *   MOSS_RUNTIME_VERSION - exact @themoss/core version (e.g. 0.1.0)
 *   MOSS_RUNTIME_REVISION- immutable Moss git commit
 *
 * Missing inputs produce a persisted configuration artifact and a non-zero
 * result; a smoke without the real runtime/RPC is not an acceptance success.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateLiveAcceptance,
  liveSuccessOf,
  MONAD_CHAIN_ID,
  MONAD_USDC_ADDRESS,
  p0DecisionCandidate,
  runKuruLiveSwap,
  toJsonValue,
} from "@parallax/moss-bridge";
import { expect, test } from "vitest";
import { bootstrapBackendApp } from "../../apps/api/src/bootstrap/backend.js";
import { runResultSchema } from "../../packages/contracts/src/index.js";
import type { KuruLiveRunner } from "../../packages/orchestrator/agent-flow/index.js";
import {
  apiCheckAcceptanceOf,
  apiCheckProvenanceMatchesOf,
} from "./live-smoke-acceptance.js";
import { formatRepositoryJson } from "./repository-json.js";

const rpcUrl = process.env.MOSS_RPC_URL;
const runtimePath = process.env.MOSS_RUNTIME_PATH;
const runtimeVersion = process.env.MOSS_RUNTIME_VERSION?.trim() || undefined;
const runtimeRevision = process.env.MOSS_RUNTIME_REVISION;
const sender =
  process.env.MOSS_SENDER ?? "0xcccccccccccccccccccccccccccccccccccccccc";

// scripts/chain-smoke/kuru-live.ts -> repo root needs two levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const smokeOutDir = join(repoRoot, ".smoke-live");
const fixtureDir = join(
  repoRoot,
  "fixtures",
  "chain-evidence",
  "kuru",
  "live-success-mon-to-usdc",
);

const apiTokenRegistry = {
  chains: [{ chainId: 143, symbol: "MON", decimals: 18 }],
  tokens: [
    {
      chainId: 143,
      address: MONAD_USDC_ADDRESS,
      symbol: "USDC",
      decimals: 6,
      decimalsSource: "onchain_verified" as const,
      verifiedAtBlock: "90000000",
    },
  ],
};

const apiCheckRequest = {
  chainId: 143,
  protocol: "kuru" as const,
  sender,
  tokenIn: { kind: "native" as const },
  tokenOut: { kind: "erc20" as const, address: MONAD_USDC_ADDRESS },
  amountIn: "0.01",
  economicBoundary: {
    availability: "unavailable" as const,
    source: "unavailable" as const,
  },
};

function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  // Deterministic Biome-compatible repository JSON (see repository-json.ts) so
  // generated evidence artifacts pass `pnpm lint` without a formatting
  // subprocess. Serialization order is the parsed object's own order.
  writeFileSync(join(dir, name), formatRepositoryJson(toJsonValue(value)));
}

function baseMetadata(
  runId: string,
  startedAt: string,
): Record<string, unknown> {
  let parallaxCommit = "unknown";
  try {
    parallaxCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    // non-git checkout: leave as unknown
  }
  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    nodeVersion: process.version,
    pnpmVersion: process.env.npm_config_user_agent ?? "unknown",
    parallaxCommit,
    mossRuntimeVersion: runtimeVersion ?? null,
    mossRuntimeRevision: runtimeRevision ?? null,
    chainId: MONAD_CHAIN_ID,
    sender,
    tokenIn: "MON",
    tokenOut: MONAD_USDC_ADDRESS,
    amountIn: "0.01",
    protocol: "kuru",
    direction: "MON_TO_USDC",
    rpcType: "environment-supplied",
    replayMode: false,
    isReplay: false,
    isMock: false,
    // RPC URL is deliberately never persisted.
  };
}

function stageStatus(
  stages: Awaited<ReturnType<typeof runKuruLiveSwap>>["stages"],
) {
  return stages.map((stage) => ({
    stage: stage.stage,
    status: stage.success
      ? "OK"
      : stage.error?.code === "TIMEOUT"
        ? "TIMEOUT"
        : "FAILED",
    blockNumber: stage.blockNumber ?? null,
    durationMs: stage.finishedAt
      ? Math.max(0, Date.parse(stage.finishedAt) - Date.parse(stage.startedAt))
      : null,
    error: stage.error ? toJsonValue(stage.error) : null,
  }));
}

test("kuru live smoke: MON -> USDC", async () => {
  const runId = `kuru-live-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const artifactDir = join(smokeOutDir, runId);
  if (!rpcUrl || !runtimePath || !runtimeVersion || !runtimeRevision) {
    const missing = [
      !rpcUrl && "MOSS_RPC_URL",
      !runtimePath && "MOSS_RUNTIME_PATH",
      !runtimeVersion && "MOSS_RUNTIME_VERSION",
      !runtimeRevision && "MOSS_RUNTIME_REVISION",
    ].filter(Boolean);
    const metadata = {
      ...baseMetadata(runId, startedAt),
      status: "CONFIGURATION_ERROR",
      liveSuccess: false,
      p0DecisionCandidate: "P0_LIVE_BLOCKED_PORTABLE_RUNTIME",
      failureStage: "INIT",
      failureCode: "MISSING_CONFIGURATION",
      missingEnvironment: missing,
    };
    writeJson(artifactDir, "raw.json", {});
    writeJson(artifactDir, "normalized.json", {
      integrationStatus: "UNAVAILABLE",
      executionStatus: "UNKNOWN",
      isReplay: false,
      isMock: false,
      replayMode: false,
      limitations: ["Live smoke configuration is incomplete."],
    });
    writeJson(artifactDir, "api-check.json", {});
    writeJson(artifactDir, "metadata.json", metadata);
    console.log(
      `LIVE_SMOKE_NOT_RUN missing=${missing.join(",")} artifact=${artifactDir} node=${process.version}`,
    );
    expect.fail(`Live smoke requires: ${missing.join(", ")}`);
    return;
  }

  let result: Awaited<ReturnType<typeof runKuruLiveSwap>> | undefined;
  let apiResponseStatus: number | undefined;
  let apiResponseBody: unknown;
  try {
    // Exercise the real configured Agent Flow selection and HTTP application
    // boundary. The injected runner is still the real Moss adapter; it only
    // lets this smoke persist the raw adapter result alongside the public
    // /api/check response without replacing the Agent Flow under test.
    let captured: Awaited<ReturnType<typeof runKuruLiveSwap>> | undefined;
    const liveRunner: KuruLiveRunner = async (adapterInput) => {
      const live = await runKuruLiveSwap({
        ...adapterInput,
        logger: (line) => console.log(line),
      });
      captured = live;
      return live;
    };
    const app = bootstrapBackendApp({
      environment: {
        MONAD_RPC_URL: rpcUrl,
        MOSS_RUNTIME_PATH: runtimePath,
        MOSS_RUNTIME_VERSION: runtimeVersion,
        MOSS_RUNTIME_REVISION: runtimeRevision,
      },
      tokenRegistry: apiTokenRegistry,
      liveRunner,
    });
    const response = await app.fetch(
      new Request("https://smoke.local/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(apiCheckRequest),
      }),
    );
    apiResponseStatus = response.status;
    apiResponseBody = await response.json();
    result = captured;
    if (result === undefined) {
      throw new Error(
        "The live /api/check smoke returned without a captured Moss result",
      );
    }
  } catch (error) {
    // Overall deadline, runtime mismatch, or unexpected init failure.
    const failureCode =
      error instanceof Error && error.name === "StageTimeoutError"
        ? "TIMEOUT"
        : "INTEGRATION_ERROR";
    const metadata = {
      ...baseMetadata(runId, startedAt),
      status: "FAILED",
      liveSuccess: false,
      failureStage: "INIT",
      failureCode,
      p0DecisionCandidate: "P0_LIVE_BLOCKED_PORTABLE_RUNTIME",
      stageStatuses: [],
      blockProvenance: null,
      apiCheckStatus: apiResponseStatus ?? null,
      error: toJsonValue(error instanceof Error ? error.message : error),
    };
    writeJson(artifactDir, "raw.json", {});
    writeJson(artifactDir, "normalized.json", {
      integrationStatus:
        failureCode === "TIMEOUT" ? "TIMEOUT" : "INTEGRATION_ERROR",
      executionStatus: "UNKNOWN",
      isReplay: false,
      isMock: false,
      replayMode: false,
      limitations: ["Live chain did not produce evidence; see metadata."],
    });
    writeJson(artifactDir, "api-check.json", apiResponseBody ?? {});
    writeJson(artifactDir, "metadata.json", metadata);
    console.error(
      `LIVE_SMOKE_FAILED stage=INIT code=${failureCode} artifact=${artifactDir}`,
    );
    // An internal timeout may leave an in-flight request holding the event
    // loop; exit explicitly so the process can terminate.
    process.exit(1);
    return;
  }

  const evidence = result.evidence;
  const coverage = evidence.simulationCoverage.value;

  // Always persist sanitized evidence.
  writeJson(artifactDir, "raw.json", result.raw);
  writeJson(artifactDir, "normalized.json", evidence);
  writeJson(artifactDir, "api-check.json", apiResponseBody ?? {});

  // The adapter acceptance gate is canonical for live evidence. The smoke adds
  // the independent requirement that the public /api/check boundary succeeded
  // and returned the same run/provenance.
  const acceptance = evaluateLiveAcceptance(result, {
    runtimeVersion,
    runtimeRevision,
  });
  const apiCheckAcceptance = apiCheckAcceptanceOf(apiResponseBody);
  const apiCheck = runResultSchema.safeParse(apiResponseBody);
  const apiCheckProvenanceMatches = apiCheckProvenanceMatchesOf(
    apiResponseBody,
    {
      simulatorPinnedBlock: result.simulatorPinnedBlock,
      observedChainId: result.observedChainId,
      evidence: {
        runtimeVersion: result.evidence.runtimeVersion,
        runtimeRevision: result.evidence.runtimeRevision,
      },
    },
  );
  const liveSuccess =
    apiResponseStatus === 200 &&
    apiCheckAcceptance &&
    apiCheckProvenanceMatches &&
    liveSuccessOf(acceptance);
  const apiVerdict = apiCheck.success ? apiCheck.data.verdict : undefined;
  // The full technical Live gate passed; the canonical Verdict may
  // legitimately be a fail-closed UNKNOWN (no economic boundary provided).
  // PROCEED is a business verdict and is never manufactured by the smoke.
  const productProceed = liveSuccess && apiVerdict === "PROCEED";
  const adapterDecision = p0DecisionCandidate(result, {
    runtimeVersion,
    runtimeRevision,
  });
  const decision = liveSuccess
    ? productProceed
      ? "P0_LIVE_READY"
      : "VALID_LIVE_UNKNOWN"
    : adapterDecision === "P0_LIVE_READY"
      ? "P0_LIVE_BLOCKED_SIMULATION"
      : adapterDecision;

  const failedStage = result.stages.find((stage) => !stage.success);
  const status =
    evidence.integrationStatus === "TIMEOUT"
      ? "FAILED"
      : failedStage
        ? "PARTIALLY_VERIFIED"
        : liveSuccess
          ? productProceed
            ? "PARTIALLY_VERIFIED"
            : "VALID_LIVE_UNKNOWN"
          : "FAILED";
  const metadata = {
    ...baseMetadata(runId, startedAt),
    status,
    liveSuccess,
    failureStage: liveSuccess ? null : (failedStage?.stage ?? "SIMULATE"),
    failureCode: liveSuccess
      ? null
      : (failedStage?.error?.code ??
        (evidence.integrationStatus === "TIMEOUT" ? "TIMEOUT" : "UNKNOWN")),
    p0DecisionCandidate: decision,
    apiCheckStatus: apiResponseStatus ?? null,
    apiCheckSchemaValid: apiCheck.success,
    apiVerdict: apiVerdict ?? null,
    apiCheckAcceptance,
    apiCheckProvenanceMatches,
    observedChainId: result.observedChainId ?? null,
    simulatorPinnedBlock: result.simulatorPinnedBlock ?? null,
    stageStatuses: stageStatus(result.stages),
    blockProvenance: {
      initial: result.evidence.blockNumber.value,
      perStage: result.stages.map((stage) => ({
        stage: stage.stage,
        blockNumber: stage.blockNumber ?? null,
      })),
    },
    simulationCoverage: coverage ? toJsonValue(coverage) : null,
    executionStatus: evidence.executionStatus,
    integrationStatus: evidence.integrationStatus,
    limitations: evidence.limitations,
  };
  writeJson(artifactDir, "metadata.json", metadata);

  if (!liveSuccess) {
    const flipOrderBlocked = JSON.stringify(
      evidence.warnings.value ?? [],
    ).includes("FlipOrderUpdated");
    console.error(
      `LIVE_SMOKE_FAILED execution=${evidence.executionStatus} integration=${evidence.integrationStatus} flipOrderUpdated=${flipOrderBlocked} coverageComplete=${coverage?.complete ?? false} artifact=${artifactDir}`,
    );
    if (evidence.integrationStatus === "TIMEOUT") {
      // An internal timeout may leave an in-flight request holding the event
      // loop; exit explicitly so the process can terminate.
      process.exit(1);
    }
    expect(false, JSON.stringify({ acceptance }, null, 2)).toBe(true);
    return;
  }

  if (!productProceed) {
    // The full technical Live gate passed but the canonical Verdict is a
    // legitimate non-PROCEED (e.g. UNKNOWN without an economic boundary). This
    // is a completed authoritative Live UNKNOWN, never a green PROCEED result
    // and not an integration failure.
    console.log(
      `LIVE_SMOKE_VALID_UNKNOWN execution=${evidence.executionStatus} integration=${evidence.integrationStatus} verdict=${apiVerdict} artifact=${artifactDir}`,
    );
    return;
  }

  // Write the formal fixture only after every acceptance condition passes.
  writeJson(fixtureDir, "raw.json", result.raw);
  writeJson(fixtureDir, "normalized.json", evidence);
  writeJson(fixtureDir, "metadata.json", {
    ...metadata,
    fixtureType: "LIVE_SIMULATION",
    real: true,
  });
  rmSync(artifactDir, { recursive: true, force: true });
  console.log(
    `LIVE_SMOKE_PASSED execution=SUCCESS block=${evidence.blockNumber.value} fixture=${fixtureDir}`,
  );
});

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
 *   MOSS_RUNTIME_REVISION- immutable Moss git commit or package identity
 *
 * When MOSS_RPC_URL is absent the smoke reports LIVE_SMOKE_NOT_RUN and passes;
 * that is a configuration state, not an implementation failure.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MONAD_CHAIN_ID,
  MONAD_USDC_ADDRESS,
  runKuruLiveSwap,
  toJsonValue,
} from "@parallax/moss-bridge";
import { expect, test } from "vitest";

const rpcUrl = process.env.MOSS_RPC_URL;
const runtimePath = process.env.MOSS_RUNTIME_PATH;
const runtimeVersion = process.env.MOSS_RUNTIME_VERSION ?? "0.1.0";
const runtimeRevision = process.env.MOSS_RUNTIME_REVISION;
const sender =
  process.env.MOSS_SENDER ?? "0xcccccccccccccccccccccccccccccccccccccccc";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const smokeOutDir = join(repoRoot, ".smoke-live");
const fixtureDir = join(
  repoRoot,
  "fixtures",
  "chain-evidence",
  "kuru",
  "live-success-mon-to-usdc",
);

const intent = {
  chainId: MONAD_CHAIN_ID,
  sender,
  tokenIn: "MON",
  tokenOut: MONAD_USDC_ADDRESS,
  amountIn: "0.01",
  minimumReceivedSource: "unavailable" as const,
};

function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    `${JSON.stringify(toJsonValue(value), null, 2)}\n`,
  );
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
    mossRuntimeVersion: runtimeVersion,
    mossRuntimeRevision: runtimeRevision,
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

function p0Candidate(
  evidence: Awaited<ReturnType<typeof runKuruLiveSwap>>["evidence"],
  stages: Awaited<ReturnType<typeof runKuruLiveSwap>>["stages"],
): string {
  const failedStage = stages.find((stage) => !stage.success);
  const stage = failedStage?.stage;
  const code = failedStage?.error?.code;
  if (
    evidence.executionStatus === "SUCCESS" &&
    evidence.simulationCoverage.value?.complete === true
  ) {
    return "P0_LIVE_READY";
  }
  if (
    code === "UNAVAILABLE" ||
    code === "INTEGRATION_ERROR" ||
    stage === undefined
  ) {
    return "P0_LIVE_BLOCKED_PORTABLE_RUNTIME";
  }
  // Timeout, NO_ROUTE, REVERTED, halted, or incomplete coverage all mean the
  // live chain did not complete simulation -> simulation-blocked.
  return "P0_LIVE_BLOCKED_SIMULATION";
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
  if (!rpcUrl || !runtimePath || !runtimeRevision) {
    const missing = [
      !rpcUrl && "MOSS_RPC_URL",
      !runtimePath && "MOSS_RUNTIME_PATH",
      !runtimeRevision && "MOSS_RUNTIME_REVISION",
    ].filter(Boolean);
    console.log(
      `LIVE_SMOKE_NOT_RUN missing=${missing.join(",")} node=${process.version}`,
    );
    expect(true).toBe(true);
    return;
  }

  const runId = `kuru-live-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const artifactDir = join(smokeOutDir, runId);
  let result: Awaited<ReturnType<typeof runKuruLiveSwap>> | undefined;
  try {
    result = await runKuruLiveSwap({
      runId,
      intent,
      rpcUrl,
      runtimePath,
      runtimeVersion,
      runtimeRevision,
      logger: (line) => console.log(line),
    });
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

  const acceptance = {
    discoverOk:
      result.stages.find((stage) => stage.stage === "DISCOVER")?.success ===
      true,
    loadOk:
      result.stages.find((stage) => stage.stage === "LOAD")?.success === true,
    quoteRouteAvailable: evidence.quote.value !== null,
    actionTransactionNonEmpty:
      Array.isArray(evidence.action.value) && evidence.action.value.length > 0,
    simulateCoversAllActions:
      coverage?.expectedTransactions === coverage?.observedResults,
    transactionIdentityMatched:
      coverage?.missingTransactionIndexes.length === 0 &&
      coverage?.unmatchedResultIndexes.length === 0,
    simulationNotHalted: coverage?.halted !== true,
    noUnmatchedResult: coverage?.unmatchedResultIndexes.length === 0,
    noMissingTransaction: coverage?.missingTransactionIndexes.length === 0,
    notReverted: evidence.executionStatus !== "REVERTED",
    receiptPresent: evidence.receipt.value !== null,
    outcomeParsed: evidence.outcome.value !== null,
    flipOrderUpdatedNotBlocking: !JSON.stringify(
      evidence.warnings.value ?? [],
    ).includes("FlipOrderUpdated"),
    runtimeProvenanceComplete:
      evidence.runtimeVersion === runtimeVersion &&
      evidence.runtimeRevision === runtimeRevision,
    blockProvenanceComplete: evidence.blockNumber.value !== null,
    isReplayFalse: evidence.isReplay === false,
    isMockFalse: evidence.isMock === false,
    executionSucceeded: evidence.executionStatus === "SUCCESS",
  };

  const passed = Object.values(acceptance).every(Boolean);
  const failedStage = result.stages.find((stage) => !stage.success);
  const status =
    evidence.integrationStatus === "TIMEOUT"
      ? "FAILED"
      : failedStage
        ? "PARTIALLY_VERIFIED"
        : passed
          ? "PARTIALLY_VERIFIED"
          : "FAILED";
  const metadata = {
    ...baseMetadata(runId, startedAt),
    status,
    liveSuccess: passed,
    failureStage: passed ? null : (failedStage?.stage ?? "SIMULATE"),
    failureCode: passed
      ? null
      : (failedStage?.error?.code ??
        (evidence.integrationStatus === "TIMEOUT" ? "TIMEOUT" : "UNKNOWN")),
    p0DecisionCandidate: p0Candidate(evidence, result.stages),
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

  if (!passed) {
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

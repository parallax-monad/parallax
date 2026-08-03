/**
 * Kuru MON -> USDC live smoke.
 *
 * Runs the full live chain discover -> load -> quote -> action -> simulate
 * against a pinned Moss runtime and a read-only Monad RPC. Never signs or
 * broadcasts. Only writes the formal `live-success-mon-to-usdc` fixture when
 * every acceptance condition passes; failed raw output goes to the gitignored
 * `.smoke-live/` directory and the command exits non-zero.
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
const tempOutDir = join(repoRoot, ".smoke-live");
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
  const result = await runKuruLiveSwap({
    runId,
    intent,
    rpcUrl,
    runtimePath,
    runtimeVersion,
    runtimeRevision,
  });

  // Always persist sanitized raw output to the gitignored temp directory.
  mkdirSync(tempOutDir, { recursive: true });
  writeFileSync(
    join(tempOutDir, `${runId}.raw.json`),
    `${JSON.stringify(toJsonValue(result.raw), null, 2)}\n`,
  );
  writeFileSync(
    join(tempOutDir, `${runId}.stages.json`),
    `${JSON.stringify(toJsonValue(result.stages), null, 2)}\n`,
  );

  for (const stage of result.stages) {
    console.log(
      `${stage.stage}: ${stage.success ? "OK" : "FAILED"} block=${
        stage.blockNumber ?? "n/a"
      } elapsed=${stage.finishedAt}`,
    );
  }

  const evidence = result.evidence;
  const coverage = evidence.simulationCoverage.value;
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
  if (!passed) {
    writeFileSync(
      join(tempOutDir, `${runId}.acceptance.json`),
      `${JSON.stringify(acceptance, null, 2)}\n`,
    );
    console.error(
      `LIVE_SMOKE_FAILED ${JSON.stringify(
        { acceptance, executionStatus: evidence.executionStatus },
        null,
        2,
      )}`,
    );
    throw new Error("Kuru live smoke acceptance failed");
  }

  // Write the formal fixture only after every acceptance condition passes.
  const metadata = {
    fixtureType: "LIVE_SIMULATION",
    real: true,
    runId,
    recordedAt: new Date().toISOString(),
    chainId: MONAD_CHAIN_ID,
    blockNumber: evidence.blockNumber.value,
    mossVersion: evidence.mossVersion,
    mossCommit: runtimeRevision,
    runtimeVersion,
    runtimeRevision,
    packageVersions: result.runtime.packageVersions,
    nodeVersion: process.version,
    pnpmVersion: process.env.npm_config_user_agent ?? "unknown",
    rpcType: "environment-supplied",
    sender,
    tokenIn: "MON",
    tokenOut: MONAD_USDC_ADDRESS,
    amountIn: "0.01",
    protocol: "kuru",
    direction: "MON_TO_USDC",
    replayMode: false,
    isReplay: false,
    isMock: false,
    syntheticPrestate: "NATIVE_PREFUND_ONLY",
    walletAffordabilityChecked: false,
    stageStatus: result.stages.map((stage) => ({
      stage: stage.stage,
      status: stage.success ? "OK" : "FAILED",
      blockNumber: stage.blockNumber ?? null,
      error: stage.error ? toJsonValue(stage.error) : null,
    })),
    limitations: evidence.limitations,
  };
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, "raw.json"),
    `${JSON.stringify(toJsonValue(result.raw), null, 2)}\n`,
  );
  writeFileSync(
    join(fixtureDir, "normalized.json"),
    `${JSON.stringify(toJsonValue(evidence), null, 2)}\n`,
  );
  writeFileSync(
    join(fixtureDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  rmSync(tempOutDir, { recursive: true, force: true });
  console.log(
    `LIVE_SMOKE_PASSED execution=SUCCESS block=${evidence.blockNumber.value} fixture=${fixtureDir}`,
  );
});

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CanonicalNativeRpcCapture,
  createCanonicalNativeRpcEvaluationInput,
} from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import {
  createTraceRpcEvidenceSource,
  type TraceRpcEvidenceResult,
} from "../../apps/api/src/backend/trace-rpc-evidence-source.js";
import { assertAcceptedSourceFixture } from "./native-rpc-canonical-exercise.js";
import {
  assertUnchangedSource,
  captureSourceProvenance,
} from "./native-rpc-source-provenance.js";

const CANONICAL_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";

const ACCEPTED_TRACE_BASELINE =
  "fixtures/provider-registry/be-078/quicknode-canonical-2026-09-25T03-40-05-885Z/capture.json";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");

type AcceptedTraceBaseline = {
  readonly status: string;
  readonly real: boolean;
  readonly readOnly: boolean;
  readonly traceEvidence: {
    readonly callTracer: {
      readonly status: string;
      readonly gasUsed: string;
      readonly output: string;
      readonly resultSha256: string;
    };
    readonly prestateTracer: {
      readonly status: string;
      readonly diffMode: boolean;
      readonly preAddressCount: number;
      readonly postAddressCount: number;
      readonly canonicalSwapAddressesObserved: readonly string[];
      readonly resultSha256: string;
    };
  };
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNode22(version: string): void {
  if (!/^v22\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error("Trace RPC qualification requires Node 22.x");
  }
}

function traceRpcEndpoint(): string {
  const value = process.env.ARBITRUM_SEPOLIA_RPC_URL;

  if (!value) {
    throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Trace RPC URL is invalid");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Trace RPC qualification requires HTTPS");
  }

  return value;
}

function assertAcceptedTraceBaseline(value: AcceptedTraceBaseline): void {
  if (
    value.status !== "PASS" ||
    value.real !== true ||
    value.readOnly !== true ||
    value.traceEvidence.callTracer.status !== "OBSERVED" ||
    value.traceEvidence.prestateTracer.status !== "OBSERVED" ||
    value.traceEvidence.prestateTracer.diffMode !== true
  ) {
    throw new Error("Accepted #98 trace baseline is not qualified");
  }

  if (
    !/^[0-9a-f]{64}$/.test(value.traceEvidence.callTracer.resultSha256) ||
    !/^[0-9a-f]{64}$/.test(value.traceEvidence.prestateTracer.resultSha256)
  ) {
    throw new Error("Accepted #98 trace baseline fingerprints are invalid");
  }
}

function expectedPreparedTransactionFingerprint(
  evaluation: ReturnType<typeof createCanonicalNativeRpcEvaluationInput>,
): string {
  return `sha256:${sha256(
    JSON.stringify(evaluation.input.unsignedTransaction),
  )}`;
}

function validateRealQualification(
  result: TraceRpcEvidenceResult,
  evaluation: ReturnType<typeof createCanonicalNativeRpcEvaluationInput>,
  canonical: CanonicalNativeRpcCapture,
  baseline: AcceptedTraceBaseline,
  endpoint: string,
) {
  if (result.status !== "success") {
    throw new Error(
      `TraceRpcEvidenceSource returned ${result.status}; expected success`,
    );
  }

  if (result.source.sourceId !== "trace-rpc" || result.source.mode !== "LIVE") {
    throw new Error("TraceRpcEvidenceSource provenance is not LIVE trace-rpc");
  }

  if (result.freshness.status !== "not_checked") {
    throw new Error(
      "TraceRpcEvidenceSource freshness must be explicitly not_checked",
    );
  }

  const binding = result.binding;

  if (binding === undefined) {
    throw new Error("TraceRpcEvidenceSource omitted execution binding");
  }

  if (
    binding.runId !== evaluation.runId ||
    binding.chainId !== evaluation.chainId ||
    binding.protocol !== evaluation.protocol
  ) {
    throw new Error(
      "TraceRpcEvidenceSource run/chain/protocol binding diverged",
    );
  }

  const expectedBlock = evaluation.input.blockContext;

  if (
    binding.blockContext.blockNumber !== expectedBlock.blockNumber ||
    binding.blockContext.blockHash?.toLowerCase() !==
      expectedBlock.blockHash?.toLowerCase()
  ) {
    throw new Error("TraceRpcEvidenceSource pinned block binding diverged");
  }

  const expectedTxFingerprint =
    expectedPreparedTransactionFingerprint(evaluation);

  if (binding.transactionFingerprint !== expectedTxFingerprint) {
    throw new Error(
      "TraceRpcEvidenceSource prepared transaction fingerprint diverged",
    );
  }

  const call = result.capabilities.callTracer;

  if (call.status !== "observed" || call.executionStatus !== "succeeded") {
    throw new Error(
      "TraceRpcEvidenceSource did not observe a successful callTracer result",
    );
  }

  if (
    call.gasUsed.toLowerCase() !==
      baseline.traceEvidence.callTracer.gasUsed.toLowerCase() ||
    call.output?.toLowerCase() !==
      baseline.traceEvidence.callTracer.output.toLowerCase() ||
    call.output?.toLowerCase() !==
      canonical.observations.preparedSwap.ethCall.result.toLowerCase()
  ) {
    throw new Error(
      "Normalized callTracer result diverged from accepted canonical evidence",
    );
  }

  const state = result.capabilities.prestateTracerDiff;

  if (
    state.status !== "observed" ||
    state.diffMode !== true ||
    state.preAddressCount <= 0 ||
    state.postAddressCount <= 0
  ) {
    throw new Error(
      "TraceRpcEvidenceSource did not observe a valid state diff",
    );
  }

  const expectedAddresses = [
    canonical.observations.preparedSwap.route.pool,
    canonical.observations.preparedSwap.route.tokenIn,
    canonical.observations.preparedSwap.route.tokenOut,
  ].map((address) => address.toLowerCase());

  const observedAddresses = new Set(
    state.changedAddresses.map((address) => address.toLowerCase()),
  );

  for (const address of expectedAddresses) {
    if (!observedAddresses.has(address)) {
      throw new Error(
        `Normalized state diff is missing canonical address ${address}`,
      );
    }
  }

  if (
    result.unknownScope.length !== 0 ||
    result.unavailableScope.length !== 0
  ) {
    throw new Error(
      "Successful real qualification retained unknown/unavailable trace scope",
    );
  }

  for (const scope of [
    "trace-rpc.chain",
    "trace-rpc.pinned-block",
    "trace-rpc.callTracer",
    "trace-rpc.prestateTracer.diffMode",
  ]) {
    if (!result.checkedScope.includes(scope)) {
      throw new Error(`Successful real qualification did not check ${scope}`);
    }
  }

  if (JSON.stringify(result).includes(endpoint)) {
    throw new Error("TraceRpcEvidenceSource leaked the RPC endpoint");
  }

  return {
    expectedPreparedTransactionFingerprint: expectedTxFingerprint,
    callTracer: {
      gasUsedMatchesAcceptedBaseline:
        call.gasUsed.toLowerCase() ===
        baseline.traceEvidence.callTracer.gasUsed.toLowerCase(),
      outputMatchesAcceptedBaseline:
        call.output?.toLowerCase() ===
        baseline.traceEvidence.callTracer.output.toLowerCase(),
      rawFingerprintMatchesAcceptedBaseline:
        call.resultFingerprint ===
        `sha256:${baseline.traceEvidence.callTracer.resultSha256}`,
    },
    prestateTracer: {
      canonicalAddressesObserved: expectedAddresses,
      preAddressCount: state.preAddressCount,
      postAddressCount: state.postAddressCount,
      preAddressCountMatchesAcceptedBaseline:
        state.preAddressCount ===
        baseline.traceEvidence.prestateTracer.preAddressCount,
      postAddressCountMatchesAcceptedBaseline:
        state.postAddressCount ===
        baseline.traceEvidence.prestateTracer.postAddressCount,
      rawFingerprintMatchesAcceptedBaseline:
        state.resultFingerprint ===
        `sha256:${baseline.traceEvidence.prestateTracer.resultSha256}`,
    },
  };
}

async function main(): Promise<void> {
  assertNode22(process.version);

  const endpoint = traceRpcEndpoint();
  const sourceProvenance = captureSourceProvenance(REPO_ROOT);
  const runnerSha256 = sha256(readFileSync(SCRIPT_PATH));

  const canonicalPath = join(REPO_ROOT, CANONICAL_CAPTURE);
  const canonicalBytes = readFileSync(canonicalPath);

  assertAcceptedSourceFixture(canonicalBytes);

  const canonical = JSON.parse(
    canonicalBytes.toString("utf8"),
  ) as CanonicalNativeRpcCapture;

  const baselinePath = join(REPO_ROOT, ACCEPTED_TRACE_BASELINE);
  const baselineBytes = readFileSync(baselinePath);

  const baseline = JSON.parse(
    baselineBytes.toString("utf8"),
  ) as AcceptedTraceBaseline;

  assertAcceptedTraceBaseline(baseline);

  const startedAt = new Date().toISOString();
  const runId = `be-106-trace-rpc-${startedAt
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 17)}`;

  const evaluation = createCanonicalNativeRpcEvaluationInput(canonical, runId);

  const source = createTraceRpcEvidenceSource({
    rpcUrl: endpoint,
    mode: "LIVE",
    timeoutMs: 30_000,
  });

  const result = await source.evaluate(evaluation);

  const comparison = validateRealQualification(
    result,
    evaluation,
    canonical,
    baseline,
    endpoint,
  );

  assertUnchangedSource(sourceProvenance, captureSourceProvenance(REPO_ROOT));

  if (sha256(readFileSync(SCRIPT_PATH)) !== runnerSha256) {
    throw new Error("Trace RPC qualification runner changed during execution");
  }

  const capturedAt = new Date().toISOString();

  const evidence = {
    schemaVersion: "be-106-trace-rpc-source-qualification-v1",
    status: "PASS",
    real: true,
    readOnly: true,
    capturedAt,
    repositoryHeadAtCapture: sourceProvenance.repositoryHead,
    sourceProvenance,
    source: {
      canonicalFixture: CANONICAL_CAPTURE,
      canonicalFixtureSha256: sha256(canonicalBytes),
      acceptedTraceBaseline: ACCEPTED_TRACE_BASELINE,
      acceptedTraceBaselineSha256: sha256(baselineBytes),
      runner: relative(REPO_ROOT, SCRIPT_PATH),
      runnerSha256,
    },
    execution: {
      runId,
      chainId: evaluation.chainId,
      protocol: evaluation.protocol,
      blockContext: evaluation.input.blockContext,
      transactionFingerprint: result.binding?.transactionFingerprint,
    },
    normalizedEvidence: result,
    comparison,
    scope: {
      classification: "TRACE_RPC_EVIDENCE_SOURCE_QUALIFICATION",
      nativeRpcPrimaryBaseline: true,
      traceSupplementaryOnly: true,
      providerRanking: false,
      providerVoting: false,
      providerConsensus: false,
      automaticFallback: false,
      signing: false,
      broadcasting: false,
      custody: false,
    },
  };

  if (JSON.stringify(evidence).includes(endpoint)) {
    throw new Error("Qualification capture leaked the RPC endpoint");
  }

  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");

  const outputDirectory = join(
    REPO_ROOT,
    "fixtures",
    "provider-registry",
    "be-106",
    `trace-rpc-source-qualification-${stamp}`,
  );

  mkdirSync(outputDirectory, {
    recursive: true,
  });

  writeFileSync(
    join(outputDirectory, "capture.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      runId,
      blockNumber: evaluation.input.blockContext.blockNumber,
      transactionFingerprint: result.binding?.transactionFingerprint,
      callTracer: result.capabilities.callTracer.status,
      prestateTracerDiff: result.capabilities.prestateTracerDiff.status,
      rawCallFingerprintMatchesBaseline:
        comparison.callTracer.rawFingerprintMatchesAcceptedBaseline,
      rawStateDiffFingerprintMatchesBaseline:
        comparison.prestateTracer.rawFingerprintMatchesAcceptedBaseline,
      output: relative(REPO_ROOT, outputDirectory),
    })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown qualification failure";

    process.stderr.write(`Trace RPC source qualification failed: ${message}\n`);

    process.exitCode = 1;
  });
}

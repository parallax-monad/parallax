import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareEvidencePortability,
  EVIDENCE_PORTABILITY_FACTS,
  type EvidencePortabilityRecord,
  fingerprintHexData,
} from "../../apps/api/src/backend/evidence-portability.js";
import {
  type CanonicalNativeRpcCapture,
  type CanonicalNativeRpcEvaluationInput,
  createCanonicalNativeRpcEvaluationInput,
} from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import { createNativeRpcProvider } from "../../apps/api/src/backend/native-rpc-provider.js";
import {
  evaluateProviderAdapter,
  type ProviderEvaluationResult,
} from "../../apps/api/src/backend/provider-adapter.js";
import {
  createTraceRpcEvidenceSource,
  type TraceRpcEvidenceResult,
} from "../../apps/api/src/backend/trace-rpc-evidence-source.js";
import { assertAcceptedSourceFixture } from "./native-rpc-canonical-exercise.js";
import {
  assertUnchangedSource,
  captureSourceProvenance,
} from "./native-rpc-source-provenance.js";

/**
 * #91 — Native RPC baseline + Trace RPC supplementary Evidence portability.
 *
 * Both sources are handed the exact same accepted #77 prepared unsigned
 * transaction, run binding, and pinned block context. The probe persists the
 * provider-neutral comparison only; it selects no provider, ranks nothing,
 * and never signs, broadcasts, or takes custody.
 *
 * Run with an explicit real endpoint:
 *
 *   ARBITRUM_SEPOLIA_RPC_URL=... node --import=tsx/esm \
 *     scripts/provider-probes/evidence-portability-probe.ts
 *
 * The endpoint is never printed and never persisted.
 */

const CANONICAL_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
/** The probe deliberately exercises the primary source's freshness check. */
const MAX_BLOCK_LAG = 0;

export type PortabilityQualificationInput = {
  readonly record: EvidencePortabilityRecord;
  readonly evaluation: CanonicalNativeRpcEvaluationInput;
  readonly canonical: CanonicalNativeRpcCapture;
  readonly nativeRpc: ProviderEvaluationResult;
  readonly traceRpc: TraceRpcEvidenceResult;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNode22(version: string): void {
  if (!/^v22\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error("Evidence portability qualification requires Node 22.x");
  }
}

function rpcEndpoint(): string {
  const value = process.env.ARBITRUM_SEPOLIA_RPC_URL;

  if (!value) {
    throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Evidence portability RPC URL is invalid");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Evidence portability qualification requires HTTPS");
  }

  return value;
}

function fail(message: string): never {
  throw new Error(message);
}

function stableKeys(value: object): string {
  return JSON.stringify(Object.keys(value).sort());
}

/**
 * Fail-closed acceptance rules for one portability run.
 *
 * These assert binding identity, an honest capability split, and the absence
 * of ranking/fallback semantics. They deliberately do NOT require identical
 * fields: a gas estimate and a traced gas consumption stay a recorded fact
 * difference.
 */
export function assertPortabilityQualifications(
  input: PortabilityQualificationInput,
): void {
  const { record, evaluation, canonical, nativeRpc, traceRpc } = input;

  if (
    record.version !== "evidence-portability-v1" ||
    record.binding.runId !== evaluation.runId ||
    record.binding.chainId !== evaluation.chainId ||
    record.binding.protocol !== evaluation.protocol
  ) {
    fail("Evidence portability qualification has a divergent run binding");
  }

  const traceBinding = traceRpc.binding;

  if (traceBinding === undefined) {
    fail("Supplementary trace evidence omitted its execution binding");
  }

  if (
    traceBinding.transactionFingerprint !==
    record.binding.preparedTransactionFingerprint
  ) {
    fail("Supplementary trace evidence is bound to another transaction");
  }

  const prepared = evaluation.input;

  if (
    record.binding.blockContext.blockNumber !==
      prepared.blockContext.blockNumber ||
    record.binding.blockContext.blockHash?.toLowerCase() !==
      prepared.blockContext.blockHash?.toLowerCase()
  ) {
    fail("Evidence portability qualification diverged on the pinned block");
  }

  const payload = prepared.unsignedTransaction.payload as Readonly<
    Record<string, string | undefined>
  >;

  for (const [key, value] of Object.entries(
    record.binding.preparedTransaction,
  )) {
    if (payload[key] !== value) {
      fail(`Prepared transaction ${key} diverged from the shared execution`);
    }
  }

  if (
    record.facts.map((entry) => entry.fact).join(",") !==
    EVIDENCE_PORTABILITY_FACTS.join(",")
  ) {
    fail("Evidence portability facts are incomplete or out of order");
  }

  if (
    stableKeys(record) !==
    stableKeys({ version: 0, binding: 0, sources: 0, facts: 0, scope: 0 })
  ) {
    fail("Evidence portability record carries unexpected top-level fields");
  }

  const facts = new Map(record.facts.map((entry) => [entry.fact, entry]));
  const fact = (name: (typeof EVIDENCE_PORTABILITY_FACTS)[number]) => {
    const entry = facts.get(name);
    return entry === undefined
      ? fail(`Evidence portability fact ${name} is missing`)
      : entry;
  };

  const canonicalCallFingerprint = fingerprintHexData(
    canonical.observations.preparedSwap.ethCall.result,
  );

  const call = fact("call");

  if (
    call.nativeRpc.state !== "checked" ||
    call.nativeRpc.detail?.returnDataFingerprint !== canonicalCallFingerprint
  ) {
    fail(
      "Primary Native RPC did not observe the accepted canonical eth_call result",
    );
  }

  if (
    call.traceRpc.state !== "checked" ||
    call.traceRpc.detail?.outputFingerprint !== canonicalCallFingerprint
  ) {
    fail(
      "Supplementary trace did not observe the accepted canonical call output",
    );
  }

  if (call.agreement !== "equal") {
    fail("Both sources observed the same call output but did not agree");
  }

  const gas = fact("gas");

  if (gas.nativeRpc.state !== "checked" || gas.traceRpc.state !== "checked") {
    fail("Both sources must contribute a gas observation");
  }

  if (gas.agreement === "not_comparable") {
    fail("Both gas observations are present but were not comparable");
  }

  const callEvidence = traceRpc.capabilities.callTracer;

  if (
    callEvidence.status === "observed" &&
    (gas.traceRpc.detail?.gasUsedHex !== callEvidence.gasUsed ||
      call.traceRpc.detail?.executionStatus !== callEvidence.executionStatus)
  ) {
    fail(
      "Published call/gas facts diverged from the normalized trace evidence",
    );
  }

  for (const name of ["trace", "stateDiff"] as const) {
    const entry = fact(name);

    if (entry.nativeRpc.state === "checked") {
      fail(
        `Primary Native RPC must not publish a checked ${name} capability it does not exercise`,
      );
    }

    if (entry.traceRpc.state !== "checked") {
      fail(`Supplementary trace did not observe the ${name} capability`);
    }
  }

  if (fact("stateDiff").traceRpc.detail?.diffMode !== true) {
    fail("Supplementary state diff was not produced with diffMode");
  }

  if (fact("block").agreement !== "equal") {
    fail("Both sources must bind the same pinned block number and hash");
  }

  if (fact("freshness").nativeRpc.state === "unavailable") {
    fail("Primary freshness was not checked although the probe requested it");
  }

  if (
    traceRpc.freshness.status === "not_checked" &&
    (fact("freshness").traceRpc.state !== "unavailable" ||
      fact("freshness").traceRpc.reason !== "source_did_not_check_freshness")
  ) {
    fail("Supplementary freshness declaration was not published truthfully");
  }

  for (const entry of record.facts) {
    if (
      entry.nativeRpc.state === "checked" &&
      entry.nativeRpc.reason !== undefined
    ) {
      fail(`Checked fact ${entry.fact} retained a failure reason`);
    }
  }

  if (
    fact("provenance").nativeRpc.detail?.sourceId !== "native-rpc-arbitrum" ||
    fact("provenance").traceRpc.detail?.sourceId !== "trace-rpc"
  ) {
    fail("Evidence portability provenance is missing a source identity");
  }

  const scope = record.scope;

  if (
    scope.nativeRpcPrimaryBaseline !== true ||
    scope.traceSupplementaryOnly !== true ||
    scope.unsignedReadOnly !== true
  ) {
    fail("Evidence portability scope lost its primary/supplementary boundary");
  }

  if (
    scope.providerRanking ||
    scope.providerScoring ||
    scope.providerVoting ||
    scope.providerConsensus ||
    scope.automaticFallback
  ) {
    fail("Evidence portability scope introduced selection semantics");
  }

  if (nativeRpc.status === "failed" || nativeRpc.status === "timeout") {
    fail(`Primary Native RPC returned ${nativeRpc.status}`);
  }

  for (const capability of ["traces", "state-diff"]) {
    if ((nativeRpc.capabilities ?? []).includes(capability)) {
      fail(
        `Primary Native RPC changed the supplementary boundary: ${capability}`,
      );
    }
  }
}

async function main(): Promise<void> {
  assertNode22(process.version);

  const endpoint = rpcEndpoint();
  const sourceProvenance = captureSourceProvenance(REPO_ROOT);
  const runnerSha256 = sha256(readFileSync(SCRIPT_PATH));

  const canonicalBytes = readFileSync(join(REPO_ROOT, CANONICAL_CAPTURE));

  assertAcceptedSourceFixture(canonicalBytes);

  const canonical = JSON.parse(
    canonicalBytes.toString("utf8"),
  ) as CanonicalNativeRpcCapture;

  const startedAt = new Date().toISOString();
  const runId = `be-091-portability-${startedAt
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 17)}`;

  const evaluation = createCanonicalNativeRpcEvaluationInput(canonical, runId);

  const nativeAdapter = createNativeRpcProvider({
    rpcUrl: endpoint,
    mode: "LIVE",
    timeoutMs: 30_000,
    checkFreshness: true,
    maxBlockLag: MAX_BLOCK_LAG,
  });
  const nativeRpc = await evaluateProviderAdapter(nativeAdapter, evaluation);

  const traceSource = createTraceRpcEvidenceSource({
    rpcUrl: endpoint,
    mode: "LIVE",
    timeoutMs: 30_000,
  });
  const traceRpc = await traceSource.evaluate(evaluation);

  const record = compareEvidencePortability({
    nativeRpc,
    traceRpc,
    preparedExecution: evaluation.input,
  });

  assertPortabilityQualifications({
    record,
    evaluation,
    canonical,
    nativeRpc,
    traceRpc,
  });

  assertUnchangedSource(sourceProvenance, captureSourceProvenance(REPO_ROOT));

  if (sha256(readFileSync(SCRIPT_PATH)) !== runnerSha256) {
    throw new Error("Evidence portability runner changed during execution");
  }

  const capturedAt = new Date().toISOString();

  const evidence = {
    schemaVersion: "be-091-evidence-portability-v1",
    qualification: {
      status: "PASS",
      real: true,
      readOnly: true,
    },
    capturedAt,
    repositoryHeadAtCapture: sourceProvenance.repositoryHead,
    sourceProvenance,
    source: {
      canonicalFixture: CANONICAL_CAPTURE,
      canonicalFixtureSha256: sha256(canonicalBytes),
      runner: relative(REPO_ROOT, SCRIPT_PATH),
      runnerSha256,
    },
    execution: {
      runId,
      chainId: evaluation.chainId,
      protocol: evaluation.protocol,
      blockContext: evaluation.input.blockContext,
      preparedTransaction: record.binding.preparedTransaction,
      preparedTransactionFingerprint:
        record.binding.preparedTransactionFingerprint,
      nativeFreshnessCheck: {
        enabled: true,
        maxBlockLag: MAX_BLOCK_LAG,
      },
    },
    nativeRpcEvidence: nativeRpc,
    traceRpcEvidence: traceRpc,
    portability: record,
  };

  if (JSON.stringify(evidence).includes(endpoint)) {
    throw new Error("Evidence portability capture leaked the RPC endpoint");
  }

  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");

  const outputDirectory = join(
    REPO_ROOT,
    "fixtures",
    "provider-registry",
    "be-091",
    `native-rpc-trace-portability-${stamp}`,
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
      preparedTransactionFingerprint:
        record.binding.preparedTransactionFingerprint,
      nativeRpcStatus: nativeRpc.status,
      traceRpcStatus: traceRpc.status,
      facts: record.facts.map((entry) => ({
        fact: entry.fact,
        nativeRpc: entry.nativeRpc.state,
        traceRpc: entry.traceRpc.state,
        agreement: entry.agreement,
      })),
      output: relative(REPO_ROOT, outputDirectory),
    })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown qualification failure";

    process.stderr.write(
      `Evidence portability qualification failed: ${message}\n`,
    );

    process.exitCode = 1;
  });
}

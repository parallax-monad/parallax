import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CanonicalNativeRpcCapture,
  createCanonicalNativeRpcEvaluationInput,
} from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import { createNativeRpcProvider } from "../../apps/api/src/backend/native-rpc-provider.js";
import { evaluateProviderAdapter } from "../../apps/api/src/backend/provider-adapter.js";

const OFFICIAL_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const SOURCE_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
const endpointOverride = process.env.ARBITRUM_SEPOLIA_RPC_URL;
const endpoint = endpointOverride ?? OFFICIAL_RPC;
const endpointClass = endpointOverride
  ? "environment-supplied"
  : "arbitrum-official-public";

function assertEndpoint(): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Native RPC endpoint configuration is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Native RPC endpoint must use HTTPS");
  }
  if (
    endpointOverride === undefined &&
    (parsed.hostname !== "sepolia-rollup.arbitrum.io" ||
      parsed.pathname !== "/rpc")
  ) {
    throw new Error(
      "Embedded public Native RPC endpoint failed its host guard",
    );
  }
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function assertObservedCandidate(
  result: Awaited<ReturnType<typeof evaluateProviderAdapter>>,
  candidatePath: string,
  expected: string,
): void {
  const candidate = result.candidateFields.find(
    (field) => field.candidatePath === candidatePath,
  );
  if (
    candidate?.status !== "observed" ||
    typeof candidate.value !== "string" ||
    candidate.value.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error(
      `NativeRpcProvider did not observe the expected ${candidatePath}`,
    );
  }
}

async function main(): Promise<void> {
  assertEndpoint();
  const fixtureBytes = readFileSync(join(REPO_ROOT, SOURCE_CAPTURE));
  const capture = JSON.parse(
    fixtureBytes.toString("utf8"),
  ) as CanonicalNativeRpcCapture;
  const startedAt = new Date().toISOString();
  const runId = `be-078-canonical-${startedAt
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 17)}`;
  const evaluation = createCanonicalNativeRpcEvaluationInput(capture, runId);
  const preparedSwap = capture.observations.preparedSwap;

  const adapter = createNativeRpcProvider({
    rpcUrl: endpoint,
    mode: "LIVE",
    timeoutMs: 30_000,
  });
  const providerResult = await evaluateProviderAdapter(adapter, evaluation);
  if (providerResult.status !== "success") {
    const failureSnapshot =
      providerResult.responseEvidence.kind === "redacted_snapshot"
        ? object(providerResult.responseEvidence.snapshot, "Provider snapshot")
        : {};
    const providerFailure =
      typeof failureSnapshot.failure === "object" &&
      failureSnapshot.failure !== null &&
      !Array.isArray(failureSnapshot.failure)
        ? (failureSnapshot.failure as Record<string, unknown>)
        : {};
    process.stderr.write(
      `${JSON.stringify({
        providerStatus: providerResult.status,
        failure: {
          status: providerFailure.status,
          rpcCode: providerFailure.rpcCode,
        },
        diagnostics: providerResult.candidateFields
          .filter((field) => field.status !== "observed")
          .map(({ candidatePath, status, semanticNote }) => ({
            candidatePath,
            status,
            semanticNote,
          })),
      })}\n`,
    );
    throw new Error(
      `NativeRpcProvider returned ${providerResult.status}; canonical exercise did not pass`,
    );
  }

  const responseEvidence = object(
    providerResult.responseEvidence,
    "Provider response evidence",
  );
  if (responseEvidence.kind !== "redacted_snapshot") {
    throw new Error("NativeRpcProvider did not return a redacted snapshot");
  }
  const snapshot = object(responseEvidence.snapshot, "Provider snapshot");
  const methods = object(snapshot.methods, "Provider method observations");
  if (
    snapshot.mode !== "LIVE" ||
    snapshot.runId !== runId ||
    BigInt(String(methods.eth_chainId)) !== 421_614n ||
    typeof methods.eth_call !== "string" ||
    methods.eth_call.toLowerCase() !==
      preparedSwap.ethCall.result.toLowerCase() ||
    typeof methods.eth_estimateGas !== "string" ||
    BigInt(methods.eth_estimateGas) !== BigInt(preparedSwap.estimatedGas)
  ) {
    throw new Error(
      "NativeRpcProvider observations differ from the accepted canonical capture",
    );
  }
  assertObservedCandidate(providerResult, "nativeRpc.chainId", "0x66eee");
  assertObservedCandidate(
    providerResult,
    "nativeRpc.blockContext.blockNumber",
    evaluation.input.blockContext.blockNumber,
  );
  assertObservedCandidate(
    providerResult,
    "nativeRpc.ethCall.returnData",
    preparedSwap.ethCall.result,
  );
  assertObservedCandidate(
    providerResult,
    "nativeRpc.estimateGas.gasUnits",
    preparedSwap.estimatedGas,
  );
  assertObservedCandidate(
    providerResult,
    "nativeRpc.blockContext.blockHash",
    capture.observations.pinnedBlock.hash,
  );

  const capturedAt = new Date().toISOString();
  const sourceFixtureDigest = hash(fixtureBytes);
  const scriptDigest = hash(readFileSync(SCRIPT_PATH));
  const repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const evidence = {
    schemaVersion: "be-078-native-rpc-canonical-exercise-v1",
    status: "PASS",
    real: true,
    readOnly: true,
    endpointClass,
    capturedAt,
    repositoryHeadAtCapture: repositoryHead,
    source: {
      fixture: SOURCE_CAPTURE,
      fixtureSha256: sourceFixtureDigest,
      runner: relative(REPO_ROOT, SCRIPT_PATH),
      runnerSha256: scriptDigest,
      acceptedClassification: capture.classification,
    },
    execution: {
      providerId: providerResult.provider.providerId,
      providerVersion: providerResult.provider.providerVersion,
      mode: snapshot.mode,
      runId,
      chainId: evaluation.chainId,
      protocol: evaluation.protocol,
      blockContext: evaluation.input.blockContext,
      transaction: evaluation.input.unsignedTransaction.payload,
    },
    providerResult,
  };

  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");
  const parent = join(REPO_ROOT, "fixtures", "provider-registry", "be-078");
  mkdirSync(parent, { recursive: true });
  const outputDirectory = join(parent, `native-rpc-canonical-${stamp}`);
  mkdirSync(outputDirectory);
  writeFileSync(
    join(outputDirectory, "capture.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      providerId: providerResult.provider.providerId,
      blockNumber: evaluation.input.blockContext.blockNumber,
      output: relative(REPO_ROOT, outputDirectory),
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown probe failure";
  process.stderr.write(`Native RPC canonical exercise failed: ${message}\n`);
  process.exitCode = 1;
});

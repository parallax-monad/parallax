import { createHash } from "node:crypto";
import { getDefaultResultOrder } from "node:dns";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CanonicalNativeRpcCapture,
  createCanonicalNativeRpcEvaluationInput,
} from "../../apps/api/src/backend/native-rpc-canonical-exercise.js";
import { createNativeRpcProvider } from "../../apps/api/src/backend/native-rpc-provider.js";
import { evaluateProviderAdapter } from "../../apps/api/src/backend/provider-adapter.js";
import {
  assertAcceptedSourceFixture,
  validateCanonicalProviderResult,
} from "./native-rpc-canonical-exercise.js";
import {
  assertUnchangedSource,
  captureSourceProvenance,
} from "./native-rpc-source-provenance.js";

const SOURCE_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is not a non-empty string`);
  }
  return value;
}

function asHexQuantity(value: unknown, label: string): string {
  const quantity = asString(value, label);
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(quantity)) {
    throw new Error(`${label} is not a hex quantity`);
  }
  return quantity;
}

function sameAddress(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

export function assertNode22(version: string): void {
  if (!/^v22\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error("QuickNode evidence capture requires Node 22.x");
  }
}

export function quickNodeEndpoint(): string {
  const value = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  if (!value) {
    throw new Error("ARBITRUM_SEPOLIA_RPC_URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("QuickNode RPC URL is invalid");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("QuickNode RPC URL must use HTTPS");
  }

  if (
    parsed.hostname !== "quiknode.pro" &&
    !parsed.hostname.endsWith(".quiknode.pro")
  ) {
    throw new Error(
      "Canonical QuickNode probe requires a quiknode.pro endpoint",
    );
  }

  return value;
}

async function rpc(
  endpoint: string,
  method: string,
  params: readonly unknown[],
  id: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`${method} request failed`);
  }

  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}`);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new Error(`${method} returned invalid JSON`);
  }
  const payload = asObject(responseBody, `${method} response`);

  if (payload.error !== undefined) {
    throw new Error(`${method} returned a JSON-RPC error`);
  }

  if (!Object.hasOwn(payload, "result")) {
    throw new Error(`${method} response is missing result`);
  }

  return payload.result;
}

export function validateQuickNodeCallTrace(
  trace: unknown,
  capture: CanonicalNativeRpcCapture,
): {
  status: "OBSERVED";
  gasUsed: string;
  output: string;
  resultSha256: string;
} {
  const callTrace = asObject(trace, "callTracer result");
  const transaction = capture.observations.preparedSwap.tx;

  if (
    callTrace.type !== "CALL" ||
    callTrace.error !== undefined ||
    callTrace.revertReason !== undefined ||
    !sameAddress(callTrace.from, transaction.from) ||
    !sameAddress(callTrace.to, transaction.to) ||
    asString(callTrace.input, "callTracer input").toLowerCase() !==
      transaction.data.toLowerCase() ||
    BigInt(asHexQuantity(callTrace.value, "callTracer value")) !==
      BigInt(transaction.value) ||
    asString(callTrace.output, "callTracer output").toLowerCase() !==
      capture.observations.preparedSwap.ethCall.result.toLowerCase()
  ) {
    throw new Error(
      "callTracer result is not bound to the canonical transaction",
    );
  }

  const gasUsed = asString(callTrace.gasUsed, "callTracer gasUsed");
  if (
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(gasUsed) ||
    BigInt(gasUsed) <= 0n
  ) {
    throw new Error("callTracer gasUsed must be a positive hex quantity");
  }

  return {
    status: "OBSERVED",
    gasUsed,
    output: asString(callTrace.output, "callTracer output"),
    resultSha256: sha256(JSON.stringify(trace)),
  };
}

export function validateQuickNodeStateDiff(
  diff: unknown,
  capture: CanonicalNativeRpcCapture,
): {
  status: "OBSERVED";
  diffMode: true;
  preAddressCount: number;
  postAddressCount: number;
  canonicalSwapAddressesObserved: string[];
  resultSha256: string;
} {
  const stateDiff = asObject(diff, "prestateTracer result");
  const pre = asObject(stateDiff.pre, "prestateTracer pre");
  const post = asObject(stateDiff.post, "prestateTracer post");

  if (Object.keys(pre).length === 0 || Object.keys(post).length === 0) {
    throw new Error("State diff is empty");
  }

  const postAddresses = new Map(
    Object.entries(post).map(([address, change]) => [
      address.toLowerCase(),
      change,
    ]),
  );
  const route = capture.observations.preparedSwap.route;
  const requiredAddresses = [route.pool, route.tokenIn, route.tokenOut].map(
    (address) => address.toLowerCase(),
  );

  for (const address of requiredAddresses) {
    if (!postAddresses.has(address)) {
      throw new Error(`State diff is missing canonical address ${address}`);
    }
    if (
      Object.keys(asObject(postAddresses.get(address), `State diff ${address}`))
        .length === 0
    ) {
      throw new Error(
        `State diff has no change for canonical address ${address}`,
      );
    }
  }

  return {
    status: "OBSERVED",
    diffMode: true,
    preAddressCount: Object.keys(pre).length,
    postAddressCount: Object.keys(post).length,
    canonicalSwapAddressesObserved: requiredAddresses,
    resultSha256: sha256(JSON.stringify(diff)),
  };
}

async function main(): Promise<void> {
  assertNode22(process.version);
  const endpoint = quickNodeEndpoint();

  const sourceProvenance = captureSourceProvenance(REPO_ROOT);
  const runnerSha256 = sha256(readFileSync(SCRIPT_PATH));

  const fixturePath = join(REPO_ROOT, SOURCE_CAPTURE);
  const fixtureBytes = readFileSync(fixturePath);
  assertAcceptedSourceFixture(fixtureBytes);

  const capture = JSON.parse(
    fixtureBytes.toString("utf8"),
  ) as CanonicalNativeRpcCapture;

  const startedAt = new Date().toISOString();
  const runId = `be-078-quicknode-${startedAt
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 17)}`;

  const evaluation = createCanonicalNativeRpcEvaluationInput(capture, runId);

  const adapter = createNativeRpcProvider({
    rpcUrl: endpoint,
    mode: "LIVE",
    timeoutMs: 30_000,
  });

  const providerResult = await evaluateProviderAdapter(adapter, evaluation);

  const gasEstimateComparison = validateCanonicalProviderResult(
    providerResult,
    evaluation,
    capture,
  );

  const transaction = evaluation.input.unsignedTransaction.payload;
  const blockTag = capture.observations.pinnedBlock.number;
  const expectedBlockHash = capture.observations.pinnedBlock.hash.toLowerCase();

  const chainId = asHexQuantity(
    await rpc(endpoint, "eth_chainId", [], 1),
    "eth_chainId",
  );

  if (BigInt(chainId) !== 421_614n) {
    throw new Error("QuickNode endpoint is not Arbitrum Sepolia");
  }

  const block = asObject(
    await rpc(endpoint, "eth_getBlockByNumber", [blockTag, false], 2),
    "pinned block",
  );

  const observedBlockHash = asString(
    block.hash,
    "pinned block hash",
  ).toLowerCase();

  if (block.number !== blockTag || observedBlockHash !== expectedBlockHash) {
    throw new Error("Pinned block does not match canonical evidence");
  }

  const callTraceRaw = await rpc(
    endpoint,
    "debug_traceCall",
    [transaction, blockTag, { tracer: "callTracer" }],
    100,
  );

  const callTraceEvidence = validateQuickNodeCallTrace(callTraceRaw, capture);

  const stateDiffRaw = await rpc(
    endpoint,
    "debug_traceCall",
    [
      transaction,
      blockTag,
      {
        tracer: "prestateTracer",
        tracerConfig: { diffMode: true },
      },
    ],
    101,
  );

  const stateDiffEvidence = validateQuickNodeStateDiff(stateDiffRaw, capture);

  const fixtureSha256 = sha256(fixtureBytes);

  assertUnchangedSource(sourceProvenance, captureSourceProvenance(REPO_ROOT));

  if (sha256(readFileSync(SCRIPT_PATH)) !== runnerSha256) {
    throw new Error("QuickNode runner changed during execution");
  }

  if (sha256(readFileSync(fixturePath)) !== fixtureSha256) {
    throw new Error("Canonical fixture changed during execution");
  }

  const capturedAt = new Date().toISOString();
  const evidence = {
    schemaVersion: "be-078-quicknode-canonical-trace-v1",
    status: "PASS",
    real: true,
    readOnly: true,
    endpointClass: "quicknode-environment-supplied",
    capturedAt,
    repositoryHeadAtCapture: sourceProvenance.repositoryHead,
    sourceProvenance,
    source: {
      fixture: SOURCE_CAPTURE,
      fixtureSha256,
      runner: relative(REPO_ROOT, SCRIPT_PATH),
      runnerSha256,
      acceptedClassification: capture.classification,
    },
    execution: {
      endpointProvider: "quicknode",
      runId,
      chainId: evaluation.chainId,
      protocol: evaluation.protocol,
      dnsResultOrder: getDefaultResultOrder(),
      blockContext: evaluation.input.blockContext,
      transaction,
    },
    gasEstimateComparison,
    providerResult,
    traceEvidence: {
      debugTraceCall: true,
      callTracer: callTraceEvidence,
      prestateTracer: stateDiffEvidence,
    },
    scope: {
      classification: "ALTERNATIVE_ENDPOINT_CAPABILITY_EVIDENCE",
      providerSelectionDecision: "NOT_MADE",
      tenderlyQualification: "UNCHANGED",
      productionProviderWiring: "UNCHANGED",
      signing: false,
      broadcasting: false,
      custody: false,
    },
  };

  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");

  const outputDirectory = join(
    REPO_ROOT,
    "fixtures",
    "provider-registry",
    "be-078",
    `quicknode-canonical-${stamp}`,
  );

  mkdirSync(outputDirectory, { recursive: true });

  writeFileSync(
    join(outputDirectory, "capture.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      endpointProvider: "quicknode",
      blockNumber: evaluation.input.blockContext.blockNumber,
      callTracer: "OBSERVED",
      prestateTracerDiffMode: "OBSERVED",
      output: relative(REPO_ROOT, outputDirectory),
    })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown probe failure";
    process.stderr.write(`QuickNode canonical exercise failed: ${message}\n`);
    process.exitCode = 1;
  });
}

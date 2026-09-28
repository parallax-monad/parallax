import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  type ArbitrumRpcClient,
  createArbitrumRpcClient,
} from "../../apps/api/src/backend/arbitrum-chain-adapter.js";
import { createArbitrumProductionComposition } from "../../apps/api/src/backend/arbitrum-composition.js";
import { CAMELOT_SEPOLIA_ROUTER } from "../../apps/api/src/backend/camelot-v3-protocol-adapter.js";
import { NATIVE_RPC_ARBITRUM_PROVIDER_ID } from "../../apps/api/src/backend/native-rpc-evidence.js";
import { createTraceRpcEvidenceSource } from "../../apps/api/src/backend/trace-rpc-evidence-source.js";
import { projectTraceRpcEvidence } from "../../apps/api/src/backend/trace-rpc-public.js";
import { startBackendServer } from "../../apps/api/src/bootstrap/backend.js";
import { bootstrapBackendRuntime } from "../../apps/api/src/runtime-config.js";
import { InMemoryRunStore } from "../../apps/api/src/store.js";
import {
  type NormalizedSwapIntent,
  runResultSchema,
} from "../../packages/contracts/src/index.js";

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const TOKEN_OUT = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const SENDER = "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396";
const REQUIRED_TRACE_SCOPE = [
  "trace-rpc.chain",
  "trace-rpc.pinned-block",
  "trace-rpc.callTracer",
  "trace-rpc.prestateTracer.diffMode",
] as const;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");

type RecordValue = Record<string, unknown>;
type RpcCall = {
  readonly method: string;
  readonly params: readonly unknown[];
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitOutput(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function assertCleanRepository(): void {
  const status = gitOutput("status", "--porcelain=v1", "--untracked-files=all");
  if (status !== "") {
    throw new Error(
      "Live Backend Trace qualification requires a clean repository; commit the exact implementation before generating capture evidence",
    );
  }
}

function recordingRpcClient(rpcUrl: string): {
  readonly calls: RpcCall[];
  readonly client: ArbitrumRpcClient;
} {
  const delegate = createArbitrumRpcClient(rpcUrl);
  const calls: RpcCall[] = [];
  return {
    calls,
    client: {
      async request(method, params = [], options) {
        calls.push({ method, params });
        return delegate.request(method, params, options);
      },
    },
  };
}

function requiredEndpoint(): string {
  const value =
    process.env.ARBITRUM_SEPOLIA_RPC_URL ?? process.env.ARBITRUM_RPC_URL;
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "ARBITRUM_SEPOLIA_RPC_URL or ARBITRUM_RPC_URL is required for the live Backend Trace gate",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Arbitrum Trace endpoint is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Arbitrum Trace endpoint must use HTTPS");
  }
  return value;
}

function record(value: unknown, label: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as RecordValue;
}

function stringField(value: unknown, key: string, label: string): string {
  const result = record(value, label)[key];
  if (typeof result !== "string") {
    throw new Error(`${label}.${key} is not a string`);
  }
  return result;
}

function redactedTraceSummary(value: unknown): RecordValue {
  const projected = projectTraceRpcEvidence(value);
  if (projected === undefined) {
    throw new Error("Public Trace Evidence failed its normalized projection");
  }
  return projected;
}

function redactedNativeSummary(
  result: ReturnType<typeof runResultSchema.parse>,
): RecordValue {
  const providerEvidence = record(
    result.providerEvidence,
    "Public provider Evidence",
  );
  const provider = record(providerEvidence.provider, "Public provider");
  const execution = record(providerEvidence.execution, "Public execution");
  const simulation = record(
    record(result.p0, "Public P0").basicSimulation,
    "Public basicSimulation",
  );
  return {
    provider: {
      providerId: provider.providerId,
      integrationStatus: provider.integrationStatus,
    },
    executionStatus: execution.status,
    basicSimulation: {
      callStatus: record(simulation.call, "Basic simulation call").status,
      gasEstimateStatus: record(
        simulation.gasEstimate,
        "Basic simulation gas estimate",
      ).status,
      blockNumber: simulation.blockNumber,
      ...(typeof simulation.blockHash === "string"
        ? { blockHash: simulation.blockHash }
        : {}),
      validityAtExecution: simulation.validityAtExecution,
      preparedTransactionFingerprint: simulation.preparedTransactionFingerprint,
    },
  };
}

function assertTraceIntegration(
  result: ReturnType<typeof runResultSchema.parse>,
): void {
  if (result.status !== "completed") {
    throw new Error("Live Backend Trace check did not complete");
  }

  const providerEvidence = record(
    result.providerEvidence,
    "Public provider Evidence",
  );
  const provider = record(providerEvidence.provider, "Public provider");
  if (provider.providerId !== NATIVE_RPC_ARBITRUM_PROVIDER_ID) {
    throw new Error(
      "Live Trace gate did not retain Native RPC as primary Provider",
    );
  }
  const execution = record(providerEvidence.execution, "Public execution");
  if (provider.integrationStatus !== "OK" || execution.status !== "SUCCESS") {
    throw new Error(
      "Live Trace gate did not establish successful Native primary Evidence",
    );
  }

  const providerData = record(
    providerEvidence.providerData,
    "Public providerData",
  );
  const traceRpc = record(providerData.traceRpc, "Public Trace Evidence");
  if (
    traceRpc.status !== "success" ||
    record(traceRpc.source, "Trace source").mode !== "LIVE" ||
    record(traceRpc.source, "Trace source").sourceId !== "trace-rpc"
  ) {
    throw new Error(
      "Live Trace source did not produce qualified success Evidence",
    );
  }

  const binding = record(traceRpc.binding, "Trace binding");
  if (
    binding.runId !== result.runId ||
    binding.chainId !== result.intent.chainId ||
    binding.protocol !== result.intent.protocol
  ) {
    throw new Error("Live Trace binding does not match the Backend Run");
  }

  const simulation = record(
    record(result.p0, "Public P0").basicSimulation,
    "Public basicSimulation",
  );
  if (
    record(simulation.call, "Basic simulation call").status !== "SUCCEEDED" ||
    record(simulation.gasEstimate, "Basic simulation gas estimate").status !==
      "AVAILABLE" ||
    simulation.validityAtExecution !== "VALID" ||
    typeof simulation.preparedTransactionFingerprint !== "string"
  ) {
    throw new Error(
      "Live Trace gate did not establish valid Native basic simulation",
    );
  }
  if (binding.blockContext === undefined) {
    throw new Error("Live Trace binding omitted block context");
  }
  const traceBlock = stringField(
    record(binding.blockContext, "Trace block context"),
    "blockNumber",
    "Trace block context",
  );
  if (traceBlock !== simulation.blockNumber) {
    throw new Error("Trace and Native primary block contexts diverged");
  }

  const checkedScope = traceRpc.checkedScope;
  if (
    !Array.isArray(checkedScope) ||
    !REQUIRED_TRACE_SCOPE.every((scope) => checkedScope.includes(scope))
  ) {
    throw new Error("Live Trace Evidence did not check all qualified scopes");
  }

  const capabilities = record(traceRpc.capabilities, "Trace capabilities");
  if (
    record(capabilities.callTracer, "Trace callTracer").status !== "observed" ||
    record(capabilities.prestateTracerDiff, "Trace prestateTracerDiff")
      .status !== "observed"
  ) {
    throw new Error("Live Trace Evidence did not observe both capabilities");
  }
}

async function main(): Promise<void> {
  const rpcUrl = requiredEndpoint();
  assertCleanRepository();
  const tokenRegistry = {
    chains: [
      { chainId: ARBITRUM_SEPOLIA_CHAIN_ID, symbol: "ETH", decimals: 18 },
    ],
    tokens: [
      {
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        address: TOKEN_OUT,
        symbol: "USDC",
        decimals: 18,
        decimalsSource: "onchain_verified" as const,
        verifiedAtBlock: "0",
      },
    ],
  };
  const environment = {
    MONAD_RPC_URL: "https://unused.invalid",
    ARBITRUM_RPC_URL: rpcUrl,
    MOSS_RUNTIME_VERSION: "unused-for-trace-gate",
    MOSS_RUNTIME_REVISION: "native-rpc",
  };
  const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
  const runStore = new InMemoryRunStore();
  const primaryRpc = recordingRpcClient(rpcUrl);
  const traceRpc = recordingRpcClient(rpcUrl);
  const traceRpcEvidenceSource =
    createTraceRpcEvidenceSource<NormalizedSwapIntent>({
      client: traceRpc.client,
      mode: "LIVE",
      timeoutMs: 30_000,
    });
  const composition = createArbitrumProductionComposition({
    runtime,
    runStore,
    rpcClient: primaryRpc.client,
    traceRpcEvidenceSource,
  });

  let resolveListening!: (address: { address: string; port: number }) => void;
  const listening = new Promise<{ address: string; port: number }>(
    (resolve) => {
      resolveListening = resolve;
    },
  );
  const server = startBackendServer({
    environment,
    tokenRegistry,
    composition: composition as never,
    store: runStore,
    hostname: "127.0.0.1",
    port: 0,
    onListening: (address) => resolveListening(address),
  });

  try {
    const address = await listening;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const requestBody = {
      chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
      protocol: "camelot-v3",
      sender: SENDER,
      tokenIn: { kind: "native" as const },
      tokenOut: { kind: "erc20" as const, address: TOKEN_OUT },
      amountIn: "0.001",
      economicBoundary: {
        availability: "unavailable" as const,
        source: "unavailable" as const,
      },
    };
    const response = await fetch(`${baseUrl}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const responseBody: unknown = await response.json();
    if (response.status !== 200) {
      throw new Error(`POST /api/check returned HTTP ${response.status}`);
    }
    const result = runResultSchema.parse(responseBody);
    assertTraceIntegration(result);

    const preparedNativeCalls = primaryRpc.calls.filter(
      ({ method, params }) =>
        method === "eth_call" &&
        typeof record(params[0], "Native eth_call transaction").to ===
          "string" &&
        String(
          record(params[0], "Native eth_call transaction").to,
        ).toLowerCase() === CAMELOT_SEPOLIA_ROUTER.toLowerCase(),
    );
    const traceCalls = traceRpc.calls.filter(
      ({ method }) => method === "debug_traceCall",
    );
    const preparedNativeCall = preparedNativeCalls.at(-1);
    if (preparedNativeCall === undefined || traceCalls.length !== 2) {
      throw new Error(
        "Live Trace gate did not record the expected prepared transaction calls",
      );
    }
    for (const traceCall of traceCalls) {
      if (
        !isDeepStrictEqual(traceCall.params[0], preparedNativeCall.params[0])
      ) {
        throw new Error(
          "Trace transaction diverged from the Native prepared transaction",
        );
      }
    }

    const traceCallsBeforeHistoricalRead = traceRpc.calls.length;
    const primaryCallsBeforeHistoricalRead = primaryRpc.calls.length;
    const persistedResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(result.runId)}`,
    );
    const persistedBody = record(
      await persistedResponse.json(),
      "GET /api/runs response",
    );
    const persisted = runResultSchema.parse(persistedBody.result);
    if (
      persistedResponse.status !== 200 ||
      !isDeepStrictEqual(persisted, result)
    ) {
      throw new Error("GET /api/runs did not round-trip the Trace Run result");
    }
    if (traceRpc.calls.length !== traceCallsBeforeHistoricalRead) {
      throw new Error("GET /api/runs re-queried the Trace source");
    }
    if (primaryRpc.calls.length !== primaryCallsBeforeHistoricalRead) {
      throw new Error("GET /api/runs re-queried the Native primary source");
    }

    const serialized = JSON.stringify({ responseBody, persistedBody });
    if (
      serialized.includes(rpcUrl) ||
      serialized.includes("rawPayload") ||
      serialized.includes("rpcUrl") ||
      serialized.includes("storage")
    ) {
      throw new Error(
        "Live Backend Trace response leaked provider-owned payload",
      );
    }

    const capturedAt = new Date().toISOString();
    const sourceHead = gitOutput("rev-parse", "HEAD");
    const sourceTree = gitOutput("rev-parse", "HEAD^{tree}");
    const originMain = gitOutput("rev-parse", "origin/main");
    const runnerSha256 = sha256(readFileSync(SCRIPT_PATH));
    const traceSummary = redactedTraceSummary(
      record(
        record(result.providerEvidence, "Public provider Evidence")
          .providerData,
        "Public providerData",
      ).traceRpc,
    );
    const capture = {
      schemaVersion: "be-110-backend-trace-integration-v2",
      status: "PASS",
      real: true,
      readOnly: true,
      capturedAt,
      repositoryHeadAtCapture: sourceHead,
      repositoryTreeAtCapture: sourceTree,
      worktreeCleanAtCapture: true,
      baseReference: "origin/main",
      originMainAtCapture: originMain,
      endpointClass: "environment-supplied",
      source: {
        runner: relative(REPO_ROOT, SCRIPT_PATH),
        runnerSha256,
      },
      api: {
        checkPath: "POST /api/check",
        historicalPath: "GET /api/runs/:runId",
        httpStatus: response.status,
        historicalHttpStatus: persistedResponse.status,
        runId: result.runId,
        resultStatus: result.status,
        persistedResultStatus: persisted.status,
        responseResultSha256: sha256(JSON.stringify(result)),
        persistedResultSha256: sha256(JSON.stringify(persisted)),
        nativePrimary: redactedNativeSummary(result),
        traceSupplementary: traceSummary,
      },
      assertions: {
        nativePrimarySuccessful: true,
        exactPreparedTransactionMatch: true,
        traceScopeComplete: true,
        traceCapabilitiesObserved: true,
        publicResponseRedacted: true,
        persistedRoundTrip: true,
        historicalReadDidNotRequeryNative: true,
        historicalReadDidNotRequeryTrace: true,
      },
    };
    const captureSerialized = JSON.stringify(capture);
    if (captureSerialized.includes(rpcUrl)) {
      throw new Error("Live Backend Trace capture leaked the RPC endpoint");
    }
    const stamp = capturedAt.replaceAll(/[^0-9]/g, "").slice(0, 17);
    const outputDirectory = join(
      REPO_ROOT,
      "fixtures",
      "provider-registry",
      "be-110",
      `backend-trace-integration-${stamp}`,
    );
    mkdirSync(outputDirectory, { recursive: true });
    const capturePath = join(outputDirectory, "capture.json");
    writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`, {
      flag: "wx",
    });

    process.stdout.write(
      `${JSON.stringify({
        status: "PASS",
        readOnly: true,
        endpointClass: "environment-supplied",
        runId: result.runId,
        traceStatus: "success",
        traceMode: "LIVE",
        checkedScope: REQUIRED_TRACE_SCOPE,
        persistedRoundTrip: true,
        capture: relative(REPO_ROOT, capturePath),
      })}\n`,
    );
  } finally {
    await server.shutdown();
    await runStore.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown live gate failure";
    const redacted = message
      .replace(/https?:\/\/[^\s"'`)>]+/gi, "[redacted-url]")
      .replace(/(api[-_]?key|token|secret)=[^&\s]+/gi, "$1=[redacted]");
    process.stderr.write(
      `Backend Trace integration gate failed: ${redacted}\n`,
    );
    process.exitCode = 1;
  });
}

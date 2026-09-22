/**
 * BE-011 read-only Arbitrum Sepolia JSON-RPC surface probe.
 * This is evidence collection, not a NativeRpcProvider implementation.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const CHAIN_ID = 421_614;
const CHAIN_ID_HEX = "0x66eee";
const PUBLIC_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";
const SENDER = "0x0000000000000000000000000000000000000001";
const RECIPIENT = "0x0000000000000000000000000000000000000002";
const TIMEOUT_MS = 8_000;
const UNSUPPORTED_METHOD = "parallax_be011_nonexistentMethod";
const CONTROLLED_REVERT_REASON = "ERC20: transfer amount exceeds balance";
const ABI_ERROR_STRING_SELECTOR = "0x08c379a0";
const METHODS = new Set([
  "web3_clientVersion",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  UNSUPPORTED_METHOD,
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type RpcError = { code: Json; message: string; data: Json };
type RpcResponse = { httpOk: boolean; result?: Json; error?: RpcError };

const override = process.env.ARBITRUM_SEPOLIA_RPC_URL;
const endpoint = override ?? PUBLIC_RPC;
const endpointClass = override
  ? "environment-supplied"
  : "arbitrum-official-public";
const startedAt = new Date().toISOString();
const captureStamp = startedAt.replaceAll(":", "-").replaceAll(".", "-");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const captureDirectoryName = `${override ? "arbitrum-sepolia-environment-supplied" : "arbitrum-sepolia-public"}-${captureStamp}`;
const fixturePath = join(
  "fixtures",
  "provider-registry",
  "be-011",
  "native-rpc",
  captureDirectoryName,
);
const fixtureDir = join(repoRoot, fixturePath);
const stagingDir = mkdtempSync(join(tmpdir(), "be011-native-rpc-stage-"));
const responses: JsonObject[] = [];
let sequence = 0;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function scrubString(value: string): string {
  return value
    .split(endpoint)
    .join("[REDACTED_ENDPOINT]")
    .replaceAll(/https?:\/\/[^\s"'<>]+/giu, "[REDACTED_URL]");
}

function scrub(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== "object" || value === null)
    return scrubString(String(value));

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const normalized = key.toLowerCase().replaceAll(/[-_]/g, "");
      const sensitive = [
        "authorization",
        "cookie",
        "setcookie",
        "apikey",
        "accesskey",
        "accesstoken",
        "privatekey",
        "mnemonic",
        "secret",
        "rpcurl",
      ].includes(normalized);
      return [key, sensitive ? "[REDACTED]" : scrub(child)];
    }),
  );
}

function safeMessage(error: unknown): string {
  return scrubString(error instanceof Error ? error.message : String(error));
}

function checkEndpoint(): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("RPC endpoint configuration is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("RPC endpoint configuration must use HTTPS");
  }
  if (parsed.hostname.toLowerCase().includes("sequencer")) {
    throw new Error("Arbitrum sequencer endpoints are forbidden");
  }
  if (
    !override &&
    (parsed.hostname !== "sepolia-rollup.arbitrum.io" ||
      parsed.pathname !== "/rpc")
  ) {
    throw new Error("Embedded public RPC endpoint failed its host/path guard");
  }
}

function errorOf(body: Record<string, unknown>): RpcError | undefined {
  if (typeof body.error !== "object" || body.error === null) return undefined;
  const error = object(body.error, "JSON-RPC error");
  return {
    code: scrub(error.code),
    message:
      typeof error.message === "string"
        ? scrubString(error.message)
        : "JSON-RPC error without a string message",
    data: Object.hasOwn(error, "data") ? scrub(error.data) : null,
  };
}

async function rpc(method: string, params: Json[]): Promise<RpcResponse> {
  if (!METHODS.has(method) || method.startsWith("eth_send")) {
    throw new Error(`Method is not on the read-only allowlist: ${method}`);
  }

  sequence += 1;
  const id = `be011-${String(sequence).padStart(2, "0")}-${method}`;
  const requestStartedAt = new Date().toISOString();
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const request = { jsonrpc: "2.0", id, method, params };

  try {
    const http = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const rawText = await http.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { unparsedBody: rawText };
    }
    const body = object(parsed, "JSON-RPC response");
    const error = errorOf(body);
    responses.push({
      sequence,
      request: scrub(request),
      startedAt: requestStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      httpStatus: http.status,
      httpOk: http.ok,
      response: scrub(body),
    });
    return {
      httpOk: http.ok,
      result: Object.hasOwn(body, "result") ? scrub(body.result) : undefined,
      error,
    };
  } catch (error) {
    const deadline = controller.signal.aborted;
    throw new Error(
      `RPC transport failed; clientDeadlineExceeded=${deadline}; this is not Provider timeout evidence; ${safeMessage(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function resultOf(response: RpcResponse, label: string): Json {
  if (!response.httpOk || response.result === undefined || response.error) {
    throw new Error(`${label} did not return a successful JSON-RPC result`);
  }
  return response.result;
}

function textOf(value: Json, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function quantity(value: Json, label: string): bigint {
  const text = textOf(value, label);
  if (!/^0x[0-9a-f]+$/iu.test(text)) throw new Error(`${label} is not hex`);
  return BigInt(text);
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the safe integer range`);
  }
  return Number(value);
}

function word(address: string): string {
  const value = address.toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error("Invalid probe address");
  return value.padStart(64, "0");
}

/**
 * Strictly validates a Solidity ABI Error(string) revert payload:
 * selector 0x08c379a0, dynamic offset 32, declared length, and payload bytes
 * that decode to the expected controlled reason.
 */
function decodeAbiErrorString(data: Json): string | null {
  if (typeof data !== "string") return null;
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (!/^[0-9a-f]*$/iu.test(hex)) return null;
  if (hex.length < 8 + 64 + 64) return null;
  if (hex.slice(0, 8).toLowerCase() !== ABI_ERROR_STRING_SELECTOR.slice(2)) {
    return null;
  }
  if (BigInt(`0x${hex.slice(8, 8 + 64)}`) !== 32n) return null;
  const lengthValue = BigInt(`0x${hex.slice(8 + 64, 8 + 128)}`);
  if (lengthValue > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const length = Number(lengthValue);
  const dataStart = 8 + 128;
  const dataEnd = dataStart + length * 2;
  if (length <= 0 || hex.length < dataEnd) return null;
  let text = "";
  for (let i = dataStart; i < dataEnd; i += 2) {
    text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  const firstNull = text.indexOf(String.fromCharCode(0));
  const trimmed = firstNull === -1 ? text : text.slice(0, firstNull);
  return trimmed.length > 0 ? trimmed : null;
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Evidence files are staged with exclusive-create semantics and only
 * published into the unique capture directory after every live observation
 * passed validation, so a failed partial run never looks like complete
 * evidence and an existing capture is never overwritten. */
function writeStaged(name: string, value: unknown): void {
  writeFileSync(
    join(stagingDir, name),
    `${JSON.stringify(scrub(value), null, 2)}\n`,
    { flag: "wx" },
  );
}

function publishCapture(): void {
  mkdirSync(join(repoRoot, "fixtures/provider-registry/be-011/native-rpc"), {
    recursive: true,
  });
  mkdirSync(fixtureDir);
  for (const name of readdirSync(stagingDir)) {
    renameSync(join(stagingDir, name), join(fixtureDir, name));
  }
  rmSync(stagingDir, { recursive: true, force: true });
}

function writeReproduce(): void {
  writeFileSync(
    join(stagingDir, "REPRODUCE.md"),
    `# Reproduce the BE-011 Native RPC surface probe

This fixture is a sanitized real snapshot. Re-running the probe performs only
the fixed read-only JSON-RPC sequence in the source and selects the current
Arbitrum Sepolia head, so block-dependent values will change.

Run with Node 22 from the repository root:

\`\`\`bash
node --experimental-strip-types scripts/provider-probes/arbitrum-sepolia-native-rpc.ts
\`\`\`

The embedded default is the official public Arbitrum Sepolia endpoint. An
approved HTTPS override may be supplied through \`ARBITRUM_SEPOLIA_RPC_URL\`.
The override value is never printed or persisted. Sequencer endpoints are
rejected.

Every successful run writes a new UTC-timestamped capture directory such as
\`arbitrum-sepolia-public-YYYY-MM-DDTHH-MM-SS-mmmZ\`. The probe fails closed
instead of overwriting an existing capture, and the final capture directory is
created only after all required live observations passed validation.

Safety: the probe has a fixed read-only method allowlist. It never signs,
broadcasts, submits a transaction, transfers tokens, requests faucet funds, or
writes chain state. The WETH transfer probe is an \`eth_call\` from a
deterministic address whose zero balance is first verified at the same pinned
block.
`,
    { flag: "wx" },
  );
}

async function run(): Promise<void> {
  checkEndpoint();
  const observations: JsonObject = {};

  const clientVersion = textOf(
    resultOf(await rpc("web3_clientVersion", []), "web3_clientVersion"),
    "web3_clientVersion.result",
  );
  observations.endpointClientIdentity = {
    classification: "OBSERVED_RUNTIME_METADATA",
    method: "web3_clientVersion",
    value: clientVersion,
    note: "Endpoint metadata only; not a NativeRpcProvider version.",
  };

  const chainHex = textOf(
    resultOf(await rpc("eth_chainId", []), "eth_chainId"),
    "eth_chainId.result",
  );
  const observedChainId = safeNumber(
    quantity(chainHex, "eth_chainId"),
    "chainId",
  );
  observations.chainIdentity = {
    state: observedChainId === CHAIN_ID ? "VERIFIED_RUNTIME" : "FAILED",
    method: "eth_chainId",
    chainId: observedChainId,
    rawHex: chainHex,
    expectedChainId: CHAIN_ID,
    expectedHex: CHAIN_ID_HEX,
  };
  if (observedChainId !== CHAIN_ID) {
    throw new Error(
      `Chain mismatch: expected ${CHAIN_ID}, observed ${observedChainId}`,
    );
  }

  const blockHex = textOf(
    resultOf(await rpc("eth_blockNumber", []), "eth_blockNumber"),
    "eth_blockNumber.result",
  );
  const blockNumber = quantity(blockHex, "eth_blockNumber").toString();
  observations.blockNumber = {
    state: "VERIFIED_RUNTIME",
    method: "eth_blockNumber",
    blockNumber,
    rawHex: blockHex,
  };

  const block = object(
    resultOf(
      await rpc("eth_getBlockByNumber", [blockHex, false]),
      "eth_getBlockByNumber",
    ),
    "eth_getBlockByNumber.result",
  );
  const returnedBlock = quantity(
    scrub(block.number),
    "block.number",
  ).toString();
  if (returnedBlock !== blockNumber) throw new Error("Pinned block mismatch");
  const blockHash = textOf(scrub(block.hash), "block.hash");
  const blockTimestamp = quantity(scrub(block.timestamp), "block.timestamp");
  const blockTimestampIso = new Date(
    safeNumber(blockTimestamp, "block.timestamp") * 1_000,
  ).toISOString();
  observations.blockContext = {
    state: "VERIFIED_RUNTIME",
    method: "eth_getBlockByNumber",
    blockNumber,
    blockHash,
    timestamp: blockTimestamp.toString(),
    timestampIso: blockTimestampIso,
    fullTransactionsRequested: false,
  };

  const code = textOf(
    resultOf(await rpc("eth_getCode", [WETH, blockHex]), "eth_getCode"),
    "eth_getCode.result",
  );
  if (!/^0x[0-9a-f]+$/iu.test(code) || code === "0x") {
    throw new Error("WETH did not return non-empty bytecode");
  }
  observations.contractCode = {
    state: "VERIFIED_RUNTIME",
    method: "eth_getCode",
    target: WETH,
    blockNumber,
    nonEmpty: true,
    byteLength: (code.length - 2) / 2,
  };

  const decimalsRaw = textOf(
    resultOf(
      await rpc("eth_call", [{ to: WETH, data: "0x313ce567" }, blockHex]),
      "eth_call decimals()",
    ),
    "decimals.result",
  );
  const decimals = safeNumber(
    quantity(decimalsRaw, "decimals.result"),
    "decimals",
  );
  observations.ethCallDecimals = {
    state: decimals === 18 ? "VERIFIED_RUNTIME" : "FAILED",
    method: "eth_call",
    selector: "0x313ce567",
    target: WETH,
    blockNumber,
    rawResult: decimalsRaw,
    normalizedDecimals: decimals,
  };
  if (decimals !== 18)
    throw new Error(`Expected 18 decimals, observed ${decimals}`);

  const balanceRaw = textOf(
    resultOf(
      await rpc("eth_call", [
        { to: WETH, data: `0x70a08231${word(SENDER)}` },
        blockHex,
      ]),
      "eth_call balanceOf()",
    ),
    "balanceOf.result",
  );
  const balance = quantity(balanceRaw, "balanceOf.result");
  observations.ethCallBalanceOf = {
    state: "VERIFIED_RUNTIME",
    method: "eth_call",
    selector: "0x70a08231",
    target: WETH,
    probeSender: SENDER,
    blockNumber,
    rawResult: balanceRaw,
    normalizedBalance: balance.toString(),
    zeroBalanceConfirmed: balance === 0n,
  };
  if (balance !== 0n) throw new Error("Probe sender WETH balance is not zero");

  observations.ethGetBalance = {
    state: "UNKNOWN",
    method: "eth_getBalance",
    reason: "NOT_EXECUTED_IN_REAL_CHECKPOINT",
    note: "Native balance reads were not executed in the real checkpoint. The recorded balanceOf eth_call is an ERC-20 read and must not qualify eth_getBalance.",
  };

  const transfer = await rpc("eth_call", [
    {
      from: SENDER,
      to: WETH,
      data: `0xa9059cbb${word(RECIPIENT)}${1n.toString(16).padStart(64, "0")}`,
      value: "0x0",
    },
    blockHex,
  ]);
  const transferError = transfer.error;
  const errorCode = transferError?.code;
  const errorMessage = transferError?.message;
  const errorData = transferError?.data ?? null;
  const decodedRevertReason = decodeAbiErrorString(errorData);
  const controlledRevertValidation = {
    httpOk: transfer.httpOk === true,
    jsonRpcErrorPresent: transferError !== undefined,
    errorCodeIsThree: typeof errorCode === "number" && errorCode === 3,
    messageSemanticPresent:
      typeof errorMessage === "string" &&
      errorMessage.includes(CONTROLLED_REVERT_REASON),
    abiErrorDataPresent: typeof errorData === "string" && errorData.length > 0,
    abiErrorStringDecodesToControlledReason:
      decodedRevertReason === CONTROLLED_REVERT_REASON,
  };
  if (Object.values(controlledRevertValidation).some((ok) => !ok)) {
    throw new Error(
      `Controlled revert failed validation: ${JSON.stringify(scrub(controlledRevertValidation))}`,
    );
  }
  if (transferError === undefined) {
    throw new Error("Controlled revert returned no JSON-RPC error envelope");
  }
  observations.ethCallControlledRevert = {
    state: "VERIFIED_RUNTIME",
    method: "eth_call",
    target: WETH,
    blockNumber,
    from: SENDER,
    recipient: RECIPIENT,
    amount: "1",
    zeroBalancePreconditionConfirmed: true,
    outcome: "JSON_RPC_ERROR_ENVELOPE_OBSERVED",
    error: transferError,
    validation: {
      errorCode: 3,
      messageSemanticValidated: true,
      abiErrorStringSelector: ABI_ERROR_STRING_SELECTOR,
      abiErrorStringDecoded: decodedRevertReason,
      abiErrorStringMatchesControlledReason: true,
    },
    normalizedRevertReason: null,
    note: "Controlled ABI Error(string) payload validated against the expected reason; no final Provider revert-reason semantic is inferred.",
  };

  const estimateInput = { to: WETH, data: "0x313ce567" };
  const pinnedEstimate = await rpc("eth_estimateGas", [
    estimateInput,
    blockHex,
  ]);
  if (
    pinnedEstimate.httpOk &&
    pinnedEstimate.result !== undefined &&
    !pinnedEstimate.error
  ) {
    const raw = textOf(pinnedEstimate.result, "eth_estimateGas.result");
    observations.ethEstimateGas = {
      state: "VERIFIED_RUNTIME",
      method: "eth_estimateGas",
      target: WETH,
      selector: "0x313ce567",
      provenance: "PINNED_BLOCK",
      blockNumber,
      rawResult: raw,
      normalizedGasEstimate: quantity(raw, "eth_estimateGas.result").toString(),
      note: "Estimate only; no transaction was sent.",
    };
  } else {
    const headEstimate = await rpc("eth_estimateGas", [estimateInput]);
    if (
      headEstimate.httpOk &&
      headEstimate.result !== undefined &&
      !headEstimate.error
    ) {
      const raw = textOf(headEstimate.result, "eth_estimateGas head result");
      observations.ethEstimateGas = {
        state: "VERIFIED_RUNTIME",
        method: "eth_estimateGas",
        target: WETH,
        selector: "0x313ce567",
        provenance: "HEAD_ONLY_NOT_PINNED",
        pinnedBlockParameterSupported: false,
        pinnedAttemptError: pinnedEstimate.error ?? null,
        rawResult: raw,
        normalizedGasEstimate: quantity(
          raw,
          "eth_estimateGas head result",
        ).toString(),
        note: "Weaker head-only provenance; no transaction was sent.",
      };
    } else {
      observations.ethEstimateGas = {
        state: "UNKNOWN",
        method: "eth_estimateGas",
        pinnedAttemptError: pinnedEstimate.error ?? null,
        headAttemptError: headEstimate.error ?? null,
      };
    }
  }

  const unsupported = await rpc(UNSUPPORTED_METHOD, []);
  const unsupportedError = unsupported.error;
  const unsupportedCode = unsupportedError?.code;
  if (
    !(
      unsupported.httpOk === true &&
      unsupportedError !== undefined &&
      typeof unsupportedCode === "number" &&
      unsupportedCode === -32601
    )
  ) {
    throw new Error(
      `Method-not-found envelope failed validation: expected HTTP OK with JSON-RPC error code -32601, observed ${JSON.stringify(scrub({ httpOk: unsupported.httpOk, code: unsupportedCode, result: unsupported.result }))}`,
    );
  }
  if (unsupportedError === undefined) {
    throw new Error("Method-not-found envelope returned no JSON-RPC error");
  }
  observations.methodNotFoundEnvelope = {
    state: "VERIFIED_RUNTIME",
    classification: "JSON_RPC_METHOD_NOT_FOUND_ENVELOPE",
    method: UNSUPPORTED_METHOD,
    outcome: "JSON_RPC_METHOD_NOT_FOUND_ENVELOPE",
    error: unsupportedError,
    semanticBoundary:
      "Observed JSON-RPC -32601 method-not-found envelope only; NOT final Provider UNSUPPORTED semantics.",
  };

  observations.capabilitySummary = {
    promotedToVerifiedRuntime: [
      "arbitrumSepoliaChainIdentity",
      "blockNumber",
      "blockContext",
      "contractCodeRead",
      "ethCallRead",
      "ethCallRevertErrorEnvelope",
      "methodNotFoundEnvelope",
      ...(object(observations.ethEstimateGas, "gas observation").state ===
      "VERIFIED_RUNTIME"
        ? ["ethEstimateGas"]
        : []),
    ],
    explicitlyNotPromoted: [
      "completeTransactionSimulation",
      "hypotheticalReceipt",
      "hypotheticalLogs",
      "stateDiff",
      "completeAssetChanges",
      "completeBalanceChanges",
      "camelotV3Evaluation",
      "preparedExecutionSupport",
      "nativeRpcProviderImplementation",
      "nativeEthGetBalance",
      "finalFreshnessPolicy",
      "tenderlyCapability",
    ],
  };

  writeStaged("metadata.json", {
    schemaVersion: "be-011-native-rpc-surface-v1",
    qualificationStatus: "QUALIFIED_CONTROLLED_PARTIAL_EVIDENCE",
    real: true,
    providerCandidate: {
      providerId: "native-rpc-arbitrum",
      implementationStatus: "NOT_IMPLEMENTED",
      identityNote:
        "Observed client identity is endpoint metadata, not a NativeRpcProvider version.",
    },
    endpointClass,
    captureId: captureStamp,
    captureDirectoryName,
    retrievalStartedAt: startedAt,
    retrievalFinishedAt: new Date().toISOString(),
    nodeVersion: process.version,
    repositoryHeadAtCapture: gitHead(),
    chainId: observedChainId,
    pinnedBlock: {
      number: blockNumber,
      hash: blockHash,
      timestamp: blockTimestamp.toString(),
      timestampIso: blockTimestampIso,
    },
    clientVersion,
    protocol: null,
    intent: null,
    scope: "native-rpc-provider-surface-qualification",
    reproducibility:
      "Sanitized response snapshot is reproducible offline; a live rerun selects a new head and requires network access.",
    redaction:
      "Endpoint values, headers, cookies, access tokens, authorization values, and secrets are neither recorded nor printed.",
    noSigningOrBroadcast:
      "No signing, broadcast, transaction submission, faucet use, or chain write occurred.",
    failure: null,
    limitations: [
      "Controlled partial evidence fallback only; this is not a NativeRpcProvider implementation.",
      "The WETH probe qualifies deterministic read-only RPC mechanics and is not a Camelot transaction.",
      "Protocol and Intent remain null; no PreparedExecution support is inferred.",
      "Standard RPC does not prove hypothetical receipts, logs, state diffs, complete asset changes, or complete balance changes.",
      "The controlled revert and the -32601 method-not-found envelope are observed JSON-RPC envelopes only; no final Provider revert-reason or UNSUPPORTED status is inferred.",
      "eth_getBalance was not executed in this real checkpoint and remains UNKNOWN.",
      "No Provider outage, natural network timeout, or rate limit was intentionally produced or claimed.",
      "No final freshness threshold or cross-Provider normalization semantic is established.",
    ],
  });
  writeStaged("responses.json", {
    schemaVersion: "be-011-native-rpc-responses-v1",
    real: true,
    endpointClass,
    requests: responses,
  });
  writeStaged("normalized-observations.json", {
    schemaVersion: "be-011-native-rpc-observations-v1",
    real: true,
    scope: "native-rpc-provider-surface-qualification",
    protocol: null,
    intent: null,
    observations,
    unavailableEvidence: {
      providerOutage: "NOT_OBSERVED",
      naturalNetworkTimeout: "NOT_OBSERVED",
      rateLimit: "UNKNOWN_NOT_INTENTIONALLY_PROVOKED",
      staleResponse: "NOT_OBSERVED_NO_POLICY_THRESHOLD_DEFINED",
    },
    nonAuthorityNotice:
      "Observed facts only; no final Evidence Contract, Provider status mapping, Camelot support, or PreparedExecution semantic is inferred.",
  });
  writeReproduce();

  publishCapture();

  console.log(
    `BE011_NATIVE_RPC_PROBE status=QUALIFIED_CONTROLLED_PARTIAL_EVIDENCE endpointClass=${endpointClass} chainId=${observedChainId} fixture=${relative(process.cwd(), fixtureDir)}`,
  );
}

try {
  await run();
} catch (error) {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // staging cleanup is best-effort
  }
  console.error(`BE011_NATIVE_RPC_PROBE_FAILED reason=${safeMessage(error)}`);
  process.exitCode = 1;
}

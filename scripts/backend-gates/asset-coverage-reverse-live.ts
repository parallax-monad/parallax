/**
 * #105 Asset Coverage — real USDC -> WETH reverse-flow acceptance gate.
 *
 * This runner drives the REAL Backend HTTP application produced by the
 * production bootstrap (`bootstrapBackendApp` -> `createArbitrumProductionComposition`)
 * against Arbitrum Sepolia x Camelot V3, using the accepted #103 Provider
 * qualification as its only scenario source. Every recorded value below comes
 * from a real RPC/HTTP response observed during the run; nothing is synthesized.
 *
 * The exercise is strictly read-only: it never signs, approves, broadcasts, or
 * custodies anything. The runner observes every JSON-RPC method sent to the
 * configured endpoint and fails if any state-changing method is ever used.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  CAMELOT_V3_ROUTER_ADDRESS,
  inspectCamelotV3Transaction,
} from "../../apps/api/src/backend/camelot-v3-binding.js";
import {
  CAMELOT_SEPOLIA_USDC,
  CAMELOT_SEPOLIA_WETH,
} from "../../apps/api/src/backend/camelot-v3-protocol-adapter.js";
import { NATIVE_RPC_ARBITRUM_PROVIDER_ID } from "../../apps/api/src/backend/native-rpc-evidence.js";
import { fingerprintPreparedTransaction } from "../../apps/api/src/backend/prepared-transaction-fingerprint.js";
import { bootstrapBackendApp } from "../../apps/api/src/bootstrap/backend.js";
import { normalizeArbitrumCheckSwapRequest } from "../../apps/api/src/normalization.js";
import { createTrustedTokenRegistry } from "../../apps/api/src/trusted-token-registry.js";
import { convertHumanAmountToAtomic } from "../../packages/contracts/src/amount.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
const ACCEPTED_SOURCE_CAPTURE =
  "fixtures/provider-registry/be-103/usdc-weth-camelot-2026-09-29T10-09-52-993Z/capture.json";
const ACCEPTED_SOURCE_SHA256 =
  "5a7ed69ca2dcf0413f79ddd29749e6f0ae652da91493814fece00cb0963b7b20";
const OUTPUT_ROOT = "fixtures/provider-registry/be-105";
const OFFICIAL_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const CAMELOT_V3_PROTOCOL = "camelot-v3" as const;
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const AMOUNT_IN_ATOMIC = "1000000000000000";
const EXPECTED_USDC_DECIMALS = 18;
const EXPECTED_WETH_DECIMALS = 18;
const QUOTE_FLOOR_PERCENT = 99n;
const PERCENT_DENOMINATOR = 100n;

/**
 * Source the gate loads or depends on. A capture is refused unless every one
 * of these paths is committed and its content manifest is unchanged across the
 * whole run. Paths outside this set (for example `apps/web`, owned elsewhere)
 * cannot reach this composition and are recorded but not treated as blocking.
 */
const SOURCE_MANIFEST_PATHS = [
  "apps/api/src",
  "packages/contracts/src",
  "packages/moss-bridge/src",
  "packages/orchestrator/agent-flow",
  "packages/orchestrator/application",
  "packages/risk/src",
  "scripts/backend-gates/asset-coverage-reverse-live.ts",
  "scripts/backend-gates/asset-coverage-reverse-capture.test.ts",
  ACCEPTED_SOURCE_CAPTURE,
  "package.json",
  "apps/api/package.json",
  "packages/contracts/package.json",
  "packages/moss-bridge/package.json",
  "packages/orchestrator/package.json",
  "packages/risk/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "apps/api/tsconfig.json",
] as const;

/**
 * A capture may never contain raw Provider material: no response envelopes, no
 * calldata bodies, no return bytes, no endpoint or credential material.
 */
const FORBIDDEN_CAPTURE_KEYS = new Set([
  "responseEvidence",
  "rawResponse",
  "rawPayload",
  "rawProviderPayload",
  "providerPayload",
  "rawReturnData",
  "returnData",
  "calldata",
  "rpcUrl",
  "endpoint",
  "apiKey",
  "accessKey",
  "authorization",
  "privateKey",
  "mnemonic",
  "seedPhrase",
  "secret",
  "signature",
]);
const HEX_BLOB_PATTERN = /0x[0-9a-fA-F]{100,}/;
const CREDENTIAL_PATTERN =
  /rpcUrl|api[-_]?key|authorization|private[-_]?key|mnemonic|seed[-_]?phrase|bearer\s/i;
const WRITE_RPC_METHOD_PATTERN =
  /^(eth_send|eth_sign|eth_submitWork|eth_newFilter|eth_uninstallFilter|personal_|wallet_|eth_accounts|eth_requestAccounts|eth_coinbase|miner_|admin_)/;

type ObjectValue = Record<string, unknown>;

type AcceptedCapture = {
  readonly status: string;
  readonly selectedSender: string;
  readonly addresses: {
    readonly usdc: string;
    readonly weth: string;
    readonly router: string;
    readonly quoter: string;
  };
  readonly tokenMetadata: {
    readonly usdcDecimals: number;
    readonly wethDecimals: number;
  };
  readonly chain: { readonly blockNumber: string };
  readonly quote: {
    readonly amountInAtomic: string;
    readonly amountOutAtomic: string;
    readonly estimatedAmountOut: string;
    readonly blockNumber: string;
  };
  readonly prepared: {
    readonly binding: ObjectValue;
    readonly amountOutMinimumPolicy: string;
  };
};

type RpcObservationSnapshot = {
  readonly count: number;
  readonly methods: Readonly<Record<string, number>>;
  readonly writeMethodViolations: readonly string[];
};

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(value: string | Uint8Array): string {
  return `sha256:${sha256Hex(value)}`;
}

function optionalObject(value: unknown): ObjectValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nested(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalObject(current);
    if (record === undefined) return undefined;
    current = record[key];
  }
  return current;
}

function decimalFromAtomic(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Atomic amount is not a canonical unsigned integer");
  }
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function endpointConfiguration(): { url: string; endpointClass: string } {
  const configured =
    process.env.ARBITRUM_SEPOLIA_RPC_URL ?? process.env.ARBITRUM_RPC_URL;
  const url = configured ?? OFFICIAL_RPC;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Arbitrum RPC endpoint is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Arbitrum RPC endpoint must use HTTPS");
  }
  if (
    configured === undefined &&
    (parsed.hostname !== "sepolia-rollup.arbitrum.io" ||
      parsed.pathname !== "/rpc")
  ) {
    throw new Error(
      "Embedded public Arbitrum RPC endpoint failed its host guard",
    );
  }
  return {
    url,
    endpointClass:
      configured === undefined
        ? "arbitrum-official-public"
        : "environment-supplied",
  };
}

/**
 * Observes every request the production composition sends to the configured
 * endpoint. Counts are the only way the zero-RPC historical reads below are
 * non-vacuous, and the method log is the read-only proof for this exercise.
 */
function installRpcObserver(rpcUrl: string) {
  const originalFetch = globalThis.fetch;
  const methodCounts = new Map<string, number>();
  const writeMethodViolations: string[] = [];
  let count = 0;

  const wrapped: typeof fetch = async (input, init) => {
    const target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (target === rpcUrl) {
      count += 1;
      const body = init?.body;
      if (typeof body === "string") {
        try {
          const method = stringField(
            optionalObject(JSON.parse(body) as unknown)?.method,
          );
          if (method !== undefined) {
            methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
            if (WRITE_RPC_METHOD_PATTERN.test(method)) {
              writeMethodViolations.push(method);
            }
          }
        } catch {
          // A non-JSON body is not a JSON-RPC call this gate can classify.
        }
      }
    }
    return originalFetch(input, init);
  };

  globalThis.fetch = wrapped;

  return {
    snapshot(): RpcObservationSnapshot {
      return {
        count,
        methods: Object.fromEntries([...methodCounts.entries()].sort()),
        writeMethodViolations: [...new Set(writeMethodViolations)].sort(),
      };
    },
    restore(): void {
      globalThis.fetch = originalFetch;
    },
  };
}

function gitOutput(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

function gitRevision(revision: string): string {
  return gitOutput("rev-parse", revision).trim();
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    gitOutput("merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

function captureSourceProvenance() {
  const paths = [
    ...new Set(
      gitOutput(
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...SOURCE_MANIFEST_PATHS,
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const manifestChangedPaths = gitOutput(
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...SOURCE_MANIFEST_PATHS,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
  const worktreeChangedPaths = gitOutput(
    "status",
    "--porcelain",
    "--untracked-files=all",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
  const manifestSet = new Set(manifestChangedPaths);
  const files = paths.map((path) => ({
    path,
    sha256: sha256Hex(readFileSync(join(REPO_ROOT, path))),
  }));
  return {
    repositoryHead: gitRevision("HEAD"),
    repositoryTree: gitRevision("HEAD^{tree}"),
    originMain: gitRevision("origin/main"),
    headDescendsFromOriginMain: isAncestor(
      gitRevision("origin/main"),
      gitRevision("HEAD"),
    ),
    manifestChangedPaths,
    manifestSha256: sha256Hex(JSON.stringify(files)),
    fileCount: files.length,
    worktreeDirty: worktreeChangedPaths.length > 0,
    worktreeChangedPaths,
    unrelatedChangedPaths: worktreeChangedPaths.filter(
      (path) => !manifestSet.has(path),
    ),
    nodeVersion: process.version,
  };
}

function assertCleanCommittedSource(
  provenance: ReturnType<typeof captureSourceProvenance>,
): void {
  if (!provenance.headDescendsFromOriginMain) {
    throw new Error(
      "The committed source head does not descend from the current origin/main",
    );
  }
  if (provenance.manifestChangedPaths.length > 0) {
    throw new Error(
      `The gate source must be clean and committed: ${provenance.manifestChangedPaths.join(", ")}`,
    );
  }
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  const record = optionalObject(value);
  if (record === undefined) return false;
  return Object.entries(record).some(
    ([key, child]) =>
      FORBIDDEN_CAPTURE_KEYS.has(key) || containsForbiddenKey(child),
  );
}

async function requestJson(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await app.fetch(
    new Request(`http://127.0.0.1${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    }),
  );
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as unknown, text };
}

function isZeroHexQuantity(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    return BigInt(value) === 0n;
  } catch {
    return false;
  }
}

function redactFailureMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'`)>]+/gi, "[redacted-url]")
    .replace(/(api[-_]?key|token|secret)=[^&\s]+/gi, "$1=[redacted]");
}

async function main(): Promise<void> {
  const { url: rpcUrl, endpointClass } = endpointConfiguration();
  const startedAt = new Date().toISOString();

  const fixtureBytes = readFileSync(join(REPO_ROOT, ACCEPTED_SOURCE_CAPTURE));
  const fixtureDigest = sha256Hex(fixtureBytes);
  if (fixtureDigest !== ACCEPTED_SOURCE_SHA256) {
    throw new Error("The accepted BE-103 source capture digest does not match");
  }
  const accepted = JSON.parse(fixtureBytes.toString("utf8")) as AcceptedCapture;
  if (accepted.status !== "QUALIFIED_REAL") {
    throw new Error("The accepted BE-103 source capture is not QUALIFIED_REAL");
  }

  const provenanceBefore = captureSourceProvenance();
  assertCleanCommittedSource(provenanceBefore);
  const runnerDigest = fingerprint(readFileSync(SCRIPT_PATH));

  // Real product constants and the accepted Provider scenario must agree; the
  // prepared transaction can then never bind a router the scenario never saw.
  const addressesAgree =
    accepted.addresses.usdc.toLowerCase() ===
      CAMELOT_SEPOLIA_USDC.toLowerCase() &&
    accepted.addresses.weth.toLowerCase() ===
      CAMELOT_SEPOLIA_WETH.toLowerCase() &&
    accepted.addresses.router.toLowerCase() ===
      CAMELOT_V3_ROUTER_ADDRESS.toLowerCase();
  if (!addressesAgree) {
    throw new Error(
      "The accepted BE-103 addresses disagree with the product Camelot constants",
    );
  }

  const tokenRegistry = {
    chains: [
      { chainId: ARBITRUM_SEPOLIA_CHAIN_ID, symbol: "ETH", decimals: 18 },
    ],
    tokens: [
      {
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        address: accepted.addresses.usdc,
        symbol: "USDC",
        decimals: EXPECTED_USDC_DECIMALS,
        decimalsSource: "onchain_verified" as const,
        verifiedAtBlock: accepted.chain.blockNumber,
      },
      {
        chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        address: accepted.addresses.weth,
        symbol: "WETH",
        decimals: EXPECTED_WETH_DECIMALS,
        decimalsSource: "onchain_verified" as const,
        verifiedAtBlock: accepted.chain.blockNumber,
      },
    ],
  };
  const environment = {
    MONAD_RPC_URL: "https://unused.invalid",
    ARBITRUM_RPC_URL: rpcUrl,
    MOSS_RUNTIME_VERSION: "unused-for-arbitrum-gate",
    MOSS_RUNTIME_REVISION: "unused-for-arbitrum-gate",
    RUN_STORE_BACKEND: "memory",
  };

  const amountIn = decimalFromAtomic(AMOUNT_IN_ATOMIC, EXPECTED_USDC_DECIMALS);
  const intentRequest = {
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
    protocol: CAMELOT_V3_PROTOCOL,
    sender: accepted.selectedSender,
    tokenIn: { kind: "erc20" as const, address: accepted.addresses.usdc },
    tokenOut: { kind: "erc20" as const, address: accepted.addresses.weth },
    amountIn,
  };

  // The same trusted registry instance feeds both the HTTP application and the
  // gate's independent normalization, so the ERC-20 input path is exercised
  // through exactly one product implementation.
  const trustedRegistry = createTrustedTokenRegistry(tokenRegistry);

  const observer = installRpcObserver(rpcUrl);
  const app = bootstrapBackendApp({ environment, tokenRegistry });

  try {
    // ---- ERC-20 input normalization through the production registry --------
    const normalization = normalizeArbitrumCheckSwapRequest(
      {
        ...intentRequest,
        economicBoundary: {
          availability: "unavailable",
          source: "unavailable",
        },
      },
      trustedRegistry,
    );

    // Every public response body is scanned for endpoint leakage below.
    const responseTexts: string[] = [];

    // ---- Phase 1: POST /api/quote -----------------------------------------
    const quoteRpcBefore = observer.snapshot().count;
    const quoteResponse = await requestJson(app, "/api/quote", {
      method: "POST",
      body: JSON.stringify(intentRequest),
    });
    responseTexts.push(quoteResponse.text);
    const quoteRpcRequests = observer.snapshot().count - quoteRpcBefore;
    const quoteBody = optionalObject(quoteResponse.body);
    const quoteStatus = stringField(quoteBody?.status);
    const quote = optionalObject(quoteBody?.quote);
    const quoteAmountOut = stringField(quote?.estimatedAmountOut);
    const quoteBlockNumber = stringField(quote?.blockNumber);
    const quoteFetchedAt = stringField(quote?.fetchedAt);
    const quoteRuntimeVersion = stringField(quote?.runtimeVersion);
    const quoteRuntimeRevision = stringField(quote?.runtimeRevision);
    const quoteAtomicConversion =
      quoteAmountOut === undefined
        ? undefined
        : convertHumanAmountToAtomic(quoteAmountOut, EXPECTED_WETH_DECIMALS);
    const quoteAmountOutAtomic =
      quoteAtomicConversion?.success === true
        ? quoteAtomicConversion.amountAtomic
        : undefined;

    // ---- Phase 2: POST /api/check with the quoted Expectation Baseline ----
    // The baseline is the product's own /api/quote projection, verbatim. When
    // that projection omits the quote observation time the product cannot form
    // an Expectation Baseline; the gate records that instead of inventing one.
    const baseline =
      quote === undefined
        ? undefined
        : {
            // `expectationBaselineSchema` is strict: it repeats the exact-input
            // intent identity (chain/protocol/pair/amount) plus the selected
            // quote, and deliberately does not accept `sender`.
            chainId: intentRequest.chainId,
            protocol: intentRequest.protocol,
            tokenIn: intentRequest.tokenIn,
            tokenOut: intentRequest.tokenOut,
            amountIn: intentRequest.amountIn,
            quote: {
              estimatedAmountOut: quoteAmountOut,
              source: quote.source,
              blockNumber: quoteBlockNumber,
              ...(quoteFetchedAt === undefined
                ? {}
                : { fetchedAt: quoteFetchedAt }),
              runtimeVersion: quoteRuntimeVersion,
              runtimeRevision: quoteRuntimeRevision,
            },
          };
    const checkRequest = {
      ...intentRequest,
      economicBoundary: { availability: "unavailable", source: "unavailable" },
      ...(baseline === undefined ? {} : { expectationBaseline: baseline }),
    };
    const checkRpcBefore = observer.snapshot().count;
    const checkResponse = await requestJson(app, "/api/check", {
      method: "POST",
      body: JSON.stringify(checkRequest),
    });
    responseTexts.push(checkResponse.text);
    const checkRpcRequests = observer.snapshot().count - checkRpcBefore;
    const checkResult = optionalObject(checkResponse.body) ?? {};
    const runId = stringField(checkResult.runId);
    const p0 = optionalObject(checkResult.p0);
    const basicSimulation = optionalObject(p0?.basicSimulation);
    const transactionBinding = optionalObject(
      basicSimulation?.transactionBinding,
    );
    const resultQuote = optionalObject(checkResult.quote);
    const realizedQuoteFetchedAt = stringField(resultQuote?.fetchedAt);
    const realizedQuoteBlockNumber = stringField(resultQuote?.blockNumber);
    const realizedQuoteAmountOut = stringField(resultQuote?.estimatedAmountOut);
    const realizedAtomicConversion =
      realizedQuoteAmountOut === undefined
        ? undefined
        : convertHumanAmountToAtomic(
            realizedQuoteAmountOut,
            EXPECTED_WETH_DECIMALS,
          );
    const realizedAmountOutAtomic =
      realizedAtomicConversion?.success === true
        ? realizedAtomicConversion.amountAtomic
        : undefined;
    const expectedAmountOutMinimumAtomic =
      realizedAmountOutAtomic === undefined
        ? undefined
        : (
            (BigInt(realizedAmountOutAtomic) * QUOTE_FLOOR_PERCENT) /
            PERCENT_DENOMINATOR
          ).toString();

    // ---- Phase 3: independent binding decode through the product code -----
    const providerEvidence = optionalObject(checkResult.providerEvidence);
    const publicAction = Array.isArray(
      nested(providerEvidence, "action", "value"),
    )
      ? (nested(providerEvidence, "action", "value") as unknown[])
      : [];
    const preparedTransaction = publicAction
      .map(optionalObject)
      .find(
        (candidate) =>
          candidate !== undefined &&
          typeof candidate.data === "string" &&
          typeof candidate.from === "string" &&
          typeof candidate.to === "string",
      );
    const preparedTransactionFields =
      preparedTransaction === undefined
        ? undefined
        : Object.entries(preparedTransaction).reduce<Record<string, string>>(
            (fields, [key, value]) => {
              if (typeof value === "string") fields[key] = value;
              return fields;
            },
            {},
          );
    const preparedTransactionData = stringField(preparedTransaction?.data);
    const preparedTransactionValue = stringField(preparedTransaction?.value);
    const normalizedIntent =
      normalization.success === true ? normalization.intent : undefined;
    const inspection =
      normalizedIntent === undefined ||
      preparedTransactionFields === undefined ||
      realizedAmountOutAtomic === undefined
        ? undefined
        : inspectCamelotV3Transaction(
            normalizedIntent,
            { amountOutAtomic: realizedAmountOutAtomic },
            preparedTransactionFields,
          );
    const inspectionBinding =
      inspection?.ok === true ? inspection.binding : undefined;
    const preparedTransactionFingerprint =
      preparedTransactionFields === undefined
        ? undefined
        : fingerprintPreparedTransaction(preparedTransactionFields);
    const traceRpcTransactionFingerprint = stringField(
      nested(
        providerEvidence,
        "providerData",
        "traceRpc",
        "binding",
        "transactionFingerprint",
      ),
    );

    // ---- Phase 4: GET /api/runs/:runId must make zero RPC requests --------
    let runReadRpcRequests: number | undefined;
    let persistedRun: ObjectValue | undefined;
    let persistedRunHttpStatus: number | undefined;
    let persistedMatchesResponse = false;
    if (runId !== undefined) {
      const runReadBefore = observer.snapshot().count;
      const runResponse = await requestJson(
        app,
        `/api/runs/${encodeURIComponent(runId)}`,
      );
      responseTexts.push(runResponse.text);
      runReadRpcRequests = observer.snapshot().count - runReadBefore;
      persistedRunHttpStatus = runResponse.status;
      persistedRun = optionalObject(runResponse.body);
      persistedMatchesResponse =
        persistedRun?.result !== undefined &&
        isDeepStrictEqual(persistedRun.result, checkResponse.body);
    }

    // ---- Phase 5: account state + historical snapshot --------------------
    const accountStateRpcBefore = observer.snapshot().count;
    const accountStateResponse = await requestJson(app, "/api/account-state", {
      method: "POST",
      body: JSON.stringify(intentRequest),
    });
    responseTexts.push(accountStateResponse.text);
    const accountStateRpcRequests =
      observer.snapshot().count - accountStateRpcBefore;
    const accountStateBody = optionalObject(accountStateResponse.body);
    const snapshotId =
      typeof accountStateBody?.snapshotId === "string"
        ? accountStateBody.snapshotId
        : undefined;
    let snapshotReadRpcRequests: number | undefined;
    let snapshotReadStatus: number | undefined;
    let snapshotReadMatches = false;
    if (snapshotId !== undefined) {
      const snapshotReadBefore = observer.snapshot().count;
      const snapshotResponse = await requestJson(
        app,
        `/api/account-state/${encodeURIComponent(snapshotId)}`,
      );
      responseTexts.push(snapshotResponse.text);
      snapshotReadRpcRequests = observer.snapshot().count - snapshotReadBefore;
      snapshotReadStatus = snapshotResponse.status;
      snapshotReadMatches = isDeepStrictEqual(
        snapshotResponse.body,
        accountStateResponse.body,
      );
    }

    const rpc = observer.snapshot();

    // ---- Assertions -------------------------------------------------------
    const inputBalance = optionalObject(
      nested(accountStateBody, "balances", "inputToken"),
    );
    const inputMetadata = optionalObject(inputBalance?.metadata);
    const allowance = optionalObject(accountStateBody?.allowance);
    const allowanceSpender = optionalObject(allowance?.spender);
    const accountStateBlock = optionalObject(accountStateBody?.block);
    const basicSimulationBlockNumber = stringField(
      basicSimulation?.blockNumber,
    );
    const simulatorPinnedBlock = stringField(checkResult.simulatorPinnedBlock);
    const gasUnits = stringField(
      nested(basicSimulation, "gasEstimate", "gasUnits"),
    );
    const callStatus = stringField(nested(basicSimulation, "call", "status"));
    const callReturnDataFingerprint = stringField(
      nested(basicSimulation, "call", "returnDataFingerprint"),
    );
    const gasStatus = stringField(
      nested(basicSimulation, "gasEstimate", "status"),
    );
    const validityAtExecution = stringField(
      basicSimulation?.validityAtExecution,
    );
    const executionBlockHash = stringField(basicSimulation?.blockHash);
    const providedBinding = transactionBinding;
    const bindingMatchesPublic =
      inspectionBinding !== undefined &&
      providedBinding !== undefined &&
      isDeepStrictEqual(inspectionBinding, providedBinding);

    const bindingBindsIntent =
      inspectionBinding !== undefined &&
      inspectionBinding.tokenIn.toLowerCase() ===
        accepted.addresses.usdc.toLowerCase() &&
      inspectionBinding.tokenOut.toLowerCase() ===
        accepted.addresses.weth.toLowerCase() &&
      inspectionBinding.recipient.toLowerCase() ===
        accepted.selectedSender.toLowerCase() &&
      inspectionBinding.sender.toLowerCase() ===
        accepted.selectedSender.toLowerCase() &&
      inspectionBinding.amountInAtomic === AMOUNT_IN_ATOMIC &&
      inspectionBinding.router.toLowerCase() ===
        CAMELOT_V3_ROUTER_ADDRESS.toLowerCase() &&
      inspectionBinding.from.toLowerCase() ===
        accepted.selectedSender.toLowerCase() &&
      inspectionBinding.to.toLowerCase() ===
        CAMELOT_V3_ROUTER_ADDRESS.toLowerCase() &&
      inspectionBinding.amountOutMinimumAtomic ===
        expectedAmountOutMinimumAtomic;

    const executionBindingCriteria = {
      callSucceeded: callStatus === "SUCCEEDED",
      callFingerprintRecorded: /^sha256:[0-9a-f]{64}$/.test(
        callReturnDataFingerprint ?? "",
      ),
      gasAvailable: gasStatus === "AVAILABLE",
      gasUnitsPositive:
        gasUnits !== undefined &&
        /^\d+$/.test(gasUnits) &&
        BigInt(gasUnits) > 0n,
      validityValid: validityAtExecution === "VALID",
      blockHashRecorded: /^0x[0-9a-f]{64}$/i.test(executionBlockHash ?? ""),
      transactionBindingPresent: providedBinding !== undefined,
      independentInspectionOk: inspection?.ok === true,
      bindingMatchesPublic,
    };
    const executionBindingLevel = Object.values(executionBindingCriteria).every(
      Boolean,
    )
      ? "BOUND"
      : Object.entries(executionBindingCriteria).some(
            ([key, value]) =>
              value &&
              [
                "callSucceeded",
                "gasAvailable",
                "transactionBindingPresent",
                "independentInspectionOk",
              ].includes(key),
          )
        ? "PARTIAL"
        : "UNKNOWN";

    const checkedScope = Array.isArray(providerEvidence?.checkedScope)
      ? (providerEvidence?.checkedScope as unknown[])
      : [];
    const requiredProviderScopes = [
      "native-rpc.eth_call",
      "native-rpc.estimateGas",
      "native-rpc.pinned-block",
    ];
    const trustedDecimalsMatchRegistry =
      inputMetadata?.symbol === "USDC" &&
      inputMetadata?.decimals === EXPECTED_USDC_DECIMALS &&
      inputMetadata?.decimalsSource === "onchain_verified" &&
      inputMetadata?.verifiedAtBlock === accepted.chain.blockNumber;

    const assertions = {
      sourceHeadDescendsFromOriginMain:
        provenanceBefore.headDescendsFromOriginMain,
      sourceManifestCommitted:
        provenanceBefore.manifestChangedPaths.length === 0,
      erc20InputNormalized: normalization.success === true,
      quoteHttpOk: quoteResponse.status === 200,
      quoteAvailable: quoteStatus === "available",
      quotePinnedBlock:
        quoteBlockNumber !== undefined && /^\d+$/.test(quoteBlockNumber),
      quoteObservationTimeExposed:
        quoteFetchedAt !== undefined &&
        !Number.isNaN(Date.parse(quoteFetchedAt)),
      quoteRuntimeProvenancePresent:
        quoteRuntimeVersion !== undefined &&
        quoteRuntimeVersion.trim() !== "" &&
        quoteRuntimeRevision !== undefined &&
        quoteRuntimeRevision.trim() !== "",
      quoteAmountOutPositive:
        quoteAmountOutAtomic !== undefined && BigInt(quoteAmountOutAtomic) > 0n,
      expectationBaselineAvailable:
        nested(p0, "expectationBaseline", "status") === "AVAILABLE",
      checkHttpOk: checkResponse.status === 200,
      checkCompleted: checkResult.status === "completed",
      realizedQuoteObservationTimeExposed:
        realizedQuoteFetchedAt !== undefined &&
        !Number.isNaN(Date.parse(realizedQuoteFetchedAt)),
      preparedTransactionPublic: preparedTransactionData !== undefined,
      preparedTransactionSelectorIsExactInputSingle:
        inspection?.ok === true &&
        preparedTransactionData?.slice(0, 10).toLowerCase() === "0xbc651188",
      preparedTransactionBindsIntent: bindingBindsIntent,
      preparedTransactionValueIsZero:
        inspectionBinding?.value === "0x0" &&
        isZeroHexQuantity(preparedTransactionValue),
      amountOutMinimumMatchesQuotePolicy:
        expectedAmountOutMinimumAtomic !== undefined &&
        providedBinding?.amountOutMinimumAtomic ===
          expectedAmountOutMinimumAtomic,
      publicBindingMatchesIndependentInspection: bindingMatchesPublic,
      preparedTransactionFingerprintRecorded:
        typeof basicSimulation?.preparedTransactionFingerprint === "string",
      preparedTransactionFingerprintMatchesTraceEvidence:
        preparedTransactionFingerprint !== undefined &&
        traceRpcTransactionFingerprint !== undefined &&
        basicSimulation?.preparedTransactionFingerprint ===
          preparedTransactionFingerprint &&
        traceRpcTransactionFingerprint === preparedTransactionFingerprint,
      pinnedCallSucceeded: callStatus === "SUCCEEDED",
      pinnedGasEstimated: executionBindingCriteria.gasUnitsPositive,
      validityAtExecutionRecorded:
        validityAtExecution === "VALID" ||
        validityAtExecution === "INVALID" ||
        validityAtExecution === "UNKNOWN",
      executionBlockRecorded:
        basicSimulationBlockNumber !== undefined &&
        /^\d+$/.test(basicSimulationBlockNumber) &&
        /^0x[0-9a-f]{64}$/i.test(executionBlockHash ?? ""),
      executionBlockMatchesSimulatorPin:
        basicSimulationBlockNumber !== undefined &&
        basicSimulationBlockNumber === simulatorPinnedBlock,
      transactionBindingRecorded: providedBinding !== undefined,
      executionBindingBound: executionBindingLevel === "BOUND",
      providerIsNativeRpcArbitrum:
        nested(providerEvidence, "provider", "providerId") ===
        NATIVE_RPC_ARBITRUM_PROVIDER_ID,
      providerIntegrationOk:
        nested(providerEvidence, "provider", "integrationStatus") === "OK",
      providerStatusRecorded:
        typeof nested(providerEvidence, "provider", "status") === "string",
      executionStatusRecorded:
        typeof nested(providerEvidence, "execution", "status") === "string",
      liveProviderProvenance:
        nested(providerEvidence, "provenance", "mode") === "LIVE" &&
        nested(providerEvidence, "provenance", "source") === "rpc",
      pinnedScopesChecked: requiredProviderScopes.every((scope) =>
        checkedScope.includes(scope),
      ),
      evidenceStateRecorded: typeof p0?.evidenceState === "string",
      quoteFidelityRecorded:
        typeof nested(p0, "quoteFidelity", "status") === "string",
      verdictRecorded: typeof checkResult.verdict === "string",
      remediationRecorded:
        typeof nested(p0, "remediation", "status") === "string",
      persistedRunHttpStatusOk: persistedRunHttpStatus === 200,
      persistedRunMatchesResponse: persistedMatchesResponse,
      historicalRunReadMadeZeroRpcRequests: runReadRpcRequests === 0,
      primaryCheckMadeObservedRpcRequests: checkRpcRequests > 0,
      accountStateHttpOk: accountStateResponse.status === 200,
      accountStateSnapshotAvailable: accountStateBody?.status === "AVAILABLE",
      accountStateBlockVerified: accountStateBlock?.status === "VERIFIED",
      trustedInputDecimalsFromRegistry: trustedDecimalsMatchRegistry,
      allowanceSpenderQualified: allowanceSpender?.status === "QUALIFIED",
      allowanceNoLongerStructurallyUnqualified:
        allowance?.status === "SUFFICIENT" ||
        allowance?.status === "INSUFFICIENT",
      allowanceSpenderIsCamelotRouter:
        stringField(allowanceSpender?.address)?.toLowerCase() ===
        CAMELOT_V3_ROUTER_ADDRESS.toLowerCase(),
      historicalAccountStateReadMadeZeroRpcRequests:
        snapshotReadRpcRequests === 0,
      historicalAccountStateReadMatchesQuery: snapshotReadMatches,
      noWriteRpcMethodsObserved: rpc.writeMethodViolations.length === 0,
      rpcEndpointRedacted: responseTexts.every(
        (text) => !text.includes(rpcUrl),
      ),
      rawProviderPayloadAbsent:
        !containsForbiddenKey(checkResult) &&
        !containsForbiddenKey(persistedRun ?? {}) &&
        !containsForbiddenKey(accountStateBody ?? {}),
    };

    const blockers = Object.entries(assertions)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    const projectionGapOnly =
      blockers.length > 0 &&
      blockers.every((key) =>
        [
          "quoteObservationTimeExposed",
          "expectationBaselineAvailable",
        ].includes(key),
      );
    const gateStatus =
      blockers.length === 0
        ? "PASS"
        : projectionGapOnly
          ? "NOT_PASS_QUOTE_PROJECTION_OBSERVATION_TIME_NOT_EXPOSED"
          : "NOT_PASS_ACCEPTANCE_FAILURE";

    // ---- Sanitized capture ------------------------------------------------
    const completedAt = new Date().toISOString();
    const capture = {
      schemaVersion: "be-105-asset-coverage-reverse-live-v1",
      exerciseStatus: "COMPLETED",
      gateStatus,
      real: true,
      readOnly: true,
      signed: false,
      broadcast: false,
      endpointClass,
      baseReference: "origin/main",
      repositoryHeadAtCapture: provenanceBefore.repositoryHead,
      repositoryTreeAtCapture: provenanceBefore.repositoryTree,
      originMainAtCapture: provenanceBefore.originMain,
      startedAt,
      completedAt,
      source: {
        acceptedIssueScenario:
          "#105 / BE-103 real USDC -> WETH Camelot V3 qualification",
        fixture: ACCEPTED_SOURCE_CAPTURE,
        fixtureSha256: fixtureDigest,
        fixtureStatus: accepted.status,
        selectedSender: accepted.selectedSender,
        addresses: accepted.addresses,
        expected: {
          amountInAtomic: accepted.quote.amountInAtomic,
          amountOutAtomic: accepted.quote.amountOutAtomic,
          amountOutMinimumAtomic:
            accepted.prepared.binding.amountOutMinimumAtomic,
          amountOutMinimumPolicy: accepted.prepared.amountOutMinimumPolicy,
          quoteBlockNumber: accepted.quote.blockNumber,
        },
        request: intentRequest,
        baseline: baseline ?? null,
        productConstantsAgreeWithScenario: addressesAgree,
      },
      tokenRegistry: {
        chains: tokenRegistry.chains,
        tokens: tokenRegistry.tokens,
      },
      quoteEndpoint: {
        httpStatus: quoteResponse.status,
        status: quoteStatus ?? null,
        blockNumber: quoteBlockNumber ?? null,
        fetchedAt: quoteFetchedAt ?? null,
        fetchedAtExposed: quoteFetchedAt !== undefined,
        runtimeVersion: quoteRuntimeVersion ?? null,
        runtimeRevision: quoteRuntimeRevision ?? null,
        estimatedAmountOut: quoteAmountOut ?? null,
        amountOutAtomic: quoteAmountOutAtomic ?? null,
        observedRpcRequests: quoteRpcRequests,
      },
      run: {
        runId: runId ?? null,
        httpStatus: checkResponse.status,
        status: stringField(checkResult.status) ?? null,
        verdict: stringField(checkResult.verdict) ?? null,
        summary: stringField(checkResult.summary) ?? null,
        simulatorPinnedBlock: simulatorPinnedBlock ?? null,
        createdAt: stringField(checkResult.createdAt) ?? null,
        responseSha256: fingerprint(JSON.stringify(checkResponse.body)),
        persistedRunHttpStatus: persistedRunHttpStatus ?? null,
        persistedRunStatus: stringField(persistedRun?.status) ?? null,
        persistedResultSha256:
          persistedRun?.result === undefined
            ? null
            : fingerprint(JSON.stringify(persistedRun.result)),
        parentRunId: persistedRun?.parentRunId ?? null,
        realizedQuote: {
          status:
            resultQuote === undefined
              ? "MISSING"
              : typeof resultQuote.estimatedAmountOut === "string"
                ? "AVAILABLE"
                : "INVALID",
          estimatedAmountOut: realizedQuoteAmountOut ?? null,
          amountOutAtomic: realizedAmountOutAtomic ?? null,
          blockNumber: realizedQuoteBlockNumber ?? null,
          fetchedAt: realizedQuoteFetchedAt ?? null,
          runtimeVersion: stringField(resultQuote?.runtimeVersion) ?? null,
          runtimeRevision: stringField(resultQuote?.runtimeRevision) ?? null,
        },
        observedRpcRequests: checkRpcRequests,
      },
      p0: {
        expectationBaseline: nested(p0, "expectationBaseline") ?? null,
        quoteFidelity: nested(p0, "quoteFidelity") ?? null,
        cause: nested(p0, "cause") ?? null,
        constraints: nested(p0, "constraints") ?? null,
        evidenceState: stringField(p0?.evidenceState) ?? null,
        transactionProtection: nested(p0, "transactionProtection") ?? null,
        remediation: nested(p0, "remediation") ?? null,
      },
      execution: {
        callStatus: callStatus ?? null,
        callReturnDataFingerprint: callReturnDataFingerprint ?? null,
        gasStatus: gasStatus ?? null,
        gasUnits: gasUnits ?? null,
        validityAtExecution: validityAtExecution ?? null,
        blockNumber: basicSimulationBlockNumber ?? null,
        blockHash: executionBlockHash ?? null,
        observedAt: stringField(basicSimulation?.observedAt) ?? null,
        simulatorPinnedBlock: simulatorPinnedBlock ?? null,
        transactionBindingPresent: providedBinding !== undefined,
        preparedTransactionFingerprint:
          stringField(basicSimulation?.preparedTransactionFingerprint) ?? null,
        failureStage: stringField(basicSimulation?.failureStage) ?? null,
        reason: stringField(basicSimulation?.reason) ?? null,
        uncheckedCapabilities: Array.isArray(
          basicSimulation?.uncheckedCapabilities,
        )
          ? basicSimulation?.uncheckedCapabilities
          : [],
        executionBindingLevel,
        executionBindingCriteria,
      },
      preparedTransaction: {
        selector: preparedTransactionData?.slice(0, 10).toLowerCase() ?? null,
        inspectionOk: inspection?.ok === true,
        inspectionReason: inspection?.ok === false ? inspection.reason : null,
        intentNormalized: normalization.success === true,
        tokenIn: stringField(inspectionBinding?.tokenIn) ?? null,
        tokenOut: stringField(inspectionBinding?.tokenOut) ?? null,
        sender: stringField(inspectionBinding?.sender) ?? null,
        recipient: stringField(inspectionBinding?.recipient) ?? null,
        amountInAtomic: stringField(inspectionBinding?.amountInAtomic) ?? null,
        amountOutMinimumAtomic:
          stringField(inspectionBinding?.amountOutMinimumAtomic) ?? null,
        expectedAmountOutMinimumAtomic: expectedAmountOutMinimumAtomic ?? null,
        router: stringField(inspectionBinding?.router) ?? null,
        from: stringField(inspectionBinding?.from) ?? null,
        to: stringField(inspectionBinding?.to) ?? null,
        value: stringField(inspectionBinding?.value) ?? null,
        rawValue: preparedTransactionValue ?? null,
        dataFingerprint:
          stringField(inspectionBinding?.dataFingerprint) ?? null,
        preparedTransactionFingerprint: preparedTransactionFingerprint ?? null,
        productPreparedTransactionFingerprint:
          stringField(basicSimulation?.preparedTransactionFingerprint) ?? null,
        traceRpcTransactionFingerprint: traceRpcTransactionFingerprint ?? null,
        publicBindingMatchesInspection: bindingMatchesPublic,
        publicBinding: providedBinding ?? null,
      },
      providerEvidence: {
        providerId: nested(providerEvidence, "provider", "providerId") ?? null,
        providerStatus: nested(providerEvidence, "provider", "status") ?? null,
        integrationStatus:
          nested(providerEvidence, "provider", "integrationStatus") ?? null,
        executionStatus:
          nested(providerEvidence, "execution", "status") ?? null,
        quoteStatus:
          nested(providerEvidence, "quote", "value") === undefined
            ? "MISSING"
            : "AVAILABLE",
        quoteSource: nested(providerEvidence, "quote", "source") ?? null,
        quoteReproducibility:
          nested(providerEvidence, "quote", "reproducibility") ?? null,
        provenance: nested(providerEvidence, "provenance") ?? null,
        checkedScope: providerEvidence?.checkedScope ?? null,
        unknownScope: providerEvidence?.unknownScope ?? null,
        assetChangeAssessment: providerEvidence?.assetChangeAssessment ?? null,
      },
      accountState: {
        httpStatus: accountStateResponse.status,
        snapshotId: snapshotId ?? null,
        snapshotStatus: stringField(accountStateBody?.status) ?? null,
        block: accountStateBlock ?? null,
        inputTokenBalance: {
          status: inputBalance?.status ?? null,
          amountAtomic: stringField(inputBalance?.amountAtomic) ?? null,
          symbol: inputMetadata?.symbol ?? null,
          decimals: inputMetadata?.decimals ?? null,
          decimalsSource: inputMetadata?.decimalsSource ?? null,
          verifiedAtBlock: inputMetadata?.verifiedAtBlock ?? null,
        },
        outputTokenBalance: {
          status: nested(accountStateBody, "balances", "outputToken", "status"),
          amountAtomic:
            nested(
              accountStateBody,
              "balances",
              "outputToken",
              "amountAtomic",
            ) ?? null,
        },
        nativeBalance: {
          status: nested(accountStateBody, "balances", "native", "status"),
          amountAtomic:
            nested(accountStateBody, "balances", "native", "amountAtomic") ??
            null,
        },
        allowance: {
          status: allowance?.status ?? null,
          owner: allowance?.owner ?? null,
          tokenAddress: allowance?.tokenAddress ?? null,
          requiredAmountAtomic: allowance?.requiredAmountAtomic ?? null,
          allowanceAtomic: allowance?.allowanceAtomic ?? null,
          blockNumber: allowance?.blockNumber ?? null,
          spenderStatus: allowanceSpender?.status ?? null,
          spenderAddress: allowanceSpender?.address ?? null,
          qualificationRef: allowanceSpender?.qualificationRef ?? null,
          reason: allowance?.reason ?? null,
        },
        observedRpcRequests: accountStateRpcRequests,
        historicalRead: {
          httpStatus: snapshotReadStatus ?? null,
          matchesQueryResponse: snapshotReadMatches,
          observedRpcRequests: snapshotReadRpcRequests ?? null,
        },
      },
      rpcObservations: {
        totalObservedRequests: rpc.count,
        observedMethods: rpc.methods,
        writeMethodViolations: rpc.writeMethodViolations,
        quoteRequests: quoteRpcRequests,
        checkRequests: checkRpcRequests,
        historicalRunReadRequests: runReadRpcRequests ?? null,
        accountStateQueryRequests: accountStateRpcRequests,
        historicalAccountStateReadRequests: snapshotReadRpcRequests ?? null,
      },
      assertions,
      blockers,
      blockerClassification:
        blockers.length === 0
          ? "NONE"
          : projectionGapOnly
            ? "PRODUCT_API_PROJECTION_GAP"
            : "ACCEPTANCE_FAILURE",
      blockerDetails:
        blockers.length === 0
          ? []
          : [
              {
                code: projectionGapOnly
                  ? "QUOTE_OBSERVATION_TIME_NOT_EXPOSED"
                  : "ACCEPTANCE_ASSERTIONS_FAILED",
                detail: projectionGapOnly
                  ? "POST /api/quote returned an available, pinned, runtime-versioned quote without fetchedAt; the composition-backed quote projection omits the observation time, so no Expectation Baseline can be formed from it."
                  : `Failed assertions: ${blockers.join(", ")}`,
              },
            ],
      limitations: [
        "No transaction was signed, approved, broadcast, or executed onchain.",
        "The selected public sender is not controlled by this gate; only reads were performed.",
        "Native RPC basic simulation is intentionally partial: no receipt, outcome, or asset-change set is claimed.",
        "Provider status UNKNOWN and Evidence INCOMPLETE are recorded as observed and are never promoted.",
      ],
      provenance: {
        manifest: {
          runner: {
            path: relative(REPO_ROOT, SCRIPT_PATH),
            sha256: runnerDigest,
          },
          acceptedSourceCaptureSha256: fixtureDigest,
          sourceManifestSha256: provenanceBefore.manifestSha256,
        },
        fileCount: provenanceBefore.fileCount,
        nodeVersion: provenanceBefore.nodeVersion,
      },
      sourceIntegrity: {
        cleanlinessScope:
          "Gate source manifest only; paths outside it cannot reach this composition.",
        repositoryHeadAtStart: provenanceBefore.repositoryHead,
        repositoryTree: provenanceBefore.repositoryTree,
        originMainAtStart: provenanceBefore.originMain,
        headDescendsFromOriginMain: provenanceBefore.headDescendsFromOriginMain,
        worktreeDirty: provenanceBefore.worktreeDirty,
        unrelatedChangedPaths: provenanceBefore.unrelatedChangedPaths,
      },
    };

    const serializedCapture = `${JSON.stringify(capture, null, 2)}\n`;
    const captureSafety = {
      noEndpointLeak: !serializedCapture.includes(rpcUrl),
      noCredentialMaterial: !CREDENTIAL_PATTERN.test(serializedCapture),
      noRawPayloadKeys: !containsForbiddenKey(capture),
      noCalldataBodies: !HEX_BLOB_PATTERN.test(serializedCapture),
    };
    if (Object.values(captureSafety).some((value) => !value)) {
      throw new Error(
        `Refusing to write an unsanitized capture: ${Object.entries(
          captureSafety,
        )
          .filter(([, value]) => !value)
          .map(([key]) => key)
          .join(", ")}`,
      );
    }

    // ---- Integrity re-check before any capture is written -----------------
    const provenanceAfter = captureSourceProvenance();
    const runnerDigestAfter = fingerprint(readFileSync(SCRIPT_PATH));
    const fixtureDigestAfter = sha256Hex(
      readFileSync(join(REPO_ROOT, ACCEPTED_SOURCE_CAPTURE)),
    );
    if (
      provenanceAfter.repositoryHead !== provenanceBefore.repositoryHead ||
      provenanceAfter.manifestSha256 !== provenanceBefore.manifestSha256 ||
      provenanceAfter.manifestChangedPaths.length > 0 ||
      runnerDigestAfter !== runnerDigest ||
      fixtureDigestAfter !== fixtureDigest
    ) {
      throw new Error(
        "The gate source head or manifest changed during execution; no capture was written",
      );
    }

    const stamp = completedAt.replaceAll(":", "-");
    const outputDirectory = join(
      REPO_ROOT,
      OUTPUT_ROOT,
      `asset-coverage-reverse-${stamp}`,
    );
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, "capture.json"), serializedCapture, {
      flag: "wx",
    });

    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: capture.schemaVersion,
        gateStatus,
        blockers,
        blockerClassification: capture.blockerClassification,
        runId: runId ?? null,
        quoteAvailable: quoteStatus === "available",
        quoteFetchedAtExposed: quoteFetchedAt !== undefined,
        expectationBaseline:
          nested(p0, "expectationBaseline", "status") ?? null,
        quoteFidelity: nested(p0, "quoteFidelity") ?? null,
        evidenceState: stringField(p0?.evidenceState) ?? null,
        verdict: stringField(checkResult.verdict) ?? null,
        providerStatus: nested(providerEvidence, "provider", "status") ?? null,
        executionStatus:
          nested(providerEvidence, "execution", "status") ?? null,
        executionBindingLevel,
        callStatus: callStatus ?? null,
        gasStatus: gasStatus ?? null,
        gasUnits: gasUnits ?? null,
        blockNumber: basicSimulationBlockNumber ?? null,
        blockHash: executionBlockHash ?? null,
        amountOutMinimumAtomic: expectedAmountOutMinimumAtomic ?? null,
        allowanceStatus: allowance?.status ?? null,
        allowanceSpenderStatus: allowanceSpender?.status ?? null,
        historicalRunReadRequests: runReadRpcRequests ?? null,
        historicalAccountStateReadRequests: snapshotReadRpcRequests ?? null,
        totalObservedRpcRequests: rpc.count,
        capture: relative(REPO_ROOT, join(outputDirectory, "capture.json")),
      })}\n`,
    );
  } finally {
    observer.restore();
    await app.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown live gate failure";
    process.stderr.write(
      `Asset coverage reverse gate failed: ${redactFailureMessage(message)}\n`,
    );
    process.exitCode = 1;
  });
}

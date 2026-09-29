import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  type ArbitrumP0RiskContext,
  createArbitrumProductionComposition,
} from "../../apps/api/src/backend/arbitrum-composition.js";
import { NATIVE_RPC_ARBITRUM_PROVIDER_ID } from "../../apps/api/src/backend/native-rpc-evidence.js";
import { startBackendServer } from "../../apps/api/src/bootstrap/backend.js";
import { bootstrapBackendRuntime } from "../../apps/api/src/runtime-config.js";
import { InMemoryRunStore } from "../../apps/api/src/store.js";
import {
  basicSimulationBindingMatchesRequest,
  evaluateBackendGoldenPathAssertions,
  isBasicSimulationCallVerified,
  summarizeBasicSimulation,
} from "./backend-golden-path-assertions.js";
import {
  assertNoProductionRuntimeSourceChanges,
  assertUnchangedBackendGoldenPathSource,
  captureBackendGoldenPathProvenance,
} from "./backend-golden-path-provenance.js";

const SOURCE_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
const ACCEPTED_SOURCE_SHA256 =
  "85147b852e1e4b514af64241fede641f6a2b6db4f2056f0ab44d04164125cf23";
const OFFICIAL_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const TOKEN_OUT_DECIMALS = 18;
/**
 * An explicit re-check must change exactly one supported Intent field. Editing
 * only the recipient keeps the selected quote, the Expectation Baseline, and the
 * Economic Boundary unchanged, so the child Run re-checks the same economic
 * intent with a different prepared recipient. The exercise stays read-only:
 * nothing is signed, broadcast, or sent to this address.
 */
const RECHECK_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
const REQUIRED_LIVE_PROVIDER_SCOPES = [
  "native-rpc.eth_call",
  "native-rpc.estimateGas",
  "native-rpc.pinned-block",
] as const;
const FORBIDDEN_PUBLIC_PROVIDER_KEYS = new Set([
  "responseEvidence",
  "rawResponse",
  "rawPayload",
  "rpcUrl",
]);

type AcceptedCapture = {
  readonly classification: string;
  readonly observations: {
    readonly observedHead: string;
    readonly tokenFacts: {
      readonly USDC: {
        readonly address: string;
        readonly decimals: string;
      };
    };
    readonly quoteProbes: readonly {
      readonly direction: string;
      readonly version: string;
      readonly amountInAtomic: string;
      readonly decodedAmountOutAtomic: string | null;
      readonly error: unknown;
    }[];
    readonly preparedSwap: {
      readonly tx: { readonly from: string };
    };
  };
  readonly records: readonly {
    readonly context: string;
    readonly fetchedAt?: string;
  }[];
};

type ObjectValue = Record<string, unknown>;

function object(value: unknown, label: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as ObjectValue;
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function decimalFromAtomic(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Accepted quote amount is not an atomic integer");
  }
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function atomicFromDecimal(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))
    throw new Error("Live quote amount is not a decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error("Live quote exceeds trusted token precision");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`).toString();
}

function endpointConfiguration(): {
  readonly url: string;
  readonly endpointClass: string;
} {
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

function acceptedScenario(capture: AcceptedCapture) {
  const quote = capture.observations.quoteProbes.find(
    (item) => item.direction === "WETH_TO_USDC" && item.version === "IQuoter",
  );
  if (
    capture.classification !== "QUALIFIED_REAL" ||
    quote === undefined ||
    quote.error !== null ||
    quote.decodedAmountOutAtomic === null
  ) {
    throw new Error(
      "Accepted BE-063 capture lacks its qualified WETH/USDC quote",
    );
  }
  return {
    chainId: 421614,
    protocol: "camelot-v3",
    sender: capture.observations.preparedSwap.tx.from,
    tokenIn: { kind: "native" as const },
    tokenOut: {
      kind: "erc20" as const,
      address: capture.observations.tokenFacts.USDC.address,
    },
    amountIn: decimalFromAtomic(quote.amountInAtomic, 18),
    expectedAmountInAtomic: quote.amountInAtomic,
  };
}

function publicEvidenceSummary(value: unknown): ObjectValue | undefined {
  if (value === undefined) return undefined;
  const evidence = object(value, "Public provider-neutral Evidence");
  const provider = object(evidence.provider, "Public provider summary");
  const execution = object(evidence.execution, "Public execution summary");
  const provenance = object(evidence.provenance, "Public provenance");
  const quote = object(evidence.quote, "Public quote Evidence");
  const quoteValue =
    quote.value === null
      ? undefined
      : object(quote.value, "Public quote value");
  const providerData = object(evidence.providerData, "Public providerData");
  return {
    providerId: provider.providerId,
    providerStatus: provider.status,
    integrationStatus: provider.integrationStatus,
    executionStatus: execution.status,
    quote: {
      status: quoteValue === undefined ? "MISSING" : "AVAILABLE",
      ...(quoteValue?.estimatedAmountOut === undefined
        ? {}
        : { estimatedAmountOut: quoteValue.estimatedAmountOut }),
      source: quote.source,
      reproducibility: quote.reproducibility,
      blockNumber: quote.blockNumber,
      fetchedAt: quote.fetchedAt,
    },
    provenance: {
      mode: provenance.mode,
      source: provenance.source,
      observedChainId: provenance.observedChainId,
      simulationBlock: provenance.simulationBlock,
      fetchedAt: provenance.fetchedAt,
      runtime: provenance.runtime,
    },
    checkedScope: evidence.checkedScope,
    unknownScope: evidence.unknownScope,
    notChecked: evidence.notChecked,
    providerDataRedacted: Object.keys(providerData).length === 0,
  };
}

function p0Summary(value: unknown): ObjectValue | undefined {
  if (value === undefined) return undefined;
  const p0 = object(value, "Public P0 result");
  const baseline = object(p0.expectationBaseline, "P0 Expectation Baseline");
  const fidelity = object(p0.quoteFidelity, "P0 quote fidelity");
  const remediation = object(p0.remediation, "P0 remediation");
  const protection = object(
    p0.transactionProtection,
    "P0 transaction protection",
  );
  const basicSimulation = summarizeBasicSimulation(p0.basicSimulation);
  return {
    expectationBaseline: baseline,
    quoteFidelity: fidelity,
    cause: p0.cause,
    constraints: p0.constraints,
    evidenceState: p0.evidenceState,
    ...(basicSimulation === undefined ? {} : { basicSimulation }),
    transactionProtection: protection,
    remediation: {
      status: remediation.status,
      ...(typeof remediation.evaluations === "number"
        ? { evaluations: remediation.evaluations }
        : {}),
      ...(typeof remediation.reason === "string"
        ? { reason: remediation.reason }
        : {}),
      ...(typeof remediation.parentRunId === "string"
        ? { parentRunId: remediation.parentRunId }
        : {}),
      ...(typeof remediation.childRunId === "string"
        ? { childRunId: remediation.childRunId }
        : {}),
      ...(typeof remediation.verificationBlock === "string"
        ? { verificationBlock: remediation.verificationBlock }
        : {}),
    },
  };
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : undefined;
}

function containsProviderOwnedPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsProviderOwnedPayload);
  }
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_PUBLIC_PROVIDER_KEYS.has(key) ||
      containsProviderOwnedPayload(child),
  );
}

function getP0RiskConfiguration(): ArbitrumP0RiskContext | undefined {
  // This exercise intentionally does not claim the quantified remediation
  // lifecycle until an explicit bounded solver configuration is supplied.
  return undefined;
}

async function postJson(
  url: string,
  body: ObjectValue,
): Promise<{
  readonly status: number;
  readonly body: unknown;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  return { status: response.status, body: result };
}

async function main(): Promise<void> {
  const { url: rpcUrl, endpointClass } = endpointConfiguration();
  const fixturePath = join(REPO_ROOT, SOURCE_CAPTURE);
  const fixtureBytes = readFileSync(fixturePath);
  const fixtureDigest = hash(fixtureBytes);
  if (fixtureDigest !== ACCEPTED_SOURCE_SHA256) {
    throw new Error("The accepted BE-063 source capture digest does not match");
  }
  const capture = JSON.parse(fixtureBytes.toString("utf8")) as AcceptedCapture;
  const observedAt = new Date().toISOString();
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const originMain = execFileSync("git", ["rev-parse", "origin/main"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
      {
        cwd: REPO_ROOT,
      },
    );
  } catch {
    throw new Error(
      "Live Golden Path HEAD must descend from current origin/main",
    );
  }
  const sourceProvenance = captureBackendGoldenPathProvenance(REPO_ROOT);
  if (sourceProvenance.repositoryHead !== sourceHead) {
    throw new Error("Backend Golden Path source provenance head mismatch");
  }
  if (sourceProvenance.worktreeDirty)
    throw new Error("Live Golden Path requires a clean committed source head");
  assertNoProductionRuntimeSourceChanges(sourceProvenance);
  const scriptDigest = hash(readFileSync(SCRIPT_PATH));
  const scenario = acceptedScenario(capture);
  const tokenRegistry = {
    chains: [{ chainId: 421614, symbol: "ETH", decimals: 18 }],
    tokens: [
      {
        chainId: 421614,
        address: scenario.tokenOut.address,
        symbol: "USDC",
        decimals: Number(capture.observations.tokenFacts.USDC.decimals),
        decimalsSource: "onchain_verified" as const,
        verifiedAtBlock: BigInt(capture.observations.observedHead).toString(),
      },
    ],
  };
  const environment = {
    MONAD_RPC_URL: "https://unused.invalid",
    ARBITRUM_RPC_URL: rpcUrl,
    MOSS_RUNTIME_VERSION: "unused-for-arbitrum-gate",
    MOSS_RUNTIME_REVISION: "unused-for-arbitrum-gate",
  };
  const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
  const runStore = new InMemoryRunStore();
  const p0RiskConfiguration = getP0RiskConfiguration();
  const originalFetch = globalThis.fetch;
  let rpcRequestCount = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (requestUrl === rpcUrl) rpcRequestCount += 1;
    return originalFetch(input, init);
  }) as typeof fetch;
  const composition = createArbitrumProductionComposition({
    runtime,
    runStore,
    p0Risk: p0RiskConfiguration,
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
    const quoteRequest = {
      chainId: scenario.chainId,
      protocol: scenario.protocol,
      sender: scenario.sender,
      tokenIn: scenario.tokenIn,
      tokenOut: scenario.tokenOut,
      amountIn: scenario.amountIn,
    };
    const quoteResponse = await postJson(`${baseUrl}/api/quote`, quoteRequest);
    const quoteEnvelope = object(quoteResponse.body, "Live Quote response");
    if (quoteResponse.status !== 200 || quoteEnvelope.status !== "available")
      throw new Error("Real Camelot quote was not available");
    const quoteResult = object(quoteEnvelope.quote, "Live Camelot quote");
    const estimatedAmountOut = quoteResult.estimatedAmountOut;
    const quoteBlock = quoteResult.blockNumber;
    const quoteFetchedAt = quoteResult.fetchedAt;
    const runtimeVersion = quoteResult.runtimeVersion;
    const runtimeRevision = quoteResult.runtimeRevision;
    if (
      typeof estimatedAmountOut !== "string" ||
      typeof quoteBlock !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(quoteBlock) ||
      typeof quoteFetchedAt !== "string" ||
      typeof runtimeVersion !== "string" ||
      typeof runtimeRevision !== "string"
    )
      throw new Error("Real Camelot quote omitted required public facts");
    const liveBaseline = {
      chainId: scenario.chainId,
      protocol: scenario.protocol,
      tokenIn: scenario.tokenIn,
      tokenOut: scenario.tokenOut,
      amountIn: scenario.amountIn,
      quote: {
        estimatedAmountOut,
        source: "quote" as const,
        blockNumber: quoteBlock,
        fetchedAt: quoteFetchedAt,
        runtimeVersion,
        runtimeRevision,
      },
    };
    const expectedAmountOutAtomic = atomicFromDecimal(
      estimatedAmountOut,
      TOKEN_OUT_DECIMALS,
    );
    const request = {
      chainId: scenario.chainId,
      protocol: scenario.protocol,
      sender: scenario.sender,
      tokenIn: scenario.tokenIn,
      tokenOut: scenario.tokenOut,
      amountIn: scenario.amountIn,
      economicBoundary: { availability: "unavailable", source: "unavailable" },
      expectationBaseline: liveBaseline,
    };
    const response = await postJson(`${baseUrl}/api/check`, request);
    const result = object(response.body, "Public Check response");
    if (response.status !== 200) {
      const error =
        typeof result.error === "object" && result.error !== null
          ? object(result.error, "Public Check error").code
          : "UNKNOWN";
      throw new Error(
        `POST /api/check returned HTTP ${response.status} (${String(error)})`,
      );
    }

    const p0 = p0Summary(result.p0);
    const rawP0 =
      result.p0 === undefined
        ? undefined
        : object(result.p0, "Public P0 result");
    const basicSimulation = summarizeBasicSimulation(rawP0?.basicSimulation);
    const basicSimulationCallVerified = isBasicSimulationCallVerified(
      rawP0?.basicSimulation,
    );
    const basicSimulationMatchesRequest = basicSimulationBindingMatchesRequest(
      rawP0?.basicSimulation,
      {
        chainId: scenario.chainId,
        protocol: scenario.protocol,
        sender: scenario.sender,
        // Public normalization defaults an omitted recipient to sender.
        recipient: scenario.sender,
        tokenIn: "native",
        tokenOut: scenario.tokenOut.address,
        amountInAtomic: scenario.expectedAmountInAtomic,
      },
    );
    const providerEvidence = publicEvidenceSummary(result.providerEvidence);
    const resultId =
      typeof result.runId === "string" ? result.runId : undefined;
    if (resultId === undefined)
      throw new Error("Completed Check response omitted runId");

    const liveOutput = JSON.stringify(response.body);
    const rpcRequestsBeforeHistoricalGet = rpcRequestCount;
    // "Historical GET made zero RPC requests" is only meaningful when the
    // exercised check itself is observed making real RPC requests. Fail closed
    // rather than let a broken counter satisfy the assertion vacuously.
    if (rpcRequestsBeforeHistoricalGet < 1)
      throw new Error(
        "Live Golden Path primary check made no observed RPC request; the historical no-RPC count cannot be trusted",
      );
    const runResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(resultId)}`,
    );
    const persistedRun: unknown = await runResponse.json();
    const historicalGetRpcRequests =
      rpcRequestCount - rpcRequestsBeforeHistoricalGet;
    const stored = object(persistedRun, "GET /api/runs response");
    const storedResult =
      stored.result === undefined
        ? undefined
        : object(stored.result, "Persisted RunResult");
    const persistedOutput = JSON.stringify(persistedRun);
    const endpointRedacted =
      !liveOutput.includes(rpcUrl) && !persistedOutput.includes(rpcUrl);
    const noProviderRawPayload =
      !containsProviderOwnedPayload(response.body) &&
      !containsProviderOwnedPayload(persistedRun);
    if (
      runResponse.status !== 200 ||
      stored.runId !== resultId ||
      stored.status !== "completed" ||
      storedResult?.runId !== resultId ||
      storedResult?.status !== "completed"
    ) {
      throw new Error("GET /api/runs did not return the completed Check Run");
    }
    const recheckResponse = await postJson(`${baseUrl}/api/check`, {
      ...request,
      parentRunId: resultId,
      recipient: RECHECK_RECIPIENT,
    });
    const recheckResult = object(
      recheckResponse.body,
      "Explicit re-check response",
    );
    const childRunId =
      typeof recheckResult.runId === "string" ? recheckResult.runId : undefined;
    if (
      recheckResponse.status !== 200 ||
      childRunId === undefined ||
      childRunId === resultId
    )
      throw new Error("Explicit re-check did not create a distinct child Run");
    // The child must be an exactly-one-field Intent re-check, not a duplicate
    // submission that the API would reject as NOT_EXACTLY_ONE_CHANGE.
    const recheckDiff = recheckResult.diff;
    const recheckChangedFields =
      typeof recheckDiff === "object" &&
      recheckDiff !== null &&
      !Array.isArray(recheckDiff) &&
      Array.isArray((recheckDiff as ObjectValue).changedFields)
        ? ((recheckDiff as ObjectValue).changedFields as unknown[])
        : [];
    const recheckChangedExactlyRecipient =
      recheckChangedFields.length === 1 &&
      typeof recheckChangedFields[0] === "object" &&
      recheckChangedFields[0] !== null &&
      (recheckChangedFields[0] as ObjectValue).field === "recipient";
    if (!recheckChangedExactlyRecipient)
      throw new Error(
        "Explicit re-check did not record exactly one recipient Intent change",
      );
    const rpcRequestsBeforeChildGet = rpcRequestCount;
    const childCheckRpcRequests =
      rpcRequestsBeforeChildGet -
      rpcRequestsBeforeHistoricalGet -
      historicalGetRpcRequests;
    if (childCheckRpcRequests < 1)
      throw new Error(
        "Explicit re-check made no observed RPC request; the child historical no-RPC count cannot be trusted",
      );
    const childReadResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(childRunId)}`,
    );
    const childRead = object(
      await childReadResponse.json(),
      "Historical child Run response",
    );
    const childHistoricalGetRpcRequests =
      rpcRequestCount - rpcRequestsBeforeChildGet;
    const recheckVerified =
      recheckChangedExactlyRecipient &&
      recheckResult.status === "completed" &&
      recheckResult.parentRunId === resultId &&
      childReadResponse.status === 200 &&
      childRead.runId === childRunId &&
      childRead.parentRunId === resultId &&
      isDeepStrictEqual(childRead.result, recheckResult);

    const baseline =
      p0 === undefined
        ? undefined
        : object(p0.expectationBaseline, "P0 baseline summary");
    const fidelity =
      p0 === undefined
        ? undefined
        : object(p0.quoteFidelity, "P0 fidelity summary");
    const remediation =
      p0 === undefined
        ? undefined
        : object(p0.remediation, "P0 remediation summary");
    const baselineStatus = enumValue(baseline?.status, [
      "AVAILABLE",
      "MISSING",
    ] as const);
    const baselineReached = baselineStatus === "AVAILABLE";
    const baselineIdentityMatches =
      baselineStatus === "AVAILABLE" &&
      baseline?.chainId === scenario.chainId &&
      baseline.protocol === scenario.protocol &&
      baseline.tokenIn === "native" &&
      baseline.tokenOut === scenario.tokenOut.address.toLowerCase() &&
      baseline.amountInAtomic === scenario.expectedAmountInAtomic &&
      baseline.amountOutAtomic === expectedAmountOutAtomic &&
      baseline.blockNumber === liveBaseline.quote.blockNumber &&
      baseline.observedAt === liveBaseline.quote.fetchedAt &&
      baseline.provenance ===
        `source=quote;runtime=${runtimeVersion}@${runtimeRevision}`;
    const providerExecutionVerified =
      providerEvidence !== undefined &&
      providerEvidence.providerId === NATIVE_RPC_ARBITRUM_PROVIDER_ID &&
      providerEvidence.integrationStatus === "OK" &&
      providerEvidence.executionStatus === "SUCCESS" &&
      object(providerEvidence.provenance, "Provider provenance").mode ===
        "LIVE" &&
      object(providerEvidence.provenance, "Provider provenance").source ===
        "rpc" &&
      Array.isArray(providerEvidence.checkedScope) &&
      REQUIRED_LIVE_PROVIDER_SCOPES.every((scope) =>
        (providerEvidence.checkedScope as unknown[]).includes(scope),
      );
    const providerReachedRisk = providerExecutionVerified && p0 !== undefined;
    const selectedQuoteRemainsExpectationOnly =
      Array.isArray(p0?.constraints) && p0.constraints.length === 0;
    const persistedProviderEvidence = publicEvidenceSummary(
      storedResult?.providerEvidence,
    );
    const providerDataRedacted =
      providerEvidence?.providerDataRedacted === true &&
      persistedProviderEvidence?.providerDataRedacted === true;
    const persistedRunRoundTrip =
      isDeepStrictEqual(storedResult, result) &&
      persistedProviderEvidence !== undefined &&
      isDeepStrictEqual(persistedProviderEvidence, providerEvidence);
    const storedP0 =
      storedResult?.p0 === undefined
        ? undefined
        : object(storedResult.p0, "Persisted P0 result");
    const persistedBasicSimulation = summarizeBasicSimulation(
      storedP0?.basicSimulation,
    );
    const basicSimulationRoundTrip =
      basicSimulation !== undefined &&
      isDeepStrictEqual(persistedBasicSimulation, basicSimulation);
    const p0Verdict = result.verdict;
    const publicSurfaceSafe =
      endpointRedacted && noProviderRawPayload && providerDataRedacted;
    const executionCompleted = result.status === "completed";
    const gateAssertions = evaluateBackendGoldenPathAssertions({
      httpStatus: response.status,
      runStatus: enumValue(result.status, [
        "completed",
        "failed",
        "started",
      ] as const),
      persistedRunRoundTrip,
      historicalReadNoRpc:
        historicalGetRpcRequests === 0 && childHistoricalGetRpcRequests === 0,
      explicitRecheckVerified: recheckVerified,
      basicSimulationCallVerified,
      basicSimulationMatchesRequest,
      basicSimulationRoundTrip,
      basicSimulation: rawP0?.basicSimulation,
      simulatorPinnedBlock: result.simulatorPinnedBlock,
      baselineStatus,
      baselineIdentityMatches,
      providerEvidenceReachedP0Risk: providerReachedRisk,
      providerExecutionVerified,
      selectedQuoteRemainsExpectationOnly,
      publicSurfaceSafe,
      evidenceState: enumValue(p0?.evidenceState, [
        "VERIFIED",
        "INCOMPLETE",
        "UNAVAILABLE",
        "STALE",
        "UNVERIFIED",
      ] as const),
      quoteFidelityStatus: enumValue(fidelity?.status, [
        "VERIFIED",
        "UNKNOWN",
      ] as const),
      quoteFidelityReason: enumValue(fidelity?.reason, [
        "MISSING_BASELINE",
        "INCOMPATIBLE",
        "INVALID_AMOUNT",
        "EVIDENCE_NOT_VERIFIED",
      ] as const),
      verdict: enumValue(p0Verdict, [
        "PROCEED",
        "ADJUST",
        "STOP",
        "UNKNOWN",
      ] as const),
      causeStatus: enumValue(
        p0 === undefined
          ? undefined
          : object(p0.cause, "P0 cause summary").status,
        ["NOT_VERIFIED"] as const,
      ),
      unknownScope: Array.isArray(providerEvidence?.unknownScope)
        ? providerEvidence.unknownScope.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : [],
      remediationConfigured: p0RiskConfiguration?.remediation !== undefined,
      remediationStatus: enumValue(remediation?.status, [
        "NOT_RUN",
        "UNVERIFIED",
        "NO_VALID_CANDIDATE",
        "UNKNOWN",
        "VERIFIED",
      ] as const),
      remediationHasChildRun: typeof remediation?.childRunId === "string",
    });
    const gateStatus = gateAssertions.gateStatus;
    const sourceHeadAfter = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const originMainAfter = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const sourceFixtureDigestAfter = hash(readFileSync(fixturePath));
    const scriptDigestAfter = hash(readFileSync(SCRIPT_PATH));
    const sourceProvenanceAfter = captureBackendGoldenPathProvenance(REPO_ROOT);
    const sourceUnchangedDuringExecution =
      sourceHeadAfter === sourceHead &&
      originMainAfter === originMain &&
      sourceFixtureDigestAfter === fixtureDigest &&
      scriptDigestAfter === scriptDigest &&
      sourceProvenance.manifestSha256 === sourceProvenanceAfter.manifestSha256;
    assertUnchangedBackendGoldenPathSource(
      sourceProvenance,
      sourceProvenanceAfter,
    );
    if (!sourceUnchangedDuringExecution) {
      throw new Error("Golden Path source changed during execution");
    }
    const completedAt = new Date().toISOString();
    const record = {
      schemaVersion: "be-078-backend-golden-path-live-v2",
      exerciseStatus: "COMPLETED",
      gateStatus,
      real: true,
      readOnly: true,
      endpointClass,
      baseReference: "origin/main ancestor of committed source HEAD",
      repositoryHeadAtCapture: sourceHead,
      startedAt: observedAt,
      completedAt,
      source: {
        acceptedIssueScenario: "#77 / BE-063 canonical Camelot Sepolia quote",
        fixture: SOURCE_CAPTURE,
        fixtureSha256: fixtureDigest,
        fixtureClassification: capture.classification,
        command: "pnpm --filter @parallax/api probe:backend-golden-path",
        quotePath: "POST /api/quote",
        quoteHttpStatus: quoteResponse.status,
        quote: liveBaseline.quote,
        request,
        baseline: liveBaseline,
      },
      api: {
        checkPath: "POST /api/check",
        httpStatus: response.status,
        runId: resultId,
        persistedRunStatus: stored.status,
        parentRunId: stored.parentRunId ?? null,
        resultStatus: result.status,
        persistedResultMatchesResponse: persistedRunRoundTrip,
        primaryCheckRpcRequests: rpcRequestsBeforeHistoricalGet,
        childCheckRpcRequests,
        historicalGetRpcRequests,
        childHistoricalGetRpcRequests,
        recheck: {
          childRunId,
          parentRunId: resultId,
          verified: recheckVerified,
          status: recheckResult.status,
          verdict: recheckResult.verdict,
          changedIntentFields: recheckChangedFields.map((field) =>
            typeof field === "object" && field !== null
              ? (field as ObjectValue).field
              : undefined,
          ),
          recipient: RECHECK_RECIPIENT,
          historicalGetRpcRequests: childHistoricalGetRpcRequests,
        },
        responseResultSha256: hash(JSON.stringify(result)),
        persistedResultSha256: hash(JSON.stringify(storedResult)),
        publicResponse: {
          status: result.status,
          verdict: result.verdict,
          simulatorPinnedBlock: result.simulatorPinnedBlock,
          basicSimulation,
          providerEvidence,
        },
        actualExecution: {
          httpStatus: response.status,
          quoteStatus:
            providerEvidence === undefined
              ? "MISSING"
              : object(providerEvidence.quote, "Public quote Evidence").status,
          callStatus:
            typeof basicSimulation?.call === "object" &&
            basicSimulation.call !== null
              ? object(basicSimulation.call, "Basic simulation call").status
              : "NOT_RECORDED",
          callExecuted: basicSimulationCallVerified,
          transactionMatchesRequest: basicSimulationMatchesRequest,
          gasEstimateStatus:
            typeof basicSimulation?.gasEstimate === "object" &&
            basicSimulation.gasEstimate !== null
              ? object(
                  basicSimulation.gasEstimate,
                  "Basic simulation gas estimate",
                ).status
              : "NOT_RECORDED",
          returnDataFingerprint:
            typeof basicSimulation?.call === "object" &&
            basicSimulation.call !== null
              ? object(basicSimulation.call, "Basic simulation call")
                  .returnDataFingerprint
              : undefined,
          blockNumber: basicSimulation?.blockNumber,
          blockHash: basicSimulation?.blockHash,
          validityAtExecution: basicSimulation?.validityAtExecution,
          simulatorPinnedBlock: result.simulatorPinnedBlock,
          simulatorPinnedBlockHash: null,
          executionBinding: gateAssertions.executionBinding,
          transactionBindingPresent:
            basicSimulation?.transactionBinding !== undefined,
          preparedTransactionFingerprint:
            basicSimulation?.preparedTransactionFingerprint,
        },
        verdict: p0Verdict,
        summary: result.summary,
        simulatorPinnedBlock: result.simulatorPinnedBlock,
        p0,
        providerEvidence,
      },
      assertions: {
        liveBackendHttpPath: executionCompleted,
        acceptedSelectedQuoteReachedP0: baselineReached,
        selectedBaselineIdentityMatches: baselineIdentityMatches,
        providerEvidenceReachedP0Risk: providerReachedRisk,
        providerExecutionVerified,
        selectedQuoteRemainsExpectationOnly,
        providerSpecificDataRedacted: providerDataRedacted,
        rpcEndpointRedacted: endpointRedacted,
        rawProviderPayloadAbsent: noProviderRawPayload,
        publicRunQueryRoundTrip: persistedRunRoundTrip,
        basicSimulationCallVerified,
        basicSimulationMatchesRequest,
        basicSimulationRoundTrip,
        historicalReadNoRpc:
          historicalGetRpcRequests === 0 && childHistoricalGetRpcRequests === 0,
        explicitRecheckVerified: recheckVerified,
        executionBinding: gateAssertions.executionBinding,
        publicSurfaceSafe,
        expectedFailClosedUnknown: gateAssertions.expectedFailClosedUnknown,
        quoteFidelityStatus: fidelity?.status,
        evidenceState: p0?.evidenceState,
        verdict: p0Verdict,
        remediation: gateAssertions.remediation,
      },
      sourceIntegrity: {
        sourceHeadAtStart: sourceHead,
        sourceHeadAtEnd: sourceHeadAfter,
        originMainAtStart: originMain,
        originMainAtEnd: originMainAfter,
        fixtureUnchanged: sourceFixtureDigestAfter === fixtureDigest,
        runnerUnchanged: scriptDigestAfter === scriptDigest,
        runtimeSourceManifestSha256: sourceProvenance.manifestSha256,
        runtimeSourceManifestSha256AtEnd: sourceProvenanceAfter.manifestSha256,
        runtimeSourceFileCount: sourceProvenance.files.length,
        runtimeSourceChangedPaths: sourceProvenance.changedPaths,
        runtimeSourceChangedPathsAtEnd: sourceProvenanceAfter.changedPaths,
        runtimeSourceWorktreeDirty: sourceProvenance.worktreeDirty,
        runtimeSourceWorktreeDirtyAtEnd: sourceProvenanceAfter.worktreeDirty,
        unchangedDuringExecution: sourceUnchangedDuringExecution,
      },
      runner: {
        path: relative(REPO_ROOT, SCRIPT_PATH),
        sha256: scriptDigest,
      },
    };

    const stamp = completedAt.replaceAll(/[^0-9]/g, "").slice(0, 17);
    const parent = join(REPO_ROOT, "fixtures", "provider-registry", "be-078");
    mkdirSync(parent, { recursive: true });
    const outputDirectory = join(parent, `backend-golden-path-${stamp}`);
    mkdirSync(outputDirectory);
    writeFileSync(
      join(outputDirectory, "capture.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      {
        flag: "wx",
      },
    );

    process.stdout.write(
      `${JSON.stringify({
        exerciseStatus: "COMPLETED",
        gateStatus,
        runId: resultId,
        verdict: p0Verdict,
        p0Baseline: baseline?.status,
        quoteFidelity: fidelity?.status,
        evidenceState:
          p0 === undefined ? undefined : object(p0, "P0 summary").evidenceState,
        providerId: providerEvidence?.providerId,
        providerStatus: providerEvidence?.providerStatus,
        pinnedBlock: result.simulatorPinnedBlock,
        bindingLevel: gateAssertions.executionBinding.level,
        historicalGetRpcRequests,
        childRunId,
        capture: relative(REPO_ROOT, join(outputDirectory, "capture.json")),
      })}\n`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await server.shutdown();
    await runStore.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown live gate failure";
    const redacted = message
      .replace(/https?:\/\/[^\s"'`)>]+/gi, "[redacted-url]")
      .replace(/(api[-_]?key|token|secret)=[^&\s]+/gi, "$1=[redacted]");
    process.stderr.write(`Backend Golden Path exercise failed: ${redacted}\n`);
    process.exitCode = 1;
  });
}

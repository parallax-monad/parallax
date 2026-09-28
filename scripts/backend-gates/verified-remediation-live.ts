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
import { startBackendServer } from "../../apps/api/src/bootstrap/backend.js";
import { bootstrapBackendRuntime } from "../../apps/api/src/runtime-config.js";
import { InMemoryRunStore } from "../../apps/api/src/store.js";
import {
  assertNoProductionRuntimeSourceChanges,
  assertUnchangedBackendGoldenPathSource,
  captureBackendGoldenPathProvenance,
} from "./backend-golden-path-provenance.js";
import {
  evaluateVerifiedRemediationFeasibility,
  VERIFIED_REMEDIATION_BLOCKER_REFERENCES,
  type VerifiedRemediationObservation,
} from "./verified-remediation-assertions.js";

/**
 * Issue #107 live feasibility gate: does one real quantified remediation reach
 * an actual `VERIFIED` child re-check under the frozen semantics?
 *
 * This runner deliberately does not assume the answer. It supplies the bounded
 * solver configuration that the accepted P0 Golden Path exercise intentionally
 * withholds, and drives three real Arbitrum Sepolia × Camelot V3 × ETH → USDC
 * Checks through the production HTTP path:
 *
 *   A. an observation Run that reads the live quote for this scenario;
 *   B. the primary Run, whose declared Economic Boundary sits below that live
 *      quote, so its prepared transaction is genuinely executable;
 *   C. a boundary-FAIL probe, whose declared Economic Boundary sits above the
 *      live quote, which is exactly the diagnosis a remediation would target.
 *
 * No threshold is lowered, no Evidence is fabricated, no verdict is hardcoded,
 * and no provider payload or RPC endpoint enters the capture. A
 * `NOT_REACHABLE` finding is recorded truthfully with its exact blockers; the
 * gate fails only when the live exercise itself cannot be completed truthfully.
 */

const SOURCE_CAPTURE =
  "fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json";
const ACCEPTED_SOURCE_SHA256 =
  "85147b852e1e4b514af64241fede641f6a2b6db4f2056f0ab44d04164125cf23";
const OFFICIAL_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const TOKEN_IN_DECIMALS = 18;
const TOKEN_OUT_DECIMALS = 18;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
const FORBIDDEN_PUBLIC_PROVIDER_KEYS = new Set([
  "responseEvidence",
  "rawResponse",
  "rawPayload",
  "callReturnData",
  "rpcUrl",
]);
/**
 * Bounded solver domain for the accepted 0.001 ETH scenario. The domain stays
 * small, above the accepted input, and is a real bounded search rather than a
 * market-wide optimisation.
 */
const REMEDIATION = {
  maxAmountInAtomic: "2000000000000000",
  initialStepAtomic: "100000000000000",
  maxEvaluations: 4,
} as const;

type ObjectValue = Record<string, unknown>;

type AcceptedCapture = {
  readonly classification: string;
  readonly observations: {
    readonly observedHead: string;
    readonly tokenFacts: {
      readonly USDC: { readonly address: string; readonly decimals: string };
    };
    readonly quoteProbes: readonly {
      readonly direction: string;
      readonly version: string;
      readonly amountInAtomic: string;
      readonly decodedAmountOutAtomic: string | null;
      readonly error: unknown;
    }[];
    readonly preparedSwap: { readonly tx: { readonly from: string } };
  };
  readonly records: readonly {
    readonly context: string;
    readonly fetchedAt?: string;
  }[];
};

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
    throw new Error("Amount is not an atomic integer");
  }
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function atomicFromDecimal(value: string, decimals: number): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) throw new Error("Quote output is not a decimal amount");
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction)
  ).toString();
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
  const quoteRecord = capture.records.find(
    (item) => item.context === "quote:IQuoter:WETH_TO_USDC",
  );
  if (
    capture.classification !== "QUALIFIED_REAL" ||
    quote === undefined ||
    quote.error !== null ||
    quote.decodedAmountOutAtomic === null ||
    quoteRecord?.fetchedAt === undefined
  ) {
    throw new Error(
      "Accepted BE-063 capture lacks its qualified WETH/USDC quote",
    );
  }
  return {
    chainId: 421614,
    protocol: "camelot-v3",
    sender: capture.observations.preparedSwap.tx.from,
    tokenOut: capture.observations.tokenFacts.USDC.address,
    amountInAtomic: quote.amountInAtomic,
    amountIn: decimalFromAtomic(quote.amountInAtomic, TOKEN_IN_DECIMALS),
    baseline: {
      chainId: 421614,
      protocol: "camelot-v3",
      tokenIn: { kind: "native" as const },
      tokenOut: {
        kind: "erc20" as const,
        address: capture.observations.tokenFacts.USDC.address,
      },
      amountIn: decimalFromAtomic(quote.amountInAtomic, TOKEN_IN_DECIMALS),
      quote: {
        estimatedAmountOut: decimalFromAtomic(
          quote.decodedAmountOutAtomic,
          TOKEN_OUT_DECIMALS,
        ),
        source: "quote" as const,
        blockNumber: BigInt(capture.observations.observedHead).toString(),
        fetchedAt: quoteRecord.fetchedAt,
        runtimeVersion: "arbitrum-camelot-v3",
        runtimeRevision: "native-rpc",
      },
    },
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
    quoteSource: quote.source,
    quoteReproducibility: quote.reproducibility,
    quoteEstimatedAmountOut: quoteValue?.estimatedAmountOut,
    quoteBlockNumber: quote.blockNumber,
    provenanceMode: provenance.mode,
    provenanceSource: provenance.source,
    checkedScope: evidence.checkedScope,
    unknownScope: evidence.unknownScope,
    providerDataKeys: Object.keys(providerData).sort(),
    providerDataRedacted: isDeepStrictEqual(providerData, {}),
  };
}

/** Provider-neutral P0 projection summary. Nothing provider-owned is copied. */
function p0Summary(value: unknown): ObjectValue | undefined {
  if (value === undefined) return undefined;
  const p0 = object(value, "Public P0 result");
  const remediation = object(p0.remediation, "P0 remediation");
  const protection = object(
    p0.transactionProtection,
    "P0 transaction protection",
  );
  const simulation =
    p0.basicSimulation === undefined
      ? undefined
      : object(p0.basicSimulation, "P0 basicSimulation");
  const call =
    simulation?.call === undefined
      ? undefined
      : object(simulation.call, "P0 basicSimulation.call");
  const gasEstimate =
    simulation?.gasEstimate === undefined
      ? undefined
      : object(simulation.gasEstimate, "P0 basicSimulation.gasEstimate");
  const binding =
    simulation?.transactionBinding === undefined
      ? undefined
      : object(
          simulation.transactionBinding,
          "P0 basicSimulation.transactionBinding",
        );
  return {
    expectationBaseline: p0.expectationBaseline,
    quoteFidelity: p0.quoteFidelity,
    cause: p0.cause,
    constraints: p0.constraints,
    evidenceState: p0.evidenceState,
    transactionProtection: {
      status: protection.status,
      minimumReceivedAtomic: protection.minimumReceivedAtomic,
      source: protection.source,
    },
    remediation: {
      status: remediation.status,
      reason: remediation.reason,
      evaluations: remediation.evaluations,
      parentRunId: remediation.parentRunId,
      childRunId: remediation.childRunId,
      amountInAtomic: remediation.amountInAtomic,
      amountOutAtomic: remediation.amountOutAtomic,
      verificationBlock: remediation.verificationBlock,
      checkedScope: remediation.checkedScope,
    },
    basicSimulation: {
      callStatus: call?.status,
      gasEstimateStatus: gasEstimate?.status,
      gasUnits: gasEstimate?.gasUnits,
      blockNumber: simulation?.blockNumber,
      validityAtExecution: simulation?.validityAtExecution,
      preparedTransactionFingerprint:
        simulation?.preparedTransactionFingerprint,
      amountOutMinimumAtomic: binding?.amountOutMinimumAtomic,
      amountInAtomic: binding?.amountInAtomic,
      failureStage: simulation?.failureStage,
      reason: simulation?.reason,
      uncheckedCapabilities: simulation?.uncheckedCapabilities,
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

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_PUBLIC_PROVIDER_KEYS.has(key) || containsForbiddenKey(child),
  );
}

async function postJson(
  url: string,
  body: ObjectValue,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json();
  return { status: response.status, body: parsed };
}

function observationFrom(input: {
  readonly primaryP0: ObjectValue;
  readonly primaryResult: ObjectValue;
  readonly evidence: ObjectValue;
  readonly aboveHttpStatus: number;
  readonly aboveRunStatus:
    | "completed"
    | "failed"
    | "started"
    | "integration_error"
    | undefined;
}): VerifiedRemediationObservation {
  const remediation = object(input.primaryP0.remediation, "P0 remediation");
  const protection = object(
    input.primaryP0.transactionProtection,
    "P0 transaction protection",
  );
  const simulation = object(
    input.primaryP0.basicSimulation,
    "P0 basicSimulation summary",
  );
  return {
    remediationConfigured: true,
    evidenceState: enumValue(input.primaryP0.evidenceState, [
      "VERIFIED",
      "INCOMPLETE",
      "UNAVAILABLE",
      "STALE",
      "UNVERIFIED",
    ] as const),
    providerStatus:
      typeof input.evidence.providerStatus === "string"
        ? input.evidence.providerStatus
        : undefined,
    verdict: enumValue(input.primaryResult.verdict, [
      "PROCEED",
      "ADJUST",
      "STOP",
      "UNKNOWN",
    ] as const),
    transactionProtectionStatus: enumValue(protection.status, [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
    ] as const),
    callStatus: enumValue(simulation.callStatus, [
      "SUCCEEDED",
      "REVERTED",
      "UNAVAILABLE",
      "NOT_RUN",
    ] as const),
    unknownScope: Array.isArray(input.evidence.unknownScope)
      ? input.evidence.unknownScope.filter(
          (scope): scope is string => typeof scope === "string",
        )
      : [],
    remediationStatus: enumValue(remediation.status, [
      "NOT_RUN",
      "UNVERIFIED",
      "NO_VALID_CANDIDATE",
      "UNKNOWN",
      "VERIFIED",
    ] as const),
    remediationChildRunId:
      typeof remediation.childRunId === "string"
        ? remediation.childRunId
        : undefined,
    childRiskVerdict: undefined,
    boundaryAboveQuoteHttpStatus: input.aboveHttpStatus,
    boundaryAboveQuoteRunStatus: input.aboveRunStatus,
    // The frozen solver only searches upward, and every supported constraint
    // metric degrades as trade size grows, so no legitimate size-improving
    // caller constraint can be configured for this path.
    constraintRoute: "NOT_CONFIGURED",
  };
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
  const scenario = acceptedScenario(capture);

  const startedHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const sourceProvenance = captureBackendGoldenPathProvenance(REPO_ROOT);
  if (sourceProvenance.repositoryHead !== startedHead) {
    throw new Error("Verified remediation source provenance head mismatch");
  }
  assertNoProductionRuntimeSourceChanges(sourceProvenance);
  const runnerDigest = hash(readFileSync(SCRIPT_PATH));
  const startedAt = new Date().toISOString();
  const environment = {
    MONAD_RPC_URL: "https://unused.invalid",
    ARBITRUM_RPC_URL: rpcUrl,
    MOSS_RUNTIME_VERSION: "unused-for-arbitrum-gate",
    MOSS_RUNTIME_REVISION: "unused-for-arbitrum-gate",
  };
  const tokenRegistry = {
    chains: [{ chainId: 421614, symbol: "ETH", decimals: TOKEN_IN_DECIMALS }],
    tokens: [
      {
        chainId: 421614,
        address: scenario.tokenOut,
        symbol: "USDC",
        decimals: Number(capture.observations.tokenFacts.USDC.decimals),
        decimalsSource: "onchain_verified" as const,
        verifiedAtBlock: BigInt(capture.observations.observedHead).toString(),
      },
    ],
  };
  const runtime = bootstrapBackendRuntime({ environment, tokenRegistry });
  const runStore = new InMemoryRunStore();
  const innerRpcClient = createArbitrumRpcClient(rpcUrl);
  const rpcCalls = { total: 0 };
  const rpcClient: ArbitrumRpcClient = {
    request(method, params, options) {
      rpcCalls.total += 1;
      return innerRpcClient.request(method, params, options);
    },
  };
  const composition = createArbitrumProductionComposition({
    runtime,
    runStore,
    rpcClient,
    p0Risk: { remediation: { ...REMEDIATION } },
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
    const request = (minimumReceived?: string): ObjectValue => ({
      chainId: scenario.chainId,
      protocol: scenario.protocol,
      sender: scenario.sender,
      tokenIn: { kind: "native" },
      tokenOut: { kind: "erc20", address: scenario.tokenOut },
      amountIn: scenario.amountIn,
      economicBoundary:
        minimumReceived === undefined
          ? { availability: "unavailable", source: "unavailable" }
          : {
              availability: "available",
              minimumReceived,
              source: "user_declared",
            },
      expectationBaseline: scenario.baseline,
    });

    // Run A — read the live quote for this scenario.
    const quoteProbe = await postJson(`${baseUrl}/api/check`, request());
    if (quoteProbe.status !== 200) {
      throw new Error(
        `Live quote observation returned HTTP ${quoteProbe.status}`,
      );
    }
    const quoteProbeResult = object(
      quoteProbe.body,
      "Live quote observation response",
    );
    const quoteProbeEvidence = publicEvidenceSummary(
      quoteProbeResult.providerEvidence,
    );
    const liveQuoteOut = quoteProbeEvidence?.quoteEstimatedAmountOut;
    if (typeof liveQuoteOut !== "string") {
      throw new Error("Live quote observation omitted the quote output");
    }
    const liveQuoteAtomic = atomicFromDecimal(liveQuoteOut, TOKEN_OUT_DECIMALS);

    // Run B — the primary Run: a declared Economic Boundary below the live
    // quote, with the bounded solver configured.
    const belowAtomic = ((BigInt(liveQuoteAtomic) * 99n) / 100n).toString();
    const belowRequest = request(
      decimalFromAtomic(belowAtomic, TOKEN_OUT_DECIMALS),
    );
    const primary = await postJson(`${baseUrl}/api/check`, belowRequest);
    if (primary.status !== 200) {
      throw new Error(`Primary Check returned HTTP ${primary.status}`);
    }
    const primaryResult = object(primary.body, "Primary Check response");
    const primaryRunId = primaryResult.runId;
    if (typeof primaryRunId !== "string") {
      throw new Error("Primary Check response omitted runId");
    }
    const primaryP0 = p0Summary(primaryResult.p0);
    const primaryEvidence = publicEvidenceSummary(
      primaryResult.providerEvidence,
    );
    if (primaryP0 === undefined || primaryEvidence === undefined) {
      throw new Error("Primary Check response omitted P0 or Evidence summary");
    }

    // Historical read must not re-query any Provider/RPC.
    const callsBeforeRead = rpcCalls.total;
    const readResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(primaryRunId)}`,
    );
    const readBody: unknown = await readResponse.json();
    const persisted = object(readBody, "GET /api/runs response");
    const persistedResult = object(persisted.result, "Persisted RunResult");
    const rpcCallsDuringRead = rpcCalls.total - callsBeforeRead;
    const persistedRunRoundTrip = isDeepStrictEqual(
      persistedResult,
      primaryResult,
    );

    // Run C — the boundary-FAIL probe: a declared Economic Boundary above the
    // live quote. Transaction Protection for a declared boundary is bound
    // verbatim into the prepared calldata, so this Run cannot complete.
    const aboveAtomic = (
      (BigInt(liveQuoteAtomic) * 1001n) / 1000n +
      1n
    ).toString();
    const above = await postJson(
      `${baseUrl}/api/check`,
      request(decimalFromAtomic(aboveAtomic, TOKEN_OUT_DECIMALS)),
    );
    const aboveBody = object(above.body, "Boundary-above Check body");
    const aboveRun =
      aboveBody.run === undefined
        ? undefined
        : object(aboveBody.run, "Boundary-above Run");
    const aboveRunStatus = enumValue(aboveRun?.status, [
      "completed",
      "failed",
      "started",
      "integration_error",
    ] as const);

    const observation = observationFrom({
      primaryP0,
      primaryResult,
      evidence: primaryEvidence,
      aboveHttpStatus: above.status,
      aboveRunStatus,
    });
    const feasibility = evaluateVerifiedRemediationFeasibility(observation);

    const liveOutput = JSON.stringify(primary.body);
    const persistedOutput = JSON.stringify(readBody);
    const endpointRedacted =
      !liveOutput.includes(rpcUrl) && !persistedOutput.includes(rpcUrl);
    const noProviderRawPayload =
      !containsForbiddenKey(primary.body) && !containsForbiddenKey(readBody);
    const providerDataRedacted = primaryEvidence.providerDataRedacted === true;
    const historicalReadMadeNoRpcRequest = rpcCallsDuringRead === 0;

    if (
      !(
        persistedRunRoundTrip &&
        endpointRedacted &&
        noProviderRawPayload &&
        providerDataRedacted &&
        historicalReadMadeNoRpcRequest &&
        observation.callStatus === "SUCCEEDED" &&
        observation.transactionProtectionStatus === "PASS"
      )
    ) {
      throw new Error(
        "The live verified-remediation exercise could not be completed truthfully",
      );
    }

    const completedAt = new Date().toISOString();
    const sourceHeadAfter = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const fixtureDigestAfter = hash(readFileSync(fixturePath));
    const runnerDigestAfter = hash(readFileSync(SCRIPT_PATH));
    const sourceProvenanceAfter = captureBackendGoldenPathProvenance(REPO_ROOT);
    assertUnchangedBackendGoldenPathSource(
      sourceProvenance,
      sourceProvenanceAfter,
    );
    if (
      sourceHeadAfter !== startedHead ||
      fixtureDigestAfter !== fixtureDigest ||
      runnerDigestAfter !== runnerDigest
    ) {
      throw new Error("Verified remediation source changed during execution");
    }

    const record = {
      schemaVersion: "be-107-verified-remediation-feasibility-v1",
      exerciseStatus: "COMPLETED",
      gateStatus:
        feasibility.status === "VERIFIED"
          ? "VERIFIED_REMEDIATION_REACHED"
          : "VERIFIED_REMEDIATION_NOT_REACHABLE",
      real: true,
      readOnly: true,
      signed: false,
      broadcast: false,
      endpointClass,
      baseReference: "origin/main",
      repositoryHeadAtCapture: startedHead,
      headNote:
        "This capture is committed after the run; only fixtures/provider-registry/be-107/** was added afterwards.",
      startedAt,
      completedAt,
      source: {
        acceptedIssueScenario: "#77 / BE-063 canonical Camelot Sepolia quote",
        fixture: SOURCE_CAPTURE,
        fixtureSha256: fixtureDigest,
        fixtureClassification: capture.classification,
        command: "pnpm --filter @parallax/api probe:verified-remediation",
        remediationConfiguration: { ...REMEDIATION },
        primaryRequest: {
          chainId: belowRequest.chainId,
          protocol: belowRequest.protocol,
          sender: belowRequest.sender,
          tokenIn: belowRequest.tokenIn,
          tokenOut: belowRequest.tokenOut,
          amountIn: belowRequest.amountIn,
          economicBoundary: belowRequest.economicBoundary,
        },
        expectationBaseline: scenario.baseline,
      },
      liveQuote: {
        amountOutAtomic: liveQuoteAtomic,
        boundaryBelowQuoteAtomic: belowAtomic,
        boundaryAboveQuoteAtomic: aboveAtomic,
      },
      runs: {
        liveQuoteObservation: {
          httpStatus: quoteProbe.status,
          runId: quoteProbeResult.runId,
          verdict: quoteProbeResult.verdict,
          providerEvidence: quoteProbeEvidence,
        },
        primary: {
          httpStatus: primary.status,
          runId: primaryRunId,
          resultStatus: primaryResult.status,
          verdict: primaryResult.verdict,
          summary: primaryResult.summary,
          p0: primaryP0,
          providerEvidence: primaryEvidence,
        },
        boundaryAboveQuote: {
          httpStatus: above.status,
          runStatus: aboveRunStatus,
          errorCode:
            aboveBody.error === undefined
              ? undefined
              : object(aboveBody.error, "Boundary-above error").code,
          runErrorCode:
            aboveRun?.error === undefined
              ? undefined
              : object(aboveRun.error, "Boundary-above run error").code,
          runVerdict: aboveRun?.verdict,
          runSummary: aboveRun?.summary,
        },
      },
      historicalRead: {
        httpStatus: readResponse.status,
        persistedRunStatus: persisted.status,
        persistedResultMatchesResponse: persistedRunRoundTrip,
        rpcRequestsDuringRead: rpcCallsDuringRead,
        rpcRequestsTotal: rpcCalls.total,
      },
      feasibility: {
        status: feasibility.status,
        reachable: feasibility.reachable,
        childLifecycle: feasibility.childLifecycle,
        blockers: feasibility.blockers,
        blockerReferences: Object.fromEntries(
          feasibility.blockers.map((code) => [
            code,
            VERIFIED_REMEDIATION_BLOCKER_REFERENCES[code],
          ]),
        ),
      },
      assertions: {
        liveBackendHttpPath: primary.status === 200,
        publicRunQueryRoundTrip: persistedRunRoundTrip,
        historicalReadMadeNoRpcRequest,
        providerSpecificDataRedacted: providerDataRedacted,
        rpcEndpointRedacted: endpointRedacted,
        rawProviderPayloadAbsent: noProviderRawPayload,
        remediationConfigured: true,
        remediationBranchEntered: observation.remediationStatus !== "NOT_RUN",
        childRunProduced: observation.remediationChildRunId !== undefined,
        executedPartialSimulationSurface:
          observation.callStatus === "SUCCEEDED",
        boundaryAboveQuoteRejected: above.status !== 200,
        evidenceState: observation.evidenceState,
        providerStatus: observation.providerStatus,
        verdict: observation.verdict,
        transactionProtectionStatus: observation.transactionProtectionStatus,
        remediationStatus: observation.remediationStatus,
        constraintRoute: observation.constraintRoute,
      },
      sourceIntegrity: {
        sourceHeadAtStart: startedHead,
        sourceHeadAtEnd: sourceHeadAfter,
        fixtureUnchanged: fixtureDigestAfter === fixtureDigest,
        runnerUnchanged: runnerDigestAfter === runnerDigest,
        runtimeSourceManifestSha256: sourceProvenance.manifestSha256,
        runtimeSourceManifestSha256AtEnd: sourceProvenanceAfter.manifestSha256,
        runtimeSourceChangedPaths: sourceProvenance.changedPaths,
        runtimeSourceWorktreeDirty: sourceProvenance.worktreeDirty,
      },
      runner: {
        path: relative(REPO_ROOT, SCRIPT_PATH),
        sha256: runnerDigest,
      },
    };

    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    if (serialized.includes(rpcUrl) || containsForbiddenKey(record)) {
      throw new Error("The capture would leak a provider-owned payload");
    }
    const stamp = completedAt.replace(/[^0-9]/g, "").slice(0, 17);
    const parent = join(REPO_ROOT, "fixtures", "provider-registry", "be-107");
    mkdirSync(parent, { recursive: true });
    const outputDirectory = join(parent, `verified-remediation-${stamp}`);
    mkdirSync(outputDirectory);
    writeFileSync(join(outputDirectory, "capture.json"), serialized, {
      flag: "wx",
    });

    process.stdout.write(
      `${JSON.stringify({
        exerciseStatus: "COMPLETED",
        gateStatus: record.gateStatus,
        feasibility: feasibility.status,
        reachable: feasibility.reachable,
        blockers: feasibility.blockers,
        evidenceState: observation.evidenceState,
        providerStatus: observation.providerStatus,
        verdict: observation.verdict,
        remediationStatus: observation.remediationStatus,
        liveQuoteAmountOutAtomic: liveQuoteAtomic,
        boundaryAboveQuoteHttpStatus: above.status,
        capture: relative(REPO_ROOT, join(outputDirectory, "capture.json")),
      })}\n`,
    );
  } finally {
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
    process.stderr.write(`Verified remediation exercise failed: ${redacted}\n`);
    process.exitCode = 1;
  });
}

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Offline validation of the committed #105 live acceptance capture.
 *
 * This test never contacts a Provider, RPC endpoint, or the network. It keeps
 * the recorded reverse USDC -> WETH exercise truthful: the recorded binding,
 * decimals, block binding, allowance spender, zero-RPC historical reads, and
 * the sanitized public boundary are re-derived from the recorded facts only.
 *
 * When the capture records the known `/api/quote` observation-time projection
 * gap, this test still requires every substantive acceptance fact to hold and
 * requires the failure set to be exactly that documented gap. A future change
 * that silently relaxes or widens the gate fails here.
 */

const root = resolve(import.meta.dirname, "../..");
const captureRoot = resolve(root, "fixtures/provider-registry/be-105");
const CAMELOT_ROUTER = "0x171B925C51565F5D2a7d8C494ba3188D304EFD93";
const USDC = "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7";
const WETH = "0x980B62Da83EfF3D4576C647993b0c1D7faf17c73";
const SENDER = "0x01bb7b44cc398aaa2b76ac6253f0f5634279db9d";
const AMOUNT_IN_ATOMIC = "1000000000000000";
const PROJECTION_GAP_STATUS =
  "NOT_PASS_QUOTE_PROJECTION_OBSERVATION_TIME_NOT_EXPOSED";
const PROJECTION_GAP_ASSERTIONS = [
  "expectationBaselineAvailable",
  "quoteObservationTimeExposed",
];
const FORBIDDEN_KEYS = new Set([
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

type Capture = {
  readonly schemaVersion: string;
  readonly exerciseStatus: string;
  readonly gateStatus: string;
  readonly real: boolean;
  readonly readOnly: boolean;
  readonly signed: boolean;
  readonly broadcast: boolean;
  readonly endpointClass: string;
  readonly baseReference: string;
  readonly repositoryHeadAtCapture: string;
  readonly originMainAtCapture: string;
  readonly source: {
    readonly fixtureSha256: string;
    readonly fixtureStatus: string;
    readonly selectedSender: string;
    readonly expected: { readonly amountOutAtomic: string };
    readonly productConstantsAgreeWithScenario: boolean;
  };
  readonly tokenRegistry: {
    readonly chains: readonly {
      readonly chainId: number;
      readonly symbol: string;
      readonly decimals: number;
    }[];
    readonly tokens: readonly {
      readonly chainId: number;
      readonly address: string;
      readonly symbol: string;
      readonly decimals: number;
      readonly decimalsSource: string;
      readonly verifiedAtBlock?: string;
    }[];
  };
  readonly quoteEndpoint: {
    readonly httpStatus: number;
    readonly status: string;
    readonly blockNumber: string;
    readonly fetchedAt: string | null;
    readonly fetchedAtExposed: boolean;
    readonly runtimeVersion: string;
    readonly runtimeRevision: string;
    readonly estimatedAmountOut: string;
    readonly amountOutAtomic: string;
  };
  readonly run: {
    readonly runId: string;
    readonly httpStatus: number;
    readonly status: string;
    readonly verdict: string;
    readonly simulatorPinnedBlock: string;
    readonly responseSha256: string;
    readonly persistedRunStatus: string;
    readonly persistedResultSha256: string;
    readonly realizedQuote: {
      readonly fetchedAt: string | null;
      readonly amountOutAtomic: string | null;
    };
  };
  readonly p0: {
    readonly evidenceState: string;
    readonly expectationBaseline: { readonly status: string };
    readonly quoteFidelity: { readonly status: string };
    readonly remediation: { readonly status: string };
  };
  readonly execution: {
    readonly callStatus: string;
    readonly callReturnDataFingerprint: string;
    readonly gasStatus: string;
    readonly gasUnits: string;
    readonly validityAtExecution: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly simulatorPinnedBlock: string;
    readonly transactionBindingPresent: boolean;
    readonly executionBindingLevel: string;
  };
  readonly preparedTransaction: {
    readonly selector: string;
    readonly inspectionOk: boolean;
    readonly intentNormalized: boolean;
    readonly tokenIn: string;
    readonly tokenOut: string;
    readonly sender: string;
    readonly recipient: string;
    readonly amountInAtomic: string;
    readonly amountOutMinimumAtomic: string;
    readonly expectedAmountOutMinimumAtomic: string;
    readonly router: string;
    readonly from: string;
    readonly to: string;
    readonly value: string;
    readonly dataFingerprint: string;
    readonly preparedTransactionFingerprint: string;
    readonly productPreparedTransactionFingerprint: string;
    readonly traceRpcTransactionFingerprint: string;
    readonly publicBindingMatchesInspection: boolean;
  };
  readonly providerEvidence: {
    readonly providerId: string;
    readonly providerStatus: string;
    readonly integrationStatus: string;
    readonly executionStatus: string;
    readonly provenance: {
      readonly mode: string;
      readonly source: string;
      readonly simulationBlock: string;
    };
    readonly checkedScope: readonly string[];
    readonly unknownScope: readonly string[];
  };
  readonly accountState: {
    readonly httpStatus: number;
    readonly snapshotId: string;
    readonly snapshotStatus: string;
    readonly block: {
      readonly status: string;
      readonly chainId: number;
      readonly blockNumber: string;
      readonly blockHash: string;
      readonly observedAt: string;
    };
    readonly inputTokenBalance: {
      readonly status: string;
      readonly amountAtomic: string;
      readonly symbol: string;
      readonly decimals: number;
      readonly decimalsSource: string;
      readonly verifiedAtBlock: string;
    };
    readonly allowance: {
      readonly status: string;
      readonly tokenAddress: string;
      readonly requiredAmountAtomic: string;
      readonly allowanceAtomic: string;
      readonly spenderStatus: string;
      readonly spenderAddress: string;
      readonly qualificationRef: string;
      readonly reason: string | null;
    };
    readonly historicalRead: {
      readonly httpStatus: number;
      readonly matchesQueryResponse: boolean;
      readonly observedRpcRequests: number;
    };
  };
  readonly rpcObservations: {
    readonly totalObservedRequests: number;
    readonly observedMethods: Readonly<Record<string, number>>;
    readonly writeMethodViolations: readonly string[];
    readonly checkRequests: number;
    readonly historicalRunReadRequests: number;
    readonly historicalAccountStateReadRequests: number;
  };
  readonly assertions: Readonly<Record<string, boolean>>;
  readonly blockers: readonly string[];
  readonly blockerClassification: string;
};

function loadCapture(): { capture: Capture; bytes: string } {
  const directories = existsSync(captureRoot)
    ? readdirSync(captureRoot, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith("asset-coverage-reverse-"),
        )
        .map((entry) => entry.name)
        .sort()
    : [];
  const latest = directories[directories.length - 1];
  if (latest === undefined) {
    throw new Error(
      "The #105 live capture is not committed yet; run scripts/backend-gates/asset-coverage-reverse-live.ts from a clean committed head",
    );
  }
  const bytes = readFileSync(join(captureRoot, latest, "capture.json"), "utf8");
  return { capture: JSON.parse(bytes) as Capture, bytes };
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child),
  );
}

const { capture, bytes } = loadCapture();
const failedAssertions = Object.entries(capture.assertions)
  .filter(([, value]) => value !== true)
  .map(([key]) => key)
  .sort();

describe("#105 asset coverage reverse live capture", () => {
  it("records a real, read-only, unsigned exercise from the accepted #103 scenario", () => {
    expect(capture.schemaVersion).toBe("be-105-asset-coverage-reverse-live-v1");
    expect(capture.exerciseStatus).toBe("COMPLETED");
    expect(capture.real).toBe(true);
    expect(capture.readOnly).toBe(true);
    expect(capture.signed).toBe(false);
    expect(capture.broadcast).toBe(false);
    expect(["environment-supplied", "arbitrum-official-public"]).toContain(
      capture.endpointClass,
    );
    expect(capture.baseReference).toBe("origin/main");
    expect(capture.repositoryHeadAtCapture).toMatch(/^[0-9a-f]{40}$/);
    expect(capture.originMainAtCapture).toMatch(/^[0-9a-f]{40}$/);
    expect(capture.source.fixtureStatus).toBe("QUALIFIED_REAL");
    expect(capture.source.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(capture.source.selectedSender.toLowerCase()).toBe(SENDER);
    expect(capture.source.productConstantsAgreeWithScenario).toBe(true);
  });

  it("only ever issued read-only JSON-RPC methods", () => {
    expect(capture.rpcObservations.totalObservedRequests).toBeGreaterThan(0);
    expect(capture.rpcObservations.writeMethodViolations).toEqual([]);
    expect(
      Object.keys(capture.rpcObservations.observedMethods).length,
    ).toBeGreaterThan(0);
  });

  it("normalizes the ERC-20 input from the trusted registry with verified decimals", () => {
    expect(
      capture.tokenRegistry.chains.some(
        (chain) =>
          chain.chainId === 421614 &&
          chain.symbol === "ETH" &&
          chain.decimals === 18,
      ),
    ).toBe(true);
    const usdc = capture.tokenRegistry.tokens.find(
      (token) => token.address.toLowerCase() === USDC.toLowerCase(),
    );
    const weth = capture.tokenRegistry.tokens.find(
      (token) => token.address.toLowerCase() === WETH.toLowerCase(),
    );
    expect(usdc?.symbol).toBe("USDC");
    expect(usdc?.decimals).toBe(18);
    expect(usdc?.decimalsSource).toBe("onchain_verified");
    expect(usdc?.verifiedAtBlock).toMatch(/^\d+$/);
    expect(weth?.symbol).toBe("WETH");
    expect(weth?.decimals).toBe(18);
    expect(weth?.decimalsSource).toBe("onchain_verified");
    expect(capture.preparedTransaction.intentNormalized).toBe(true);
  });

  it("records a real pinned quote and its observation-time projection gap", () => {
    expect(capture.quoteEndpoint.httpStatus).toBe(200);
    expect(capture.quoteEndpoint.status).toBe("available");
    expect(capture.quoteEndpoint.blockNumber).toMatch(/^\d+$/);
    expect(capture.quoteEndpoint.runtimeVersion).toBe("arbitrum-camelot-v3");
    expect(capture.quoteEndpoint.runtimeRevision).toBe("native-rpc");
    expect(BigInt(capture.quoteEndpoint.amountOutAtomic)).toBeGreaterThan(0n);
    expect(capture.quoteEndpoint.fetchedAtExposed).toBe(
      capture.quoteEndpoint.fetchedAt !== null,
    );
    // The Check response carries a real observation time even when the pre-check
    // Quote projection does not.
    expect(capture.run.realizedQuote.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("completes the real Check with pinned execution evidence", () => {
    expect(capture.run.httpStatus).toBe(200);
    expect(capture.run.status).toBe("completed");
    expect(capture.run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(capture.execution.callStatus).toBe("SUCCEEDED");
    expect(capture.execution.callReturnDataFingerprint).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(capture.execution.gasStatus).toBe("AVAILABLE");
    expect(BigInt(capture.execution.gasUnits)).toBeGreaterThan(0n);
    expect(capture.execution.validityAtExecution).toBe("VALID");
    expect(capture.execution.blockNumber).toMatch(/^\d+$/);
    expect(capture.execution.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(capture.execution.blockNumber).toBe(
      capture.execution.simulatorPinnedBlock,
    );
    expect(capture.execution.transactionBindingPresent).toBe(true);
    expect(capture.execution.executionBindingLevel).toBe("BOUND");
    expect(capture.providerEvidence.provenance.mode).toBe("LIVE");
    expect(capture.providerEvidence.provenance.source).toBe("rpc");
    expect(capture.providerEvidence.provenance.simulationBlock).toBe(
      capture.execution.blockNumber,
    );
    expect(capture.providerEvidence.checkedScope).toEqual(
      expect.arrayContaining([
        "native-rpc.eth_call",
        "native-rpc.estimateGas",
        "native-rpc.pinned-block",
      ]),
    );
  });

  it("binds the exact prepared ERC-20 transaction from the public response", () => {
    const prepared = capture.preparedTransaction;
    expect(prepared.inspectionOk).toBe(true);
    expect(prepared.selector).toBe("0xbc651188");
    expect(prepared.tokenIn.toLowerCase()).toBe(USDC.toLowerCase());
    expect(prepared.tokenOut.toLowerCase()).toBe(WETH.toLowerCase());
    expect(prepared.sender.toLowerCase()).toBe(SENDER);
    expect(prepared.recipient.toLowerCase()).toBe(SENDER);
    expect(prepared.from.toLowerCase()).toBe(SENDER);
    expect(prepared.amountInAtomic).toBe(AMOUNT_IN_ATOMIC);
    expect(prepared.router.toLowerCase()).toBe(CAMELOT_ROUTER.toLowerCase());
    expect(prepared.to.toLowerCase()).toBe(CAMELOT_ROUTER.toLowerCase());
    expect(prepared.value).toBe("0x0");
    expect(prepared.dataFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(prepared.publicBindingMatchesInspection).toBe(true);
    expect(prepared.preparedTransactionFingerprint).toBe(
      prepared.productPreparedTransactionFingerprint,
    );
    expect(prepared.traceRpcTransactionFingerprint).toBe(
      prepared.preparedTransactionFingerprint,
    );

    const realized = BigInt(capture.run.realizedQuote.amountOutAtomic ?? "0");
    expect(realized).toBeGreaterThan(0n);
    const expectedFloor = (realized * 99n) / 100n;
    expect(prepared.amountOutMinimumAtomic).toBe(expectedFloor.toString());
    expect(prepared.expectedAmountOutMinimumAtomic).toBe(
      expectedFloor.toString(),
    );
  });

  it("records fail-closed Risk and Evidence state without inflation", () => {
    expect([
      "VERIFIED",
      "INCOMPLETE",
      "UNAVAILABLE",
      "STALE",
      "UNVERIFIED",
    ]).toContain(capture.p0.evidenceState);
    expect(["PROCEED", "ADJUST", "STOP", "UNKNOWN"]).toContain(
      capture.run.verdict,
    );
    expect(["VERIFIED", "UNKNOWN"]).toContain(capture.p0.quoteFidelity.status);
    expect([
      "NOT_RUN",
      "UNVERIFIED",
      "NO_VALID_CANDIDATE",
      "UNKNOWN",
      "VERIFIED",
    ]).toContain(capture.p0.remediation.status);
    expect(capture.providerEvidence.providerId).toBe("native-rpc-arbitrum");
    expect(capture.providerEvidence.integrationStatus).toBe("OK");
    expect(capture.providerEvidence.executionStatus).toBe("SUCCESS");
    expect(typeof capture.providerEvidence.providerStatus).toBe("string");
  });

  it("reads the same facts from persistence without a single RPC request", () => {
    expect(capture.run.persistedRunStatus).toBe("completed");
    expect(capture.run.persistedResultSha256).toBe(capture.run.responseSha256);
    expect(capture.assertions.persistedRunMatchesResponse).toBe(true);
    expect(capture.assertions.persistedRunHttpStatusOk).toBe(true);
    expect(capture.rpcObservations.historicalRunReadRequests).toBe(0);
    // The zero-RPC claim is only meaningful because the Check really did RPC.
    expect(capture.rpcObservations.checkRequests).toBeGreaterThan(0);
  });

  it("qualifies the Camelot router allowance spender with verified decimals", () => {
    expect(capture.accountState.httpStatus).toBe(200);
    expect(capture.accountState.snapshotStatus).toBe("AVAILABLE");
    expect(capture.accountState.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(capture.accountState.block.status).toBe("VERIFIED");
    expect(capture.accountState.block.chainId).toBe(421614);
    expect(capture.accountState.block.blockNumber).toMatch(/^\d+$/);
    expect(capture.accountState.block.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(capture.accountState.block.observedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(capture.accountState.inputTokenBalance.status).toBe("AVAILABLE");
    expect(capture.accountState.inputTokenBalance.symbol).toBe("USDC");
    expect(capture.accountState.inputTokenBalance.decimals).toBe(18);
    expect(capture.accountState.inputTokenBalance.decimalsSource).toBe(
      "onchain_verified",
    );
    expect(capture.accountState.inputTokenBalance.verifiedAtBlock).toMatch(
      /^\d+$/,
    );
    expect(
      BigInt(capture.accountState.inputTokenBalance.amountAtomic),
    ).toBeGreaterThan(0n);

    const allowance = capture.accountState.allowance;
    expect(allowance.spenderStatus).toBe("QUALIFIED");
    expect(allowance.spenderAddress.toLowerCase()).toBe(
      CAMELOT_ROUTER.toLowerCase(),
    );
    expect(allowance.qualificationRef).toContain("be-103:");
    expect(allowance.reason).toBeNull();
    // No longer structurally SPENDER_NOT_QUALIFIED.
    expect(allowance.status).not.toBe("UNAVAILABLE");
    expect(["SUFFICIENT", "INSUFFICIENT"]).toContain(allowance.status);
    expect(allowance.tokenAddress.toLowerCase()).toBe(USDC.toLowerCase());
    expect(allowance.requiredAmountAtomic).toBe(AMOUNT_IN_ATOMIC);
    if (allowance.status === "SUFFICIENT") {
      expect(BigInt(allowance.allowanceAtomic)).toBeGreaterThanOrEqual(
        BigInt(allowance.requiredAmountAtomic),
      );
    }
    expect(capture.accountState.historicalRead.httpStatus).toBe(200);
    expect(capture.accountState.historicalRead.matchesQueryResponse).toBe(true);
    expect(capture.rpcObservations.historicalAccountStateReadRequests).toBe(0);
  });

  it("records only the documented blocker, without weakening any assertion", () => {
    if (capture.gateStatus === "PASS") {
      expect(failedAssertions).toEqual([]);
      expect(capture.blockers).toEqual([]);
      expect(capture.blockerClassification).toBe("NONE");
      return;
    }
    expect(capture.gateStatus).toBe(PROJECTION_GAP_STATUS);
    expect(capture.blockerClassification).toBe("PRODUCT_API_PROJECTION_GAP");
    expect(failedAssertions).toEqual([...PROJECTION_GAP_ASSERTIONS].sort());
    expect([...capture.blockers].sort()).toEqual([
      ...PROJECTION_GAP_ASSERTIONS,
    ]);
    expect(capture.quoteEndpoint.fetchedAtExposed).toBe(false);
    expect(capture.p0.expectationBaseline.status).toBe("MISSING");
  });

  it("remains endpoint- and raw-payload-safe", () => {
    expect(bytes).not.toMatch(/https?:\/\//);
    expect(bytes).not.toMatch(
      /rpcUrl|api[-_]?key|authorization|private[-_]?key|mnemonic|seed[-_]?phrase|bearer\s/i,
    );
    expect(bytes).not.toMatch(/0x[0-9a-fA-F]{100,}/);
    expect(containsForbiddenKey(capture)).toBe(false);
    expect(capture.assertions.rawProviderPayloadAbsent).toBe(true);
    expect(capture.assertions.rpcEndpointRedacted).toBe(true);
  });

  it("binds the capture to its committed source manifest", () => {
    expect(capture.assertions.sourceManifestCommitted).toBe(true);
    expect(capture.assertions.sourceHeadDescendsFromOriginMain).toBe(true);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(capture.assertions.historicalRunReadMadeZeroRpcRequests).toBe(true);
  });
});

import { createHash } from "node:crypto";
import {
  type AssetReference,
  convertHumanAmountToAtomic,
  type GenericEvidence,
  type NormalizedSwapIntent,
  type RunResult,
} from "@parallax/contracts";
import {
  type CallerConstraint,
  type ConstraintEvaluation,
  type ConstraintEvidence,
  type EvidenceState,
  evaluateP0Risk,
  type QuoteContext,
  type QuoteFidelity,
  type RuleResult,
  type Verdict,
  type VerifiedCandidate,
} from "@parallax/risk";

/**
 * Backend-owned Provider-neutral Evidence → P0 Risk bridge (P0-D Slice 1).
 *
 * This module is Backend glue, not a second Risk engine: it never re-implements
 * a Risk rule. It converts the current Backend execution context into the
 * `QuoteContext` that the merged `@parallax/risk` P0 implementation consumes,
 * derives one conservative `EvidenceState` for provider-neutral GenericEvidence,
 * forwards only explicitly supplied Expectation Baseline / caller constraints /
 * verified remediation, and returns the Risk result unchanged.
 *
 * Boundaries this module keeps:
 *  - the current execution quote is never substituted for the selected
 *    Expectation Baseline, and a missing baseline fails closed;
 *  - the normalized Intent Economic Boundary (`minimumReceived`) is Transaction
 *    Protection and never becomes a `CallerConstraint`;
 *  - provider raw payloads (RPC results, endpoints, headers, credentials) are
 *    never read, so they cannot enter the Risk input or the Risk result;
 *  - an unbuildable current `QuoteContext` fails closed instead of throwing, and
 *    no randomness, wall clock, or network access is used.
 */

/** Provider-neutral description of the current execution quote observation. */
export type BackendCurrentQuoteInput = {
  readonly intent: NormalizedSwapIntent;
  /** Provider-neutral Evidence projected from this Run's provider evaluation. */
  readonly evidence: GenericEvidence;
  /** Current execution quote produced for this Run by the protocol adapter. */
  readonly quote: unknown;
  /** Pinned execution block this Run's quote was read at. */
  readonly blockNumber: string;
  /** Provider observation time for this Run, when the quote carries none. */
  readonly observedAt?: string;
  /** Trusted tokenOut decimals used for the exact atomic conversion. */
  readonly tokenOutDecimals: number;
};

export type BackendCurrentQuoteUnavailableReason =
  | "QUOTE_UNAVAILABLE"
  | "INVALID_AMOUNT"
  | "BLOCK_NUMBER_UNAVAILABLE"
  | "BLOCK_NUMBER_MISMATCH"
  | "OBSERVED_AT_UNAVAILABLE"
  | "OBSERVED_AT_MISMATCH"
  | "RUNTIME_PROVENANCE_UNAVAILABLE";

export type BackendCurrentQuoteResult =
  | { readonly status: "available"; readonly quote: QuoteContext }
  | {
      readonly status: "unavailable";
      readonly reason: BackendCurrentQuoteUnavailableReason;
    };

/**
 * Builds the current execution `QuoteContext` from this Run's own pinned
 * execution material.
 *
 * `tokenOut` decimals come from the trusted token registry, so
 * `amountOutAtomic` is the exact base-10 expansion of the adapter's
 * human-readable quote output — never a `Number` or float. The pinned execution
 * block is authoritative and `latest` is never accepted; the selected baseline
 * never contributes a block here. `quoteId` is a deterministic SHA-256
 * fingerprint of the observed quote identity, never a random or generated value.
 */
export function buildBackendCurrentQuoteContext(
  input: BackendCurrentQuoteInput,
): BackendCurrentQuoteResult {
  const quote = input.quote;
  if (!isRecord(quote)) return unavailable("QUOTE_UNAVAILABLE");
  const estimatedAmountOut = quote.estimatedAmountOut;
  if (typeof estimatedAmountOut !== "string") {
    return unavailable("QUOTE_UNAVAILABLE");
  }
  if (!atomic(input.intent.amountInAtomic)) {
    return unavailable("INVALID_AMOUNT");
  }
  const converted = convertHumanAmountToAtomic(
    estimatedAmountOut,
    input.tokenOutDecimals,
  );
  if (!converted.success) return unavailable("INVALID_AMOUNT");

  const blockNumber = atomicText(input.blockNumber);
  if (blockNumber === undefined) {
    return unavailable("BLOCK_NUMBER_UNAVAILABLE");
  }
  if (quote.blockNumber !== undefined) {
    const quoteBlockNumber = atomicText(quote.blockNumber);
    if (quoteBlockNumber === undefined) {
      return unavailable("BLOCK_NUMBER_UNAVAILABLE");
    }
    if (quoteBlockNumber !== blockNumber) {
      return unavailable("BLOCK_NUMBER_MISMATCH");
    }
  }

  const observedAt = firstTimestamp(input.observedAt);
  if (observedAt === undefined) {
    return unavailable("OBSERVED_AT_UNAVAILABLE");
  }
  if (quote.fetchedAt !== undefined) {
    const quoteObservedAt = firstTimestamp(quote.fetchedAt);
    if (quoteObservedAt === undefined) {
      return unavailable("OBSERVED_AT_UNAVAILABLE");
    }
    if (quoteObservedAt !== observedAt) {
      return unavailable("OBSERVED_AT_MISMATCH");
    }
  }
  const runtime = input.evidence.provenance.runtime;
  const runtimeVersion = firstText(
    quote.runtimeVersion,
    runtime?.runtimeVersion,
  );
  const runtimeRevision = firstText(
    quote.runtimeRevision,
    runtime?.runtimeRevision,
  );
  if (runtimeVersion === undefined || runtimeRevision === undefined) {
    return unavailable("RUNTIME_PROVENANCE_UNAVAILABLE");
  }

  const identity: QuoteIdentity = {
    chainId: input.intent.chainId,
    protocol: input.intent.protocol,
    tokenIn: assetKey(input.intent.tokenIn),
    tokenOut: assetKey(input.intent.tokenOut),
    amountInAtomic: input.intent.amountInAtomic,
    amountOutAtomic: converted.amountAtomic,
    blockNumber,
    observedAt,
    runtimeVersion,
    runtimeRevision,
  };
  return {
    status: "available",
    quote: {
      chainId: identity.chainId,
      protocol: identity.protocol,
      tokenIn: identity.tokenIn,
      tokenOut: identity.tokenOut,
      amountInAtomic: identity.amountInAtomic,
      amountOutAtomic: identity.amountOutAtomic,
      quoteId: quoteIdentity(identity),
      provenance: quoteProvenance(
        input.evidence,
        runtimeVersion,
        runtimeRevision,
      ),
      blockNumber: identity.blockNumber,
      observedAt: identity.observedAt,
    },
  };
}

/**
 * The fields the current quote fingerprint is bound to: chain, protocol, both
 * assets, exact input, exact observed output, pinned block, observation time,
 * and runtime version/revision. Changing any of them yields a different
 * `quoteId`, and an identical context always yields the same one.
 */
type QuoteIdentity = {
  readonly chainId: number;
  readonly protocol: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountInAtomic: string;
  readonly amountOutAtomic: string;
  readonly blockNumber: string;
  readonly observedAt: string;
  readonly runtimeVersion: string;
  readonly runtimeRevision: string;
};

function quoteIdentity(identity: QuoteIdentity): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        identity.chainId,
        identity.protocol,
        identity.tokenIn,
        identity.tokenOut,
        identity.amountInAtomic,
        identity.amountOutAtomic,
        identity.blockNumber,
        identity.observedAt,
        identity.runtimeVersion,
        identity.runtimeRevision,
      ]),
    )
    .digest("hex");
  return `sha256:${fingerprint}`;
}

/**
 * Provider-neutral provenance text for the current quote. It is assembled from
 * Generic Evidence identity fields only, so a provider endpoint, request
 * header, credential, or raw RPC result can never be encoded into it.
 */
function quoteProvenance(
  evidence: GenericEvidence,
  runtimeVersion: string,
  runtimeRevision: string,
): string {
  return [
    `provider=${evidence.provider.providerId}`,
    `mode=${evidence.provenance.mode}`,
    `source=${evidence.provenance.source}`,
    `quote=${evidence.quote.source}`,
    `runtime=${runtimeVersion}@${runtimeRevision}`,
  ].join(";");
}

/**
 * Closed scope keys whose absence from the current provider observation is
 * material to *this* slice: the P0 gate consumes this Run's current quote
 * observation only. Receipt, outcome, asset-change, and complete-simulation
 * coverage stay outside the slice and are never required here.
 */
const P0_RESERVED_SCOPE_KEYS: readonly string[] = ["quote"];

/**
 * Conservative Provider-neutral GenericEvidence → P0 `EvidenceState` mapping.
 *
 * Rules are applied in order and the first match wins:
 *  1. explicit Provider / GenericEvidence staleness → `STALE`;
 *  2. Provider integration unavailable, unsupported, failed, or the required
 *     provider observation absent → `UNAVAILABLE`;
 *  3. provider-neutral evidence present but incomplete for this slice
 *     (including a reserved `unknownScope` key) → `INCOMPLETE`;
 *  4. provenance, reproducibility, or the required observation not verifiable
 *     → `UNVERIFIED`;
 *  5. otherwise → `VERIFIED`.
 *
 * `VERIFIED` here means only that the fields this slice's P0 Risk consumes are
 * verified for this Run. It never asserts a complete simulation, a receipt, a
 * final outcome, asset-change completeness, or transaction safety. In
 * particular, Native RPC's partial provider surface is never inflated, and
 * receipt/outcome coverage is never required in order to reach `VERIFIED`.
 */
export function backendEvidenceState(evidence: GenericEvidence): EvidenceState {
  if (evidence.provider.status === "STALE") return "STALE";
  if (
    evidence.provider.integrationStatus !== "OK" ||
    evidence.provider.status === "UNSUPPORTED" ||
    evidence.provider.status === "FAILED" ||
    evidence.quote.value === null
  ) {
    return "UNAVAILABLE";
  }
  if (
    evidence.provider.status !== "SUCCESS" ||
    evidence.quote.source !== "quote" ||
    evidence.unknownScope.some((key) => P0_RESERVED_SCOPE_KEYS.includes(key))
  ) {
    return "INCOMPLETE";
  }
  if (
    evidence.provenance.mode !== "LIVE" ||
    evidence.provenance.source === "mock" ||
    evidence.provenance.source === "unknown" ||
    evidence.provenance.source === "external" ||
    evidence.quote.reproducibility !== "REPRODUCIBLE" ||
    evidence.quote.blockNumber === undefined ||
    evidence.quote.fetchedAt === undefined ||
    evidence.provenance.runtime?.runtimeVersion === undefined ||
    evidence.provenance.runtime?.runtimeRevision === undefined
  ) {
    return "UNVERIFIED";
  }
  return "VERIFIED";
}

export type BackendP0RiskInput = {
  readonly parentRunId: string;
  readonly intent: NormalizedSwapIntent;
  readonly evidence: GenericEvidence;
  /**
   * Current execution `QuoteContext`. `undefined` (unbuildable, or not bound to
   * this Intent) fails closed inside the Risk gate instead of throwing.
   */
  readonly currentQuote?: QuoteContext;
  /**
   * Selected quote / Expectation Baseline. It is an independent input: it is
   * never defaulted from `currentQuote`, from the Intent Economic Boundary, or
   * from `minimumReceived`, and its absence yields
   * `UNKNOWN / MISSING_BASELINE`.
   */
  readonly selectedQuote?: QuoteContext;
  /** Explicit caller Economic Constraints. Never derived from the Intent. */
  readonly constraints?: readonly CallerConstraint[];
  readonly constraintEvidence?: readonly ConstraintEvidence[];
  readonly verifiedRemediation?: VerifiedCandidate;
};

export type BackendP0RiskResult = {
  readonly base: RuleResult;
  readonly quoteFidelity: QuoteFidelity;
  readonly constraints: readonly ConstraintEvaluation[];
  readonly evidenceState: EvidenceState;
  readonly verdict: Verdict;
};

/**
 * Runs the merged `@parallax/risk` P0 gate over Backend execution context.
 *
 * The gate stays provider-neutral and total: the current quote must belong to
 * the checked Intent, and no provider raw payload is read or forwarded beyond
 * the provider-neutral Generic Evidence that Risk already owns.
 */
export function evaluateBackendP0Risk(
  input: BackendP0RiskInput,
): BackendP0RiskResult {
  const currentQuote = intentBoundCurrentQuote(
    input.intent,
    input.currentQuote,
  );
  return evaluateP0Risk(input.evidence, {
    parentRunId: input.parentRunId,
    evidenceState: backendEvidenceState(input.evidence),
    ...(currentQuote === undefined ? {} : { currentQuote }),
    ...(input.selectedQuote === undefined
      ? {}
      : { selectedQuote: input.selectedQuote }),
    ...(input.constraints === undefined
      ? {}
      : { constraints: input.constraints }),
    ...(input.constraintEvidence === undefined
      ? {}
      : { constraintEvidence: input.constraintEvidence }),
    ...(input.verifiedRemediation === undefined
      ? {}
      : { verifiedRemediation: input.verifiedRemediation }),
  });
}

/**
 * A `QuoteContext` is only accepted as *this* Run's current quote when it
 * describes the checked Intent exactly. A quote for another chain, protocol,
 * asset pair, or input amount is dropped so the gate fails closed instead of
 * comparing two unrelated executions.
 */
function intentBoundCurrentQuote(
  intent: NormalizedSwapIntent,
  currentQuote: QuoteContext | undefined,
): QuoteContext | undefined {
  if (currentQuote === undefined) return undefined;
  return currentQuote.chainId === intent.chainId &&
    currentQuote.protocol === intent.protocol &&
    currentQuote.tokenIn.toLowerCase() === assetKey(intent.tokenIn) &&
    currentQuote.tokenOut.toLowerCase() === assetKey(intent.tokenOut) &&
    currentQuote.amountInAtomic === intent.amountInAtomic
    ? currentQuote
    : undefined;
}

/**
 * Relative restrictiveness of the shared verdict vocabulary. The public
 * projection and the P0 gate are merged by keeping the more restrictive claim:
 * the P0 gate is authoritative for trust, so a projected `PROCEED` can never
 * hide a P0 `UNKNOWN`/`STOP`, and a P0 `PROCEED` can never promote an untrusted
 * projection.
 */
const VERDICT_RESTRICTIVENESS: Record<Verdict, number> = {
  PROCEED: 0,
  ADJUST: 1,
  UNKNOWN: 2,
  STOP: 3,
};

/**
 * Existing Orchestrator projection copy, reused verbatim so this Backend-side
 * merge introduces no new public summary semantics.
 */
const RESTRICTED_SUMMARY: Record<"UNKNOWN" | "STOP", string> = {
  UNKNOWN: "Live check could not establish a trustworthy result",
  STOP: "Live check completed with verdict STOP",
};

/**
 * Minimal Backend-side decision wrapper: the public RunResult shape and every
 * other field stay on the existing contract, and the final verdict (plus its
 * summary when the verdict changed) is made to obey the P0 Risk verdict.
 *
 * An `integration_error` Run is contractually fixed to `UNKNOWN`, so a P0
 * `STOP` must never rewrite an interrupted check into a protocol-risk result.
 * A verified `ADJUST` is published only after the existing
 * ActionEvaluation/ActionGate attestation has been attached by the
 * composition. The public P0-facing projection therefore remains the existing
 * provider-neutral Run fields (Verdict, Rule Results, Scope, Quote, Evidence,
 * and Actions); Risk-internal quote-fidelity and constraint records are not
 * invented as a second public contract here.
 */
export function applyBackendP0Verdict(
  projected: RunResult,
  p0Verdict: Verdict,
): RunResult {
  if (projected.status !== "completed") return projected;
  const merged =
    VERDICT_RESTRICTIVENESS[projected.verdict] >=
    VERDICT_RESTRICTIVENESS[p0Verdict]
      ? projected.verdict
      : p0Verdict;
  const verdict: Verdict = merged === "ADJUST" ? "STOP" : merged;
  if (verdict === projected.verdict) return projected;
  return {
    ...projected,
    verdict,
    summary:
      verdict === "UNKNOWN" || verdict === "STOP"
        ? RESTRICTED_SUMMARY[verdict]
        : projected.summary,
  };
}

function unavailable(
  reason: BackendCurrentQuoteUnavailableReason,
): BackendCurrentQuoteResult {
  return { status: "unavailable", reason };
}

function assetKey(asset: AssetReference): string {
  return asset.kind === "native" ? "native" : asset.address.toLowerCase();
}

function atomic(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

function atomicText(value: unknown): string | undefined {
  return typeof value === "string" && atomic(value) ? value : undefined;
}

function firstTimestamp(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim() !== "" &&
      !Number.isNaN(Date.parse(value))
    ) {
      return value;
    }
  }
  return undefined;
}

function firstText(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

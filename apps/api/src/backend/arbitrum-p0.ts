import {
  convertHumanAmountToAtomic,
  type GenericEvidence,
  type NormalizedSwapIntent,
  type P0EvidenceState,
  type P0Remediation,
  type P0Result,
  p0ResultSchema,
} from "@parallax/contracts";
import {
  causeRequirements,
  evaluateCause,
  evaluateP0Risk,
  type QuoteContext,
} from "@parallax/risk";

const CAUSES = Object.keys(causeRequirements) as Array<
  keyof typeof causeRequirements
>;

export type ArbitrumP0ProjectionInput = {
  readonly runId: string;
  readonly intent: NormalizedSwapIntent;
  readonly evidence: GenericEvidence;
  readonly tokenOutDecimals: number;
  readonly remediation?: P0Remediation;
};

/**
 * Projects the merged Provider/Risk seams into the public P0 result.
 *
 * This module intentionally has no protocol or Provider imports. It consumes
 * only provider-neutral GenericEvidence and the normalized Intent, so raw RPC
 * payloads cannot become a Risk or public API dependency.
 */
export function projectArbitrumP0Result(
  input: ArbitrumP0ProjectionInput,
): P0Result | undefined {
  const quote = quoteContext(input);
  if (quote === undefined) return undefined;
  const evidenceState = evidenceStateFor(input.evidence);
  const risk = evaluateP0Risk(input.evidence, {
    parentRunId: input.runId,
    selectedQuote: quote,
    currentQuote: quote,
    evidenceState,
    constraints: [],
    constraintEvidence: [],
  });

  const snapshot = toSnapshot(quote);
  const fallbackRemediation: P0Remediation =
    input.remediation ??
    (evidenceState === "VERIFIED"
      ? { status: "NOT_APPLICABLE", reason: "NO_BLOCKING_CONDITION" }
      : { status: "UNKNOWN", reason: "EVIDENCE_NOT_VERIFIED" });

  return p0ResultSchema.parse({
    expectationBaseline: snapshot,
    currentQuote: snapshot,
    quoteFidelity: risk.quoteFidelity,
    evidenceState,
    causes: CAUSES.map((cause) => ({
      ...evaluateCause(cause, []),
    })),
    constraints: risk.constraints,
    transactionProtection: transactionProtectionFor(input),
    provider: {
      providerId: input.evidence.provider.providerId,
      status: input.evidence.provider.status,
      source: input.evidence.provenance.source,
      mode: input.evidence.provenance.mode,
      checkedScope: input.evidence.checkedScope,
      unknownScope: input.evidence.unknownScope,
      provenance: {
        ...(input.evidence.provenance.runtime?.runtimeVersion === undefined
          ? {}
          : {
              runtimeVersion: input.evidence.provenance.runtime.runtimeVersion,
            }),
        ...(input.evidence.provenance.runtime?.runtimeRevision === undefined
          ? {}
          : {
              runtimeRevision:
                input.evidence.provenance.runtime.runtimeRevision,
            }),
        ...(input.evidence.provenance.simulationBlock === undefined
          ? {}
          : { blockNumber: input.evidence.provenance.simulationBlock }),
        ...(input.evidence.provenance.fetchedAt === undefined
          ? {}
          : { fetchedAt: input.evidence.provenance.fetchedAt }),
      },
    },
    verdict: risk.verdict,
    remediation: fallbackRemediation,
  });
}

function quoteContext(
  input: ArbitrumP0ProjectionInput,
): QuoteContext | undefined {
  const value = input.evidence.quote.value;
  const blockNumber = input.evidence.quote.blockNumber;
  const observedAt =
    input.evidence.quote.fetchedAt ?? input.evidence.provenance.fetchedAt;
  if (
    value === null ||
    blockNumber === undefined ||
    observedAt === undefined ||
    !Number.isFinite(Date.parse(observedAt))
  ) {
    return undefined;
  }

  const amountOut = convertHumanAmountToAtomic(
    value.estimatedAmountOut,
    input.tokenOutDecimals,
  );
  if (!amountOut.success) return undefined;

  return {
    chainId: input.intent.chainId,
    protocol: input.intent.protocol,
    tokenIn: assetKey(input.intent.tokenIn),
    tokenOut: assetKey(input.intent.tokenOut),
    amountInAtomic: input.intent.amountInAtomic,
    amountOutAtomic: amountOut.amountAtomic,
    quoteId: quoteId(input.runId, blockNumber, input.intent.amountInAtomic),
    provenance: [
      input.evidence.provenance.source,
      input.evidence.provenance.runtime?.runtimeVersion,
      input.evidence.provenance.runtime?.runtimeRevision,
    ]
      .filter((item): item is string => item !== undefined)
      .join(":"),
    blockNumber,
    observedAt,
  };
}

function toSnapshot(value: QuoteContext) {
  return {
    chainId: value.chainId,
    protocol: value.protocol,
    tokenIn: value.tokenIn,
    tokenOut: value.tokenOut,
    amountInAtomic: value.amountInAtomic,
    amountOutAtomic: value.amountOutAtomic,
    quoteId: value.quoteId,
    blockNumber: value.blockNumber,
    observedAt: value.observedAt,
    provenance: value.provenance,
  };
}

function evidenceStateFor(evidence: GenericEvidence): P0EvidenceState {
  if (evidence.provenance.mode === "MOCK") return "UNVERIFIED";
  if (evidence.provenance.mode === "RECORDED_REPLAY") return "UNVERIFIED";
  switch (evidence.provider.status) {
    case "STALE":
      return "STALE";
    case "FAILED":
    case "UNSUPPORTED":
      return "UNAVAILABLE";
    case "UNKNOWN":
      return "INCOMPLETE";
    case "SUCCESS":
      return evidence.unknownScope.length === 0 ? "VERIFIED" : "INCOMPLETE";
  }
}

function transactionProtectionFor(input: ArbitrumP0ProjectionInput) {
  if (input.intent.economicBoundary.availability === "unavailable") {
    return { status: "NOT_CHECKED" as const };
  }

  return {
    status: "UNKNOWN" as const,
    minimumReceivedAtomic: input.intent.economicBoundary.minimumReceivedAtomic,
  };
}

function assetKey(asset: NormalizedSwapIntent["tokenIn"]): string {
  return asset.kind === "native" ? "native" : asset.address;
}

function quoteId(runId: string, blockNumber: string, amountInAtomic: string) {
  return `${runId}:quote:${blockNumber}:${amountInAtomic}`;
}

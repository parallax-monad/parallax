import type { GenericEvidence } from "@parallax/contracts";
import type { VerifiedCandidate } from "./p0-solver.js";
import type { RuleResult, Verdict } from "./types.js";
import { evaluateEvidence } from "./verdict.js";

export type EvidenceState =
  | "VERIFIED"
  | "INCOMPLETE"
  | "UNAVAILABLE"
  | "STALE"
  | "UNVERIFIED";

export type QuoteContext = {
  chainId: number;
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountInAtomic: string;
  amountOutAtomic: string;
  quoteId: string;
  provenance: string;
  blockNumber: string;
  observedAt: string;
};

export type QuoteFidelity =
  | {
      status: "UNKNOWN";
      reason:
        | "MISSING_BASELINE"
        | "INCOMPATIBLE"
        | "INVALID_AMOUNT"
        | "EVIDENCE_NOT_VERIFIED";
    }
  | {
      status: "VERIFIED";
      selectedAmountOutAtomic: string;
      currentAmountOutAtomic: string;
      absoluteDeltaAtomic: string;
      /** Exact fraction; null when the selected output is zero. */
      relativeDelta: { numerator: string; denominator: string } | null;
      observations: Array<"QUOTE_OUTPUT_DEGRADED">;
      selectedQuoteId: string;
      currentQuoteId: string;
    };

export function compareQuoteFidelity(
  selected: QuoteContext | undefined,
  current: QuoteContext | undefined,
  evidenceState: EvidenceState,
): QuoteFidelity {
  if (!selected) return { status: "UNKNOWN", reason: "MISSING_BASELINE" };
  if (evidenceState !== "VERIFIED" || !current) {
    return { status: "UNKNOWN", reason: "EVIDENCE_NOT_VERIFIED" };
  }
  if (![selected, current].every(validContext)) {
    return { status: "UNKNOWN", reason: "INVALID_AMOUNT" };
  }
  if (
    selected.chainId !== current.chainId ||
    selected.protocol !== current.protocol ||
    selected.tokenIn.toLowerCase() !== current.tokenIn.toLowerCase() ||
    selected.tokenOut.toLowerCase() !== current.tokenOut.toLowerCase() ||
    selected.amountInAtomic !== current.amountInAtomic ||
    BigInt(current.blockNumber) < BigInt(selected.blockNumber) ||
    Date.parse(current.observedAt) < Date.parse(selected.observedAt)
  ) {
    return { status: "UNKNOWN", reason: "INCOMPATIBLE" };
  }
  const selectedAmount = BigInt(selected.amountOutAtomic);
  const currentAmount = BigInt(current.amountOutAtomic);
  const delta = currentAmount - selectedAmount;
  return {
    status: "VERIFIED",
    selectedAmountOutAtomic: selected.amountOutAtomic,
    currentAmountOutAtomic: current.amountOutAtomic,
    absoluteDeltaAtomic: delta.toString(),
    relativeDelta:
      selectedAmount === 0n
        ? null
        : {
            numerator: delta.toString(),
            denominator: selectedAmount.toString(),
          },
    observations: delta < 0n ? ["QUOTE_OUTPUT_DEGRADED"] : [],
    selectedQuoteId: selected.quoteId,
    currentQuoteId: current.quoteId,
  };
}

function atomic(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

function validContext(value: QuoteContext): boolean {
  return (
    Number.isSafeInteger(value.chainId) &&
    value.chainId > 0 &&
    [
      value.protocol,
      value.tokenIn,
      value.tokenOut,
      value.quoteId,
      value.provenance,
      value.blockNumber,
      value.observedAt,
    ].every((part) => part.trim().length > 0) &&
    atomic(value.blockNumber) &&
    atomic(value.amountInAtomic) &&
    atomic(value.amountOutAtomic) &&
    !Number.isNaN(Date.parse(value.observedAt))
  );
}

export type ConstraintName =
  | "maxPriceImpact"
  | "minEffectiveRate"
  | "maxTotalCost"
  | "maxGas";

export type CallerConstraint = {
  name: ConstraintName;
  /** Caller provenance is mandatory; transaction protection never enters here. */
  source: "caller";
  declarationId: string;
  numerator: string;
  denominator: string;
  unit: "bps" | "output_per_input" | "cost_atomic" | "gas_units";
  /** Required for total cost so unlike assets cannot be compared. */
  costAsset?: string;
};

export type ConstraintEvidence = {
  name: ConstraintName;
  state: EvidenceState;
  numerator: string;
  denominator: string;
  unit: CallerConstraint["unit"];
  evidenceKey: string;
  costAsset?: string;
};

export type ConstraintEvaluation = {
  name: ConstraintName;
  status: "PASS" | "FAIL" | "UNKNOWN";
  declarationId: string;
  evidenceKey?: string;
  violation?:
    | "MAX_PRICE_IMPACT_EXCEEDED"
    | "MIN_EFFECTIVE_RATE_NOT_MET"
    | "MAX_TOTAL_COST_EXCEEDED"
    | "MAX_GAS_EXCEEDED";
};

const units: Record<ConstraintName, CallerConstraint["unit"]> = {
  maxPriceImpact: "bps",
  minEffectiveRate: "output_per_input",
  maxTotalCost: "cost_atomic",
  maxGas: "gas_units",
};
const violation: Record<
  ConstraintName,
  NonNullable<ConstraintEvaluation["violation"]>
> = {
  maxPriceImpact: "MAX_PRICE_IMPACT_EXCEEDED",
  minEffectiveRate: "MIN_EFFECTIVE_RATE_NOT_MET",
  maxTotalCost: "MAX_TOTAL_COST_EXCEEDED",
  maxGas: "MAX_GAS_EXCEEDED",
};

/**
 * The measured metric belongs to the constraint name, not to a caller
 * declaration: several declarations of the same name may each be evaluated
 * against the same unique measured record. When more than one record claims the
 * same name the measured value is ambiguous, so the name resolves to
 * `undefined` and every affected declaration fails closed. Records are never
 * resolved by arbitrary first- or last-match order.
 */
function uniqueEvidenceByName(
  evidence: readonly ConstraintEvidence[],
): Map<ConstraintName, ConstraintEvidence | undefined> {
  const byName = new Map<ConstraintName, ConstraintEvidence | undefined>();
  for (const item of evidence) {
    byName.set(item.name, byName.has(item.name) ? undefined : item);
  }
  return byName;
}

/** Only explicit caller declarations are evaluated; absent declarations produce no result. */
export function evaluateConstraints(
  constraints: readonly CallerConstraint[],
  evidence: readonly ConstraintEvidence[],
): ConstraintEvaluation[] {
  const byName = uniqueEvidenceByName(evidence);
  return constraints.map((constraint) => {
    const base = {
      name: constraint.name,
      declarationId: constraint.declarationId,
    };
    const item = byName.get(constraint.name);
    if (
      constraint.source !== "caller" ||
      constraint.declarationId.trim() === "" ||
      constraint.unit !== units[constraint.name] ||
      !validRatio(constraint) ||
      !item ||
      item.state !== "VERIFIED" ||
      item.unit !== constraint.unit ||
      (constraint.name === "maxTotalCost" &&
        (!constraint.costAsset ||
          !item.costAsset ||
          constraint.costAsset.toLowerCase() !==
            item.costAsset.toLowerCase())) ||
      item.evidenceKey.trim() === "" ||
      !validRatio(item)
    ) {
      return { ...base, status: "UNKNOWN" };
    }
    const measured = BigInt(item.numerator) * BigInt(constraint.denominator);
    const allowed = BigInt(constraint.numerator) * BigInt(item.denominator);
    const fails =
      constraint.name === "minEffectiveRate"
        ? measured < allowed
        : measured > allowed;
    return {
      ...base,
      status: fails ? "FAIL" : "PASS",
      evidenceKey: item.evidenceKey,
      ...(fails ? { violation: violation[constraint.name] } : {}),
    };
  });
}

function validRatio(value: {
  numerator: string;
  denominator: string;
}): boolean {
  return (
    atomic(value.numerator) &&
    atomic(value.denominator) &&
    BigInt(value.denominator) > 0n
  );
}

export type Cause =
  | "STATE_MOVEMENT"
  | "TRADE_SIZE_RELATIVE_TO_LIQUIDITY"
  | "INSUFFICIENT_LIQUIDITY"
  | "GAS_SPIKE"
  | "FEE_STRUCTURE";

export type CauseEvidenceKind =
  | "SELECTED_STATE"
  | "CURRENT_STATE"
  | "TRADE_SIZE"
  | "POOL_LIQUIDITY"
  | "ROUTE_LIQUIDITY"
  | "GAS_BASELINE"
  | "GAS_CURRENT"
  | "FEE_BREAKDOWN";

export const causeRequirements: Readonly<
  Record<Cause, readonly CauseEvidenceKind[]>
> = {
  STATE_MOVEMENT: ["SELECTED_STATE", "CURRENT_STATE"],
  TRADE_SIZE_RELATIVE_TO_LIQUIDITY: ["TRADE_SIZE", "POOL_LIQUIDITY"],
  INSUFFICIENT_LIQUIDITY: ["ROUTE_LIQUIDITY"],
  GAS_SPIKE: ["GAS_BASELINE", "GAS_CURRENT"],
  FEE_STRUCTURE: ["FEE_BREAKDOWN"],
};

export type CauseEvidence = {
  kind: CauseEvidenceKind;
  state: EvidenceState;
  evidenceKey: string;
  /** Domain analysis must establish the causal relation, not merely supply metrics. */
  supports: Cause[];
};

export function evaluateCause(
  cause: Cause,
  evidence: readonly CauseEvidence[],
): {
  cause: Cause;
  status: "VERIFIED" | "NOT_VERIFIED";
  evidenceKeys: string[];
} {
  const matched = causeRequirements[cause].map((kind) =>
    evidence.find(
      (item) =>
        item.kind === kind &&
        item.state === "VERIFIED" &&
        item.evidenceKey.trim() !== "" &&
        item.supports.includes(cause),
    ),
  );
  return matched.every((item) => item !== undefined)
    ? {
        cause,
        status: "VERIFIED",
        evidenceKeys: matched.flatMap((item) =>
          item ? [item.evidenceKey] : [],
        ),
      }
    : { cause, status: "NOT_VERIFIED", evidenceKeys: [] };
}

/** Additive Risk-side P0 gate. The legacy evaluator remains unchanged for Monad. */
export function evaluateP0Risk(
  evidence: GenericEvidence,
  input: {
    selectedQuote?: QuoteContext;
    currentQuote?: QuoteContext;
    evidenceState: EvidenceState;
    constraints?: readonly CallerConstraint[];
    constraintEvidence?: readonly ConstraintEvidence[];
    verifiedRemediation?: VerifiedCandidate;
  },
): {
  base: RuleResult;
  quoteFidelity: QuoteFidelity;
  constraints: ConstraintEvaluation[];
  evidenceState: EvidenceState;
  verdict: Verdict;
} {
  const base = evaluateEvidence(evidence);
  const quoteFidelity = compareQuoteFidelity(
    input.selectedQuote,
    input.currentQuote,
    input.evidenceState,
  );
  const constraints = evaluateConstraints(
    input.constraints ?? [],
    input.constraintEvidence ?? [],
  );
  let verdict: Verdict;
  if (
    base.verdict === "UNKNOWN" ||
    input.evidenceState !== "VERIFIED" ||
    quoteFidelity.status === "UNKNOWN" ||
    constraints.some((item) => item.status === "UNKNOWN")
  ) {
    verdict = "UNKNOWN";
  } else if (
    base.verdict === "STOP" ||
    base.verdict === "ADJUST" ||
    constraints.some((item) => item.status === "FAIL")
  ) {
    const candidate = input.verifiedRemediation;
    const relevant =
      candidate?.status === "VERIFIED" &&
      input.selectedQuote !== undefined &&
      candidate.selectedQuoteId === input.selectedQuote.quoteId &&
      atomic(candidate.amountInAtomic) &&
      atomic(candidate.amountOutAtomic) &&
      atomic(candidate.quoteBlockNumber) &&
      BigInt(candidate.quoteBlockNumber) >=
        BigInt(input.selectedQuote.blockNumber) &&
      candidate.amountInAtomic !== input.selectedQuote.amountInAtomic &&
      BigInt(candidate.amountOutAtomic) >=
        BigInt(input.selectedQuote.amountOutAtomic) &&
      verificationBound(candidate) &&
      constraints
        .filter((item) => item.status === "FAIL")
        .every((item) =>
          candidate.verification.checkedScope.includes(
            `constraint:${item.name}`,
          ),
        ) &&
      (base.verdict !== "ADJUST" ||
        candidate.verification.checkedScope.includes("transactionProtection"));
    verdict = relevant && base.verdict !== "STOP" ? "ADJUST" : "STOP";
  } else {
    verdict = "PROCEED";
  }
  return {
    base,
    quoteFidelity,
    constraints,
    evidenceState: input.evidenceState,
    verdict,
  };
}

/**
 * Re-applies the solver's verification boundary to a caller-supplied candidate
 * before it may back a user-visible `ADJUST`. A mock, replayed, indistinct, or
 * differently-bound child Run is not a verified improvement: it may not turn a
 * speculative candidate into a remediation. The preserved candidate quote
 * context is revalidated here so a structurally supplied record cannot claim a
 * block or time that its own verification does not actually match.
 */
function verificationBound(candidate: VerifiedCandidate): boolean {
  const proof = candidate.verification;
  if (
    !atomic(candidate.amountOutAtomic) ||
    !atomic(proof.childAmountOutAtomic)
  ) {
    return false;
  }
  const quoteTime = Date.parse(candidate.quoteObservedAt);
  const verificationTime = Date.parse(proof.verificationTime);
  return (
    candidate.quoteId.trim() !== "" &&
    atomic(candidate.quoteBlockNumber) &&
    !Number.isNaN(quoteTime) &&
    proof.preparedUnsignedTxFingerprint.trim() !== "" &&
    proof.preparedAmountInAtomic === candidate.amountInAtomic &&
    proof.providerStatus === "SUCCESS" &&
    proof.riskVerdict === "PROCEED" &&
    proof.parentRunId.trim() !== "" &&
    proof.childRunId.trim() !== "" &&
    proof.childRunId !== proof.parentRunId &&
    proof.childStatus === "completed" &&
    proof.childAmountInAtomic === candidate.amountInAtomic &&
    BigInt(proof.childAmountOutAtomic) >= BigInt(candidate.amountOutAtomic) &&
    proof.childQuoteId === candidate.quoteId &&
    atomic(proof.verificationBlock) &&
    proof.verificationBlock === candidate.quoteBlockNumber &&
    !Number.isNaN(verificationTime) &&
    verificationTime >= quoteTime &&
    proof.provenance.trim() !== "" &&
    proof.checkedScope.length > 0 &&
    proof.checkedScope.every((item) => item.trim() !== "") &&
    !proof.isReplay &&
    !proof.isMock &&
    proof.actionGateVerified
  );
}

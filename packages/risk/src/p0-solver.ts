import type { EvidenceState, QuoteContext } from "./p0-diagnosis.js";

export type ChildConstraintOutcome = {
  declarationId: string;
  name: "maxPriceImpact" | "minEffectiveRate" | "maxTotalCost" | "maxGas";
  status: "PASS" | "FAIL" | "UNKNOWN";
  childRunId: string;
  candidateQuoteId: string;
};

export type ChildTransactionProtectionOutcome = {
  status: "PASS" | "FAIL" | "UNKNOWN";
  childRunId: string;
  candidateQuoteId: string;
};

export type CandidateVerification = {
  preparedUnsignedTxFingerprint: string;
  preparedAmountInAtomic: string;
  providerStatus: "SUCCESS" | "UNKNOWN" | "FAILED" | "STALE" | "UNSUPPORTED";
  riskVerdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";
  parentRunId: string;
  childRunId: string;
  childStatus: "completed" | "failed" | "started";
  childAmountInAtomic: string;
  childAmountOutAtomic: string;
  childQuoteId: string;
  verificationBlock: string;
  verificationTime: string;
  provenance: string;
  checkedScope: readonly string[];
  constraintOutcomes: readonly ChildConstraintOutcome[];
  transactionProtectionOutcome?: ChildTransactionProtectionOutcome;
  isReplay: boolean;
  isMock: boolean;
  actionGateVerified: boolean;
};

export type CandidateEvaluation =
  | { status: "QUOTE_FAILED" | "UNKNOWN"; evidenceState: EvidenceState }
  | {
      status: "QUOTED";
      evidenceState: EvidenceState;
      quote: QuoteContext;
      /** Backend supplies this only after quote → prepare → provider → Risk → child. */
      verification?: CandidateVerification;
    };

export type VerifiedCandidate = {
  status: "VERIFIED";
  selectedQuoteId: string;
  chainId: number;
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountInAtomic: string;
  amountOutAtomic: string;
  quoteId: string;
  /**
   * Candidate quote state context. Preserved so a consumer of this record can
   * revalidate the same state binding the solver applied, instead of trusting a
   * structurally supplied candidate.
   */
  quoteBlockNumber: string;
  quoteObservedAt: string;
  verification: CandidateVerification;
};

export type SolverResult =
  | { status: "VERIFIED"; candidate: VerifiedCandidate; evaluations: number }
  | {
      status: "PROPOSED";
      amountInAtomic: string;
      amountOutAtomic: string;
      evaluations: number;
    }
  | { status: "NO_VALID_CANDIDATE"; evaluations: number }
  | {
      status: "UNKNOWN";
      reason: "QUOTE_FAILED" | "EVIDENCE_NOT_VERIFIED" | "EVALUATOR_FAILURE";
      evaluations: number;
    };

export type SolverInput = {
  parentRunId: string;
  selected: QuoteContext;
  startingAmountInAtomic: string;
  maxAmountInAtomic: string;
  initialStepAtomic: string;
  maxEvaluations: number;
  evaluate: (amountInAtomic: string) => Promise<CandidateEvaluation>;
};

/**
 * Geometrically increasing, bounded exploration. Every output is an actual
 * evaluator observation. The search makes no monotonicity or optimum claim.
 */
export async function solveSelectedTargetOutput(
  input: SolverInput,
): Promise<SolverResult> {
  // The selected exact-input baseline is externally supplied quote evidence and
  // is the user expectation this exact-input search is measured against. A
  // malformed or non-positive baseline fails closed through the existing
  // `UNKNOWN` result rather than the internal invalid-input boundary, so an
  // adversarial runtime value can neither throw nor reach candidate
  // verification.
  if (!validSelectedExactInput(input.selected)) {
    return {
      status: "UNKNOWN",
      reason: "EVIDENCE_NOT_VERIFIED",
      evaluations: 0,
    };
  }
  if (
    ![
      input.selected.amountOutAtomic,
      input.startingAmountInAtomic,
      input.maxAmountInAtomic,
      input.initialStepAtomic,
    ].every(atomic) ||
    !Number.isSafeInteger(input.maxEvaluations) ||
    input.maxEvaluations < 1 ||
    input.parentRunId.trim() === "" ||
    input.selected.quoteId.trim() === "" ||
    input.selected.provenance.trim() === "" ||
    !Number.isSafeInteger(input.selected.chainId) ||
    input.selected.chainId < 1 ||
    [
      input.selected.protocol,
      input.selected.tokenIn,
      input.selected.tokenOut,
    ].some((item) => item.trim() === "") ||
    !atomic(input.selected.blockNumber) ||
    Number.isNaN(Date.parse(input.selected.observedAt)) ||
    BigInt(input.selected.amountOutAtomic) === 0n
  )
    throw new Error("Invalid bounded solver input");

  const start = BigInt(input.startingAmountInAtomic);
  const maximum = BigInt(input.maxAmountInAtomic);
  let step = BigInt(input.initialStepAtomic);
  if (start < 1n || maximum <= start || step < 1n) {
    throw new Error(
      "Solver domain must contain a positive candidate above the start",
    );
  }

  let candidate = start;
  for (
    let evaluations = 1;
    evaluations <= input.maxEvaluations;
    evaluations++
  ) {
    candidate = candidate + step > maximum ? maximum : candidate + step;
    let result: CandidateEvaluation;
    try {
      result = await input.evaluate(candidate.toString());
    } catch {
      return { status: "UNKNOWN", reason: "EVALUATOR_FAILURE", evaluations };
    }
    if (!record(result)) {
      return {
        status: "UNKNOWN",
        reason: "EVIDENCE_NOT_VERIFIED",
        evaluations,
      };
    }
    if (result.status === "QUOTE_FAILED") {
      return { status: "UNKNOWN", reason: "QUOTE_FAILED", evaluations };
    }
    if (
      result.status !== "QUOTED" ||
      result.evidenceState !== "VERIFIED" ||
      !validQuote(input.selected, result.quote, candidate)
    ) {
      return {
        status: "UNKNOWN",
        reason: "EVIDENCE_NOT_VERIFIED",
        evaluations,
      };
    }
    if (
      BigInt(result.quote.amountOutAtomic) >=
      BigInt(input.selected.amountOutAtomic)
    ) {
      if (
        result.verification &&
        result.verification.providerStatus !== "SUCCESS"
      ) {
        return {
          status: "UNKNOWN",
          reason: "EVIDENCE_NOT_VERIFIED",
          evaluations,
        };
      }
      const proof = result.verification;
      if (!validVerification(input.parentRunId, result.quote, proof)) {
        return {
          status: "PROPOSED",
          amountInAtomic: candidate.toString(),
          amountOutAtomic: result.quote.amountOutAtomic,
          evaluations,
        };
      }
      return {
        status: "VERIFIED",
        candidate: {
          status: "VERIFIED",
          selectedQuoteId: input.selected.quoteId,
          chainId: result.quote.chainId,
          protocol: result.quote.protocol,
          tokenIn: result.quote.tokenIn,
          tokenOut: result.quote.tokenOut,
          amountInAtomic: candidate.toString(),
          amountOutAtomic: result.quote.amountOutAtomic,
          quoteId: result.quote.quoteId,
          quoteBlockNumber: result.quote.blockNumber,
          quoteObservedAt: result.quote.observedAt,
          verification: proof,
        },
        evaluations,
      };
    }
    if (candidate === maximum)
      return { status: "NO_VALID_CANDIDATE", evaluations };
    step *= 2n;
  }
  return { status: "NO_VALID_CANDIDATE", evaluations: input.maxEvaluations };
}

function atomic(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTime(value: unknown): value is string {
  return nonempty(value) && !Number.isNaN(Date.parse(value));
}

/**
 * The solver is an exact-input search, so the selected baseline must be a
 * canonical atomic decimal and a valid positive swap input. `atomic` is checked
 * before any `BigInt` conversion so a non-string or non-canonical runtime value
 * is rejected without throwing.
 */
function validSelectedExactInput(selected: QuoteContext): boolean {
  return (
    atomic(selected.amountInAtomic) && BigInt(selected.amountInAtomic) > 0n
  );
}

function validQuote(
  selected: QuoteContext,
  quote: QuoteContext,
  candidate: bigint,
): boolean {
  return (
    record(quote) &&
    selected.chainId === quote.chainId &&
    selected.protocol === quote.protocol &&
    nonempty(quote.tokenIn) &&
    nonempty(quote.tokenOut) &&
    selected.tokenIn.toLowerCase() === quote.tokenIn.toLowerCase() &&
    selected.tokenOut.toLowerCase() === quote.tokenOut.toLowerCase() &&
    quote.amountInAtomic === candidate.toString() &&
    atomic(quote.amountOutAtomic) &&
    atomic(quote.blockNumber) &&
    BigInt(quote.blockNumber) >= BigInt(selected.blockNumber) &&
    nonempty(quote.quoteId) &&
    nonempty(quote.provenance) &&
    validTime(quote.observedAt) &&
    Date.parse(quote.observedAt) >= Date.parse(selected.observedAt)
  );
}

function validVerification(
  parentRunId: string,
  quote: QuoteContext,
  proof: CandidateVerification | undefined,
): proof is CandidateVerification {
  return (
    record(proof) &&
    nonempty(proof.preparedUnsignedTxFingerprint) &&
    proof.preparedAmountInAtomic === quote.amountInAtomic &&
    proof.providerStatus === "SUCCESS" &&
    proof.riskVerdict === "PROCEED" &&
    proof.parentRunId === parentRunId &&
    nonempty(proof.childRunId) &&
    proof.childRunId !== parentRunId &&
    proof.childStatus === "completed" &&
    proof.childAmountInAtomic === quote.amountInAtomic &&
    atomic(proof.childAmountOutAtomic) &&
    BigInt(proof.childAmountOutAtomic) >= BigInt(quote.amountOutAtomic) &&
    proof.childQuoteId === quote.quoteId &&
    atomic(proof.verificationBlock) &&
    proof.verificationBlock === quote.blockNumber &&
    validTime(proof.verificationTime) &&
    Date.parse(proof.verificationTime) >= Date.parse(quote.observedAt) &&
    nonempty(proof.provenance) &&
    Array.isArray(proof.checkedScope) &&
    proof.checkedScope.length > 0 &&
    proof.checkedScope.every(nonempty) &&
    Array.isArray(proof.constraintOutcomes) &&
    proof.constraintOutcomes.every(
      (item) =>
        record(item) &&
        nonempty(item.declarationId) &&
        [
          "maxPriceImpact",
          "minEffectiveRate",
          "maxTotalCost",
          "maxGas",
        ].includes(item.name as string) &&
        item.childRunId === proof.childRunId &&
        item.candidateQuoteId === quote.quoteId &&
        ["PASS", "FAIL", "UNKNOWN"].includes(item.status as string),
    ) &&
    (proof.transactionProtectionOutcome === undefined ||
      (record(proof.transactionProtectionOutcome) &&
        proof.transactionProtectionOutcome.childRunId === proof.childRunId &&
        proof.transactionProtectionOutcome.candidateQuoteId === quote.quoteId &&
        ["PASS", "FAIL", "UNKNOWN"].includes(
          proof.transactionProtectionOutcome.status,
        ))) &&
    !proof.isReplay &&
    !proof.isMock &&
    proof.actionGateVerified
  );
}

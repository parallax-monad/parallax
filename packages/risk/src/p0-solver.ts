import type { EvidenceState, QuoteContext } from "./p0-diagnosis.js";

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
  amountInAtomic: string;
  amountOutAtomic: string;
  quoteId: string;
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
          amountInAtomic: candidate.toString(),
          amountOutAtomic: result.quote.amountOutAtomic,
          quoteId: result.quote.quoteId,
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

function atomic(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

function validQuote(
  selected: QuoteContext,
  quote: QuoteContext,
  candidate: bigint,
): boolean {
  return (
    selected.chainId === quote.chainId &&
    selected.protocol === quote.protocol &&
    selected.tokenIn.toLowerCase() === quote.tokenIn.toLowerCase() &&
    selected.tokenOut.toLowerCase() === quote.tokenOut.toLowerCase() &&
    quote.amountInAtomic === candidate.toString() &&
    atomic(quote.amountOutAtomic) &&
    atomic(quote.blockNumber) &&
    BigInt(quote.blockNumber) >= BigInt(selected.blockNumber) &&
    quote.quoteId.trim() !== "" &&
    quote.provenance.trim() !== "" &&
    !Number.isNaN(Date.parse(quote.observedAt)) &&
    Date.parse(quote.observedAt) >= Date.parse(selected.observedAt)
  );
}

function validVerification(
  parentRunId: string,
  quote: QuoteContext,
  proof: CandidateVerification | undefined,
): proof is CandidateVerification {
  return (
    !!proof &&
    proof.preparedUnsignedTxFingerprint.trim() !== "" &&
    proof.preparedAmountInAtomic === quote.amountInAtomic &&
    proof.providerStatus === "SUCCESS" &&
    proof.riskVerdict === "PROCEED" &&
    proof.parentRunId === parentRunId &&
    proof.childRunId.trim() !== "" &&
    proof.childRunId !== parentRunId &&
    proof.childStatus === "completed" &&
    proof.childAmountInAtomic === quote.amountInAtomic &&
    atomic(proof.childAmountOutAtomic) &&
    BigInt(proof.childAmountOutAtomic) >= BigInt(quote.amountOutAtomic) &&
    proof.childQuoteId === quote.quoteId &&
    atomic(proof.verificationBlock) &&
    proof.verificationBlock === quote.blockNumber &&
    !Number.isNaN(Date.parse(proof.verificationTime)) &&
    proof.provenance.trim() !== "" &&
    proof.checkedScope.length > 0 &&
    proof.checkedScope.every((item) => item.trim() !== "") &&
    !proof.isReplay &&
    !proof.isMock &&
    proof.actionGateVerified
  );
}

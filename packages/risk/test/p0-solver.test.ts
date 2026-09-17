import { describe, expect, it } from "vitest";
import {
  type CandidateEvaluation,
  type CandidateVerification,
  type QuoteContext,
  type SolverInput,
  solveSelectedTargetOutput,
} from "../src/index.js";

const selected: QuoteContext = {
  chainId: 42161,
  protocol: "camelot-v3",
  tokenIn: "A",
  tokenOut: "B",
  amountInAtomic: "10000",
  amountOutAtomic: "4812",
  quoteId: "selected",
  provenance: "quote:v1",
  blockNumber: "100",
  observedAt: "2026-09-17T00:00:00Z",
};

function quote(input: string, output: string): QuoteContext {
  return {
    ...selected,
    amountInAtomic: input,
    amountOutAtomic: output,
    quoteId: `quote-${input}`,
    blockNumber: "101",
  };
}

function verification(value: QuoteContext): CandidateVerification {
  return {
    preparedUnsignedTxFingerprint: `sha256:${value.amountInAtomic}`,
    preparedAmountInAtomic: value.amountInAtomic,
    providerStatus: "SUCCESS",
    riskVerdict: "PROCEED",
    parentRunId: "parent",
    childRunId: `child-${value.amountInAtomic}`,
    childStatus: "completed",
    childAmountInAtomic: value.amountInAtomic,
    childAmountOutAtomic: value.amountOutAtomic,
    childQuoteId: value.quoteId,
    verificationBlock: value.blockNumber,
    verificationTime: "2026-09-17T00:00:01Z",
    provenance: "provider:v1",
    checkedScope: ["quote", "prepared transaction", "simulation", "risk"],
    isReplay: false,
    isMock: false,
    actionGateVerified: true,
  };
}

function input(
  evaluate: SolverInput["evaluate"],
  overrides: Partial<SolverInput> = {},
): SolverInput {
  return {
    parentRunId: "parent",
    selected,
    startingAmountInAtomic: "10000",
    maxAmountInAtomic: "10500",
    initialStepAtomic: "100",
    maxEvaluations: 4,
    evaluate,
    ...overrides,
  };
}

describe("bounded selected-target-output solver", () => {
  it("uses actual nonlinear quote output and returns one state-bound verified child", async () => {
    const visited: string[] = [];
    const actual: Record<string, string> = { "10100": "4793", "10300": "4820" };
    const result = await solveSelectedTargetOutput(
      input(async (amount) => {
        visited.push(amount);
        const value = quote(amount, actual[amount] ?? "0");
        return {
          status: "QUOTED",
          evidenceState: "VERIFIED",
          quote: value,
          verification: verification(value),
        };
      }),
    );
    expect(visited).toEqual(["10100", "10300"]);
    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED") {
      expect(result.candidate.amountInAtomic).toBe("10300");
      expect(result.candidate.amountOutAtomic).toBe("4820");
      expect(result.candidate.verification.parentRunId).toBe("parent");
      expect(result.candidate.verification.verificationBlock).toBe("101");
    }
    expect(result).not.toHaveProperty("minimumAmountInAtomic");
  });

  it("returns no valid candidate at the input bound", async () => {
    const result = await solveSelectedTargetOutput(
      input(async (amount) => ({
        status: "QUOTED",
        evidenceState: "VERIFIED",
        quote: quote(amount, "4700"),
      })),
    );
    expect(result).toEqual({ status: "NO_VALID_CANDIDATE", evaluations: 3 });
  });

  it("enforces the maximum evaluation count deterministically", async () => {
    const seen: string[] = [];
    const evaluator: SolverInput["evaluate"] = async (amount) => {
      seen.push(amount);
      return {
        status: "QUOTED",
        evidenceState: "VERIFIED",
        quote: quote(amount, "4700"),
      };
    };
    const config = input(evaluator, { maxEvaluations: 2 });
    expect(await solveSelectedTargetOutput(config)).toEqual({
      status: "NO_VALID_CANDIDATE",
      evaluations: 2,
    });
    expect(seen).toEqual(["10100", "10300"]);
    seen.length = 0;
    await solveSelectedTargetOutput(config);
    expect(seen).toEqual(["10100", "10300"]);
  });

  it("does not publish a merely quoted candidate as verified", async () => {
    const result = await solveSelectedTargetOutput(
      input(async (amount) => ({
        status: "QUOTED",
        evidenceState: "VERIFIED",
        quote: quote(amount, "4812"),
      })),
    );
    expect(result).toEqual({
      status: "PROPOSED",
      amountInAtomic: "10100",
      amountOutAtomic: "4812",
      evaluations: 1,
    });
  });

  it.each([
    [
      "bad parent",
      (value: CandidateVerification) => ({ ...value, parentRunId: "another" }),
    ],
    [
      "replay",
      (value: CandidateVerification) => ({ ...value, isReplay: true }),
    ],
    [
      "Action Gate absent",
      (value: CandidateVerification) => ({
        ...value,
        actionGateVerified: false,
      }),
    ],
    [
      "wrong prepared input",
      (value: CandidateVerification) => ({
        ...value,
        preparedAmountInAtomic: "999",
      }),
    ],
  ])("keeps %s proposed", async (_label, modify) => {
    const result = await solveSelectedTargetOutput(
      input(async (amount) => {
        const value = quote(amount, "4812");
        return {
          status: "QUOTED",
          evidenceState: "VERIFIED",
          quote: value,
          verification: modify(verification(value)),
        };
      }),
    );
    expect(result.status).toBe("PROPOSED");
  });

  it("stops when Provider becomes unknown during child verification", async () => {
    const result = await solveSelectedTargetOutput(
      input(async (amount) => {
        const value = quote(amount, "4812");
        return {
          status: "QUOTED",
          evidenceState: "VERIFIED",
          quote: value,
          verification: { ...verification(value), providerStatus: "UNKNOWN" },
        };
      }),
    );
    expect(result).toEqual({
      status: "UNKNOWN",
      reason: "EVIDENCE_NOT_VERIFIED",
      evaluations: 1,
    });
  });

  it.each(["STALE", "INCOMPLETE", "UNAVAILABLE", "UNVERIFIED"] as const)(
    "stops on %s evaluator evidence",
    async (state) => {
      const evaluation: CandidateEvaluation = {
        status: "QUOTED",
        evidenceState: state,
        quote: quote("10100", "4812"),
      };
      const result = await solveSelectedTargetOutput(
        input(async () => evaluation),
      );
      expect(result).toMatchObject({
        status: "UNKNOWN",
        reason: "EVIDENCE_NOT_VERIFIED",
        evaluations: 1,
      });
    },
  );

  it("distinguishes quote failure and evaluator exception", async () => {
    expect(
      await solveSelectedTargetOutput(
        input(async () => ({
          status: "QUOTE_FAILED",
          evidenceState: "UNAVAILABLE",
        })),
      ),
    ).toEqual({ status: "UNKNOWN", reason: "QUOTE_FAILED", evaluations: 1 });
    expect(
      await solveSelectedTargetOutput(
        input(async () => {
          throw new Error("provider failed");
        }),
      ),
    ).toEqual({
      status: "UNKNOWN",
      reason: "EVALUATOR_FAILURE",
      evaluations: 1,
    });
  });

  it("does not infer an output from linear scaling", async () => {
    const result = await solveSelectedTargetOutput(
      input(async (amount) => ({
        status: "QUOTED",
        evidenceState: "VERIFIED",
        quote: quote(amount, "4700"),
      })),
    );
    expect(result.status).toBe("NO_VALID_CANDIDATE");
  });
});

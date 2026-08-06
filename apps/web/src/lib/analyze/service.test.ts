import { describe, expect, test } from "vitest";
import { estimateOutput } from "@/components/wallet/walletData";
import {
  changedLogicalFields,
  INITIAL_FORM,
  planSubmission,
  validateForm,
} from "./form";
import { checkSwap } from "./service";
import type { CheckSwapInput } from "./types";

/** Kuru MON→USDC is the one fully-supported demo pair. */
function input(overrides: Partial<CheckSwapInput> = {}): CheckSwapInput {
  return {
    protocol: "kuru",
    tokenIn: "MON",
    tokenOut: "USDC",
    amountIn: "1200",
    slippage: "0.5",
    minimumReceivedSource: "unavailable",
    ...overrides,
  };
}

describe("checkSwap verdict mapping", () => {
  test("maps a clean simulated run to PROCEED without claiming safety", () => {
    const result = checkSwap(input());

    expect(result.systemStatus).toBe("OK");
    expect(result.productRunMode).toBe("DEMO");
    expect(result.replayMode).toBe(false);
    expect(result.evidence.every((item) => item.origin === "mock")).toBe(true);
    expect(result.verdict).toBe("PROCEED");
    expect(result.summary.en).toContain("not a safety guarantee");
    expect(result.summary.en).not.toContain("safe to sign");
  });

  test("maps an unroutable pair to STOP", () => {
    const result = checkSwap(input({ tokenOut: "MON" }));

    expect(result.verdict).toBe("STOP");
    expect(result.quote.expectedOutput).toBe("unavailable");
  });

  test("maps an over-balance amount to ADJUST rather than STOP", () => {
    // Recorded MON balance is 1800, so 1801 reverts on the balance check.
    const result = checkSwap(input({ amountIn: "1801" }));

    expect(result.verdict).toBe("ADJUST");
    expect(
      result.recommendedActions.some((item) => item.field === "amountIn"),
    ).toBe(true);
  });
});
describe("checkSwap invalid input", () => {
  test.each(["0", "-5", "abc", ""])(
    "reports %j as an integration error rather than a risk verdict",
    (amountIn) => {
      const result = checkSwap(input({ amountIn }));

      expect(result.systemStatus).toBe("INTEGRATION_ERROR");
      expect(result.verdict).toBe("UNKNOWN");
    },
  );

  test("keeps an integration error out of the risk rule surface", () => {
    const result = checkSwap(input({ amountIn: "0" }));

    expect(result.ruleResults).toEqual([]);
    expect(result.recommendedActions).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.unknowns).toHaveLength(1);
    expect(result.summary.en).toContain("says nothing about the transaction");
  });

  test("keeps an incomplete run in demo mode without replay provenance", () => {
    const result = checkSwap(input({ amountIn: "0" }));
    expect(result.productRunMode).toBe("DEMO");
    expect(result.replayMode).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  test.each([
    { slippage: "abc" },
    { slippage: "-0.1" },
    { slippage: "100.1" },
    { minimumReceived: "abc" },
    { minimumReceived: "0" },
    { minimumReceived: "-1" },
  ])("rejects invalid boundary input without fallback: %o", (overrides) => {
    const result = checkSwap(input(overrides));

    expect(result.systemStatus).toBe("INTEGRATION_ERROR");
    expect(result.evidence).toEqual([]);
    expect(result.recommendedActions).toEqual([]);
  });
});

describe("form validation and rerun changes", () => {
  test("accepts empty minimum received and supported slippage", () => {
    expect(validateForm(INITIAL_FORM).valid).toBe(true);
  });

  test.each([
    { field: "amountIn", value: "0" },
    { field: "amountIn", value: "abc" },
    { field: "slippage", value: "" },
    { field: "slippage", value: "-1" },
    { field: "slippage", value: "101" },
    { field: "minimumReceived", value: "0" },
    { field: "minimumReceived", value: "abc" },
  ] as const)("returns a field error for $field=$value", ({ field, value }) => {
    const validation = validateForm({ ...INITIAL_FORM, [field]: value });
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors[field]).toBeDefined();
  });

  test("counts tokenIn and tokenOut together as one tokenPair change", () => {
    expect(
      changedLogicalFields(INITIAL_FORM, {
        ...INITIAL_FORM,
        tokenIn: "WMON",
        tokenOut: "USDT",
      }),
    ).toEqual(["tokenPair"]);
  });

  test("counts amount and slippage as two logical changes", () => {
    expect(
      changedLogicalFields(INITIAL_FORM, {
        ...INITIAL_FORM,
        amountIn: "1000",
        slippage: "1",
      }),
    ).toEqual(["amountIn", "slippage"]);
  });

  test("allows a one-condition rerun plan", () => {
    const plan = planSubmission(
      { ...INITIAL_FORM, amountIn: "1000" },
      INITIAL_FORM,
    );
    expect(plan.allowed).toBe(true);
  });

  test("blocks an unchanged rerun plan", () => {
    const plan = planSubmission(INITIAL_FORM, INITIAL_FORM);
    expect(plan.allowed).toBe(false);
  });

  test("allows an unchanged integration retry plan", () => {
    const plan = planSubmission(INITIAL_FORM, INITIAL_FORM, {
      allowUnchanged: true,
    });
    expect(plan.allowed).toBe(true);
  });

  test("blocks a multi-condition rerun plan before scheduling", () => {
    const plan = planSubmission(
      { ...INITIAL_FORM, amountIn: "1000", slippage: "1" },
      INITIAL_FORM,
    );
    expect(plan.allowed).toBe(false);
    if (!plan.allowed) expect(plan.errors.form).toBeDefined();
  });

  test("returns no inline quote for invalid slippage", () => {
    expect(
      estimateOutput({
        protocol: "kuru",
        tokenIn: "MON",
        tokenOut: "USDC",
        amountIn: "1200",
        slippage: "not-a-number",
      }),
    ).toBeUndefined();
  });
});

describe("checkSwap rerun", () => {
  test("carries the parent run id onto the child run", () => {
    const first = checkSwap(input());
    const second = checkSwap(input({ parentRunId: first.runId }), {
      previous: first,
    });

    expect(second.parentRunId).toBe(first.runId);
    expect(second.runId).not.toBe(first.runId);
  });

  test("omits a diff on the first run", () => {
    expect(checkSwap(input()).diff).toBeUndefined();
  });

  test("reports the changed amount as its own diff row", () => {
    const first = checkSwap(input({ amountIn: "1200" }));
    const second = checkSwap(
      input({ amountIn: "1801", parentRunId: first.runId }),
      { previous: first },
    );

    const amountRow = second.diff?.find((row) => row.field.en === "Amount in");
    expect(amountRow).toBeDefined();
    expect(amountRow?.previous.en).toBe("1200 MON");
    expect(amountRow?.next.en).toBe("1801 MON");
  });

  test("omits the amount row when the amount did not change", () => {
    const first = checkSwap(input());
    const second = checkSwap(
      input({
        minimumReceived: "9999",
        minimumReceivedSource: "user_declared",
        parentRunId: first.runId,
      }),
      { previous: first },
    );

    expect(second.diff?.some((row) => row.field.en === "Amount in")).toBe(
      false,
    );
    expect(second.diff?.some((row) => row.field.en === "Verdict")).toBe(true);
  });
});

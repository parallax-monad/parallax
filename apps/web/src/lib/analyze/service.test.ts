import { describe, expect, test } from "vitest";
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

  test("does not label an incomplete run as demo preset data", () => {
    // replayMode drives the "Demo preset" pill, so a run that never produced
    // fixture evidence must not claim it did.
    expect(checkSwap(input({ amountIn: "0" })).replayMode).toBe(false);
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

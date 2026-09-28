import { describe, expect, it } from "vitest";
import { classifyUsdcWethFeasibility } from "./usdc-weth-camelot-feasibility.js";

const qualified = {
  spenderVerified: true,
  balanceSufficient: true,
  allowanceSufficient: true,
  ethCallSucceeded: true,
  estimateGasSucceeded: true,
};

describe("#103 real reverse-path feasibility classification", () => {
  it("requires observed router transferFrom before qualifying the spender", () => {
    expect(
      classifyUsdcWethFeasibility({ ...qualified, spenderVerified: false }),
    ).toBe("BLOCKED_SPENDER_UNVERIFIED");
  });

  it.each([
    { balanceSufficient: false, allowanceSufficient: true },
    { balanceSufficient: true, allowanceSufficient: false },
    { balanceSufficient: false, allowanceSufficient: false },
  ])(
    "does not upgrade an account-state blocker from quote or tx construction",
    (state) => {
      expect(classifyUsdcWethFeasibility({ ...qualified, ...state })).toBe(
        "BLOCKED_ACCOUNT_STATE",
      );
    },
  );

  it.each([
    { ethCallSucceeded: false, estimateGasSucceeded: true },
    { ethCallSucceeded: true, estimateGasSucceeded: false },
    { ethCallSucceeded: false, estimateGasSucceeded: false },
  ])("requires both real read-only execution checks", (execution) => {
    expect(classifyUsdcWethFeasibility({ ...qualified, ...execution })).toBe(
      "BLOCKED_EXECUTION",
    );
  });

  it("qualifies only when spender, account state, call, and gas all succeed", () => {
    expect(classifyUsdcWethFeasibility(qualified)).toBe("QUALIFIED_REAL");
  });
});

import { describe, expect, it } from "vitest";
import { convertHumanAmountToAtomic } from "./amount.js";
import { atomicAmountSchema, UINT256_MAX } from "./common.js";

describe("atomicAmountSchema", () => {
  it("accepts uint256 maximum", () => {
    expect(atomicAmountSchema.safeParse(UINT256_MAX.toString()).success).toBe(
      true,
    );
  });

  it("rejects an atomic amount above uint256", () => {
    expect(
      atomicAmountSchema.safeParse((UINT256_MAX + 1n).toString()).success,
    ).toBe(false);
  });
});

describe("convertHumanAmountToAtomic", () => {
  it.each([
    ["1.25", 6, "1250000"],
    ["0.000001", 6, "1"],
    ["1.5", 18, "1500000000000000000"],
    ["1", 0, "1"],
  ])("converts %s with %i decimals exactly", (amount, decimals, expected) => {
    expect(convertHumanAmountToAtomic(amount, decimals)).toEqual({
      success: true,
      amountAtomic: expected,
    });
  });

  it.each(["0", "-1", "1e6", "01", " 1"])(
    "rejects invalid human amount %s",
    (amount) => {
      expect(convertHumanAmountToAtomic(amount, 6)).toMatchObject({
        success: false,
        error: { code: "INVALID_DECIMAL" },
      });
    },
  );

  it("rejects precision beyond trusted token decimals", () => {
    expect(convertHumanAmountToAtomic("0.0000001", 6)).toMatchObject({
      success: false,
      error: { code: "TOO_MANY_DECIMAL_PLACES" },
    });
  });

  it("accepts uint256 max and rejects overflow", () => {
    expect(convertHumanAmountToAtomic(UINT256_MAX.toString(), 0)).toEqual({
      success: true,
      amountAtomic: UINT256_MAX.toString(),
    });
    expect(
      convertHumanAmountToAtomic((UINT256_MAX + 1n).toString(), 0),
    ).toMatchObject({
      success: false,
      error: { code: "AMOUNT_EXCEEDS_UINT256" },
    });
  });
});

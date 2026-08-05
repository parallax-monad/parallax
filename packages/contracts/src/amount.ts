import { positiveDecimalSchema, UINT256_MAX } from "./common.js";

export type AmountConversionErrorCode =
  | "INVALID_DECIMAL"
  | "TOO_MANY_DECIMAL_PLACES"
  | "AMOUNT_EXCEEDS_UINT256";

export type AmountConversionResult =
  | { success: true; amountAtomic: string }
  | {
      success: false;
      error: {
        code: AmountConversionErrorCode;
        message: string;
      };
    };

/**
 * Converts a human-readable token amount to atomic units without using
 * JavaScript floating-point arithmetic.
 */
export function convertHumanAmountToAtomic(
  amount: string,
  decimals: number,
): AmountConversionResult {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !positiveDecimalSchema.safeParse(amount).success
  ) {
    return {
      success: false,
      error: {
        code: "INVALID_DECIMAL",
        message: "Amount must be a positive plain decimal string",
      },
    };
  }

  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    return {
      success: false,
      error: {
        code: "TOO_MANY_DECIMAL_PLACES",
        message: `Amount supports at most ${decimals} decimal places`,
      },
    };
  }

  // Padding the fractional digits produces the exact base-10 integer value.
  const amountAtomic = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  if (amountAtomic > UINT256_MAX) {
    return {
      success: false,
      error: {
        code: "AMOUNT_EXCEEDS_UINT256",
        message: "Atomic amount exceeds uint256",
      },
    };
  }

  return { success: true, amountAtomic: amountAtomic.toString() };
}

/**
 * Converts an atomic token amount to the plain decimal string expected by
 * external protocol adapters without using floating-point arithmetic.
 */
export function convertAtomicAmountToHuman(
  amountAtomic: string,
  decimals: number,
): string {
  if (
    !/^(?:0|[1-9]\d*)$/.test(amountAtomic) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new Error("Invalid atomic amount or token decimals");
  }

  if (decimals === 0) return amountAtomic;

  const padded = amountAtomic.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

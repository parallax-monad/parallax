import { z } from "zod";
import type { NormalizedSwapIntent } from "./intent.js";

export const intentNormalizationErrorCodeSchema = z.enum([
  "UNSUPPORTED_CHAIN",
  "UNSUPPORTED_TOKEN",
  "INVALID_DECIMAL",
  "TOO_MANY_DECIMAL_PLACES",
  "AMOUNT_EXCEEDS_UINT256",
]);

export const intentNormalizationErrorSchema = z
  .object({
    code: intentNormalizationErrorCodeSchema,
    field: z.enum([
      "chainId",
      "tokenIn",
      "tokenOut",
      "amountIn",
      "economicBoundary.minimumReceived",
    ]),
    message: z.string().trim().min(1),
  })
  .strict();

export type IntentNormalizationErrorCode = z.infer<
  typeof intentNormalizationErrorCodeSchema
>;
export type IntentNormalizationError = z.infer<
  typeof intentNormalizationErrorSchema
>;
export type IntentNormalizationResult =
  | { success: true; intent: NormalizedSwapIntent }
  | { success: false; error: IntentNormalizationError };

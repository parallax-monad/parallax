import { z } from "zod";
import {
  assetReferenceSchema,
  chainIdSchema,
  positiveDecimalSchema,
  protocolSchema,
} from "./common.js";
import { quoteSchema } from "./quote.js";

/**
 * The quote a caller selected before starting a Check. Its execution identity
 * is repeated here so Backend can reject comparisons across different exact-
 * input intents instead of treating a user-selected quote as a constraint.
 */
export const expectationBaselineSchema = z
  .object({
    chainId: chainIdSchema,
    protocol: protocolSchema,
    tokenIn: assetReferenceSchema,
    tokenOut: assetReferenceSchema,
    amountIn: positiveDecimalSchema,
    quote: quoteSchema,
  })
  .strict();

export type ExpectationBaseline = z.infer<typeof expectationBaselineSchema>;

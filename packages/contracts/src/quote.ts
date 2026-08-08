import { z } from "zod";
import {
  addressSchema,
  assetIdentity,
  assetReferenceSchema,
  chainIdSchema,
  positiveDecimalSchema,
  protocolSchema,
} from "./common.js";

function distinctAssets<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((request, context) => {
    const chainId = request.chainId as number;
    if (
      assetIdentity({ chainId, asset: request.tokenIn }) ===
      assetIdentity({ chainId, asset: request.tokenOut })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tokenIn and tokenOut must be different assets",
        path: ["tokenOut"],
      });
    }
  });
}

/** Public exact-input request for the pre-check Kuru quote. */
export const quoteRequestSchema = distinctAssets(
  z
    .object({
      chainId: chainIdSchema,
      protocol: protocolSchema,
      sender: addressSchema,
      tokenIn: assetReferenceSchema,
      tokenOut: assetReferenceSchema,
      amountIn: positiveDecimalSchema,
    })
    .strict(),
);

/** Quote amount and provenance exposed by both Quote and Check responses. */
export const quoteSchema = z
  .object({
    estimatedAmountOut: positiveDecimalSchema,
    minimumAmountOut: positiveDecimalSchema.optional(),
    source: z.literal("quote"),
    blockNumber: z.string().regex(/^\d+$/),
    fetchedAt: z.string().datetime().optional(),
    runtimeVersion: z.string().trim().min(1),
    runtimeRevision: z.string().trim().min(1),
  })
  .strict()
  .superRefine((quote, context) => {
    if (
      quote.minimumAmountOut !== undefined &&
      comparePositiveDecimals(
        quote.minimumAmountOut,
        quote.estimatedAmountOut,
      ) > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minimumAmountOut must not exceed estimatedAmountOut",
        path: ["minimumAmountOut"],
      });
    }
  });

function comparePositiveDecimals(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightValue = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export const quoteUnavailableReasonSchema = z.enum([
  "NO_ROUTE",
  "QUOTE_UNAVAILABLE",
]);

export const quoteResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      quote: quoteSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: quoteUnavailableReasonSchema,
    })
    .strict(),
]);

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteUnavailableReason = z.infer<
  typeof quoteUnavailableReasonSchema
>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;

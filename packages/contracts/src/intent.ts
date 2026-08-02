import { z } from "zod";
import {
  type AssetReference,
  addressSchema,
  assetIdentity,
  assetReferenceSchema,
  atomicAmountSchema,
  chainIdSchema,
  positiveDecimalSchema,
  protocolSchema,
} from "./common.js";

export const recipientSourceSchema = z.enum([
  "explicit",
  "defaulted_from_sender",
]);

const publicEconomicBoundarySourceSchema = z.enum(["user_declared"]);

const normalizedEconomicBoundarySourceSchema = z.enum([
  "original_swap",
  "user_declared",
  "demo_preset",
]);

/**
 * The API always represents the economic boundary explicitly. When the user
 * omits Minimum Received, callers send the unavailable variant so downstream
 * code can distinguish "not provided" from missing or malformed data.
 *
 * Available amounts remain human-readable at this untrusted HTTP boundary.
 */
export const checkEconomicBoundarySchema = z.discriminatedUnion(
  "availability",
  [
    z
      .object({
        availability: z.literal("available"),
        minimumReceived: positiveDecimalSchema,
        source: publicEconomicBoundarySourceSchema,
      })
      .strict(),
    z
      .object({
        availability: z.literal("unavailable"),
        source: z.literal("unavailable"),
      })
      .strict(),
  ],
);

// Internal consumers receive only backend-normalized atomic units.
export const normalizedEconomicBoundarySchema = z.discriminatedUnion(
  "availability",
  [
    z
      .object({
        availability: z.literal("available"),
        minimumReceivedAtomic: atomicAmountSchema,
        source: normalizedEconomicBoundarySourceSchema,
      })
      .strict(),
    z
      .object({
        availability: z.literal("unavailable"),
        source: z.literal("unavailable"),
      })
      .strict(),
  ],
);

function distinctAssetsSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((intent, context) => {
    const chainId = intent.chainId as number;
    const tokenIn = intent.tokenIn as AssetReference;
    const tokenOut = intent.tokenOut as AssetReference;

    if (
      assetIdentity({ chainId, asset: tokenIn }) ===
      assetIdentity({ chainId, asset: tokenOut })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tokenIn and tokenOut must be different assets",
        path: ["tokenOut"],
      });
    }
  });
}

// The presence of amountIn, rather than amountOut, fixes P0 to exact-input.
export const checkSwapRequestSchema = distinctAssetsSchema(
  z
    .object({
      chainId: chainIdSchema,
      protocol: protocolSchema,
      sender: addressSchema,
      recipient: addressSchema.optional(),
      tokenIn: assetReferenceSchema,
      tokenOut: assetReferenceSchema,
      amountIn: positiveDecimalSchema,
      economicBoundary: checkEconomicBoundarySchema,
    })
    .strict(),
);

// Risk, orchestration, Moss, and replay code must consume this domain contract.
export const normalizedSwapIntentSchema = distinctAssetsSchema(
  z
    .object({
      chainId: chainIdSchema,
      protocol: protocolSchema,
      sender: addressSchema,
      recipient: addressSchema,
      recipientSource: recipientSourceSchema,
      tokenIn: assetReferenceSchema,
      tokenOut: assetReferenceSchema,
      amountInAtomic: atomicAmountSchema,
      economicBoundary: normalizedEconomicBoundarySchema,
    })
    .strict(),
);

export type CheckEconomicBoundary = z.infer<typeof checkEconomicBoundarySchema>;
export type RecipientSource = z.infer<typeof recipientSourceSchema>;
export type NormalizedEconomicBoundary = z.infer<
  typeof normalizedEconomicBoundarySchema
>;
export type CheckSwapRequest = z.infer<typeof checkSwapRequestSchema>;
export type NormalizedSwapIntent = z.infer<typeof normalizedSwapIntentSchema>;

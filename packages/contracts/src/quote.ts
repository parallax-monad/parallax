import { z } from "zod";
import {
  addressSchema,
  assetIdentity,
  assetReferenceSchema,
  atomicAmountSchema,
  chainIdSchema,
  positiveDecimalSchema,
  protocolSchema,
} from "./common.js";
import {
  tokenMetadataPairSchema,
  trustedTokenMetadataSchema,
} from "./registry.js";

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

/** Versioned, exact source identity for a Quote observation. */
export const quoteProvenanceSchema = z
  .object({
    version: z.literal(1),
    profileId: z.string().trim().min(1),
    sourceChainId: chainIdSchema,
    sourceBlock: z
      .object({
        number: z.string().regex(/^(?:0|[1-9]\d*)$/),
        hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        timestamp: z.string().regex(/^(?:0|[1-9]\d*)$/),
        observedAt: z.string().datetime(),
      })
      .strict(),
    inputAsset: trustedTokenMetadataSchema,
    outputAsset: trustedTokenMetadataSchema,
    amountInAtomic: atomicAmountSchema,
    amountOutAtomic: atomicAmountSchema,
    route: z
      .object({
        protocol: protocolSchema,
        kind: z.literal("direct"),
        poolAddress: addressSchema,
        tokenPath: z.tuple([addressSchema, addressSchema]),
      })
      .strict(),
    quoteSource: z
      .object({
        kind: z.literal("quoter"),
        protocol: protocolSchema,
        address: addressSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (
      provenance.inputAsset.chainId !== provenance.sourceChainId ||
      provenance.outputAsset.chainId !== provenance.sourceChainId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quote assets must belong to the source chain",
        path: ["sourceChainId"],
      });
    }
    if (provenance.route.protocol !== provenance.quoteSource.protocol) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quote source protocol must match the direct route protocol",
        path: ["quoteSource", "protocol"],
      });
    }
    if (
      provenance.inputAsset.asset.kind === "erc20" &&
      provenance.route.tokenPath[0].toLowerCase() !==
        provenance.inputAsset.asset.address.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Direct route input must match the input ERC-20 asset",
        path: ["route", "tokenPath", 0],
      });
    }
    if (
      provenance.outputAsset.asset.kind === "erc20" &&
      provenance.route.tokenPath[1].toLowerCase() !==
        provenance.outputAsset.asset.address.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Direct route output must match the output ERC-20 asset",
        path: ["route", "tokenPath", 1],
      });
    }
  });

export type QuoteProvenance = z.infer<typeof quoteProvenanceSchema>;

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
    provenance: quoteProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((quote, context) => {
    if (
      quote.provenance !== undefined &&
      quote.provenance.sourceBlock.number !== quote.blockNumber
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quote blockNumber must match its pinned source block",
        path: ["provenance", "sourceBlock", "number"],
      });
    }
    if (
      quote.provenance !== undefined &&
      quote.fetchedAt !== undefined &&
      quote.provenance.sourceBlock.observedAt !== quote.fetchedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quote fetchedAt must match its provenance observedAt",
        path: ["provenance", "sourceBlock", "observedAt"],
      });
    }
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
      tokenMetadata: tokenMetadataPairSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: quoteUnavailableReasonSchema,
      tokenMetadata: tokenMetadataPairSchema.optional(),
    })
    .strict(),
]);

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteUnavailableReason = z.infer<
  typeof quoteUnavailableReasonSchema
>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;

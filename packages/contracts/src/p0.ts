import { z } from "zod";
import { atomicAmountSchema, chainIdSchema, protocolSchema } from "./common.js";
import { verdictSchema } from "./decision.js";
import { evidenceSourceSchema } from "./evidence.js";
import {
  genericEvidenceModeSchema,
  genericProviderStatusSchema,
} from "./generic-evidence.js";

const signedAtomicAmountSchema = z.string().regex(/^-?(0|[1-9]\d*)$/);

export const p0EvidenceStateSchema = z.enum([
  "VERIFIED",
  "INCOMPLETE",
  "UNAVAILABLE",
  "STALE",
  "UNVERIFIED",
]);

export const p0QuoteSnapshotSchema = z
  .object({
    chainId: chainIdSchema,
    protocol: protocolSchema,
    tokenIn: z.string().trim().min(1),
    tokenOut: z.string().trim().min(1),
    amountInAtomic: atomicAmountSchema,
    amountOutAtomic: atomicAmountSchema,
    quoteId: z.string().trim().min(1),
    blockNumber: atomicAmountSchema,
    observedAt: z.string().datetime(),
    provenance: z.string().trim().min(1),
  })
  .strict();

export const p0QuoteFidelitySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("UNKNOWN"),
      reason: z.enum([
        "MISSING_BASELINE",
        "INCOMPATIBLE",
        "INVALID_AMOUNT",
        "EVIDENCE_NOT_VERIFIED",
      ]),
    })
    .strict(),
  z
    .object({
      status: z.literal("VERIFIED"),
      selectedAmountOutAtomic: atomicAmountSchema,
      currentAmountOutAtomic: atomicAmountSchema,
      absoluteDeltaAtomic: signedAtomicAmountSchema,
      relativeDelta: z
        .object({
          numerator: signedAtomicAmountSchema,
          denominator: atomicAmountSchema,
        })
        .strict()
        .nullable(),
      observations: z.array(z.literal("QUOTE_OUTPUT_DEGRADED")),
      selectedQuoteId: z.string().trim().min(1),
      currentQuoteId: z.string().trim().min(1),
    })
    .strict(),
]);

export const p0CauseSchema = z.enum([
  "STATE_MOVEMENT",
  "TRADE_SIZE_RELATIVE_TO_LIQUIDITY",
  "INSUFFICIENT_LIQUIDITY",
  "GAS_SPIKE",
  "FEE_STRUCTURE",
]);

export const p0CauseResultSchema = z
  .object({
    cause: p0CauseSchema,
    status: z.enum(["VERIFIED", "NOT_VERIFIED"]),
    evidenceKeys: z.array(z.string().trim().min(1)),
  })
  .strict();

export const p0ConstraintResultSchema = z
  .object({
    name: z.enum([
      "maxPriceImpact",
      "minEffectiveRate",
      "maxTotalCost",
      "maxGas",
    ]),
    status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    declarationId: z.string().trim().min(1),
    evidenceKey: z.string().trim().min(1).optional(),
    violation: z
      .enum([
        "MAX_PRICE_IMPACT_EXCEEDED",
        "MIN_EFFECTIVE_RATE_NOT_MET",
        "MAX_TOTAL_COST_EXCEEDED",
        "MAX_GAS_EXCEEDED",
      ])
      .optional(),
  })
  .strict();

export const p0TransactionProtectionSchema = z
  .object({
    status: z.enum(["PASS", "FAIL", "UNKNOWN", "NOT_CHECKED"]),
    minimumReceivedAtomic: atomicAmountSchema.optional(),
    evidenceKey: z.string().trim().min(1).optional(),
  })
  .strict();

export const p0ProviderSummarySchema = z
  .object({
    providerId: z.string().trim().min(1),
    status: genericProviderStatusSchema,
    source: evidenceSourceSchema,
    mode: genericEvidenceModeSchema,
    checkedScope: z.array(z.string().trim().min(1)),
    unknownScope: z.array(z.string().trim().min(1)),
    provenance: z
      .object({
        runtimeVersion: z.string().trim().min(1).optional(),
        runtimeRevision: z.string().trim().min(1).optional(),
        blockNumber: atomicAmountSchema.optional(),
        fetchedAt: z.string().datetime().optional(),
      })
      .strict(),
  })
  .strict();

export const p0VerificationSummarySchema = z
  .object({
    childRunId: z.string().trim().min(1),
    verificationBlock: atomicAmountSchema,
    verificationTime: z.string().datetime(),
    provenance: z.string().trim().min(1),
    checkedScope: z.array(z.string().trim().min(1)),
  })
  .strict();

export const p0RemediationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("NOT_APPLICABLE"),
      reason: z.enum(["NO_BLOCKING_CONDITION", "EVIDENCE_NOT_VERIFIED"]),
    })
    .strict(),
  z
    .object({
      status: z.literal("UNKNOWN"),
      reason: z.enum([
        "QUOTE_FAILED",
        "EVIDENCE_NOT_VERIFIED",
        "EVALUATOR_FAILURE",
        "NO_VALID_CANDIDATE",
      ]),
    })
    .strict(),
  z
    .object({
      status: z.literal("PROPOSED"),
      candidate: p0QuoteSnapshotSchema,
      evaluations: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("VERIFIED"),
      before: p0QuoteSnapshotSchema,
      proposed: p0QuoteSnapshotSchema,
      after: p0QuoteSnapshotSchema,
      verification: p0VerificationSummarySchema,
    })
    .strict(),
]);

export const p0ResultSchema = z
  .object({
    expectationBaseline: p0QuoteSnapshotSchema,
    currentQuote: p0QuoteSnapshotSchema,
    quoteFidelity: p0QuoteFidelitySchema,
    evidenceState: p0EvidenceStateSchema,
    causes: z.array(p0CauseResultSchema),
    constraints: z.array(p0ConstraintResultSchema),
    transactionProtection: p0TransactionProtectionSchema,
    provider: p0ProviderSummarySchema,
    verdict: verdictSchema,
    remediation: p0RemediationSchema,
  })
  .strict();

export type P0EvidenceState = z.infer<typeof p0EvidenceStateSchema>;
export type P0QuoteSnapshot = z.infer<typeof p0QuoteSnapshotSchema>;
export type P0QuoteFidelity = z.infer<typeof p0QuoteFidelitySchema>;
export type P0Cause = z.infer<typeof p0CauseSchema>;
export type P0CauseResult = z.infer<typeof p0CauseResultSchema>;
export type P0ConstraintResult = z.infer<typeof p0ConstraintResultSchema>;
export type P0TransactionProtection = z.infer<
  typeof p0TransactionProtectionSchema
>;
export type P0ProviderSummary = z.infer<typeof p0ProviderSummarySchema>;
export type P0VerificationSummary = z.infer<typeof p0VerificationSummarySchema>;
export type P0Remediation = z.infer<typeof p0RemediationSchema>;
export type P0Result = z.infer<typeof p0ResultSchema>;

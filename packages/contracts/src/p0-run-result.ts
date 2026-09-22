import { z } from "zod";
import { chainIdSchema, runIdSchema } from "./common.js";

export const p0EvidenceStateSchema = z.enum([
  "VERIFIED",
  "INCOMPLETE",
  "UNAVAILABLE",
  "STALE",
  "UNVERIFIED",
]);

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
      selectedAmountOutAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      currentAmountOutAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      absoluteDeltaAtomic: z.string().regex(/^-?(0|[1-9]\d*)$/),
      relativeDelta: z
        .object({
          numerator: z.string().regex(/^-?(0|[1-9]\d*)$/),
          denominator: z.string().regex(/^(0|[1-9]\d*)$/),
        })
        .strict()
        .nullable(),
      observations: z.array(z.literal("QUOTE_OUTPUT_DEGRADED")),
      selectedQuoteId: z.string().trim().min(1),
      currentQuoteId: z.string().trim().min(1),
    })
    .strict(),
]);

export const p0BaselineProjectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("MISSING") }).strict(),
  z
    .object({
      status: z.literal("AVAILABLE"),
      chainId: chainIdSchema,
      protocol: z.string().trim().min(1),
      tokenIn: z.string().trim().min(1),
      tokenOut: z.string().trim().min(1),
      amountInAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      amountOutAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      quoteId: z.string().trim().min(1),
      blockNumber: z.string().regex(/^\d+$/),
      observedAt: z.string().datetime(),
      provenance: z.string().trim().min(1),
    })
    .strict(),
]);

const p0ConstraintResultSchema = z
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

const p0RemediationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_RUN") }).strict(),
  z
    .object({
      status: z.literal("UNVERIFIED"),
      evaluations: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("NO_VALID_CANDIDATE"),
      evaluations: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("UNKNOWN"),
      reason: z.enum([
        "QUOTE_FAILED",
        "EVIDENCE_NOT_VERIFIED",
        "EVALUATOR_FAILURE",
      ]),
      evaluations: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("VERIFIED"),
      parentRunId: runIdSchema,
      childRunId: runIdSchema,
      amountInAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      amountOutAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      quoteId: z.string().trim().min(1),
      verificationBlock: z.string().regex(/^\d+$/),
      verificationTime: z.string().datetime(),
      provenance: z.string().trim().min(1),
      checkedScope: z.array(z.string().trim().min(1)),
    })
    .strict(),
]);

/**
 * Provider-neutral P0 summary. Detailed evidence and actions continue to use
 * the existing RunResult fields; this projection only publishes the P0 Risk
 * outputs needed to explain baseline fidelity and verified remediation.
 */
export const p0RunResultSchema = z
  .object({
    expectationBaseline: p0BaselineProjectionSchema,
    quoteFidelity: p0QuoteFidelitySchema,
    cause: z.object({ status: z.literal("NOT_VERIFIED") }).strict(),
    constraints: z.array(p0ConstraintResultSchema),
    evidenceState: p0EvidenceStateSchema,
    transactionProtection: z
      .object({
        status: z.enum(["PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"]),
        minimumReceivedAtomic: z
          .string()
          .regex(/^(0|[1-9]\d*)$/)
          .optional(),
        source: z
          .enum([
            "original_swap",
            "user_declared",
            "demo_preset",
            "unavailable",
          ])
          .optional(),
      })
      .strict(),
    remediation: p0RemediationSchema,
  })
  .strict();

export type P0RunResult = z.infer<typeof p0RunResultSchema>;

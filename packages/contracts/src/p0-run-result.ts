import { z } from "zod";
import {
  addressSchema,
  chainIdSchema,
  crossRunEvidenceRefSchema,
  runIdSchema,
  uint256AmountSchema,
} from "./common.js";

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

const candidateExecutionBindingSchema = z
  .object({
    preparedTransactionFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    blockNumber: z.string().regex(/^\d+$/),
    blockHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
    candidateQuoteId: z.string().trim().min(1),
    observedAt: z.string().datetime(),
  })
  .strict();

export const targetOutputVerificationProofSchema = z
  .object({
    targetAmountOutAtomic: uint256AmountSchema,
    targetQuoteId: z.string().trim().min(1),
    verifiedAmountOutAtomic: uint256AmountSchema,
    resultEvidenceRef: crossRunEvidenceRefSchema,
    executionBinding: candidateExecutionBindingSchema.optional(),
  })
  .strict();

const constraintRationalSchema = z
  .object({
    numerator: z.string().regex(/^(0|[1-9]\d*)$/),
    denominator: z.string().regex(/^[1-9]\d*$/),
    unit: z.enum(["bps", "output_per_input", "cost_atomic", "gas_units"]),
    costAsset: z.string().trim().min(1).optional(),
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
      evaluations: z.number().int().positive().optional(),
      childRunId: runIdSchema,
      amountInAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      amountOutAtomic: z.string().regex(/^(0|[1-9]\d*)$/),
      quoteId: z.string().trim().min(1),
      verificationBlock: z.string().regex(/^\d+$/),
      verificationTime: z.string().datetime(),
      provenance: z.string().trim().min(1),
      checkedScope: z.array(z.string().trim().min(1)),
      // Optional as a whole for legacy Runs; new Backend results supply all fields.
      verificationProof: targetOutputVerificationProofSchema.optional(),
    })
    .strict(),
]);

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const p0BasicSimulationBindingSchema = z
  .object({
    chainId: chainIdSchema,
    protocol: z.string().trim().min(1),
    sender: addressSchema,
    recipient: addressSchema,
    tokenIn: z.string().trim().min(1),
    tokenOut: z.string().trim().min(1),
    amountInAtomic: uint256AmountSchema,
    amountOutMinimumAtomic: uint256AmountSchema,
    router: addressSchema,
    from: addressSchema,
    to: addressSchema,
    value: z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i),
    dataFingerprint: fingerprintSchema,
  })
  .strict();

/**
 * Provider-neutral facts from the bounded Native RPC basic simulation.
 *
 * This is deliberately a partial simulation contract: a successful `eth_call`
 * and an available gas estimate are independent facts, and neither one is a
 * receipt, an outcome, or a Risk verdict. The optional field keeps historical
 * Runs without this hardening slice readable as "not recorded".
 */
export const p0BasicSimulationSchema = z
  .object({
    call: z
      .object({
        status: z.enum(["SUCCEEDED", "REVERTED", "UNAVAILABLE", "NOT_RUN"]),
        returnDataFingerprint: fingerprintSchema.optional(),
      })
      .strict(),
    gasEstimate: z
      .object({
        status: z.enum(["AVAILABLE", "UNAVAILABLE", "NOT_RUN"]),
        gasUnits: uint256AmountSchema.optional(),
      })
      .strict(),
    blockNumber: z.string().regex(/^\d+$/),
    blockHash: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/i)
      .optional(),
    observedAt: z.string().datetime(),
    validityAtExecution: z.enum(["VALID", "INVALID", "UNKNOWN"]),
    preparedTransactionFingerprint: fingerprintSchema,
    transactionBinding: p0BasicSimulationBindingSchema.optional(),
    failureStage: z
      .enum(["PREPARE", "BLOCK", "CALL", "GAS_ESTIMATE", "FRESHNESS"])
      .optional(),
    reason: z.string().trim().min(1).optional(),
    uncheckedCapabilities: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((simulation, context) => {
    if (simulation.validityAtExecution === "VALID") {
      if (simulation.blockHash === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockHash"],
          message: "VALID execution requires a verified block hash",
        });
      }
      if (simulation.transactionBinding === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transactionBinding"],
          message: "VALID execution requires transaction binding evidence",
        });
      }
    }
    if (
      simulation.call.status === "SUCCEEDED" &&
      simulation.call.returnDataFingerprint === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["call", "returnDataFingerprint"],
        message: "SUCCEEDED call requires a return-data fingerprint",
      });
    }
    if (
      simulation.gasEstimate.status === "AVAILABLE" &&
      simulation.gasEstimate.gasUnits === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gasEstimate", "gasUnits"],
        message: "AVAILABLE gas estimate requires gas units",
      });
    }
  });

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
    executionBinding: candidateExecutionBindingSchema.optional(),
    constraintVerification: z
      .object({
        candidateQuoteId: z.string().trim().min(1),
        blockNumber: z.string().regex(/^\d+$/),
        checks: z.array(
          z
            .object({
              declaration: constraintRationalSchema
                .extend({
                  name: p0ConstraintResultSchema.shape.name,
                  declarationId: z.string().trim().min(1),
                  source: z.literal("caller"),
                })
                .strict(),
              measurements: z.array(
                constraintRationalSchema
                  .extend({
                    name: p0ConstraintResultSchema.shape.name,
                    state: p0EvidenceStateSchema,
                    evidenceKey: z.string().trim().min(1),
                  })
                  .strict(),
              ),
              outcome: p0ConstraintResultSchema,
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
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
    basicSimulation: p0BasicSimulationSchema.optional(),
    remediation: p0RemediationSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.remediation.status !== "VERIFIED" ||
      !result.remediation.verificationProof
    )
      return;
    const proof = result.remediation.verificationProof;
    if (proof.resultEvidenceRef.runId !== result.remediation.childRunId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remediation", "verificationProof", "resultEvidenceRef"],
        message:
          "Verified output Evidence must resolve against the verification child Run",
      });
    if (result.remediation.evaluations === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remediation", "evaluations"],
        message:
          "A new verification proof requires its actual evaluation count",
      });
    if (
      ![
        proof.verifiedAmountOutAtomic,
        proof.targetAmountOutAtomic,
        result.remediation.amountOutAtomic,
      ].every((amount) => uint256AmountSchema.safeParse(amount).success)
    )
      return;
    if (
      result.expectationBaseline.status !== "AVAILABLE" ||
      proof.targetQuoteId !== result.expectationBaseline.quoteId ||
      proof.targetAmountOutAtomic !==
        result.expectationBaseline.amountOutAtomic ||
      BigInt(proof.verifiedAmountOutAtomic) <
        BigInt(proof.targetAmountOutAtomic) ||
      BigInt(proof.verifiedAmountOutAtomic) <
        BigInt(result.remediation.amountOutAtomic)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remediation", "verificationProof"],
        message:
          "Verified output must prove the selected target and candidate quote",
      });
    }
  });

export type P0RunResult = z.infer<typeof p0RunResultSchema>;
export type P0BasicSimulation = z.infer<typeof p0BasicSimulationSchema>;

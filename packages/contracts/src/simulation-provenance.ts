import { z } from "zod";
import { addressSchema, chainIdSchema, uint256AmountSchema } from "./common.js";
import { p0BasicSimulationTransactionBindingSchema } from "./p0-run-result.js";

const decimalBlockNumberSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const blockHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const forkRunIdSchema = z.string().uuid();
const atomicAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const signedAtomicAmountSchema = z.string().regex(/^-?(0|[1-9]\d*)$/);

export const providerNeutralStateRevisionSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("AVAILABLE"),
        fingerprint: fingerprintSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("UNKNOWN"),
        reason: z.enum([
          "NO_QUALIFIED_STATE_REVISION_TOKEN",
          "STATE_CHANGED_DURING_SIMULATION",
        ]),
      })
      .strict(),
  ],
);

const simulationFailureReasonSchema = z.enum([
  "EVM_REVERT",
  "SLIPPAGE_GUARD",
  "RPC_TIMEOUT",
  "RPC_UNAVAILABLE",
  "MALFORMED_RESPONSE",
  "INSUFFICIENT_NATIVE_BALANCE",
  "FORK_STATE_CHANGED",
]);

const callCapabilitySchema = z
  .object({
    status: z.enum(["SUCCEEDED", "REVERTED", "UNAVAILABLE", "NOT_RUN"]),
    returnDataFingerprint: fingerprintSchema.optional(),
    failureReason: simulationFailureReasonSchema.optional(),
  })
  .strict()
  .superRefine((call, context) => {
    if (
      (call.status === "SUCCEEDED") !==
      (call.returnDataFingerprint !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnDataFingerprint"],
        message: "Only a successful call carries a return-data fingerprint",
      });
    }
    if (
      (call.status === "REVERTED" || call.status === "UNAVAILABLE") !==
      (call.failureReason !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "Reverted and unavailable calls require a normalized reason",
      });
    }
    if (
      call.status === "REVERTED" &&
      call.failureReason !== "EVM_REVERT" &&
      call.failureReason !== "SLIPPAGE_GUARD"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "A reverted call requires a revert or slippage-guard reason",
      });
    }
  });

const gasEstimateCapabilitySchema = z
  .object({
    status: z.enum(["AVAILABLE", "UNAVAILABLE", "NOT_RUN"]),
    gasUnits: uint256AmountSchema.optional(),
    failureReason: simulationFailureReasonSchema.optional(),
  })
  .strict()
  .superRefine((estimate, context) => {
    if (
      (estimate.status === "AVAILABLE") !==
      (estimate.gasUnits !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gasUnits"],
        message: "Only available gas estimates carry gas units",
      });
    }
    if (
      (estimate.status === "UNAVAILABLE") !==
      (estimate.failureReason !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "Unavailable gas estimates require a normalized reason",
      });
    }
  });

const amountReceivedCapabilitySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("AVAILABLE"),
      amountReceivedAtomic: uint256AmountSchema,
      source: z.enum(["RECIPIENT_BALANCE_DELTA", "VALIDATED_STATE_DIFF"]),
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      reason: z.enum(["STATE_DIFF_NOT_QUALIFIED", "CALL_NOT_SUCCEEDED"]),
    })
    .strict(),
]);

const quoteReconciliationSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("MATCHED"),
        comparisonMethod: z.literal("ATOMIC_INTEGER_EQUALITY"),
        quoteAmountOutAtomic: atomicAmountSchema,
        simulatedAmountReceivedAtomic: atomicAmountSchema,
        differenceAtomic: z.literal("0"),
      })
      .strict(),
    z
      .object({
        status: z.literal("MISMATCHED"),
        comparisonMethod: z.literal("ATOMIC_INTEGER_EQUALITY"),
        quoteAmountOutAtomic: atomicAmountSchema,
        simulatedAmountReceivedAtomic: atomicAmountSchema,
        differenceAtomic: signedAtomicAmountSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("UNAVAILABLE"),
        comparisonMethod: z.literal("ATOMIC_INTEGER_EQUALITY"),
        quoteAmountOutAtomic: atomicAmountSchema,
        reason: z.literal("SIMULATED_OUTPUT_UNAVAILABLE"),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.status === "MATCHED" &&
      value.quoteAmountOutAtomic !== value.simulatedAmountReceivedAtomic
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulatedAmountReceivedAtomic"],
        message: "A matched quote and simulation must be atomically equal",
      });
    }
    if (
      value.status === "MISMATCHED" &&
      (value.quoteAmountOutAtomic === value.simulatedAmountReceivedAtomic ||
        BigInt(value.differenceAtomic) !==
          BigInt(value.simulatedAmountReceivedAtomic) -
            BigInt(value.quoteAmountOutAtomic))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["differenceAtomic"],
        message: "A mismatch must preserve the exact signed atomic delta",
      });
    }
  });

/**
 * Provider-neutral, versioned provenance for read-only execution evidence.
 * This additive Run field contains only normalized facts: no provider payload,
 * endpoint, credential, or Risk verdict. Legacy Run projections remain valid.
 */
export const providerNeutralSimulationProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("AVAILABLE"),
    sourceChainId: chainIdSchema,
    sourceBlockNumber: decimalBlockNumberSchema,
    sourceBlockHash: blockHashSchema,
    sourceObservedAt: z.string().datetime(),
    executionEnvironment: z.enum(["LIVE", "LOCAL_FORK"]),
    executionChainId: chainIdSchema,
    executionBlockContext: z
      .object({
        baseBlockNumber: decimalBlockNumberSchema,
        baseBlockHash: blockHashSchema,
        observedHeadNumber: decimalBlockNumberSchema,
      })
      .strict(),
    forkRunId: forkRunIdSchema.optional(),
    stateRevision: providerNeutralStateRevisionSchema,
    accountOverridesApplied: z.boolean(),
    transactionFingerprint: fingerprintSchema,
    transactionBinding: p0BasicSimulationTransactionBindingSchema,
    quote: z
      .object({
        amountInAtomic: atomicAmountSchema,
        amountOutAtomic: atomicAmountSchema,
        poolAddress: addressSchema,
        tokenPath: z.tuple([addressSchema, addressSchema]),
      })
      .strict(),
    capabilities: z
      .object({
        call: callCapabilitySchema,
        gasEstimate: gasEstimateCapabilitySchema,
        amountReceived: amountReceivedCapabilitySchema,
      })
      .strict(),
    quoteReconciliation: quoteReconciliationSchema,
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.executionEnvironment === "LOCAL_FORK") {
      if (provenance.forkRunId === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["forkRunId"],
          message: "Local-fork evidence requires a fork run identity",
        });
      }
      if (
        provenance.executionBlockContext.baseBlockNumber !==
          provenance.sourceBlockNumber ||
        provenance.executionBlockContext.baseBlockHash.toLowerCase() !==
          provenance.sourceBlockHash.toLowerCase() ||
        provenance.executionBlockContext.observedHeadNumber !==
          provenance.executionBlockContext.baseBlockNumber
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["executionBlockContext"],
          message: "Local execution must match the exact source block context",
        });
      }
    } else if (provenance.forkRunId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forkRunId"],
        message: "Live execution cannot claim a local fork run identity",
      });
    }

    if (
      provenance.executionEnvironment === "LIVE" &&
      provenance.executionChainId !== provenance.sourceChainId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionChainId"],
        message: "Live execution must use the source chain",
      });
    }

    if (
      provenance.stateRevision.status === "UNKNOWN" &&
      provenance.stateRevision.reason === "STATE_CHANGED_DURING_SIMULATION" &&
      (provenance.capabilities.call.status === "SUCCEEDED" ||
        provenance.capabilities.gasEstimate.status === "AVAILABLE")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateRevision"],
        message:
          "A changed state revision invalidates successful call and gas evidence",
      });
    }

    if (
      provenance.transactionBinding.chainId !== provenance.sourceChainId ||
      provenance.transactionBinding.amountInAtomic !==
        provenance.quote.amountInAtomic ||
      provenance.transactionBinding.tokenOut.toLowerCase() !==
        provenance.quote.tokenPath[1].toLowerCase() ||
      provenance.transactionBinding.router.toLowerCase() !==
        provenance.transactionBinding.to.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionBinding"],
        message: "Transaction binding must match the source quote and route",
      });
    }

    if (
      provenance.capabilities.amountReceived.status === "AVAILABLE" &&
      (provenance.capabilities.call.status !== "SUCCEEDED" ||
        provenance.stateRevision.status !== "AVAILABLE")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities", "amountReceived"],
        message:
          "Recipient output requires a successful call and qualified state revision",
      });
    }

    const reconciliation = provenance.quoteReconciliation;
    if (
      reconciliation.status === "UNAVAILABLE" &&
      provenance.capabilities.amountReceived.status !== "UNAVAILABLE"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteReconciliation"],
        message:
          "Unavailable reconciliation requires unavailable output evidence",
      });
    }
    if (
      reconciliation.status !== "UNAVAILABLE" &&
      (provenance.capabilities.amountReceived.status !== "AVAILABLE" ||
        reconciliation.simulatedAmountReceivedAtomic !==
          provenance.capabilities.amountReceived.amountReceivedAtomic ||
        reconciliation.quoteAmountOutAtomic !==
          provenance.quote.amountOutAtomic)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteReconciliation"],
        message: "Reconciliation must compare the recorded quote and output",
      });
    }
  });

export type ProviderNeutralSimulationProvenance = z.infer<
  typeof providerNeutralSimulationProvenanceSchema
>;

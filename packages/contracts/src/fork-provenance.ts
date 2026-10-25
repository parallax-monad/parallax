import { z } from "zod";
import { addressSchema, uint256AmountSchema } from "./common.js";
import { p0BasicSimulationTransactionBindingSchema } from "./p0-run-result.js";

const decimalBlockNumberSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const forkInstanceIdSchema = z
  .string()
  .uuid()
  .refine((value) => value[14]?.toLowerCase() === "4", {
    message: "Fork instance identity must be a UUID v4",
  });

export const arbitrumOneForkStateRevisionSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("AVAILABLE"),
        method: z.literal("ANVIL_DUMP_STATE"),
        fingerprint: fingerprintSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("UNKNOWN"),
        reason: z.literal("NO_QUALIFIED_ANVIL_STATE_REVISION_TOKEN"),
      })
      .strict(),
  ],
);

const forkSimulationCallSchema = z
  .object({
    status: z.enum(["SUCCEEDED", "REVERTED", "UNAVAILABLE", "NOT_RUN"]),
    returnDataFingerprint: fingerprintSchema.optional(),
    failureReason: z
      .enum([
        "EVM_REVERT",
        "RPC_TIMEOUT",
        "RPC_UNAVAILABLE",
        "MALFORMED_RESPONSE",
        "INSUFFICIENT_NATIVE_BALANCE",
      ])
      .optional(),
  })
  .strict()
  .superRefine((call, context) => {
    if (
      call.status === "SUCCEEDED" &&
      call.returnDataFingerprint === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnDataFingerprint"],
        message: "A successful call requires a return-data fingerprint",
      });
    }
    if (
      (call.status === "UNAVAILABLE" || call.status === "REVERTED") !==
      (call.failureReason !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message:
          "Only reverted or unavailable calls may include a failure reason",
      });
    }
  });

const forkGasEstimateSchema = z
  .object({
    status: z.enum(["AVAILABLE", "UNAVAILABLE", "NOT_RUN"]),
    gasUnits: uint256AmountSchema.optional(),
    failureReason: z
      .enum([
        "EVM_REVERT",
        "RPC_TIMEOUT",
        "RPC_UNAVAILABLE",
        "MALFORMED_RESPONSE",
        "INSUFFICIENT_NATIVE_BALANCE",
      ])
      .optional(),
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
        message:
          "Unavailable gas estimates require a normalized failure reason",
      });
    }
  });

export const forkAmountReceivedSchema = z.discriminatedUnion("status", [
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

const availableArbitrumOneForkProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("AVAILABLE"),
    source: z
      .object({
        chainId: z.literal(42161),
        blockNumber: decimalBlockNumberSchema,
        blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        observedAt: z.string().datetime(),
      })
      .strict(),
    localExecution: z
      .object({
        chainId: z.literal(31337),
        baseBlockNumber: decimalBlockNumberSchema,
        baseBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        observedHeadNumber: decimalBlockNumberSchema,
        forkInstanceId: forkInstanceIdSchema,
        anvilVersion: z.string().trim().min(1),
        stateRevision: arbitrumOneForkStateRevisionSchema,
      })
      .strict(),
    transaction: z
      .object({
        preparedTransactionFingerprint: fingerprintSchema,
        binding: p0BasicSimulationTransactionBindingSchema,
      })
      .strict(),
    simulation: z
      .object({
        observedAt: z.string().datetime(),
        call: forkSimulationCallSchema,
        gasEstimate: forkGasEstimateSchema,
        amountReceived: forkAmountReceivedSchema,
      })
      .strict(),
    accountOverride: z
      .object({
        address: addressSchema,
        nativeBalanceAtomic: uint256AmountSchema,
        snapshotRestored: z.literal(true),
      })
      .strict(),
    safety: z
      .object({
        upstreamWritesAllowed: z.literal(false),
        signingOrBroadcastingPerformed: z.literal(false),
        transactionSubmissionPerformed: z.literal(false),
        localTransactionsMined: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (
      provenance.localExecution.baseBlockNumber !==
        provenance.source.blockNumber ||
      provenance.localExecution.observedHeadNumber !==
        provenance.localExecution.baseBlockNumber
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localExecution", "baseBlockNumber"],
        message: "Fork execution must remain at its pinned source block",
      });
    }
    if (
      provenance.localExecution.baseBlockHash.toLowerCase() !==
      provenance.source.blockHash.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localExecution", "baseBlockHash"],
        message: "Fork base block hash must match the source block",
      });
    }
    if (
      provenance.transaction.binding.chainId !== 42161 ||
      provenance.transaction.binding.protocol !== "camelot-v3" ||
      provenance.transaction.binding.from.toLowerCase() !==
        provenance.transaction.binding.sender.toLowerCase() ||
      provenance.transaction.binding.sender.toLowerCase() !==
        provenance.accountOverride.address.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transaction", "binding"],
        message:
          "Fork transaction binding must match the One execution identity",
      });
    }
    if (
      provenance.simulation.amountReceived.status === "AVAILABLE" &&
      provenance.localExecution.stateRevision.status !== "AVAILABLE"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulation", "amountReceived"],
        message: "Recipient output requires a qualified local state revision",
      });
    }
    if (
      provenance.simulation.amountReceived.status === "AVAILABLE" &&
      provenance.simulation.call.status !== "SUCCEEDED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulation", "amountReceived"],
        message: "Recipient output requires a successful local call",
      });
    }
  });

export const unknownArbitrumOneForkProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("UNKNOWN"),
    reason: z.literal("NOT_RECORDED"),
  })
  .strict();

/**
 * Optional, versioned Run-level execution provenance for the local Arbitrum One
 * fork Check. The UNKNOWN variant is used only when reading legacy Runs that
 * predate persisted fork provenance; it is never reconstructed from RPC data.
 */
export const arbitrumOneForkProvenanceSchema = z.union([
  availableArbitrumOneForkProvenanceSchema,
  unknownArbitrumOneForkProvenanceSchema,
]);

export type ArbitrumOneForkProvenance = z.infer<
  typeof arbitrumOneForkProvenanceSchema
>;
export type AvailableArbitrumOneForkProvenance = z.infer<
  typeof availableArbitrumOneForkProvenanceSchema
>;

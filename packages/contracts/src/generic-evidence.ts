import { z } from "zod";
import { chainIdSchema, protocolSchema } from "./common.js";
import {
  evidenceReproducibilitySchema,
  evidenceSourceSchema,
} from "./evidence.js";

/**
 * Generic Evidence compatibility contract (Swap + Decision loop minimum).
 *
 * This is the provider-agnostic Evidence domain boundary of Parallax Core.
 * Providers (e.g. MossProvider) map their normalized output into this shape;
 * Risk and Orchestrator consume only this shape. Provider raw types must not
 * leak through this boundary.
 *
 * The schema is deliberately consumer-driven: every field below is read by
 * the current Risk rules or the Orchestrator RunResult projection. Provider
 * specific metadata is preserved verbatim in `providerData` instead of being
 * flattened into new typed fields.
 */

/** Coarse provider-agnostic evaluation status. */
export const genericEvidenceStatusSchema = z.enum([
  "SUCCESS",
  "UNKNOWN",
  "UNSUPPORTED",
  "FAILED",
  "STALE",
]);

/** Health of the provider integration itself (distinct from the protocol outcome). */
export const genericProviderStatusSchema = z.enum([
  "OK",
  "INTEGRATION_ERROR",
  "UNAVAILABLE",
  "TIMEOUT",
  "UNSUPPORTED",
]);

/** Protocol execution outcome. NO_ROUTE is a legal terminal result. */
export const genericExecutionStatusSchema = z.enum([
  "SUCCESS",
  "NO_ROUTE",
  "REVERTED",
  "UNKNOWN",
]);

export const genericBoundarySourceSchema = z.enum([
  "original_swap",
  "user_declared",
  "demo_preset",
  "unavailable",
]);

export const genericAssetChangeAssessmentSchema = z.enum([
  "EXPLAINED",
  "UNEXPLAINED",
  "UNKNOWN",
  "NOT_APPLICABLE",
]);

export const genericProviderStageSchema = z.enum([
  "DISCOVER",
  "LOAD",
  "QUOTE",
  "ACTION",
  "SIMULATE",
]);

export const genericProviderErrorCodeSchema = z.enum([
  "NO_ROUTE",
  "REVERTED",
  "TIMEOUT",
  "UNAVAILABLE",
  "INTEGRATION_ERROR",
  "UNKNOWN",
]);

/**
 * A normalized provider error. NO_ROUTE errors are legal terminal
 * classifications (integrationStatus OK) and must never be treated as
 * provider failures.
 */
export const genericProviderErrorSchema = z
  .object({
    stage: genericProviderStageSchema.optional(),
    code: genericProviderErrorCodeSchema,
    message: z.string().trim().min(1),
    integrationStatus: z.enum([
      "OK",
      "INTEGRATION_ERROR",
      "UNAVAILABLE",
      "TIMEOUT",
    ]),
    source: z.enum(["moss", "rpc", "quote", "unknown"]),
    normalization: z.enum(["PRESERVED", "DERIVED"]),
    retryable: z.boolean().optional(),
  })
  .strict();

/** The classified failure of the provider evaluation, when it failed. */
export const genericProviderFailureSchema = genericProviderErrorSchema;

/**
 * The intent as the provider actually evaluated it. Amounts are human-readable
 * decimals (the provider builds its own execution context); asset keys are
 * "native" or an ERC-20 address.
 */
export const genericSwapIntentSchema = z
  .object({
    chainId: chainIdSchema,
    protocol: protocolSchema,
    sender: z.string().trim().min(1),
    tokenIn: z.string().trim().min(1),
    tokenOut: z.string().trim().min(1),
    amountIn: z.string().trim().min(1),
    minimumReceived: z.string().trim().min(1).optional(),
    minimumReceivedSource: genericBoundarySourceSchema,
  })
  .strict();

/** Swap quote output read by Risk's economic boundary and the Quote projection. */
export const genericQuoteOutputSchema = z
  .object({
    estimatedAmountOut: z.string().trim().min(1),
    minimumAmountOut: z.string().trim().min(1).optional(),
  })
  .strict();

/** Simulation coverage summary read by the completeness rule. */
export const genericSimulationCoverageSchema = z
  .object({
    expectedTransactions: z.number().int().nonnegative(),
    observedResults: z.number().int().nonnegative(),
    unmatchedResultIndexes: z.array(z.number().int().nonnegative()),
    halted: z.boolean(),
    complete: z.boolean(),
    missingTransactionIndexes: z.array(z.number().int().nonnegative()),
    haltReason: z.string().optional(),
  })
  .strict();

/** JSON payload values carried by evidence fields (Moss normalized JSON). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const evidenceFieldBaseShape = {
  source: evidenceSourceSchema,
  reproducibility: evidenceReproducibilitySchema,
  blockNumber: z.string().regex(/^\d+$/).optional(),
  fetchedAt: z.string().datetime().optional(),
  formula: z.string().trim().min(1).optional(),
  limitation: z.string().trim().min(1).optional(),
};

/**
 * One evidence field with its provenance. `value` is the provider payload;
 * `source`, `reproducibility`, `blockNumber` and `fetchedAt` keep the
 * truthfulness boundary intact (mock/unknown sources and non-reproducible
 * fields never count as checked).
 */
export type EvidenceField<T> = {
  value: T | null;
  source: z.infer<typeof evidenceSourceSchema>;
  reproducibility: z.infer<typeof evidenceReproducibilitySchema>;
  blockNumber?: string;
  fetchedAt?: string;
  formula?: string;
  limitation?: string;
};

export const quoteEvidenceFieldSchema = z
  .object({
    value: genericQuoteOutputSchema.nullable(),
    ...evidenceFieldBaseShape,
  })
  .strict();

export const jsonArrayEvidenceFieldSchema = z
  .object({
    value: z.array(jsonValueSchema).nullable(),
    ...evidenceFieldBaseShape,
  })
  .strict();

export const jsonEvidenceFieldSchema = z
  .object({
    value: jsonValueSchema.nullable(),
    ...evidenceFieldBaseShape,
  })
  .strict();

export const simulationEvidenceFieldSchema = z
  .object({
    value: genericSimulationCoverageSchema.nullable(),
    ...evidenceFieldBaseShape,
  })
  .strict();

export const stringEvidenceFieldSchema = z
  .object({
    value: z.string().nullable(),
    ...evidenceFieldBaseShape,
  })
  .strict();

export const providerErrorsEvidenceFieldSchema = z
  .object({
    value: z.array(genericProviderErrorSchema).nullable(),
    ...evidenceFieldBaseShape,
  })
  .strict();

/**
 * Generic provenance. `runtimeVersion` / `runtimeRevision` identify the
 * immutable provider runtime; `commit` is the provider baseline commit of the
 * evidence (Moss records its checkout revision there). Provider-specific
 * extras (package versions, checkout identity) stay in `providerData`.
 */
export const genericEvidenceProvenanceSchema = z
  .object({
    runtimeVersion: z.string().trim().min(1).optional(),
    runtimeRevision: z.string().trim().min(1).optional(),
    checkoutRevision: z.string().trim().min(1).optional(),
    commit: z.string().trim().min(1).optional(),
    replayMode: z.boolean(),
    isReplay: z.boolean(),
    isMock: z.boolean(),
    source: evidenceSourceSchema,
    observedChainId: chainIdSchema.optional(),
    simulatorPinnedBlock: z.string().regex(/^\d+$/).optional(),
    fetchedAt: z.string().datetime().optional(),
  })
  .strict();

const genericEvidenceObjectSchema = z
  .object({
    status: genericEvidenceStatusSchema,
    intent: genericSwapIntentSchema,
    provider: z
      .object({
        providerId: z.string().trim().min(1),
        status: genericProviderStatusSchema,
        failure: genericProviderFailureSchema.optional(),
        errors: providerErrorsEvidenceFieldSchema,
      })
      .strict(),
    execution: z
      .object({
        status: genericExecutionStatusSchema,
      })
      .strict(),
    quote: quoteEvidenceFieldSchema,
    action: jsonArrayEvidenceFieldSchema,
    receipt: jsonEvidenceFieldSchema,
    outcome: jsonEvidenceFieldSchema,
    assetChanges: jsonArrayEvidenceFieldSchema,
    assetChangeAssessment: genericAssetChangeAssessmentSchema,
    warnings: jsonArrayEvidenceFieldSchema,
    simulation: simulationEvidenceFieldSchema,
    blockNumber: stringEvidenceFieldSchema,
    /** Provider-declared capability tokens (e.g. "quote", "action", "simulate"). */
    capabilities: z.array(z.string().trim().min(1)),
    provenance: genericEvidenceProvenanceSchema,
    /** Stages the provider actually checked; the decision Scope stays in RunResult. */
    checkedScope: z.array(z.string().trim().min(1)),
    unknownScope: z.array(z.string().trim().min(1)),
    /** Provider-specific metadata, preserved verbatim and never flattened. */
    providerData: z.record(z.string(), jsonValueSchema),
  })
  .strict();

function validateMockProvenance(
  evidence: z.infer<typeof genericEvidenceObjectSchema>,
  context: z.RefinementCtx,
) {
  if ((evidence.provenance.source === "mock") !== evidence.provenance.isMock) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Mock Evidence must use source=mock and isMock=true together",
      path: ["provenance", "isMock"],
    });
  }
}

function validateFailureStatus(
  evidence: z.infer<typeof genericEvidenceObjectSchema>,
  context: z.RefinementCtx,
) {
  if (
    evidence.provider.failure !== undefined &&
    evidence.provider.status === "OK"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A classified Provider failure requires a non-OK Provider status",
      path: ["provider", "status"],
    });
  }
}

export const genericEvidenceSchema = genericEvidenceObjectSchema
  .superRefine(validateMockProvenance)
  .superRefine(validateFailureStatus);

export type GenericEvidenceStatus = z.infer<typeof genericEvidenceStatusSchema>;
export type GenericProviderStatus = z.infer<typeof genericProviderStatusSchema>;
export type GenericExecutionStatus = z.infer<
  typeof genericExecutionStatusSchema
>;
export type GenericBoundarySource = z.infer<typeof genericBoundarySourceSchema>;
export type GenericAssetChangeAssessment = z.infer<
  typeof genericAssetChangeAssessmentSchema
>;
export type GenericProviderStage = z.infer<typeof genericProviderStageSchema>;
export type GenericProviderErrorCode = z.infer<
  typeof genericProviderErrorCodeSchema
>;
export type GenericProviderError = z.infer<typeof genericProviderErrorSchema>;
export type GenericProviderFailure = z.infer<
  typeof genericProviderFailureSchema
>;
export type GenericSwapIntent = z.infer<typeof genericSwapIntentSchema>;
export type GenericQuoteOutput = z.infer<typeof genericQuoteOutputSchema>;
export type GenericSimulationCoverage = z.infer<
  typeof genericSimulationCoverageSchema
>;
export type GenericEvidenceProvenance = z.infer<
  typeof genericEvidenceProvenanceSchema
>;
export type GenericEvidence = z.infer<typeof genericEvidenceSchema>;

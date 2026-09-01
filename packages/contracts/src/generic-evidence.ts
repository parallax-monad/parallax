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
 * Three independent status axes are kept separate and must never be merged:
 *   1. provider.status  — provider evaluation status (SUCCESS/UNKNOWN/
 *                         UNSUPPORTED/FAILED/STALE)
 *   2. execution.status — protocol execution outcome (SUCCESS/NO_ROUTE/
 *                         REVERTED/UNKNOWN)
 *   3. Risk verdict     — PROCEED/ADJUST/STOP/UNKNOWN, produced by the Risk
 *                         rules from the evidence, never stored on it
 * A verified REVERTED execution is provider.status=SUCCESS with
 * execution.status=REVERTED while Risk still returns UNKNOWN; a broken
 * integration is provider.status=FAILED. NO_ROUTE stays a legal terminal
 * outcome that never requires a simulation block.
 *
 * The schema is deliberately consumer-driven: every field below is read by
 * the current Risk rules or the Orchestrator RunResult projection. Provider
 * specific metadata is preserved verbatim in `providerData` (and the
 * provider-specific `provenance.runtime` block) instead of being flattened
 * into new typed fields, and must never become a decision dependency.
 */

/**
 * Provider evaluation status — how the provider's evaluation of this evidence
 * request went, independent of the protocol outcome and of the Risk verdict.
 *
 *   SUCCESS       Provider completed the requested evidence evaluation.
 *   UNKNOWN       Provider could not determine the required result (e.g.
 *                 insufficient evidence or capability).
 *   UNSUPPORTED   Provider explicitly does not support this chain /
 *                 transaction / capability.
 *   FAILED        Provider / RPC / integration invocation failed.
 *   STALE         Evidence exists but violates the provider freshness policy.
 */
export const genericProviderStatusSchema = z.enum([
  "SUCCESS",
  "UNKNOWN",
  "UNSUPPORTED",
  "FAILED",
  "STALE",
]);

/**
 * Legacy provider-integration health status. This is the historical
 * `integrationStatus` vocabulary and must stay a separate axis from the
 * provider evaluation status: a verified REVERTED execution is
 * `status=SUCCESS` with `execution.status=REVERTED`, while a broken
 * integration is `status=FAILED` with `integrationStatus=INTEGRATION_ERROR`.
 */
export const genericIntegrationStatusSchema = z.enum([
  "OK",
  "INTEGRATION_ERROR",
  "UNAVAILABLE",
  "TIMEOUT",
]);

/** Protocol execution outcome, independent of provider status and Risk verdict. */
export const genericExecutionStatusSchema = z.enum([
  "SUCCESS",
  "NO_ROUTE",
  "REVERTED",
  "UNKNOWN",
]);

/**
 * Normalized evidence truthfulness mode. Replay/Mock truthfulness must stay
 * fail-closed: recorded evidence is never presented as live, mock evidence is
 * never presented as recorded or live.
 */
export const genericEvidenceModeSchema = z.enum([
  "LIVE",
  "RECORDED_REPLAY",
  "MOCK",
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
 * Provider-specific runtime provenance, owned by the provider that fills it.
 * Moss records its immutable runtime identity and evidence baseline commit
 * here; the generic contract does not require future providers to understand
 * any of it.
 */
export const genericRuntimeProvenanceSchema = z
  .object({
    runtimeVersion: z.string().trim().min(1).optional(),
    runtimeRevision: z.string().trim().min(1).optional(),
    checkoutRevision: z.string().trim().min(1).optional(),
    commit: z.string().trim().min(1).optional(),
    packageVersions: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/**
 * Generic provenance — only fields meaningful across providers.
 *
 * `mode` and `source` carry the evidence truthfulness axis; `observedChainId`,
 * `fetchedAt` and `simulationBlock` are acquisition facts. Moss runtime
 * identity (runtimeVersion/runtimeRevision/checkoutRevision/commit/
 * packageVersions) is provider-specific and lives in the optional `runtime`
 * block, which future providers simply omit. Provider-specific extras stay in
 * `providerData` and must never be inspected by Risk or the canonical
 * decision path.
 */
export const genericEvidenceProvenanceSchema = z
  .object({
    observedChainId: chainIdSchema.optional(),
    fetchedAt: z.string().datetime().optional(),
    mode: genericEvidenceModeSchema,
    source: evidenceSourceSchema,
    /** Provider-agnostic simulation base block (Moss: simulatorPinnedBlock). */
    simulationBlock: z.string().regex(/^\d+$/).optional(),
    /** Provider-specific runtime identity (Moss fills it; others omit it). */
    runtime: genericRuntimeProvenanceSchema.optional(),
  })
  .strict();

const genericEvidenceObjectSchema = z
  .object({
    intent: genericSwapIntentSchema,
    provider: z
      .object({
        providerId: z.string().trim().min(1),
        status: genericProviderStatusSchema,
        integrationStatus: genericIntegrationStatusSchema,
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
  if (
    (evidence.provenance.source === "mock") !==
    (evidence.provenance.mode === "MOCK")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Mock Evidence must use source=mock and mode=MOCK together",
      path: ["provenance", "mode"],
    });
  }
}

function validateFailureStatus(
  evidence: z.infer<typeof genericEvidenceObjectSchema>,
  context: z.RefinementCtx,
) {
  if (
    evidence.provider.failure !== undefined &&
    evidence.provider.status !== "FAILED"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A classified Provider failure requires provider.status=FAILED",
      path: ["provider", "status"],
    });
  }
}

export const genericEvidenceSchema = genericEvidenceObjectSchema
  .superRefine(validateMockProvenance)
  .superRefine(validateFailureStatus);

export type GenericProviderStatus = z.infer<typeof genericProviderStatusSchema>;
export type GenericIntegrationStatus = z.infer<
  typeof genericIntegrationStatusSchema
>;
export type GenericExecutionStatus = z.infer<
  typeof genericExecutionStatusSchema
>;
export type GenericEvidenceMode = z.infer<typeof genericEvidenceModeSchema>;
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
export type GenericRuntimeProvenance = z.infer<
  typeof genericRuntimeProvenanceSchema
>;
export type GenericEvidenceProvenance = z.infer<
  typeof genericEvidenceProvenanceSchema
>;
export type GenericEvidence = z.infer<typeof genericEvidenceSchema>;

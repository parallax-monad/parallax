import { z } from "zod";
import {
  addressSchema,
  assetReferenceSchema,
  atomicAmountSchema,
  chainIdSchema,
  protocolSchema,
  transactionAdjustmentFieldSchema,
  uint256AmountSchema,
} from "./common.js";

export const evidenceSourceSchema = z.enum([
  "moss",
  "rpc",
  "quote",
  "external",
  "derived",
  "mock",
  "unknown",
]);

export const evidenceStageSchema = z.enum([
  "DISCOVER",
  "LOAD",
  "QUOTE",
  "ACTION",
  "SIMULATE",
]);

const evidenceProvenanceShape = {
  key: z.string().trim().min(1),
  blockNumber: z.string().regex(/^\d+$/).optional(),
  runtimeVersion: z.string().trim().min(1).optional(),
  runtimeRevision: z.string().trim().min(1).optional(),
  fixtureId: z.string().trim().min(1).optional(),
  isReplay: z.boolean(),
  isMock: z.boolean(),
};

function validateMockProvenance(
  evidence: { source: z.infer<typeof evidenceSourceSchema>; isMock: boolean },
  context: z.RefinementCtx,
) {
  if ((evidence.source === "mock") !== evidence.isMock) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Mock Evidence must use source=mock and isMock=true together",
      path: ["isMock"],
    });
  }
}

export const evidenceRefSchema = z
  .object({
    ...evidenceProvenanceShape,
    source: evidenceSourceSchema,
    stage: evidenceStageSchema.optional(),
  })
  .strict()
  .superRefine(validateMockProvenance);

export const evidenceStatusSchema = z.enum([
  "confirmed",
  "warning",
  "failed",
  "unknown",
  "not_applicable",
]);

const genericEvidenceItemObjectSchema = z
  .object({
    ...evidenceProvenanceShape,
    kind: z.literal("generic"),
    status: evidenceStatusSchema,
    summary: z.string().trim().min(1),
    source: evidenceSourceSchema,
    stage: evidenceStageSchema.optional(),
  })
  .strict();

export const genericEvidenceItemSchema =
  genericEvidenceItemObjectSchema.superRefine(validateMockProvenance);

const simulatedTokenOutEvidenceObjectSchema = z
  .object({
    ...evidenceProvenanceShape,
    kind: z.literal("simulated_token_out"),
    status: z.literal("confirmed"),
    summary: z.string().trim().min(1),
    source: z.enum(["moss", "derived"]),
    stage: z.literal("SIMULATE"),
    tokenOut: assetReferenceSchema,
    recipient: addressSchema,
    amountReceivedAtomic: uint256AmountSchema,
    derivation: z.enum(["recipient_balance_delta", "asset_change"]),
  })
  .strict();

const noRouteClassificationEvidenceObjectSchema = z
  .object({
    ...evidenceProvenanceShape,
    kind: z.literal("no_route_classification"),
    status: z.literal("confirmed"),
    summary: z.string().trim().min(1),
    source: z.literal("derived"),
    stage: z.enum(["QUOTE", "ACTION"]),
    protocol: protocolSchema,
    chainId: chainIdSchema,
    sender: addressSchema,
    recipient: addressSchema,
    tokenIn: assetReferenceSchema,
    tokenOut: assetReferenceSchema,
    amountInAtomic: atomicAmountSchema,
    rawEvidenceKey: z.string().trim().min(1),
    normalizedCode: z.literal("NO_ROUTE"),
    integrationStatus: z.literal("OK"),
  })
  .strict();

const noRouteRawEvidenceObjectSchema = z
  .object({
    ...evidenceProvenanceShape,
    kind: z.literal("no_route_raw_output"),
    status: z.literal("confirmed"),
    summary: z.string().trim().min(1),
    source: z.enum(["moss", "quote"]),
    stage: z.enum(["QUOTE", "ACTION"]),
    payloadFingerprint: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/, "Expected a SHA-256 payload fingerprint"),
  })
  .strict();

const actionVerificationEvidenceObjectSchema = z
  .object({
    ...evidenceProvenanceShape,
    kind: z.literal("action_verification"),
    status: z.literal("confirmed"),
    summary: z.string().trim().min(1),
    source: z.literal("derived"),
    stage: z.enum(["QUOTE", "ACTION", "SIMULATE"]),
    field: transactionAdjustmentFieldSchema,
    actionReasonCode: z.enum([
      "ALTERNATIVE_PATH_VERIFIED",
      "OUTPUT_IMPROVEMENT_VERIFIED",
    ]),
    baselineRunId: z.string().trim().min(1),
    verificationRunId: z.string().trim().min(1),
    beforeValue: z.string().trim().min(1),
    afterValue: z.string().trim().min(1),
    resultEvidenceKey: z.string().trim().min(1),
    baselineBoundaryAtomic: atomicAmountSchema.optional(),
    verificationBoundaryAtomic: atomicAmountSchema.optional(),
  })
  .strict();

function validateSimulatedTokenOutProvenance(
  evidence: z.infer<typeof simulatedTokenOutEvidenceObjectSchema>,
  context: z.RefinementCtx,
) {
  validateMockProvenance(evidence, context);

  if (evidence.isMock) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Simulated tokenOut Evidence cannot be mock Evidence",
      path: ["isMock"],
    });
  }
}

function validateGateEvidenceProvenance(
  evidence:
    | z.infer<typeof noRouteClassificationEvidenceObjectSchema>
    | z.infer<typeof noRouteRawEvidenceObjectSchema>
    | z.infer<typeof actionVerificationEvidenceObjectSchema>,
  context: z.RefinementCtx,
) {
  validateMockProvenance(evidence, context);

  if (
    evidence.runtimeVersion === undefined &&
    evidence.runtimeRevision === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Gate Evidence requires a Runtime Version or Revision",
      path: ["runtimeVersion"],
    });
  }

  if (evidence.isReplay && evidence.fixtureId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Replay Gate Evidence requires a Fixture ID",
      path: ["fixtureId"],
    });
  }

  if (
    evidence.kind === "no_route_raw_output" &&
    evidence.stage === "ACTION" &&
    evidence.source === "quote"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ACTION-stage raw Evidence must come from Moss",
      path: ["source"],
    });
  }

  if (
    evidence.kind === "action_verification" &&
    evidence.baselineRunId === evidence.verificationRunId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action verification requires distinct before and after Runs",
      path: ["verificationRunId"],
    });
  }

  if (
    evidence.kind === "action_verification" &&
    evidence.beforeValue === evidence.afterValue
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action verification requires a real parameter change",
      path: ["afterValue"],
    });
  }

  if (
    evidence.kind === "action_verification" &&
    evidence.resultEvidenceKey === evidence.key
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Action verification must reference a separate result Evidence item",
      path: ["resultEvidenceKey"],
    });
  }

  if (
    evidence.kind === "action_verification" &&
    evidence.actionReasonCode === "OUTPUT_IMPROVEMENT_VERIFIED" &&
    (evidence.baselineBoundaryAtomic === undefined ||
      evidence.verificationBoundaryAtomic === undefined ||
      evidence.baselineBoundaryAtomic !== evidence.verificationBoundaryAtomic)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Output improvement verification must preserve the original boundary",
      path: ["verificationBoundaryAtomic"],
    });
  }
}

export const simulatedTokenOutEvidenceSchema =
  simulatedTokenOutEvidenceObjectSchema.superRefine(
    validateSimulatedTokenOutProvenance,
  );

export const noRouteClassificationEvidenceSchema =
  noRouteClassificationEvidenceObjectSchema.superRefine(
    validateGateEvidenceProvenance,
  );

export const noRouteRawEvidenceSchema =
  noRouteRawEvidenceObjectSchema.superRefine(validateGateEvidenceProvenance);

export const actionVerificationEvidenceSchema =
  actionVerificationEvidenceObjectSchema.superRefine(
    validateGateEvidenceProvenance,
  );

export const evidenceItemSchema = z
  .discriminatedUnion("kind", [
    genericEvidenceItemObjectSchema,
    simulatedTokenOutEvidenceObjectSchema,
    noRouteClassificationEvidenceObjectSchema,
    noRouteRawEvidenceObjectSchema,
    actionVerificationEvidenceObjectSchema,
  ])
  .superRefine((evidence, context) => {
    if (evidence.kind === "simulated_token_out") {
      validateSimulatedTokenOutProvenance(evidence, context);
    } else if (
      evidence.kind === "no_route_classification" ||
      evidence.kind === "no_route_raw_output" ||
      evidence.kind === "action_verification"
    ) {
      validateGateEvidenceProvenance(evidence, context);
    } else {
      validateMockProvenance(evidence, context);
    }
  });

export const scopeStatusSchema = z.enum(["checked", "not_checked", "unknown"]);

export const scopeSubjectSchema = z.enum([
  "P0-EVIDENCE-001",
  "P0-EXECUTION-001",
  "P0-ECONOMIC-001",
  "P0-CHECK-ACTION-001",
  "P0-CHECK-SIMULATION-001",
  "P0-CHECK-SIMULATION-COVERAGE-001",
  "OUTSIDE_P0_SCOPE",
]);

export const scopeReasonSchema = z.enum([
  "REQUIRED_CHECK_INTERRUPTED",
  "REQUIRED_EVIDENCE_UNAVAILABLE",
  "CLASSIFICATION_INCOMPLETE",
  "PRECONDITION_ABSENT",
  "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
  "OUTSIDE_P0_SCOPE",
]);

export const scopeItemSchema = z
  .object({
    key: scopeSubjectSchema,
    label: z.string().trim().min(1),
    status: scopeStatusSchema,
    reason: scopeReasonSchema.optional(),
    note: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((item, context) => {
    const unknownReasons = new Set([
      "REQUIRED_CHECK_INTERRUPTED",
      "REQUIRED_EVIDENCE_UNAVAILABLE",
      "CLASSIFICATION_INCOMPLETE",
    ]);
    const notCheckedReasons = new Set([
      "PRECONDITION_ABSENT",
      "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
      "OUTSIDE_P0_SCOPE",
    ]);

    if (item.status === "checked" && item.reason !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Checked Scope items do not carry a non-checked reason",
        path: ["reason"],
      });
    }

    if (
      item.status === "unknown" &&
      (item.reason === undefined || !unknownReasons.has(item.reason))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unknown Scope items require an unknown reason",
        path: ["reason"],
      });
    }

    if (
      item.status === "not_checked" &&
      (item.reason === undefined || !notCheckedReasons.has(item.reason))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Not-checked Scope items require a not-checked reason",
        path: ["reason"],
      });
    }
  });

export const scopeDisclosureSchema = z
  .array(scopeItemSchema)
  .min(1)
  .superRefine((items, context) => {
    const keys = new Set<string>();

    items.forEach((item, index) => {
      if (keys.has(item.key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Scope item keys must be unique",
          path: [index, "key"],
        });
      }

      keys.add(item.key);
    });
  });

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type EvidenceStage = z.infer<typeof evidenceStageSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type GenericEvidenceItem = z.infer<typeof genericEvidenceItemSchema>;
export type SimulatedTokenOutEvidence = z.infer<
  typeof simulatedTokenOutEvidenceSchema
>;
export type NoRouteClassificationEvidence = z.infer<
  typeof noRouteClassificationEvidenceSchema
>;
export type NoRouteRawEvidence = z.infer<typeof noRouteRawEvidenceSchema>;
export type ActionVerificationEvidence = z.infer<
  typeof actionVerificationEvidenceSchema
>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ScopeStatus = z.infer<typeof scopeStatusSchema>;
export type ScopeSubject = z.infer<typeof scopeSubjectSchema>;
export type ScopeReason = z.infer<typeof scopeReasonSchema>;
export type ScopeItem = z.infer<typeof scopeItemSchema>;
export type ScopeDisclosure = z.infer<typeof scopeDisclosureSchema>;

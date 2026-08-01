import { z } from "zod";
import { transactionAdjustmentFieldSchema } from "./common.js";
import { evidenceRefSchema } from "./evidence.js";

export const verdictSchema = z.enum(["PROCEED", "ADJUST", "STOP", "UNKNOWN"]);

export const ruleStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "UNKNOWN",
  "NOT_APPLICABLE",
]);

export const p0RuleIdSchema = z.enum([
  "P0-EVIDENCE-001",
  "P0-EXECUTION-001",
  "P0-ECONOMIC-001",
]);

export const p0ReasonCodeSchema = z.enum([
  "SIMULATION_COVERAGE_MISSING",
  "SIMULATION_HALTED",
  "CRITICAL_EVIDENCE_MISSING",
  "UNCLASSIFIED_WARNING",
  "UNEXPLAINED_ASSET_CHANGE",
  "EVIDENCE_SOURCE_UNKNOWN",
  "EVIDENCE_NOT_REPRODUCIBLE",
  "NO_ROUTE_FOUND",
  "SIMULATED_OUTPUT_UNAVAILABLE",
  "OUTPUT_BELOW_BOUNDARY",
  "OUTPUT_SOURCE_CONFLICT",
  "RULE_CLASSIFICATION_NOT_VERIFIED",
]);

export const p0ActionReasonCodeSchema = z.enum([
  "ALTERNATIVE_PATH_VERIFIED",
  "OUTPUT_IMPROVEMENT_VERIFIED",
  "CANNOT_CREATE_MISSING_ROUTE",
  "CHANGES_ACCEPTANCE_BOUNDARY_ONLY",
  "EFFECT_NOT_VERIFIED",
  "RESTORES_CHECK_ONLY",
]);

export const p0ApplicabilityReasonCodeSchema = z.enum([
  "BOUNDARY_NOT_PROVIDED",
  "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT",
]);

export const nextActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("TRANSACTION_ADJUSTMENT"),
      field: transactionAdjustmentFieldSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ACCEPTANCE_BOUNDARY_CHANGE"),
      field: z.literal("minimumReceived"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SYSTEM_RECOVERY"),
      action: z.enum(["RETRY_CHECK", "VIEW_MISSING_EVIDENCE", "USE_REPLAY"]),
    })
    .strict(),
]);

// A concrete change is required only when a transaction adjustment is made
// public. The value remains a serialized normalized-Intent field so this
// contract does not invent protocol-specific parameter shapes.
export const proposedIntentChangeSchema = z
  .object({
    field: transactionAdjustmentFieldSchema,
    before: z.string().trim().min(1),
    after: z.string().trim().min(1),
  })
  .strict()
  .refine((change) => change.before !== change.after, {
    message: "A proposed Intent change must change the field value",
    path: ["after"],
  });

function addUniqueEvidenceRefIssues(
  references: Array<z.infer<typeof evidenceRefSchema>>,
  context: z.RefinementCtx,
) {
  const keys = new Set<string>();

  references.forEach((reference, index) => {
    if (keys.has(reference.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence references must be unique by key",
        path: [index, "key"],
      });
    }

    keys.add(reference.key);
  });
}

const evidenceRefListSchema = z
  .array(evidenceRefSchema)
  .superRefine(addUniqueEvidenceRefIssues);

export const actionEvaluationSchema = z
  .object({
    id: z.string().trim().min(1),
    action: nextActionSchema,
    relevance: z.enum(["RELEVANT", "IRRELEVANT", "UNKNOWN"]),
    recommendable: z.boolean(),
    actionReasonCode: p0ActionReasonCodeSchema,
    evidenceRefs: evidenceRefListSchema,
    proposedChange: proposedIntentChangeSchema.optional(),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.relevance !== "RELEVANT" && evaluation.recommendable) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only RELEVANT actions can be recommendable",
        path: ["recommendable"],
      });
    }

    if (evaluation.recommendable && evaluation.evidenceRefs.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recommendable actions require supporting Evidence",
        path: ["evidenceRefs"],
      });
    }

    if (
      evaluation.relevance === "IRRELEVANT" &&
      evaluation.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "IRRELEVANT actions require verification Evidence",
        path: ["evidenceRefs"],
      });
    }

    if (
      evaluation.action.kind === "ACCEPTANCE_BOUNDARY_CHANGE" &&
      evaluation.recommendable
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Acceptance-boundary changes are not recommendable in P0",
        path: ["recommendable"],
      });
    }

    if (
      evaluation.action.kind === "SYSTEM_RECOVERY" &&
      evaluation.actionReasonCode !== "RESTORES_CHECK_ONLY"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "System-recovery actions require RESTORES_CHECK_ONLY",
        path: ["actionReasonCode"],
      });
    }

    if (
      evaluation.actionReasonCode === "EFFECT_NOT_VERIFIED" &&
      (evaluation.relevance !== "UNKNOWN" || evaluation.recommendable)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "EFFECT_NOT_VERIFIED actions must remain UNKNOWN and not recommendable",
        path: ["actionReasonCode"],
      });
    }

    if (
      (evaluation.actionReasonCode === "ALTERNATIVE_PATH_VERIFIED" ||
        evaluation.actionReasonCode === "OUTPUT_IMPROVEMENT_VERIFIED") &&
      evaluation.relevance !== "RELEVANT"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Verified action reasons require RELEVANT classification",
        path: ["relevance"],
      });
    }

    if (
      (evaluation.actionReasonCode === "CANNOT_CREATE_MISSING_ROUTE" ||
        evaluation.actionReasonCode === "CHANGES_ACCEPTANCE_BOUNDARY_ONLY") &&
      (evaluation.relevance !== "IRRELEVANT" || evaluation.recommendable)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Negative action classifications must be IRRELEVANT and not recommendable",
        path: ["relevance"],
      });
    }

    if (
      evaluation.action.kind === "TRANSACTION_ADJUSTMENT" &&
      evaluation.recommendable &&
      evaluation.actionReasonCode !== "ALTERNATIVE_PATH_VERIFIED" &&
      evaluation.actionReasonCode !== "OUTPUT_IMPROVEMENT_VERIFIED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Recommendable transaction adjustments require a verified Action Gate reason",
        path: ["actionReasonCode"],
      });
    }

    if (
      evaluation.action.kind === "TRANSACTION_ADJUSTMENT" &&
      evaluation.recommendable &&
      (evaluation.proposedChange === undefined ||
        evaluation.proposedChange.field !== evaluation.action.field)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Recommendable transaction adjustments require a matching proposed Intent change",
        path: ["proposedChange"],
      });
    }

    if (
      evaluation.action.kind !== "TRANSACTION_ADJUSTMENT" &&
      evaluation.proposedChange !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only transaction adjustments may carry a proposed Intent change",
        path: ["proposedChange"],
      });
    }

    if (
      evaluation.actionReasonCode === "ALTERNATIVE_PATH_VERIFIED" &&
      (evaluation.action.kind !== "TRANSACTION_ADJUSTMENT" ||
        (evaluation.action.field !== "tokenPair" &&
          evaluation.action.field !== "protocol"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Alternative-path verification applies only to token pair or protocol adjustments",
        path: ["actionReasonCode"],
      });
    }

    if (
      evaluation.actionReasonCode === "CHANGES_ACCEPTANCE_BOUNDARY_ONLY" &&
      evaluation.action.kind !== "ACCEPTANCE_BOUNDARY_CHANGE"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "CHANGES_ACCEPTANCE_BOUNDARY_ONLY applies only to boundary changes",
        path: ["actionReasonCode"],
      });
    }
  });

const ruleResultBaseShape = {
  ruleId: p0RuleIdSchema,
  evidenceRefs: evidenceRefListSchema,
  actionEvaluations: z.array(actionEvaluationSchema),
};

const evidenceReasonCodes = new Set<z.infer<typeof p0ReasonCodeSchema>>([
  "SIMULATION_COVERAGE_MISSING",
  "SIMULATION_HALTED",
  "CRITICAL_EVIDENCE_MISSING",
  "UNCLASSIFIED_WARNING",
  "UNEXPLAINED_ASSET_CHANGE",
  "EVIDENCE_SOURCE_UNKNOWN",
  "EVIDENCE_NOT_REPRODUCIBLE",
  "OUTPUT_SOURCE_CONFLICT",
]);

function validateRuleReasonTuple(
  result: {
    ruleId: z.infer<typeof p0RuleIdSchema>;
    status: z.infer<typeof ruleStatusSchema>;
    reasonCode?: z.infer<typeof p0ReasonCodeSchema>;
  },
  context: z.RefinementCtx,
) {
  if (result.status !== "FAIL" && result.status !== "UNKNOWN") {
    return;
  }

  const valid =
    (result.ruleId === "P0-EVIDENCE-001" &&
      result.status === "UNKNOWN" &&
      result.reasonCode !== undefined &&
      evidenceReasonCodes.has(result.reasonCode)) ||
    (result.ruleId === "P0-EXECUTION-001" &&
      ((result.status === "FAIL" && result.reasonCode === "NO_ROUTE_FOUND") ||
        (result.status === "UNKNOWN" &&
          result.reasonCode === "RULE_CLASSIFICATION_NOT_VERIFIED"))) ||
    (result.ruleId === "P0-ECONOMIC-001" &&
      ((result.status === "FAIL" &&
        result.reasonCode === "OUTPUT_BELOW_BOUNDARY") ||
        (result.status === "UNKNOWN" &&
          result.reasonCode === "SIMULATED_OUTPUT_UNAVAILABLE")));

  if (!valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reason code is not valid for this Rule status",
      path: ["reasonCode"],
    });
  }
}

export const ruleResultSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        ...ruleResultBaseShape,
        status: z.literal("PASS"),
        reasonCode: z.never().optional(),
        applicabilityReasonCode: z.never().optional(),
      })
      .strict(),
    z
      .object({
        ...ruleResultBaseShape,
        status: z.literal("NOT_APPLICABLE"),
        reasonCode: z.never().optional(),
        applicabilityReasonCode: p0ApplicabilityReasonCodeSchema,
      })
      .strict(),
    z
      .object({
        ...ruleResultBaseShape,
        status: z.enum(["FAIL", "UNKNOWN"]),
        reasonCode: p0ReasonCodeSchema,
        applicabilityReasonCode: z.never().optional(),
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    validateRuleReasonTuple(result, context);

    if (
      (result.status === "PASS" || result.status === "FAIL") &&
      result.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rule PASS/FAIL requires supporting Evidence",
        path: ["evidenceRefs"],
      });
    }
  });

export type Verdict = z.infer<typeof verdictSchema>;
export type RuleStatus = z.infer<typeof ruleStatusSchema>;
export type P0RuleId = z.infer<typeof p0RuleIdSchema>;
export type P0ReasonCode = z.infer<typeof p0ReasonCodeSchema>;
export type P0ActionReasonCode = z.infer<typeof p0ActionReasonCodeSchema>;
export type P0ApplicabilityReasonCode = z.infer<
  typeof p0ApplicabilityReasonCodeSchema
>;
export type TransactionAdjustmentField = z.infer<
  typeof transactionAdjustmentFieldSchema
>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type ProposedIntentChange = z.infer<typeof proposedIntentChangeSchema>;
export type ActionEvaluation = z.infer<typeof actionEvaluationSchema>;
export type RuleResult = z.infer<typeof ruleResultSchema>;

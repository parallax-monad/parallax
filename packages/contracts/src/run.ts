import { z } from "zod";
import { type AssetReference, assetIdentity } from "./common.js";
import {
  type ActionEvaluation,
  actionEvaluationSchema,
  type RuleResult,
  ruleResultSchema,
  verdictSchema,
} from "./decision.js";
import {
  type ActionVerificationEvidence,
  type EvidenceItem,
  type EvidenceRef,
  evidenceItemSchema,
  type NoRouteClassificationEvidence,
  type SimulatedTokenOutEvidence,
  scopeDisclosureSchema,
} from "./evidence.js";
import { normalizedSwapIntentSchema } from "./intent.js";
import { routeSchema } from "./route.js";

export const runDiffFieldSchema = z.enum([
  "amountInAtomic",
  "protocol",
  "recipient",
  "recipientSource",
  "tokenIn",
  "tokenOut",
  "route",
  "economicBoundary",
]);

export const changedFieldSchema = z
  .object({
    field: runDiffFieldSchema,
    before: z.string(),
    after: z.string(),
  })
  .strict();

export const runDiffSchema = z
  .object({
    previousRunId: z.string().trim().min(1),
    previousVerdict: verdictSchema,
    changedFields: z.array(changedFieldSchema).min(1),
  })
  .strict();

const runIdentitySchema = z.object({
  runId: z.string().trim().min(1),
  replayMode: z.boolean(),
  intent: normalizedSwapIntentSchema,
});

type RunIdentity = z.infer<typeof runIdentitySchema>;

function validateRunIdentity(result: RunIdentity, context: z.RefinementCtx) {
  if (
    result.intent.recipientSource === "defaulted_from_sender" &&
    result.intent.recipient.toLowerCase() !== result.intent.sender.toLowerCase()
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A recipient defaulted from sender must equal the normalized sender",
      path: ["intent", "recipient"],
    });
  }

  if (
    !result.replayMode &&
    result.intent.economicBoundary.availability === "available" &&
    result.intent.economicBoundary.source === "demo_preset"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Live runs cannot use a demo_preset Economic Boundary",
      path: ["intent", "economicBoundary", "source"],
    });
  }
}

function collectEvidence(
  evidenceItems: EvidenceItem[],
  replayMode: boolean,
  context: z.RefinementCtx,
) {
  const evidenceByKey = new Map<string, EvidenceItem>();

  evidenceItems.forEach((evidence, index) => {
    if (evidenceByKey.has(evidence.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence keys must be unique",
        path: ["evidence", index, "key"],
      });
    }

    if (evidence.isReplay !== replayMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence replay provenance must match replayMode",
        path: ["evidence", index, "isReplay"],
      });
    }

    evidenceByKey.set(evidence.key, evidence);
  });

  return evidenceByKey;
}

const evidenceRefFields = [
  "source",
  "stage",
  "blockNumber",
  "runtimeVersion",
  "runtimeRevision",
  "fixtureId",
  "isReplay",
  "isMock",
] as const;

function resolveEvidenceRefs(
  references: EvidenceRef[],
  evidenceByKey: Map<string, EvidenceItem>,
  context: z.RefinementCtx,
  path: Array<string | number>,
) {
  const resolved: EvidenceItem[] = [];

  references.forEach((reference, index) => {
    const evidence = evidenceByKey.get(reference.key);
    if (!evidence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown Evidence reference: ${reference.key}`,
        path: [...path, index, "key"],
      });
      return;
    }

    evidenceRefFields.forEach((field) => {
      if (reference[field] !== evidence[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evidence reference provenance does not match ${reference.key}`,
          path: [...path, index, field],
        });
      }
    });

    resolved.push(evidence);
  });

  return resolved;
}

function nextActionIdentity(evaluation: ActionEvaluation) {
  return evaluation.id;
}

function evidenceRefIdentity(reference: EvidenceRef) {
  return JSON.stringify([
    reference.key,
    reference.source,
    reference.stage,
    reference.blockNumber,
    reference.runtimeVersion,
    reference.runtimeRevision,
    reference.fixtureId,
    reference.isReplay,
    reference.isMock,
  ]);
}

function actionEvaluationIdentity(evaluation: ActionEvaluation) {
  const actionIdentity =
    evaluation.action.kind === "TRANSACTION_ADJUSTMENT" ||
    evaluation.action.kind === "ACCEPTANCE_BOUNDARY_CHANGE"
      ? [evaluation.action.kind, evaluation.action.field]
      : [evaluation.action.kind, evaluation.action.action];
  const proposedChangeIdentity = evaluation.proposedChange
    ? [
        evaluation.proposedChange.field,
        evaluation.proposedChange.before,
        evaluation.proposedChange.after,
      ]
    : null;

  return JSON.stringify([
    evaluation.id,
    actionIdentity,
    evaluation.relevance,
    evaluation.recommendable,
    evaluation.actionReasonCode,
    proposedChangeIdentity,
    evaluation.evidenceRefs.map(evidenceRefIdentity).sort(),
  ]);
}

function validateActionEvaluationEvidence(
  evaluation: ActionEvaluation,
  supportingEvidence: EvidenceItem[],
  evidenceByKey: Map<string, EvidenceItem>,
  runId: string,
  context: z.RefinementCtx,
  path: Array<string | number>,
) {
  const trustedEvidence = supportingEvidence.filter(
    (evidence) =>
      !evidence.isMock &&
      evidence.source !== "mock" &&
      evidence.source !== "unknown" &&
      evidence.source !== "external",
  );

  if (evaluation.recommendable && trustedEvidence.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Recommendable actions require trusted supporting Evidence",
      path,
    });
  }

  if (
    evaluation.relevance === "IRRELEVANT" &&
    !trustedEvidence.some((evidence) => evidence.status === "confirmed")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "IRRELEVANT actions require confirmed trusted Evidence",
      path,
    });
  }

  if (
    evaluation.action.kind !== "TRANSACTION_ADJUSTMENT" ||
    !evaluation.recommendable
  ) {
    return;
  }

  const adjustmentField = evaluation.action.field;
  const verification = trustedEvidence.find(
    (evidence): evidence is ActionVerificationEvidence =>
      evidence.kind === "action_verification" &&
      evidence.field === adjustmentField &&
      evidence.actionReasonCode === evaluation.actionReasonCode &&
      (evidence.baselineRunId === runId ||
        evidence.verificationRunId === runId),
  );

  if (!verification) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Transaction recommendations require matching Action Gate Evidence",
      path,
    });
    return;
  }

  if (
    evaluation.proposedChange === undefined ||
    verification.beforeValue !== evaluation.proposedChange.before ||
    verification.afterValue !== evaluation.proposedChange.after
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "The proposed Intent change must match Action Verification Evidence",
      path: [...path.slice(0, -1), "proposedChange"],
    });
  }

  const resultEvidence = evidenceByKey.get(verification.resultEvidenceKey);
  const resultIsReferenced = evaluation.evidenceRefs.some(
    (reference) => reference.key === verification.resultEvidenceKey,
  );
  const resultIsTrusted =
    resultEvidence !== undefined &&
    resultIsReferenced &&
    resultEvidence.status === "confirmed" &&
    !resultEvidence.isMock &&
    resultEvidence.source !== "mock" &&
    resultEvidence.source !== "unknown" &&
    resultEvidence.source !== "external" &&
    resultEvidence.isReplay === verification.isReplay &&
    (verification.runtimeVersion === undefined ||
      resultEvidence.runtimeVersion === verification.runtimeVersion) &&
    (verification.runtimeRevision === undefined ||
      resultEvidence.runtimeRevision === verification.runtimeRevision);
  const resultMatchesReason =
    verification.actionReasonCode !== "OUTPUT_IMPROVEMENT_VERIFIED" ||
    resultEvidence?.kind === "simulated_token_out";

  if (!resultIsTrusted || !resultMatchesReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action Gate Evidence must reference a trusted verified result",
      path,
    });
  }
}

function validateUniqueActions(
  evaluations: ActionEvaluation[],
  context: z.RefinementCtx,
  path: Array<string | number>,
  allActions?: Set<string>,
) {
  const actions = new Set<string>();

  evaluations.forEach((evaluation, index) => {
    const identity = nextActionIdentity(evaluation);
    if (actions.has(identity) || allActions?.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Action evaluations must be unique by stable identity within a Run",
        path: [...path, index, "action"],
      });
    }

    actions.add(identity);
    allActions?.add(identity);
  });
}

function validateRuleResults(
  ruleResults: RuleResult[],
  evidenceByKey: Map<string, EvidenceItem>,
  runId: string,
  context: z.RefinementCtx,
) {
  const ruleIds = new Set<string>();
  const actionIds = new Set<string>();

  ruleResults.forEach((ruleResult, ruleIndex) => {
    if (ruleIds.has(ruleResult.ruleId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rule IDs must be unique",
        path: ["ruleResults", ruleIndex, "ruleId"],
      });
    }
    ruleIds.add(ruleResult.ruleId);

    const ruleEvidence = resolveEvidenceRefs(
      ruleResult.evidenceRefs,
      evidenceByKey,
      context,
      ["ruleResults", ruleIndex, "evidenceRefs"],
    );

    if (ruleResult.status === "PASS" || ruleResult.status === "FAIL") {
      const independentlySupportingEvidence = ruleEvidence.filter(
        (evidence) => evidence.source !== "external",
      );

      ruleEvidence.forEach((evidence, evidenceIndex) => {
        if (
          evidence.isMock ||
          evidence.source === "mock" ||
          evidence.source === "unknown"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Mock or unknown Evidence cannot support core PASS/FAIL",
            path: ["ruleResults", ruleIndex, "evidenceRefs", evidenceIndex],
          });
        }

        if (evidence.source !== "external" && evidence.status !== "confirmed") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Rule PASS/FAIL requires confirmed Evidence",
            path: ["ruleResults", ruleIndex, "evidenceRefs", evidenceIndex],
          });
        }
      });

      if (independentlySupportingEvidence.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "External Evidence cannot independently support core PASS/FAIL",
          path: ["ruleResults", ruleIndex, "evidenceRefs"],
        });
      }
    }

    validateUniqueActions(
      ruleResult.actionEvaluations,
      context,
      ["ruleResults", ruleIndex, "actionEvaluations"],
      actionIds,
    );

    ruleResult.actionEvaluations.forEach((evaluation, actionIndex) => {
      const path = [
        "ruleResults",
        ruleIndex,
        "actionEvaluations",
        actionIndex,
        "evidenceRefs",
      ];
      const supportingEvidence = resolveEvidenceRefs(
        evaluation.evidenceRefs,
        evidenceByKey,
        context,
        path,
      );
      validateActionEvaluationEvidence(
        evaluation,
        supportingEvidence,
        evidenceByKey,
        runId,
        context,
        path,
      );
    });
  });
}

function validateRuleScopeConsistency(
  ruleResults: RuleResult[],
  scope: z.infer<typeof scopeDisclosureSchema>,
  runStatus: "completed" | "integration_error",
  context: z.RefinementCtx,
) {
  const p0RuleIds = new Set([
    "P0-EVIDENCE-001",
    "P0-EXECUTION-001",
    "P0-ECONOMIC-001",
  ]);
  const scopeBySubject = new Map(scope.map((item) => [item.key, item]));

  ruleResults.forEach((ruleResult, ruleIndex) => {
    const scopeIndex = scope.findIndex(
      (item) => item.key === ruleResult.ruleId,
    );
    const scopeItem = scopeBySubject.get(ruleResult.ruleId);
    if (!scopeItem) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every RuleResult must have a Rule-bound Scope item",
        path: ["ruleResults", ruleIndex, "ruleId"],
      });
      return;
    }

    if (
      runStatus === "integration_error" &&
      scopeItem.status === "unknown" &&
      scopeItem.reason === "REQUIRED_CHECK_INTERRUPTED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "An interrupted Scope item must not have a corresponding RuleResult",
        path: ["ruleResults", ruleIndex, "ruleId"],
      });
    }

    const expectedStatus =
      ruleResult.status === "PASS" || ruleResult.status === "FAIL"
        ? "checked"
        : ruleResult.status === "UNKNOWN"
          ? "unknown"
          : "not_checked";

    if (scopeItem.status !== expectedStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rule-bound Scope status must match the RuleResult status",
        path: ["scope", scopeIndex, "status"],
      });
    }

    if (
      ruleResult.status === "NOT_APPLICABLE" &&
      scopeItem.reason !==
        (ruleResult.applicabilityReasonCode === "BOUNDARY_NOT_PROVIDED"
          ? "PRECONDITION_ABSENT"
          : "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Rule-bound NOT_APPLICABLE Scope must preserve its Applicability Reason",
        path: ["scope", scopeIndex, "reason"],
      });
    }
  });

  scope.forEach((scopeItem, scopeIndex) => {
    if (!p0RuleIds.has(scopeItem.key)) {
      return;
    }

    const hasRuleResult = ruleResults.some(
      (ruleResult) => ruleResult.ruleId === scopeItem.key,
    );
    if (hasRuleResult) {
      return;
    }

    if (
      runStatus === "integration_error" &&
      scopeItem.status === "unknown" &&
      scopeItem.reason === "REQUIRED_CHECK_INTERRUPTED"
    ) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        runStatus === "integration_error"
          ? "An interrupted P0 Rule without a RuleResult must be unknown / REQUIRED_CHECK_INTERRUPTED"
          : "A Rule-bound Scope item must have a corresponding RuleResult",
      path: ["scope", scopeIndex],
    });
  });
}

function validatePublicActions(
  recommendedActions: ActionEvaluation[],
  irrelevantActions: ActionEvaluation[],
  ruleResults: RuleResult[],
  evidenceByKey: Map<string, EvidenceItem>,
  context: z.RefinementCtx,
) {
  validateUniqueActions(recommendedActions, context, ["recommendedActions"]);
  validateUniqueActions(irrelevantActions, context, ["irrelevantActions"]);

  const recommendedActionIds = new Set(
    recommendedActions.map(nextActionIdentity),
  );
  irrelevantActions.forEach((evaluation, index) => {
    if (recommendedActionIds.has(nextActionIdentity(evaluation))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "An action cannot be both recommended and classified as irrelevant",
        path: ["irrelevantActions", index, "action"],
      });
    }
  });

  const evaluatedActions = new Set(
    ruleResults.flatMap((result) =>
      result.actionEvaluations.map(actionEvaluationIdentity),
    ),
  );

  recommendedActions.forEach((evaluation, index) => {
    resolveEvidenceRefs(evaluation.evidenceRefs, evidenceByKey, context, [
      "recommendedActions",
      index,
      "evidenceRefs",
    ]);

    if (evaluation.relevance !== "RELEVANT" || !evaluation.recommendable) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "recommendedActions accepts only RELEVANT, recommendable evaluations",
        path: ["recommendedActions", index],
      });
    }

    if (evaluation.action.kind === "ACCEPTANCE_BOUNDARY_CHANGE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Acceptance-boundary changes cannot enter recommendedActions",
        path: ["recommendedActions", index, "action"],
      });
    }

    if (!evaluatedActions.has(actionEvaluationIdentity(evaluation))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Public actions must preserve a RuleResult ActionEvaluation",
        path: ["recommendedActions", index],
      });
    }
  });

  irrelevantActions.forEach((evaluation, index) => {
    resolveEvidenceRefs(evaluation.evidenceRefs, evidenceByKey, context, [
      "irrelevantActions",
      index,
      "evidenceRefs",
    ]);

    if (
      evaluation.relevance !== "IRRELEVANT" ||
      evaluation.recommendable ||
      evaluation.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "irrelevantActions accepts only verified IRRELEVANT evaluations",
        path: ["irrelevantActions", index],
      });
    }

    if (
      evaluation.action.kind === "ACCEPTANCE_BOUNDARY_CHANGE" &&
      evaluation.actionReasonCode !== "CHANGES_ACCEPTANCE_BOUNDARY_ONLY"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Public acceptance-boundary actions require CHANGES_ACCEPTANCE_BOUNDARY_ONLY",
        path: ["irrelevantActions", index, "actionReasonCode"],
      });
    }

    if (!evaluatedActions.has(actionEvaluationIdentity(evaluation))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Public actions must preserve a RuleResult ActionEvaluation",
        path: ["irrelevantActions", index],
      });
    }
  });
}

function sameAsset(
  chainId: number,
  left: AssetReference,
  right: AssetReference,
) {
  return (
    assetIdentity({ chainId, asset: left }) ===
    assetIdentity({ chainId, asset: right })
  );
}

function validateNoRouteClassification(
  result: {
    intent: z.infer<typeof normalizedSwapIntentSchema>;
    ruleResults: RuleResult[];
    route: z.infer<typeof routeSchema>;
  },
  evidenceByKey: Map<string, EvidenceItem>,
  context: z.RefinementCtx,
) {
  const executionRuleIndex = result.ruleResults.findIndex(
    (ruleResult) =>
      ruleResult.ruleId === "P0-EXECUTION-001" &&
      ruleResult.status === "FAIL" &&
      ruleResult.reasonCode === "NO_ROUTE_FOUND",
  );
  const executionRule = result.ruleResults[executionRuleIndex];
  if (!executionRule) {
    return false;
  }

  const classifications = executionRule.evidenceRefs
    .map((reference) => evidenceByKey.get(reference.key))
    .filter(
      (evidence): evidence is NoRouteClassificationEvidence =>
        evidence?.kind === "no_route_classification",
    );

  if (classifications.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "NO_ROUTE_FOUND requires exactly one structured Classification Evidence item",
      path: ["ruleResults", executionRuleIndex, "evidenceRefs"],
    });
    return false;
  }

  const classification = classifications[0];
  const rawEvidence = evidenceByKey.get(classification.rawEvidenceKey);
  const rawIsReferenced = executionRule.evidenceRefs.some(
    (reference) => reference.key === classification.rawEvidenceKey,
  );
  const rawRuntimeMatches =
    rawEvidence !== undefined &&
    (classification.runtimeVersion === undefined ||
      rawEvidence.runtimeVersion === classification.runtimeVersion) &&
    (classification.runtimeRevision === undefined ||
      rawEvidence.runtimeRevision === classification.runtimeRevision);
  const rawScopeMatches =
    rawEvidence !== undefined &&
    (classification.blockNumber === undefined ||
      rawEvidence.blockNumber === classification.blockNumber) &&
    (classification.fixtureId === undefined ||
      rawEvidence.fixtureId === classification.fixtureId);
  const identityMatches =
    classification.protocol === result.intent.protocol &&
    classification.chainId === result.intent.chainId &&
    classification.sender.toLowerCase() ===
      result.intent.sender.toLowerCase() &&
    classification.recipient.toLowerCase() ===
      result.intent.recipient.toLowerCase() &&
    classification.amountInAtomic === result.intent.amountInAtomic &&
    sameAsset(
      result.intent.chainId,
      classification.tokenIn,
      result.intent.tokenIn,
    ) &&
    sameAsset(
      result.intent.chainId,
      classification.tokenOut,
      result.intent.tokenOut,
    );
  const rawEvidenceIsTrusted =
    rawEvidence?.kind === "no_route_raw_output" &&
    rawIsReferenced &&
    rawEvidence.status === "confirmed" &&
    (rawEvidence.source === "moss" ||
      (classification.stage === "QUOTE" && rawEvidence.source === "quote")) &&
    rawEvidence.stage === classification.stage &&
    rawEvidence.isReplay === classification.isReplay &&
    !rawEvidence.isMock &&
    rawRuntimeMatches &&
    rawScopeMatches;

  if (
    result.route.availability !== "unavailable" ||
    !identityMatches ||
    !rawEvidenceIsTrusted
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "NO_ROUTE_FOUND Classification Evidence must match trusted raw Evidence and the checked intent",
      path: ["ruleResults", executionRuleIndex, "evidenceRefs"],
    });
    return false;
  }

  return true;
}

function validateEconomicBoundary(
  result: {
    intent: z.infer<typeof normalizedSwapIntentSchema>;
    ruleResults: RuleResult[];
  },
  evidenceByKey: Map<string, EvidenceItem>,
  hasTrustedNoRoute: boolean,
  context: z.RefinementCtx,
  allowMissingRuleResult = false,
) {
  const economicRuleIndex = result.ruleResults.findIndex(
    (ruleResult) => ruleResult.ruleId === "P0-ECONOMIC-001",
  );
  const economicRule = result.ruleResults[economicRuleIndex];

  if (!economicRule) {
    if (allowMissingRuleResult) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Completed results require P0-ECONOMIC-001",
      path: ["ruleResults"],
    });
    return;
  }

  if (result.intent.economicBoundary.availability === "unavailable") {
    if (
      economicRule.status !== "NOT_APPLICABLE" ||
      economicRule.applicabilityReasonCode !== "BOUNDARY_NOT_PROVIDED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Unavailable Economic Boundaries require NOT_APPLICABLE / BOUNDARY_NOT_PROVIDED",
        path: ["ruleResults", economicRuleIndex],
      });
    }
    return;
  }

  if (
    economicRule.status === "NOT_APPLICABLE" &&
    economicRule.applicabilityReasonCode !==
      "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Available Economic Boundaries are NOT_APPLICABLE only after a trusted terminal result",
      path: ["ruleResults", economicRuleIndex, "applicabilityReasonCode"],
    });
  }

  if (
    economicRule.status === "NOT_APPLICABLE" &&
    economicRule.applicabilityReasonCode ===
      "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT"
  ) {
    if (!hasTrustedNoRoute) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Terminal Economic applicability requires a trusted earlier no-route result",
        path: ["ruleResults", economicRuleIndex, "applicabilityReasonCode"],
      });
    }
  }

  if (economicRule.status !== "PASS" && economicRule.status !== "FAIL") {
    return;
  }

  if (
    economicRule.status === "FAIL" &&
    economicRule.reasonCode !== "OUTPUT_BELOW_BOUNDARY"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Economic FAIL requires OUTPUT_BELOW_BOUNDARY",
      path: ["ruleResults", economicRuleIndex, "reasonCode"],
    });
  }

  const simulationEvidence = economicRule.evidenceRefs
    .map((reference) => evidenceByKey.get(reference.key))
    .filter(
      (evidence): evidence is SimulatedTokenOutEvidence =>
        evidence?.kind === "simulated_token_out",
    );

  if (simulationEvidence.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Economic PASS/FAIL requires exactly one complete simulated tokenOut result",
      path: ["ruleResults", economicRuleIndex, "evidenceRefs"],
    });
    return;
  }

  const simulatedOutput = simulationEvidence[0];
  if (
    !sameAsset(
      result.intent.chainId,
      result.intent.tokenOut,
      simulatedOutput.tokenOut,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Simulated tokenOut must match the checked intent",
      path: ["evidence", simulatedOutput.key, "tokenOut"],
    });
  }

  if (
    simulatedOutput.recipient.toLowerCase() !==
    result.intent.recipient.toLowerCase()
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Simulated recipient must match the checked intent recipient",
      path: ["evidence", simulatedOutput.key, "recipient"],
    });
  }

  const received = BigInt(simulatedOutput.amountReceivedAtomic);
  const minimum = BigInt(result.intent.economicBoundary.minimumReceivedAtomic);
  const expectedStatus = received >= minimum ? "PASS" : "FAIL";
  if (economicRule.status !== expectedStatus) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Economic Rule status must match the simulated tokenOut comparison",
      path: ["ruleResults", economicRuleIndex, "status"],
    });
  }
}

export const completedRunResultSchema = runIdentitySchema
  .extend({
    status: z.literal("completed"),
    systemStatus: z.literal("OK"),
    verdict: verdictSchema,
    summary: z.string().trim().min(1),
    ruleResults: z.array(ruleResultSchema).min(1),
    recommendedActions: z.array(actionEvaluationSchema),
    irrelevantActions: z.array(actionEvaluationSchema),
    evidence: z.array(evidenceItemSchema).min(1),
    scope: scopeDisclosureSchema,
    route: routeSchema,
    diff: runDiffSchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    validateRunIdentity(result, context);
    const evidenceByKey = collectEvidence(
      result.evidence,
      result.replayMode,
      context,
    );

    validateRuleResults(
      result.ruleResults,
      evidenceByKey,
      result.runId,
      context,
    );
    validatePublicActions(
      result.recommendedActions,
      result.irrelevantActions,
      result.ruleResults,
      evidenceByKey,
      context,
    );
    validateRuleScopeConsistency(
      result.ruleResults,
      result.scope,
      "completed",
      context,
    );
    const hasTrustedNoRoute = validateNoRouteClassification(
      result,
      evidenceByKey,
      context,
    );
    validateEconomicBoundary(result, evidenceByKey, hasTrustedNoRoute, context);

    if (result.verdict === "PROCEED") {
      if (!result.scope.some((item) => item.status === "checked")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "PROCEED requires at least one checked scope item",
          path: ["scope"],
        });
      }

      result.evidence.forEach((evidence, index) => {
        if (evidence.status === "failed") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "PROCEED cannot include failed Evidence",
            path: ["evidence", index, "status"],
          });
        }
      });
    }
  });

export const integrationErrorSchema = z
  .object({
    code: z.enum([
      "MOSS_UNAVAILABLE",
      "RPC_UNAVAILABLE",
      "TIMEOUT",
      "UNSUPPORTED",
      "INVALID_RESPONSE",
      "INTERNAL_ERROR",
    ]),
    stage: z.enum([
      "quote",
      "action",
      "simulation",
      "normalization",
      "unknown",
    ]),
    message: z.string().trim().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const failedRunResultSchema = runIdentitySchema
  .extend({
    status: z.literal("integration_error"),
    systemStatus: z.literal("INTEGRATION_ERROR"),
    verdict: z.literal("UNKNOWN"),
    summary: z.string().trim().min(1),
    error: integrationErrorSchema,
    ruleResults: z.array(ruleResultSchema),
    recommendedActions: z.array(actionEvaluationSchema),
    irrelevantActions: z.array(actionEvaluationSchema).max(0),
    evidence: z.array(evidenceItemSchema),
    scope: scopeDisclosureSchema,
  })
  .strict()
  .superRefine((result, context) => {
    validateRunIdentity(result, context);
    const evidenceByKey = collectEvidence(
      result.evidence,
      result.replayMode,
      context,
    );

    validateRuleResults(
      result.ruleResults,
      evidenceByKey,
      result.runId,
      context,
    );
    validatePublicActions(
      result.recommendedActions,
      result.irrelevantActions,
      result.ruleResults,
      evidenceByKey,
      context,
    );
    validateRuleScopeConsistency(
      result.ruleResults,
      result.scope,
      "integration_error",
      context,
    );
    validateEconomicBoundary(result, evidenceByKey, false, context, true);

    result.ruleResults.forEach((ruleResult, index) => {
      if (ruleResult.status === "PASS" || ruleResult.status === "FAIL") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Integration errors cannot generate protocol-risk or transaction-risk PASS/FAIL",
          path: ["ruleResults", index, "status"],
        });
      }
    });

    result.recommendedActions.forEach((evaluation, index) => {
      if (
        evaluation.action.kind !== "SYSTEM_RECOVERY" ||
        evaluation.relevance !== "RELEVANT" ||
        !evaluation.recommendable ||
        evaluation.actionReasonCode !== "RESTORES_CHECK_ONLY"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Integration errors can recommend only verified SYSTEM_RECOVERY actions",
          path: ["recommendedActions", index],
        });
      }
    });
  });

export const runResultSchema = z.union([
  completedRunResultSchema,
  failedRunResultSchema,
]);

export type RunDiffField = z.infer<typeof runDiffFieldSchema>;
export type RunDiff = z.infer<typeof runDiffSchema>;
export type IntegrationError = z.infer<typeof integrationErrorSchema>;
export type CompletedRunResult = z.infer<typeof completedRunResultSchema>;
export type FailedRunResult = z.infer<typeof failedRunResultSchema>;
export type RunResult = z.infer<typeof runResultSchema>;

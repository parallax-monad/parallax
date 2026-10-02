import { isDeepStrictEqual } from "node:util";
import {
  type ActionEvaluation,
  type ActionVerificationEvidence,
  completedRunResultSchema,
  type EvidenceRef,
  type NormalizedSwapIntent,
  type RunResult,
  type SimulatedTokenOutEvidence,
} from "@parallax/contracts";
import { evaluateConstraints, evaluateEvidence } from "@parallax/risk";
import { projectGenericEvidenceToRunResult } from "../agent-flow/index.js";
import { extractSimulatedOutput } from "../agent-flow/simulated-output.js";
import { backendEvidenceState } from "./evidence-state.js";

const REQUIRED_CHILD_RULE_IDS = [
  "P0-EVIDENCE-001",
  "P0-EXECUTION-001",
  "P0-ECONOMIC-001",
] as const;

type CompletedRun = Extract<RunResult, { status: "completed" }>;

function hasTerminalNoRouteFailure(result: CompletedRun): boolean {
  return result.ruleResults.some(
    (rule) =>
      rule.ruleId === "P0-EXECUTION-001" &&
      rule.status === "FAIL" &&
      rule.reasonCode === "NO_ROUTE_FOUND",
  );
}

export type ActionGateRunRecord =
  | { status: "started" }
  | { status: "failed" }
  | { status: "completed"; result: RunResult };

type EvidenceProvenance = {
  key: string;
  source: EvidenceRef["source"];
  stage?: EvidenceRef["stage"];
  blockNumber?: string;
  simulatorPinnedBlock?: string;
  runtimeVersion?: string;
  runtimeRevision?: string;
  fixtureId?: string;
  reproducibility: EvidenceRef["reproducibility"];
  isReplay: boolean;
  isMock: boolean;
};

/** P0 fixture path: economic FAIL with execution PASS and a declared boundary. */
export function isActionGateCandidate(result: CompletedRun): boolean {
  if (
    (result.verdict !== "STOP" && result.verdict !== "ADJUST") ||
    result.parentRunId !== undefined ||
    result.intent.economicBoundary.availability !== "available" ||
    result.scope.some((item) => item.status === "unknown") ||
    result.ruleResults.some((rule) => rule.status === "UNKNOWN") ||
    (result.verdict === "ADJUST" &&
      actionGateVerificationRunIds(result).length > 0)
  ) {
    return false;
  }

  const evidence = result.ruleResults.find(
    (rule) => rule.ruleId === "P0-EVIDENCE-001",
  );
  const execution = result.ruleResults.find(
    (rule) => rule.ruleId === "P0-EXECUTION-001",
  );
  const economic = result.ruleResults.find(
    (rule) => rule.ruleId === "P0-ECONOMIC-001",
  );

  return (
    evidence?.status === "PASS" &&
    execution?.status === "PASS" &&
    economic?.status === "FAIL" &&
    economic.reasonCode === "OUTPUT_BELOW_BOUNDARY"
  );
}

/** Deterministic fixture adjustment: reduce amountIn by one third. */
export function proposeAmountInAdjustment(intent: NormalizedSwapIntent): {
  before: string;
  after: string;
  nextIntent: NormalizedSwapIntent;
} {
  const before = intent.amountInAtomic;
  const current = BigInt(before);
  const after = current <= 1n ? before : ((current * 2n) / 3n).toString();

  if (after === before) {
    throw new Error(
      "Action Gate fixture adjustment must change amountInAtomic",
    );
  }

  return {
    before,
    after,
    nextIntent: {
      ...intent,
      amountInAtomic: after,
    },
  };
}

/**
 * Resolves the simulated tokenOut Evidence referenced by P0-ECONOMIC-001.
 * First-match scanning is intentionally avoided so multi-output Runs cannot
 * attest an unreferenced output.
 */
export function economicSimulatedTokenOutEvidence(
  result: CompletedRun,
): SimulatedTokenOutEvidence | undefined {
  const economic = result.ruleResults.find(
    (rule) => rule.ruleId === "P0-ECONOMIC-001",
  );
  if (economic === undefined || economic.evidenceRefs.length !== 1) {
    return undefined;
  }

  const reference = economic.evidenceRefs[0];
  if (reference === undefined) {
    return undefined;
  }

  const evidence = result.evidence.find((item) => item.key === reference.key);
  if (evidence?.kind !== "simulated_token_out") {
    return undefined;
  }

  return evidence;
}

/** Resolves simulated tokenOut via the Economic rule EvidenceRef. */
export function simulatedTokenOutEvidence(
  result: CompletedRun,
): SimulatedTokenOutEvidence | undefined {
  return economicSimulatedTokenOutEvidence(result);
}

export function childRunPassesActionGate(
  child: CompletedRun,
  baselineRunId: string,
): boolean {
  const output = economicSimulatedTokenOutEvidence(child);
  if (
    child.parentRunId !== baselineRunId ||
    child.replayMode ||
    child.systemStatus !== "OK" ||
    child.scope.some((item) => item.status === "unknown") ||
    output === undefined ||
    output.recipient !== child.intent.recipient ||
    !isDeepStrictEqual(output.tokenOut, child.intent.tokenOut)
  ) {
    return false;
  }

  return REQUIRED_CHILD_RULE_IDS.every((ruleId) =>
    child.ruleResults.some(
      (rule) => rule.ruleId === ruleId && rule.status === "PASS",
    ),
  );
}

/** Selected quote target is not the optional transaction Minimum Received. */
export function childRunPassesTargetOutputGate(
  child: CompletedRun,
  baselineRunId: string,
  baselineIntent: NormalizedSwapIntent,
  targetAmountOutAtomic: string,
): boolean {
  if (!completedRunResultSchema.safeParse(child).success) return false;
  if (!childExecutionIsBound(child)) return false;
  const authorization = baselineIntent.amountInIncreaseAuthorization;
  const outputs = child.evidence.filter(
    (item) => item.kind === "simulated_token_out",
  );
  const output = outputs[0];
  if (
    authorization?.availability !== "available" ||
    outputs.length !== 1 ||
    output?.kind !== "simulated_token_out" ||
    child.parentRunId !== baselineRunId ||
    child.runId === baselineRunId ||
    child.replayMode ||
    child.systemStatus !== "OK" ||
    child.verdict !== "PROCEED" ||
    output.isReplay ||
    output.isMock ||
    output.recipient !== child.intent.recipient ||
    !isDeepStrictEqual(output.tokenOut, child.intent.tokenOut) ||
    !isDeepStrictEqual(child.intent, {
      ...baselineIntent,
      amountInAtomic: child.intent.amountInAtomic,
    }) ||
    BigInt(child.intent.amountInAtomic) <=
      BigInt(baselineIntent.amountInAtomic) ||
    BigInt(child.intent.amountInAtomic) >
      BigInt(authorization.maximumAmountInAtomic) ||
    !/^(0|[1-9]\d*)$/.test(targetAmountOutAtomic) ||
    BigInt(output.amountReceivedAtomic) < BigInt(targetAmountOutAtomic) ||
    child.scope.some((item) => item.status === "unknown") ||
    child.ruleResults.some(
      (rule) => rule.status === "UNKNOWN" || rule.status === "FAIL",
    )
  )
    return false;
  return REQUIRED_CHILD_RULE_IDS.every((ruleId) =>
    child.ruleResults.some(
      (rule) =>
        rule.ruleId === ruleId &&
        rule.status ===
          (ruleId === "P0-ECONOMIC-001" &&
          child.intent.economicBoundary.availability === "unavailable"
            ? "NOT_APPLICABLE"
            : "PASS"),
    ),
  );
}

function childRunPassesSelectedTargetGate(
  baseline: CompletedRun,
  child: CompletedRun,
): boolean {
  const remediation = baseline.p0?.remediation;
  const target = baseline.p0?.expectationBaseline;
  if (
    remediation?.status !== "VERIFIED" ||
    !remediation.verificationProof ||
    target?.status !== "AVAILABLE"
  )
    return false;
  const proof = remediation.verificationProof;
  const output = child.evidence.find(
    (item) => item.key === proof.resultEvidenceRef.evidenceId,
  );
  const checks = child.p0?.constraintVerification;
  return (
    childRunPassesTargetOutputGate(
      child,
      baseline.runId,
      baseline.intent,
      proof.targetAmountOutAtomic,
    ) &&
    remediation.parentRunId === baseline.runId &&
    remediation.childRunId === child.runId &&
    proof.resultEvidenceRef.runId === child.runId &&
    remediation.amountInAtomic === child.intent.amountInAtomic &&
    target.quoteId === proof.targetQuoteId &&
    target.amountOutAtomic === proof.targetAmountOutAtomic &&
    output?.kind === "simulated_token_out" &&
    output.amountReceivedAtomic === proof.verifiedAmountOutAtomic &&
    output.blockNumber === remediation.verificationBlock &&
    checks !== undefined &&
    checks.candidateQuoteId === remediation.quoteId &&
    checks.blockNumber === remediation.verificationBlock &&
    proof.executionBinding !== undefined &&
    isDeepStrictEqual(proof.executionBinding, child.p0?.executionBinding) &&
    proof.executionBinding.blockNumber === remediation.verificationBlock &&
    proof.executionBinding.candidateQuoteId === remediation.quoteId &&
    proof.executionBinding.observedAt === remediation.verificationTime &&
    recordedConstraintsMatch(baseline, child)
  );
}

/** Compare the persisted execution facts, not just the output/block height. */
function childExecutionIsBound(child: CompletedRun): boolean {
  const binding = child.p0?.executionBinding;
  const evidence = child.providerEvidence;
  if (
    !binding ||
    !evidence ||
    evidence.provider.status !== "SUCCESS" ||
    backendEvidenceState(evidence) !== "VERIFIED" ||
    evidence.execution.status !== "SUCCESS" ||
    evidence.provenance.simulationBlock !== binding.blockNumber ||
    child.simulatorPinnedBlock !== binding.blockNumber
  )
    return false;
  // Persisted PASS rules cannot authorize evidence that changed on recovery.
  const recoveredRisk = evaluateEvidence(evidence);
  if (
    recoveredRisk.verdict !== child.verdict ||
    recoveredRisk.evidenceCompleteness !== "COMPLETE" ||
    child.p0?.transactionProtection.status !== recoveredRisk.economicBoundary
  )
    return false;
  const recovered = projectGenericEvidenceToRunResult(
    child.runId,
    child.intent,
    evidence,
  );
  if (
    recovered.status !== "completed" ||
    recovered.verdict !== child.verdict ||
    !REQUIRED_CHILD_RULE_IDS.every((ruleId) => {
      const recorded = child.ruleResults.filter(
        (rule) => rule.ruleId === ruleId,
      );
      const current = recovered.ruleResults.find(
        (rule) => rule.ruleId === ruleId,
      );
      return (
        recorded.length === 1 &&
        current !== undefined &&
        isDeepStrictEqual(
          JSON.parse(JSON.stringify(recorded[0])),
          JSON.parse(JSON.stringify(current)),
        )
      );
    })
  )
    return false;
  // Re-derive from the recovered execution, using the same qualification and
  // balance-delta checks as the initial projection. Identity alone is not proof
  // that a persisted canonical output still agrees with its source.
  const derived = extractSimulatedOutput(
    child.intent,
    evidence,
    child.evidence,
  );
  const outputs = child.evidence.filter(
    (item) => item.kind === "simulated_token_out",
  );
  const output = outputs[0];
  if (
    !derived ||
    outputs.length !== 1 ||
    output?.kind !== "simulated_token_out" ||
    output.amountReceivedAtomic !== derived.amountReceivedAtomic ||
    output.derivation !== derived.derivation ||
    output.derivationVersion !== derived.derivationVersion ||
    !isDeepStrictEqual(
      output.inputEvidenceRefs.map((ref) => ref.key),
      derived.inputEvidenceKeys,
    )
  )
    return false;
  for (const field of [evidence.receipt, evidence.outcome]) {
    const value = field.value;
    if (
      field.blockNumber !== binding.blockNumber ||
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.transactionFingerprint !== binding.preparedTransactionFingerprint ||
      value.blockHash !== binding.blockHash
    )
      return false;
  }
  const actions = evidence.action.value;
  return (
    Array.isArray(actions) &&
    actions.length === 1 &&
    actions[0] !== null &&
    typeof actions[0] === "object" &&
    !Array.isArray(actions[0]) &&
    actions[0].transactionFingerprint === binding.preparedTransactionFingerprint
  );
}

function recordedConstraintsMatch(
  baseline: CompletedRun,
  child: CompletedRun,
): boolean {
  const original = baseline.p0?.constraintVerification;
  const recorded = child.p0?.constraintVerification;
  if (!original || !recorded) return false;
  const declarations = recorded.checks.map((check) => check.declaration);
  if (
    !isDeepStrictEqual(
      declarations,
      original.checks.map((check) => check.declaration),
    ) ||
    new Set(declarations.map((declaration) => declaration.declarationId))
      .size !== declarations.length ||
    declarations.length !== baseline.p0?.constraints.length
  )
    return false;
  try {
    const measurements = new Map<
      string,
      (typeof recorded.checks)[number]["measurements"]
    >();
    for (const check of recorded.checks) {
      if (
        check.measurements.some((item) => item.name !== check.declaration.name)
      )
        return false;
      const previous = measurements.get(check.declaration.name);
      if (
        previous !== undefined &&
        !isDeepStrictEqual(previous, check.measurements)
      )
        return false;
      measurements.set(check.declaration.name, check.measurements);
    }
    // Repeated declarations share one observation; conflicting copies never
    // become separate observations selected per threshold.
    const evaluated = evaluateConstraints(
      declarations,
      [...measurements.values()].flat(),
    );
    return (
      evaluated.every((outcome) => outcome.status === "PASS") &&
      isDeepStrictEqual(
        evaluated,
        recorded.checks.map((check) => check.outcome),
      ) &&
      isDeepStrictEqual(evaluated, child.p0?.constraints)
    );
  } catch {
    return false;
  }
}

function findActionGateAttestation(
  result: CompletedRun,
  evaluation: CompletedRun["recommendedActions"][number],
): ActionVerificationEvidence | undefined {
  if (
    evaluation.action.kind !== "TRANSACTION_ADJUSTMENT" ||
    evaluation.proposedChange === undefined
  ) {
    return undefined;
  }

  const field = evaluation.action.field;
  return result.evidence.find(
    (evidence): evidence is ActionVerificationEvidence =>
      evidence.kind === "action_verification" &&
      evidence.baselineRunId === result.runId &&
      evidence.verificationRunId !== result.runId &&
      evidence.field === field &&
      evidence.actionReasonCode === evaluation.actionReasonCode &&
      evidence.beforeValue === evaluation.proposedChange?.before &&
      evidence.afterValue === evaluation.proposedChange?.after &&
      evaluation.evidenceRefs.some(
        (reference) => reference.key === evidence.key,
      ),
  );
}

/** Returns the child Runs the application must load before Gate validation. */
export function actionGateVerificationRunIds(result: CompletedRun): string[] {
  if (result.verdict !== "ADJUST") return [];

  return [
    ...new Set(
      result.recommendedActions.flatMap((evaluation) => {
        const attestation = findActionGateAttestation(result, evaluation);
        return attestation === undefined ? [] : [attestation.verificationRunId];
      }),
    ),
  ];
}

/** Fails an unattested or non-terminal ADJUST closed without Store access. */
export function closeUnverifiedAdjust(
  result: RunResult,
  verificationChildren: ReadonlyMap<string, ActionGateRunRecord | undefined>,
): RunResult {
  if (
    result.status !== "completed" ||
    result.verdict !== "ADJUST" ||
    hasVerifiedActionGate(result, verificationChildren)
  ) {
    return result;
  }

  const targetAttestations = result.evidence.filter(
    (item) =>
      item.kind === "action_verification" &&
      item.targetOutputProof !== undefined,
  );
  const rejectedKeys = new Set(
    targetAttestations.flatMap((item) =>
      item.kind === "action_verification"
        ? [
            item.key,
            ...(item.resultEvidenceKey === undefined
              ? []
              : [item.resultEvidenceKey]),
          ]
        : [],
    ),
  );
  const rejectedActions = new Set(
    result.recommendedActions
      .filter((action) =>
        action.evidenceRefs.some((reference) =>
          rejectedKeys.has(reference.key),
        ),
      )
      .map((action) => action.id),
  );
  const evaluations =
    result.p0?.remediation.status === "VERIFIED"
      ? (result.p0.remediation.evaluations ?? 0)
      : 0;
  return completedRunResultSchema.parse({
    ...result,
    verdict: "STOP",
    summary: "No verified child Run and Action Gate attestation is available",
    recommendedActions: [],
    ...(targetAttestations.length === 0
      ? {}
      : {
          evidence: result.evidence.filter(
            (item) => !rejectedKeys.has(item.key),
          ),
          ruleResults: result.ruleResults.map((rule) => ({
            ...rule,
            actionEvaluations: rule.actionEvaluations.filter(
              (action) => !rejectedActions.has(action.id),
            ),
          })),
          ...(result.p0 === undefined
            ? {}
            : {
                p0: {
                  ...result.p0,
                  remediation: {
                    status: "UNKNOWN",
                    reason: "EVIDENCE_NOT_VERIFIED",
                    evaluations,
                  },
                },
              }),
        }),
  });
}

function hasVerifiedActionGate(
  result: CompletedRun,
  verificationChildren: ReadonlyMap<string, ActionGateRunRecord | undefined>,
): boolean {
  if (
    result.recommendedActions.length === 0 ||
    hasTerminalNoRouteFailure(result)
  )
    return false;

  return result.recommendedActions.every((evaluation) => {
    const attestation = findActionGateAttestation(result, evaluation);
    if (attestation === undefined) return false;
    if (
      result.p0?.remediation.status === "VERIFIED" &&
      result.p0.remediation.verificationProof !== undefined &&
      attestation.targetOutputProof === undefined
    )
      return false;

    const childRecord = verificationChildren.get(attestation.verificationRunId);
    if (
      childRecord?.status !== "completed" ||
      childRecord.result.status !== "completed"
    ) {
      return false;
    }

    if (attestation.targetOutputProof !== undefined) {
      return childRunPassesSelectedTargetGate(result, childRecord.result);
    }

    const childOutput = economicSimulatedTokenOutEvidence(childRecord.result);
    const crossRunResultRef = attestation.resultEvidenceRef;
    return (
      (crossRunResultRef === undefined ||
        (crossRunResultRef.runId === childRecord.result.runId &&
          crossRunResultRef.evidenceId === childOutput?.key)) &&
      childRunPassesActionGate(childRecord.result, result.runId)
    );
  });
}

export function evidenceRefFromItem(evidence: EvidenceProvenance): EvidenceRef {
  return {
    key: evidence.key,
    source: evidence.source,
    stage: evidence.stage,
    blockNumber: evidence.blockNumber,
    simulatorPinnedBlock: evidence.simulatorPinnedBlock,
    runtimeVersion: evidence.runtimeVersion,
    runtimeRevision: evidence.runtimeRevision,
    fixtureId: evidence.fixtureId,
    reproducibility: evidence.reproducibility,
    isReplay: evidence.isReplay,
    isMock: evidence.isMock,
  };
}

/** Builds a public ADJUST baseline while keeping child Evidence child-owned. */
export function buildVerifiedAdjustBaseline(
  baseline: CompletedRun,
  child: CompletedRun,
  adjustment: { before: string; after: string },
): CompletedRun {
  if (hasTerminalNoRouteFailure(baseline)) {
    throw new Error("NO_ROUTE_FOUND cannot be promoted to ADJUST");
  }

  const targetProof =
    baseline.p0?.remediation.status === "VERIFIED"
      ? baseline.p0.remediation.verificationProof
      : undefined;
  const childOutput =
    targetProof === undefined
      ? economicSimulatedTokenOutEvidence(child)
      : child.evidence.find(
          (item): item is SimulatedTokenOutEvidence =>
            item.kind === "simulated_token_out" &&
            item.key === targetProof.resultEvidenceRef.evidenceId,
        );
  if (
    targetProof !== undefined &&
    !childRunPassesSelectedTargetGate(baseline, child)
  )
    throw new Error("Selected target Action Gate did not pass");
  if (childOutput === undefined) {
    throw new Error(
      "Action Gate verification requires child Economic simulated tokenOut Evidence",
    );
  }

  const boundaryAtomic =
    baseline.intent.economicBoundary.availability === "available"
      ? baseline.intent.economicBoundary.minimumReceivedAtomic
      : undefined;
  if (boundaryAtomic === undefined && targetProof === undefined) {
    throw new Error(
      "Action Gate verification requires an available Economic Boundary",
    );
  }

  const attestationKey = "action-verification-amount-in";
  if (baseline.evidence.some((item) => item.key === attestationKey))
    throw new Error("Action verification Evidence key collision");
  const attestation: ActionVerificationEvidence = {
    kind: "action_verification",
    key: attestationKey,
    status: "confirmed",
    summary: "A verification child Run confirmed the proposed amountIn change",
    source: "derived",
    stage: "SIMULATE",
    blockNumber: childOutput.blockNumber,
    simulatorPinnedBlock: childOutput.simulatorPinnedBlock,
    runtimeVersion: childOutput.runtimeVersion,
    runtimeRevision: childOutput.runtimeRevision,
    fixtureId: childOutput.fixtureId,
    reproducibility: childOutput.reproducibility,
    isReplay: false,
    isMock: false,
    field: "amountIn",
    actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
    baselineRunId: baseline.runId,
    verificationRunId: child.runId,
    beforeValue: adjustment.before,
    afterValue: adjustment.after,
    baselineBoundaryAtomic: boundaryAtomic,
    verificationBoundaryAtomic: boundaryAtomic,
    ...(targetProof === undefined
      ? {
          resultEvidenceRef: {
            kind: "CROSS_RUN_EVIDENCE" as const,
            runId: child.runId,
            evidenceId: childOutput.key,
          },
        }
      : {}),
    ...(targetProof === undefined ? {} : { targetOutputProof: targetProof }),
  };

  const verificationReference = evidenceRefFromItem(attestation);
  const recommendedAction: ActionEvaluation = {
    id: "verified-amount-in-adjustment",
    action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
    relevance: "RELEVANT",
    recommendable: true,
    actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
    // Selected-target proof points to child Evidence only inside the local
    // attestation; public Action refs stay scoped to this parent Run.
    evidenceRefs: [verificationReference],
    proposedChange: {
      field: "amountIn",
      before: adjustment.before,
      after: adjustment.after,
    },
  };

  const ruleResults = baseline.ruleResults.map((rule) =>
    rule.ruleId === "P0-ECONOMIC-001"
      ? {
          ...rule,
          actionEvaluations: [recommendedAction],
        }
      : rule,
  );

  return completedRunResultSchema.parse({
    ...baseline,
    verdict: "ADJUST",
    summary:
      targetProof === undefined
        ? "A verified amount adjustment can satisfy the Economic Boundary"
        : "An authorized input increase preserved the selected output target",
    recommendedActions: [recommendedAction],
    evidence: [...baseline.evidence, attestation],
    ruleResults,
  });
}

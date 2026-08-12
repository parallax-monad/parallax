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

const REQUIRED_CHILD_RULE_IDS = [
  "P0-EVIDENCE-001",
  "P0-EXECUTION-001",
  "P0-ECONOMIC-001",
] as const;

type CompletedRun = Extract<RunResult, { status: "completed" }>;

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
    result.ruleResults.some((rule) => rule.status === "UNKNOWN")
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

  return completedRunResultSchema.parse({
    ...result,
    verdict: "STOP",
    summary: "No verified child Run and Action Gate attestation is available",
    recommendedActions: [],
  });
}

function hasVerifiedActionGate(
  result: CompletedRun,
  verificationChildren: ReadonlyMap<string, ActionGateRunRecord | undefined>,
): boolean {
  if (result.recommendedActions.length === 0) return false;

  return result.recommendedActions.every((evaluation) => {
    const attestation = findActionGateAttestation(result, evaluation);
    if (attestation === undefined) return false;

    const childRecord = verificationChildren.get(attestation.verificationRunId);
    return (
      childRecord?.status === "completed" &&
      childRecord.result.status === "completed" &&
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

/**
 * Builds a publicly verified ADJUST baseline from a STOP/ADJUST baseline and
 * passing child. Shared Contract requires same-Run result Evidence for
 * recommendable Actions; the verified output is a derived attestation payload
 * (not the child's Evidence record relocated into the baseline).
 */
export function buildVerifiedAdjustBaseline(
  baseline: CompletedRun,
  child: CompletedRun,
  adjustment: { before: string; after: string },
): CompletedRun {
  const childOutput = economicSimulatedTokenOutEvidence(child);
  if (childOutput === undefined) {
    throw new Error(
      "Action Gate verification requires child Economic simulated tokenOut Evidence",
    );
  }

  const boundaryAtomic =
    baseline.intent.economicBoundary.availability === "available"
      ? baseline.intent.economicBoundary.minimumReceivedAtomic
      : undefined;
  if (boundaryAtomic === undefined) {
    throw new Error(
      "Action Gate verification requires an available Economic Boundary",
    );
  }

  const baselineSimulationInput = baseline.evidence.find(
    (item) =>
      item.kind === "generic" &&
      item.simulationInputRole === "SIMULATION_RECEIPT",
  );

  const attestationKey = "action-verification-amount-in";
  const verifiedOutputKey = "verified-output-improvement";
  const verifiedOutput: SimulatedTokenOutEvidence = {
    kind: "simulated_token_out",
    key: verifiedOutputKey,
    status: "confirmed",
    summary: "Verified simulated output after the proposed amountIn adjustment",
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
    tokenOut: childOutput.tokenOut,
    recipient: childOutput.recipient,
    amountReceivedAtomic: childOutput.amountReceivedAtomic,
    derivation: childOutput.derivation,
    derivationVersion: childOutput.derivationVersion,
    inputEvidenceRefs:
      baselineSimulationInput === undefined
        ? childOutput.inputEvidenceRefs.map((reference) =>
            evidenceRefFromItem(reference),
          )
        : [evidenceRefFromItem(baselineSimulationInput)],
  };

  const attestation: ActionVerificationEvidence = {
    kind: "action_verification",
    key: attestationKey,
    status: "confirmed",
    summary: "A verification child Run confirmed the proposed amountIn change",
    source: "derived",
    stage: "SIMULATE",
    blockNumber: verifiedOutput.blockNumber,
    simulatorPinnedBlock: verifiedOutput.simulatorPinnedBlock,
    runtimeVersion: verifiedOutput.runtimeVersion,
    runtimeRevision: verifiedOutput.runtimeRevision,
    fixtureId: verifiedOutput.fixtureId,
    reproducibility: verifiedOutput.reproducibility,
    isReplay: verifiedOutput.isReplay,
    isMock: verifiedOutput.isMock,
    field: "amountIn",
    actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
    baselineRunId: baseline.runId,
    verificationRunId: child.runId,
    beforeValue: adjustment.before,
    afterValue: adjustment.after,
    resultEvidenceKey: verifiedOutputKey,
    baselineBoundaryAtomic: boundaryAtomic,
    verificationBoundaryAtomic: boundaryAtomic,
  };

  const verificationReference = evidenceRefFromItem(attestation);
  const resultReference = evidenceRefFromItem(verifiedOutput);
  const recommendedAction: ActionEvaluation = {
    id: "verified-amount-in-adjustment",
    action: { kind: "TRANSACTION_ADJUSTMENT", field: "amountIn" },
    relevance: "RELEVANT",
    recommendable: true,
    actionReasonCode: "OUTPUT_IMPROVEMENT_VERIFIED",
    // Contract requires the same-Run result EvidenceRef alongside attestation.
    evidenceRefs: [verificationReference, resultReference],
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
    summary: "A verified amount adjustment can satisfy the Economic Boundary",
    recommendedActions: [recommendedAction],
    evidence: [...baseline.evidence, verifiedOutput, attestation],
    ruleResults,
  });
}

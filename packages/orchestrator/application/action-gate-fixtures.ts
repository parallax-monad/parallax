import type { NormalizedSwapIntent, RunResult } from "@parallax/contracts";
import { evidenceRefFromItem } from "./action-gate.js";

type CompletedRunResult = Extract<RunResult, { status: "completed" }>;

/** Runtime identity + assets needed to build Action Gate fixture Runs. */
export type ActionGateFixtureAssets = {
  sender: string;
  mon: Extract<NormalizedSwapIntent["tokenIn"], { kind: "native" }>;
  usdc: Extract<NormalizedSwapIntent["tokenOut"], { kind: "erc20" }>;
  simulatorPinnedBlock: string;
  runtimeVersion: string;
  runtimeRevision: string;
};

function actionGateEvidenceBundle(
  assets: ActionGateFixtureAssets,
  amountReceivedAtomic: string,
) {
  const {
    sender,
    usdc,
    simulatorPinnedBlock,
    runtimeVersion,
    runtimeRevision,
  } = assets;

  const routeEvidence = {
    kind: "generic" as const,
    key: "route-quote",
    status: "confirmed" as const,
    summary: "Moss returned a route for the checked Intent",
    source: "quote" as const,
    stage: "QUOTE" as const,
    blockNumber: "12345",
    simulatorPinnedBlock,
    runtimeVersion,
    runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
    routeInputRole: "ROUTE_QUOTE" as const,
  };
  const evidenceCompleteness = {
    kind: "generic" as const,
    key: "evidence-completeness",
    status: "confirmed" as const,
    summary: "P0 Evidence completeness is verified",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    simulatorPinnedBlock,
    runtimeVersion,
    runtimeRevision,
    coreRole: "EVIDENCE_COMPLETENESS" as const,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };
  const simulationInput = {
    kind: "generic" as const,
    key: "simulation-receipt",
    status: "confirmed" as const,
    summary: "Simulation receipt is available",
    source: "moss" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    simulatorPinnedBlock,
    runtimeVersion,
    runtimeRevision,
    simulationInputRole: "SIMULATION_RECEIPT" as const,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
  };
  const simulationOutput = {
    kind: "simulated_token_out" as const,
    key: "simulated-token-out",
    status: "confirmed" as const,
    summary: "Recipient tokenOut balance delta",
    source: "derived" as const,
    stage: "SIMULATE" as const,
    blockNumber: "12345",
    simulatorPinnedBlock,
    runtimeVersion,
    runtimeRevision,
    reproducibility: "REPRODUCIBLE" as const,
    isReplay: false,
    isMock: false,
    tokenOut: usdc,
    recipient: sender,
    amountReceivedAtomic,
    derivation: "recipient_balance_delta" as const,
    derivationVersion: "recipient-balance-delta/v1",
    inputEvidenceRefs: [evidenceRefFromItem(simulationInput)],
  };
  return {
    routeEvidence,
    evidenceCompleteness,
    simulationInput,
    simulationOutput,
  };
}

function economicFixtureResult(
  assets: ActionGateFixtureAssets,
  runId: string,
  intent: NormalizedSwapIntent,
  options: {
    amountReceivedAtomic: string;
    verdict: CompletedRunResult["verdict"];
    summary: string;
    economic:
      | { status: "PASS" }
      | { status: "FAIL"; reasonCode: "OUTPUT_BELOW_BOUNDARY" };
  },
): CompletedRunResult {
  const {
    routeEvidence,
    evidenceCompleteness,
    simulationInput,
    simulationOutput,
  } = actionGateEvidenceBundle(assets, options.amountReceivedAtomic);

  const economicRule =
    options.economic.status === "PASS"
      ? {
          ruleId: "P0-ECONOMIC-001" as const,
          status: "PASS" as const,
          evidenceRefs: [evidenceRefFromItem(simulationOutput)],
          actionEvaluations: [],
        }
      : {
          ruleId: "P0-ECONOMIC-001" as const,
          status: "FAIL" as const,
          reasonCode: options.economic.reasonCode,
          evidenceRefs: [evidenceRefFromItem(simulationOutput)],
          actionEvaluations: [],
        };

  return {
    runId,
    replayMode: false,
    intent,
    simulatorPinnedBlock: assets.simulatorPinnedBlock,
    status: "completed",
    systemStatus: "OK",
    verdict: options.verdict,
    summary: options.summary,
    recommendedActions: [],
    irrelevantActions: [],
    ruleResults: [
      {
        ruleId: "P0-EVIDENCE-001",
        status: "PASS",
        evidenceRefs: [evidenceRefFromItem(evidenceCompleteness)],
        actionEvaluations: [],
      },
      {
        ruleId: "P0-EXECUTION-001",
        status: "PASS",
        evidenceRefs: [evidenceRefFromItem(routeEvidence)],
        actionEvaluations: [],
      },
      economicRule,
    ],
    evidence: [
      routeEvidence,
      evidenceCompleteness,
      simulationInput,
      simulationOutput,
    ],
    scope: [
      { key: "P0-EVIDENCE-001", label: "Evidence", status: "checked" },
      { key: "P0-EXECUTION-001", label: "Execution", status: "checked" },
      { key: "P0-ECONOMIC-001", label: "Economic", status: "checked" },
    ],
    route: {
      availability: "available",
      protocol: "kuru",
      path: [assets.mon, assets.usdc],
      source: "quote",
      blockNumber: "12345",
      evidenceRef: evidenceRefFromItem(routeEvidence),
    },
  };
}

export function economicFailStopResult(
  assets: ActionGateFixtureAssets,
  runId: string,
  intent: NormalizedSwapIntent,
): CompletedRunResult {
  return economicFixtureResult(assets, runId, intent, {
    amountReceivedAtomic: "10000",
    verdict: "STOP",
    summary: "Output is below the Economic Boundary",
    economic: { status: "FAIL", reasonCode: "OUTPUT_BELOW_BOUNDARY" },
  });
}

export function economicPassChildResult(
  assets: ActionGateFixtureAssets,
  runId: string,
  intent: NormalizedSwapIntent,
): CompletedRunResult {
  return economicFixtureResult(assets, runId, intent, {
    amountReceivedAtomic: "30000",
    verdict: "PROCEED",
    summary: "Adjusted Intent meets the Economic Boundary",
    economic: { status: "PASS" },
  });
}

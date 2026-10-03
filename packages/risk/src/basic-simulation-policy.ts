import type { AssetReference, RunResult } from "@parallax/contracts";

export const BASIC_SIMULATION_POLICY = "BASIC-SIMULATION-001";

/**
 * Bounded execution-readiness policy for an unconstrained live swap.
 * PROCEED accepts the recorded call/gas/binding checks only. It does not certify
 * complete simulation, asset changes, quote fidelity or a remediation child.
 * The original evidence, required-rule observations and P0 states stay intact.
 */
export function applyBasicSimulationRiskPolicy(run: RunResult): RunResult {
  if (
    run.status !== "completed" ||
    run.replayMode ||
    run.intent.chainId !== 421614 ||
    run.intent.protocol !== "camelot-v3" ||
    run.verdict !== "UNKNOWN" ||
    run.intent.economicBoundary.availability !== "unavailable" ||
    run.intent.amountInIncreaseAuthorization?.availability === "available" ||
    run.route?.availability !== "available" ||
    run.recommendedActions.length !== 0 ||
    run.irrelevantActions.length !== 0 ||
    run.evidence.some((item) => item.status === "failed") ||
    run.ruleResults.some((rule) => rule.status === "FAIL")
  ) {
    return run;
  }

  const p0 = run.p0;
  const simulation = p0?.basicSimulation;
  const evidence = run.providerEvidence;
  if (
    p0?.evidenceState !== "INCOMPLETE" ||
    p0.remediation.status !== "NOT_RUN" ||
    p0.constraints.length !== 0 ||
    simulation?.validityAtExecution !== "VALID" ||
    simulation.call.status !== "SUCCEEDED" ||
    simulation.call.returnDataFingerprint === undefined ||
    simulation.gasEstimate.status !== "AVAILABLE" ||
    simulation.gasEstimate.gasUnits === undefined ||
    BigInt(simulation.gasEstimate.gasUnits) <= 0n ||
    simulation.blockHash === undefined ||
    simulation.failureStage !== undefined ||
    evidence?.provider.integrationStatus !== "OK" ||
    evidence.provider.status !== "UNKNOWN" ||
    evidence.provider.failure !== undefined ||
    evidence.provider.errors.value?.length !== 0 ||
    evidence.execution.status !== "SUCCESS" ||
    evidence.provenance.mode !== "LIVE" ||
    evidence.provenance.source !== "rpc" ||
    evidence.provenance.simulationBlock !== simulation.blockNumber ||
    run.simulatorPinnedBlock !== simulation.blockNumber ||
    evidence.provenance.runtime?.runtimeVersion === undefined ||
    evidence.provenance.runtime.runtimeRevision === undefined ||
    evidence.quote.source !== "quote" ||
    evidence.quote.value === null ||
    evidence.action.source !== "rpc" ||
    evidence.action.value?.length !== 1 ||
    evidence.warnings.value?.length !== 0 ||
    evidence.assetChangeAssessment === "UNEXPLAINED" ||
    evidence.unknownScope.some(
      (key) =>
        ![
          "receipt",
          "outcome",
          "assetChanges",
          "simulation",
          "freshness",
        ].includes(key),
    )
  ) {
    return run;
  }

  const required = [
    evidence.quote,
    evidence.action,
    evidence.blockNumber,
    evidence.warnings,
  ];
  if (
    required.some(
      (field) =>
        field.value === null ||
        field.reproducibility !== "REPRODUCIBLE" ||
        field.blockNumber !== simulation.blockNumber ||
        field.fetchedAt === undefined ||
        !["quote", "rpc"].includes(field.source),
    ) ||
    evidence.blockNumber.value !== simulation.blockNumber
  ) {
    return run;
  }

  const binding = simulation.transactionBinding;
  const intent = run.intent;
  if (
    binding === undefined ||
    binding.chainId !== intent.chainId ||
    binding.protocol !== intent.protocol ||
    binding.sender.toLowerCase() !== intent.sender.toLowerCase() ||
    binding.recipient.toLowerCase() !== intent.recipient.toLowerCase() ||
    binding.tokenIn.toLowerCase() !== assetKey(intent.tokenIn) ||
    binding.tokenOut.toLowerCase() !== assetKey(intent.tokenOut) ||
    binding.amountInAtomic !== intent.amountInAtomic
  ) {
    return run;
  }

  return {
    ...run,
    verdict: "PROCEED",
    summary: `${BASIC_SIMULATION_POLICY}: Basic simulation passed: contract call, gas estimate and exact transaction binding were verified at the recorded block. Full simulation, asset changes and economic output remain unverified.`,
  };
}

function assetKey(asset: AssetReference): string {
  return asset.kind === "native" ? "native" : asset.address.toLowerCase();
}

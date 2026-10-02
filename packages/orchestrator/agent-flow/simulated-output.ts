import type {
  EvidenceItem,
  GenericEvidence,
  NormalizedSwapIntent,
} from "@parallax/contracts";

const uint256Max = (1n << 256n) - 1n;

function atomic(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return;
  if (value.length > 78) return;
  const result = BigInt(value);
  return result <= uint256Max ? result : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameAddress(value: unknown, expected: string): boolean {
  return (
    typeof value === "string" && value.toLowerCase() === expected.toLowerCase()
  );
}

type TokenQualification = {
  tokenOut: string;
  tokenCodeHash: string;
  transactionFingerprint: string;
  blockNumber: string;
  blockHash: string;
  qualificationVersion: string;
};

function hasBoundExecution(
  intent: NormalizedSwapIntent,
  evidence: GenericEvidence,
): boolean {
  const outcome = evidence.outcome.value;
  const receipt = evidence.receipt.value;
  const action = evidence.action.value;
  return (
    record(outcome) &&
    record(receipt) &&
    action?.length === 1 &&
    record(action[0]) &&
    outcome.amountInAtomic === intent.amountInAtomic &&
    outcome.evaluatedAmountIn === evidence.intent.amountIn &&
    (intent.tokenIn.kind === "native"
      ? evidence.intent.tokenIn === "native" ||
        (intent.chainId === 143 && evidence.intent.tokenIn === "MON")
      : sameAddress(evidence.intent.tokenIn, intent.tokenIn.address)) &&
    (intent.tokenOut.kind === "native"
      ? evidence.intent.tokenOut === "native" ||
        (intent.chainId === 143 && evidence.intent.tokenOut === "MON")
      : sameAddress(evidence.intent.tokenOut, intent.tokenOut.address)) &&
    typeof outcome.transactionFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(outcome.transactionFingerprint) &&
    outcome.transactionFingerprint === action[0].transactionFingerprint &&
    outcome.transactionFingerprint === receipt.transactionFingerprint &&
    typeof outcome.blockHash === "string" &&
    /^0x[a-fA-F0-9]{64}$/.test(outcome.blockHash) &&
    outcome.blockHash === receipt.blockHash &&
    [evidence.action, evidence.receipt].every(
      (field) =>
        (field.source === "moss" ||
          field.source === "rpc" ||
          field.source === "derived") &&
        field.reproducibility === "REPRODUCIBLE" &&
        field.blockNumber === evidence.provenance.simulationBlock,
    )
  );
}

/** Local normalized qualification; opaque providerData is never authority. */
export function validatedTokenQualification(
  intent: NormalizedSwapIntent,
  evidence: GenericEvidence,
): TokenQualification | undefined {
  const outcome = evidence.outcome.value;
  if (!record(outcome) || outcome.derivation !== "asset_change") return;
  const proof = outcome.tokenQualification;
  const receipt = evidence.receipt.value;
  const action = evidence.action.value;
  if (
    evidence.provenance.mode !== "LIVE" ||
    evidence.provider.status !== "SUCCESS" ||
    evidence.execution.status !== "SUCCESS" ||
    evidence.simulation.value?.complete !== true ||
    evidence.simulation.value.expectedTransactions !== 1 ||
    evidence.simulation.value.observedResults !== 1 ||
    evidence.simulation.value.halted ||
    evidence.simulation.value.missingTransactionIndexes.length !== 0 ||
    evidence.simulation.value.unmatchedResultIndexes.length !== 0 ||
    !hasBoundExecution(intent, evidence) ||
    !record(proof) ||
    !record(receipt) ||
    action?.length !== 1 ||
    !record(action[0]) ||
    intent.tokenOut.kind !== "erc20" ||
    proof.chainId !== intent.chainId ||
    proof.protocol !== intent.protocol ||
    !sameAddress(proof.tokenOut, intent.tokenOut.address) ||
    !sameAddress(receipt.tokenOut, intent.tokenOut.address) ||
    !sameAddress(proof.sender, intent.sender) ||
    !sameAddress(proof.recipient, intent.recipient) ||
    proof.amountInAtomic !== intent.amountInAtomic ||
    proof.semantics !== "transfer_events_equal_balance_changes" ||
    proof.completeLogSet !== true ||
    proof.completeAssetChanges !== true ||
    typeof proof.qualificationVersion !== "string" ||
    !proof.qualificationVersion.trim() ||
    typeof proof.transactionFingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(proof.transactionFingerprint) ||
    proof.transactionFingerprint !== action[0].transactionFingerprint ||
    proof.transactionFingerprint !== receipt.transactionFingerprint ||
    proof.transactionFingerprint !== outcome.transactionFingerprint ||
    typeof proof.blockHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.blockHash) ||
    proof.blockHash !== receipt.blockHash ||
    proof.blockHash !== outcome.blockHash ||
    typeof proof.blockNumber !== "string" ||
    proof.blockNumber !== evidence.provenance.simulationBlock ||
    typeof proof.tokenCodeHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(proof.tokenCodeHash) ||
    proof.tokenCodeHash !== receipt.tokenCodeHash ||
    [
      evidence.outcome,
      evidence.action,
      evidence.receipt,
      evidence.simulation,
    ].some(
      (field) =>
        (field.source !== "moss" &&
          field.source !== "rpc" &&
          field.source !== "derived") ||
        field.reproducibility !== "REPRODUCIBLE" ||
        field.blockNumber !== proof.blockNumber,
    )
  )
    return;
  return {
    tokenOut: intent.tokenOut.address,
    tokenCodeHash: proof.tokenCodeHash,
    transactionFingerprint: proof.transactionFingerprint,
    blockNumber: proof.blockNumber,
    blockHash: proof.blockHash,
    qualificationVersion: proof.qualificationVersion,
  };
}

/** Consume normalized proof only; an amount alias or a Transfer is not a proof. */
export function extractSimulatedOutput(
  intent: NormalizedSwapIntent,
  evidence: GenericEvidence,
  items: readonly EvidenceItem[],
) {
  const value = evidence.outcome.value;
  const runtime = evidence.provenance.runtime;
  const block = evidence.provenance.simulationBlock;
  if (
    !record(value) ||
    !runtime?.runtimeVersion ||
    !runtime.runtimeRevision ||
    block === undefined ||
    evidence.blockNumber.value !== block ||
    evidence.provenance.mode !== "LIVE" ||
    evidence.provider.status !== "SUCCESS" ||
    evidence.execution.status !== "SUCCESS" ||
    evidence.simulation.value?.complete !== true ||
    evidence.simulation.value.expectedTransactions !== 1 ||
    evidence.simulation.value.halted ||
    evidence.simulation.value.missingTransactionIndexes.length !== 0 ||
    evidence.simulation.value.unmatchedResultIndexes.length !== 0 ||
    evidence.simulation.value.observedResults !==
      evidence.simulation.value.expectedTransactions ||
    evidence.blockNumber.source === "unknown" ||
    evidence.blockNumber.source === "external" ||
    evidence.blockNumber.source === "mock" ||
    evidence.blockNumber.source === "quote" ||
    evidence.blockNumber.reproducibility !== "REPRODUCIBLE" ||
    evidence.outcome.source === "unknown" ||
    evidence.outcome.source === "external" ||
    evidence.outcome.source === "mock" ||
    evidence.outcome.source === "quote" ||
    evidence.outcome.reproducibility !== "REPRODUCIBLE" ||
    evidence.outcome.blockNumber !== block ||
    evidence.simulation.source === "unknown" ||
    evidence.simulation.source === "external" ||
    evidence.simulation.source === "mock" ||
    evidence.simulation.source === "quote" ||
    evidence.simulation.reproducibility !== "REPRODUCIBLE" ||
    evidence.simulation.blockNumber !== block ||
    evidence.intent.chainId !== intent.chainId ||
    evidence.intent.protocol !== intent.protocol ||
    (evidence.provenance.observedChainId !== undefined &&
      evidence.provenance.observedChainId !== intent.chainId) ||
    !sameAddress(evidence.intent.sender, intent.sender) ||
    !sameAddress(value.recipient, intent.recipient)
  )
    return;

  const token = record(value.tokenOut) ? value.tokenOut : undefined;
  if (
    intent.tokenOut.kind === "native"
      ? value.tokenOut !== "native" && token?.kind !== "native"
      : !sameAddress(
          token?.kind === "erc20" ? token.address : value.tokenOut,
          intent.tokenOut.address,
        )
  )
    return;

  const amount = atomic(value.amountReceivedAtomic);
  if (
    amount === undefined ||
    typeof value.derivationVersion !== "string" ||
    !value.derivationVersion.trim() ||
    !Array.isArray(value.inputEvidenceKeys) ||
    value.inputEvidenceKeys.length === 0 ||
    !value.inputEvidenceKeys.every((key) => typeof key === "string") ||
    new Set(value.inputEvidenceKeys).size !== value.inputEvidenceKeys.length
  )
    return;

  const inputs = value.inputEvidenceKeys.map((key) =>
    items.find((item) => item.key === key),
  );
  if (
    inputs.some(
      (item) =>
        item?.kind !== "generic" ||
        item.status !== "confirmed" ||
        item.source === "unknown" ||
        item.source === "external" ||
        item.source === "mock" ||
        item.source === "quote" ||
        item.stage !== "SIMULATE" ||
        item.isReplay ||
        item.isMock ||
        item.reproducibility !== "REPRODUCIBLE" ||
        item.blockNumber !== block ||
        item.simulatorPinnedBlock !== block ||
        item.runtimeVersion !== runtime.runtimeVersion ||
        item.runtimeRevision !== runtime.runtimeRevision ||
        item.coreRole !== undefined ||
        item.routeInputRole !== undefined ||
        (item.simulationInputRole === undefined &&
          (value.derivation !== "asset_change" ||
            item.key !== `${runtime.commit ?? "live"}:token-qualification`)),
    )
  )
    return;
  const sourceKey = `${runtime.commit ?? "live"}:${value.derivation === "recipient_balance_delta" ? "outcome" : "asset-changes"}`;
  const source = inputs.find((item) => item?.key === sourceKey);
  if (source?.kind !== "generic") return;

  if (value.derivation === "recipient_balance_delta") {
    if (!hasBoundExecution(intent, evidence)) return;
    const before = atomic(value.balanceBeforeAtomic);
    const after = atomic(value.balanceAfterAtomic);
    if (
      source.simulationInputRole !== "RECIPIENT_BALANCE_SNAPSHOT" ||
      before === undefined ||
      after === undefined ||
      after - before !== amount
    )
      return;
  } else if (value.derivation === "asset_change") {
    if (
      !hasBoundExecution(intent, evidence) ||
      validatedTokenQualification(intent, evidence) === undefined
    )
      return;
    const qualification = inputs.find(
      (item) => item?.key === value.qualificationEvidenceKey,
    );
    // Qualification must be a separate confirmed attestation, not a receipt,
    // quote, outcome or a relabelled movement set. No existing partial Provider
    // fabricates this item; its future producer must be qualified independently.
    if (
      qualification?.kind !== "generic" ||
      qualification.key !== `${runtime.commit ?? "live"}:token-qualification` ||
      qualification.simulationInputRole !== undefined ||
      qualification.coreRole !== undefined ||
      qualification.routeInputRole !== undefined ||
      source.simulationInputRole !== "ASSET_CHANGE_SET" ||
      evidence.assetChangeAssessment !== "EXPLAINED" ||
      evidence.assetChanges.source === "unknown" ||
      evidence.assetChanges.source === "external" ||
      evidence.assetChanges.reproducibility !== "REPRODUCIBLE" ||
      evidence.assetChanges.blockNumber !== block ||
      evidence.assetChanges.value === null
    )
      return;
    let net = 0n;
    for (const change of evidence.assetChanges.value) {
      if (
        !record(change) ||
        change.kind !== "assetChange" ||
        typeof change.from !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(change.from) ||
        typeof change.to !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(change.to) ||
        typeof change.token !== "string" ||
        (change.token !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(change.token))
      )
        return;
      const movement = atomic(change.amountAtomic);
      if (movement === undefined) return;
      const matches =
        intent.tokenOut.kind === "native"
          ? change.token === "native"
          : sameAddress(change.token, intent.tokenOut.address);
      if (!matches) continue;
      if (sameAddress(change.to, intent.recipient)) net += movement;
      if (sameAddress(change.from, intent.recipient)) net -= movement;
    }
    if (net !== amount) return;
  } else return;

  return {
    amountReceivedAtomic: amount.toString(),
    derivation: value.derivation,
    derivationVersion: value.derivationVersion,
    inputEvidenceKeys: value.inputEvidenceKeys as string[],
  };
}

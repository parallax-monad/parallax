import type { AccountStateObservation, RunResult } from "@parallax/contracts";

const POLICY = "PARAMETER-ADJUSTMENT-001";

/** A request to edit inputs, with no claim that a replacement swap is verified. */
export function applyParameterAdjustment(
  run: RunResult,
  account: AccountStateObservation | undefined,
  quote: unknown,
): RunResult {
  if (
    run.status !== "completed" ||
    run.replayMode ||
    run.intent.chainId !== 421614 ||
    run.intent.protocol !== "camelot-v3" ||
    run.verdict === "ADJUST" ||
    run.verdict === "STOP" ||
    run.p0?.remediation.status === "VERIFIED" ||
    run.evidence.some((item) => item.kind === "action_verification")
  )
    return run;

  const intent = run.intent;
  let reason: string | undefined;
  let source: "rpc" | "quote" = "quote";
  let blockNumber: string | undefined;
  const balance = account?.balances.inputToken;
  if (
    account?.block.status === "VERIFIED" &&
    balance?.status === "AVAILABLE" &&
    account.context.chainId === intent.chainId &&
    account.context.protocol === intent.protocol &&
    account.context.sender.toLowerCase() === intent.sender.toLowerCase() &&
    account.context.amountInAtomic === intent.amountInAtomic &&
    JSON.stringify(account.context.tokenIn) ===
      JSON.stringify(intent.tokenIn) &&
    BigInt(balance.amountAtomic) < BigInt(intent.amountInAtomic)
  ) {
    reason = `Input balance ${balance.amountAtomic} is below requested amount ${intent.amountInAtomic} (atomic units). Reduce the input amount or fund the account, then re-check.`;
    source = "rpc";
    blockNumber = account.block.blockNumber;
  } else if (
    intent.economicBoundary.availability === "available" &&
    run.providerEvidence?.provider.integrationStatus === "OK" &&
    typeof quote === "object" &&
    quote !== null &&
    "source" in quote &&
    quote.source === "quote" &&
    "amountOutAtomic" in quote &&
    typeof quote.amountOutAtomic === "string" &&
    /^\d+$/.test(quote.amountOutAtomic) &&
    "fetchedAt" in quote &&
    typeof quote.fetchedAt === "string" &&
    Number.isFinite(Date.parse(quote.fetchedAt)) &&
    "blockNumber" in quote &&
    quote.blockNumber === run.simulatorPinnedBlock &&
    BigInt(quote.amountOutAtomic) <=
      BigInt(intent.economicBoundary.minimumReceivedAtomic)
  ) {
    reason = `Quoted output ${quote.amountOutAtomic} is at or below minimum received ${intent.economicBoundary.minimumReceivedAtomic} (atomic units). Review the swap parameters, then re-check. This is a quote comparison, not a simulated received amount.`;
    blockNumber = run.simulatorPinnedBlock;
  }
  if (reason === undefined) return run;
  return {
    ...run,
    verdict: "ADJUST",
    summary: reason,
    recommendedActions: [],
    irrelevantActions: [],
    evidence: [
      ...run.evidence,
      {
        kind: "generic",
        key: POLICY,
        status: "warning",
        summary: reason,
        source,
        blockNumber,
        reproducibility: "REPRODUCIBLE",
        simulatorPinnedBlock: run.simulatorPinnedBlock,
        runtimeVersion:
          run.providerEvidence?.provenance.runtime?.runtimeVersion,
        runtimeRevision:
          run.providerEvidence?.provenance.runtime?.runtimeRevision,
        isReplay: false,
        isMock: false,
      },
    ],
  };
}

/** Persisted advisory ADJUST is distinct from a verified transaction recommendation. */
export function isParameterAdjustment(run: RunResult): boolean {
  return (
    run.status === "completed" &&
    !run.replayMode &&
    run.intent.chainId === 421614 &&
    run.intent.protocol === "camelot-v3" &&
    run.verdict === "ADJUST" &&
    run.simulatorPinnedBlock !== undefined &&
    run.recommendedActions.length === 0 &&
    run.irrelevantActions.length === 0 &&
    run.p0?.remediation.status !== "VERIFIED" &&
    !run.evidence.some((item) => item.kind === "action_verification") &&
    run.evidence.some(
      (item) =>
        item.kind === "generic" &&
        item.key === POLICY &&
        item.status === "warning" &&
        !item.isReplay &&
        !item.isMock &&
        ["rpc", "quote"].includes(item.source) &&
        item.blockNumber === run.simulatorPinnedBlock &&
        item.simulatorPinnedBlock === run.simulatorPinnedBlock &&
        item.runtimeVersion ===
          run.providerEvidence?.provenance.runtime?.runtimeVersion &&
        item.runtimeRevision ===
          run.providerEvidence?.provenance.runtime?.runtimeRevision &&
        item.summary === run.summary &&
        validAdjustmentReason(run, item.source, item.summary),
    )
  );
}

function validAdjustmentReason(
  run: RunResult,
  source: string,
  summary: string,
): boolean {
  if (source === "rpc") {
    const match =
      /^Input balance (\d+) is below requested amount (\d+) \(atomic units\)\. Reduce the input amount or fund the account, then re-check\.$/.exec(
        summary,
      );
    return (
      match !== null &&
      match[1] !== undefined &&
      match[2] !== undefined &&
      match[2] === run.intent.amountInAtomic &&
      BigInt(match[1]) < BigInt(match[2])
    );
  }
  const match =
    /^Quoted output (\d+) is at or below minimum received (\d+) \(atomic units\)\. Review the swap parameters, then re-check\. This is a quote comparison, not a simulated received amount\.$/.exec(
      summary,
    );
  return (
    match !== null &&
    match[1] !== undefined &&
    match[2] !== undefined &&
    run.intent.economicBoundary.availability === "available" &&
    match[2] === run.intent.economicBoundary.minimumReceivedAtomic &&
    BigInt(match[1]) <= BigInt(match[2])
  );
}

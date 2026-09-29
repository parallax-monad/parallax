import type { CheckSwapResult } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

/** Read-only Backend facts. None of these statuses is inferred from another. */
export function P0ExecutionCard({
  result,
  language,
}: {
  result: CheckSwapResult;
  language: Language;
}) {
  const simulation = result.basicSimulation;
  const row = (label: string, value: string) => (
    <div
      className="flex justify-between gap-3 border-t border-line/50 py-2"
      key={label}
    >
      <dt className="text-dim">{label}</dt>
      <dd className="mono m-0 max-w-[60%] break-all text-right text-white">
        {value}
      </dd>
    </div>
  );

  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3 text-[12px]">
      <h3 className="m-0 mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-white">
        {say(language, { en: "Backend check facts", zh: "后端检查事实" })}
      </h3>
      <p className="m-0 mb-2 leading-[1.5] text-dim">
        {say(language, {
          en: "A successful call or available gas estimate does not mean this swap passed Risk review.",
          zh: "调用成功或 Gas 估算可用，不代表本次兑换通过风险审查。",
        })}
      </p>
      <dl className="m-0">
        {row("Run ID", result.backendRunId ?? result.runId)}
        {result.parentRunId && row("Parent Run ID", result.parentRunId)}
        {row(
          "Chain",
          result.chainId === 421614
            ? "Arbitrum Sepolia (421614)"
            : String(result.chainId ?? "unknown"),
        )}
        {row("Protocol", result.protocol ?? "unknown")}
        {row("Provider status", result.providerStatus ?? "not recorded")}
        {row("Execution result", result.executionStatus ?? "not recorded")}
        {row("eth_call", simulation?.call ?? "not recorded")}
        {row("Gas estimate", simulation?.gasEstimate ?? "not recorded")}
        {simulation?.gasUnits && row("Gas units", simulation.gasUnits)}
        {row(
          "Execution validity",
          simulation?.validityAtExecution ?? "not recorded",
        )}
        {row(
          "Selected quote baseline",
          result.expectationBaselineStatus ?? "not recorded",
        )}
        {row("Quote fidelity", result.quoteFidelityStatus ?? "not recorded")}
        {row("Evidence quality", result.evidenceState ?? "not recorded")}
        {row("Risk verdict", result.verdict)}
        {row("Remediation", result.remediationStatus ?? "not recorded")}
        {simulation && row("Block", simulation.blockNumber)}
        {simulation && row("Observed at", simulation.observedAt)}
        {simulation &&
          row(
            "Prepared transaction",
            simulation.preparedTransactionFingerprint,
          )}
        {simulation &&
          row(
            "Exact binding",
            simulation.transactionBound ? "recorded" : "not recorded",
          )}
        {simulation?.sender && row("Checked sender", simulation.sender)}
        {simulation?.router && row("Prepared router", simulation.router)}
        {simulation?.failureStage &&
          row("Failure stage", simulation.failureStage)}
        {simulation?.reason && row("Normalized reason", simulation.reason)}
      </dl>
    </section>
  );
}

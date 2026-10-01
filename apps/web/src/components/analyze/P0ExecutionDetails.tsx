import type { BasicSimulation, CheckSwapResult } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

function FactRow({
  label,
  language,
  value,
}: {
  label: Copy;
  language: Language;
  value: string;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-0">
      <dt className="text-dim">{say(language, label)}</dt>
      <dd className="mono m-0 min-w-0 break-all text-right text-white">
        {value}
      </dd>
    </div>
  );
}

function routeLabel(result: CheckSwapResult): string {
  const chainName =
    typeof result.chainId !== "number" || !Number.isFinite(result.chainId)
      ? "UNAVAILABLE"
      : result.chainId === 421614
        ? "Arbitrum Sepolia"
        : result.chainId === 42161
          ? "Arbitrum One"
          : `Chain ${result.chainId}`;
  const protocol = result.protocol?.trim();
  const protocolName = !protocol
    ? "UNAVAILABLE"
    : protocol === "camelot-v3"
      ? "Camelot V3"
      : protocol === "kuru"
        ? "Kuru"
        : protocol === "pancake"
          ? "PancakeSwap"
          : protocol;

  return `${chainName} · ${protocolName}`;
}

export function P0ExecutionDetails({
  result,
  language,
}: {
  result: CheckSwapResult;
  language: Language;
}) {
  const simulation: BasicSimulation | undefined = result.basicSimulation;
  const callStatus = simulation?.call.status ?? "UNAVAILABLE";
  const gasStatus = simulation?.gasEstimate.status ?? "UNAVAILABLE";
  const evidenceState = result.evidenceState ?? "UNKNOWN";
  const providerStatus = result.providerEvidence?.status ?? "UNKNOWN";
  const executionStatus = result.executionEvidence?.status ?? "UNKNOWN";
  const remediation = result.remediationStatus ?? "UNKNOWN";

  return (
    <details className="border-y border-line" aria-label="P0 execution facts">
      <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 overflow-hidden py-3 text-left text-[12px] font-bold uppercase text-dim marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-monad-dim focus-visible:outline-offset-2">
        <span className="min-w-0 flex-1 break-words">
          {say(language, {
            en: "Execution details",
            zh: "执行详情",
          })}
        </span>
        <span aria-hidden="true" className="shrink-0 text-monad-dim">
          +
        </span>
      </summary>
      <div className="border-t border-line pb-2">
        <h3 className="m-0 pt-3 text-[12px] font-bold uppercase text-dim">
          {routeLabel(result)}
        </h3>
        <dl className="m-0 mt-2">
          <FactRow
            language={language}
            label={{ en: "Provider status", zh: "Provider 状态" }}
            value={providerStatus}
          />
          <FactRow
            language={language}
            label={{ en: "Provider execution", zh: "Provider 执行结果" }}
            value={executionStatus}
          />
          <FactRow
            language={language}
            label={{ en: "basicSimulation call", zh: "basicSimulation 调用" }}
            value={callStatus}
          />
          <FactRow
            language={language}
            label={{ en: "Gas status", zh: "Gas 状态" }}
            value={gasStatus}
          />
          <FactRow
            language={language}
            label={{ en: "Evidence quality", zh: "Evidence 质量" }}
            value={evidenceState}
          />
          <FactRow
            language={language}
            label={{ en: "Risk verdict", zh: "风险判定" }}
            value={result.verdict}
          />
          <FactRow
            language={language}
            label={{ en: "Remediation", zh: "修复状态" }}
            value={remediation}
          />
          <FactRow
            language={language}
            label={{ en: "Run ID", zh: "Run ID" }}
            value={result.runId}
          />
          {result.parentRunId && (
            <FactRow
              language={language}
              label={{ en: "Parent Run", zh: "Parent Run" }}
              value={result.parentRunId}
            />
          )}
          <FactRow
            language={language}
            label={{ en: "Block", zh: "区块" }}
            value={
              simulation?.blockNumber ??
              simulation?.call.blockNumber ??
              result.simulatorPinnedBlock ??
              "UNAVAILABLE"
            }
          />
          <FactRow
            language={language}
            label={{ en: "Baseline quote ID", zh: "基线报价 ID" }}
            value={result.expectationBaseline?.quoteId ?? "UNAVAILABLE"}
          />
          <FactRow
            language={language}
            label={{ en: "Baseline provenance", zh: "基线来源" }}
            value={result.expectationBaseline?.provenance ?? "UNAVAILABLE"}
          />
          <FactRow
            language={language}
            label={{ en: "Baseline observed at", zh: "基线观测时间" }}
            value={result.expectationBaseline?.observedAt ?? "UNAVAILABLE"}
          />
          <FactRow
            language={language}
            label={{ en: "Provider observed at", zh: "Provider 观测时间" }}
            value={result.providerEvidence?.observedAt ?? "UNAVAILABLE"}
          />
        </dl>
        {simulation?.call.status === "SUCCEEDED" && (
          <p className="mb-0 mt-3 border-l-2 border-risk-elevated pl-3 text-[12px] leading-[1.5] text-dim">
            {say(language, {
              en: "eth_call success is an execution fact, not a safety or Risk pass.",
              zh: "eth_call 成功只代表执行检查结果，不代表安全或风险通过。",
            })}
          </p>
        )}
        {(evidenceState === "INCOMPLETE" || result.verdict === "UNKNOWN") && (
          <p className="mb-1 mt-2 text-[12px] font-semibold text-risk-elevated">
            {say(language, {
              en: "UNKNOWN is not a pass.",
              zh: "UNKNOWN 不代表通过。",
            })}
          </p>
        )}
      </div>
    </details>
  );
}

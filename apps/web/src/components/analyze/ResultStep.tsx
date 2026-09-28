import { useState } from "react";
import { ExecutionEconomicsCard } from "@/components/analyze/ExecutionEconomicsCard";
import { QuoteFidelityCard } from "@/components/analyze/QuoteFidelityCard";
import { VerdictIcon } from "@/components/analyze/StatusIcon";
import { TokenIcon } from "@/components/analyze/TokenIcon";
import { formatAmount } from "@/components/wallet/walletData";
import type { CheckSwapResult, Verdict } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const VERDICT_TONE: Record<Verdict, string> = {
  PROCEED: "border-risk-low/50 bg-risk-low/10 text-risk-low",
  ADJUST: "border-risk-moderate/50 bg-risk-moderate/10 text-risk-moderate",
  UNKNOWN: "border-risk-elevated/50 bg-risk-elevated/10 text-risk-elevated",
  STOP: "border-risk-high/50 bg-risk-high/10 text-risk-high",
};

const VERDICT_TITLE: Record<Verdict, Copy> = {
  PROCEED: { en: "No blocking evidence found", zh: "未发现阻断证据" },
  ADJUST: { en: "Adjust before proceeding", zh: "继续之前需要调整" },
  STOP: { en: "Do not use this path", zh: "不要使用当前路径" },
  UNKNOWN: { en: "More evidence is required", zh: "需要更多证据" },
};

const VERDICT_EXPLANATION: Record<Verdict, Copy> = {
  PROCEED: {
    en: "No blocking evidence was found within the checks completed for this swap.",
    zh: "在已完成的兑换检查范围内未发现阻断证据。",
  },
  ADJUST: {
    en: "A verified change may improve this swap. Review the available options.",
    zh: "已验证的变更可能改善此兑换。请查看可用选项。",
  },
  STOP: {
    en: "Blocking evidence applies to this transaction path.",
    zh: "阻断证据适用于当前交易路径。",
  },
  UNKNOWN: {
    en: "Required evidence is missing, incomplete, or not verified. This is not a pass.",
    zh: "必要证据缺失、不完整或未验证。这不代表通过。",
  },
};

const RECHECK_COPY: Copy = {
  en: "This result is based on the checked state. Re-check immediately before signing if conditions change.",
  zh: "此结果基于已检查的状态。如果条件发生变化，请在签名前立即重新检查。",
};

function SwapSummary({
  amountIn,
  tokenIn,
  amountOut,
  tokenOut,
  language,
}: {
  amountIn: string;
  tokenIn: string;
  amountOut: string;
  tokenOut: string;
  language: Language;
}) {
  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/50 p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TokenIcon size={26} symbol={tokenIn} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
              {say(language, { en: "You pay", zh: "你支付" })}
            </div>
            <div className="truncate text-[16px] font-extrabold text-white">
              {amountIn} {tokenIn}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-monad-dim" aria-hidden="true">
          <svg
            aria-hidden="true"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M13 7l5 5m0 0l-5 5m5-5H6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TokenIcon size={26} symbol={tokenOut} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
              {say(language, { en: "You receive", zh: "你收到" })}
            </div>
            <div className="truncate text-[16px] font-extrabold text-white">
              {amountOut} {tokenOut}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScopeSummary({
  result,
  language,
  expanded,
  onToggle,
}: {
  result: CheckSwapResult;
  language: Language;
  expanded: boolean;
  onToggle: () => void;
}) {
  const checked = result.checked.length;
  const unknown = result.unknowns.length;
  const notChecked = result.notChecked.length;

  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "Check scope", zh: "检查范围" })}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-white">
            <span>
              {say(language, { en: "Checked", zh: "已检查" })}: {checked}
            </span>
            <span className="text-dim">
              {say(language, { en: "Unknown", zh: "未知" })}: {unknown}
            </span>
            <span className="text-dim">
              {say(language, { en: "Not checked", zh: "未检查" })}: {notChecked}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          className="shrink-0 text-[12px] font-bold uppercase tracking-[0.06em] text-monad-dim underline"
          onClick={onToggle}
        >
          {say(
            language,
            expanded
              ? { en: "Hide details", zh: "收起详情" }
              : { en: "View details", zh: "查看详情" },
          )}
        </button>
      </div>
      {expanded && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          {result.unknowns.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-risk-elevated">
                {say(language, { en: "Unknown", zh: "未知" })}
              </div>
              <ul className="m-0 mt-1 list-disc space-y-1 pl-4 text-[13px] leading-[1.5] text-white">
                {result.unknowns.map((item) => (
                  <li key={item.id}>{say(language, item.reason)}</li>
                ))}
              </ul>
            </div>
          )}
          {result.checked.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
                {say(language, { en: "Checked", zh: "已检查" })}
              </div>
              <ul className="m-0 mt-1 list-disc space-y-1 pl-4 text-[13px] leading-[1.5] text-white">
                {result.checked.map((item) => (
                  <li key={item.en}>{say(language, item)}</li>
                ))}
              </ul>
            </div>
          )}
          {result.notChecked.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
                {say(language, { en: "Not checked", zh: "未检查" })}
              </div>
              <ul className="m-0 mt-1 list-disc space-y-1 pl-4 text-[13px] leading-[1.5] text-white">
                {result.notChecked.map((item) => (
                  <li key={item.en}>{say(language, item)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ResultStep({
  result,
  language,
  onNext,
}: {
  result: CheckSwapResult;
  language: Language;
  onNext: () => void;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const { intent, quote, verdict } = result;
  const amountIn = Number.isFinite(Number(intent.amountIn))
    ? formatAmount(Number(intent.amountIn))
    : intent.amountIn;
  const amountOut =
    quote.expectedOutput === "unavailable"
      ? say(language, { en: "Unknown", zh: "未知" })
      : quote.expectedOutput;
  const hasOptions = Boolean(
    result.remediationOptions && result.remediationOptions.length > 0,
  );
  const hasDiagnosis = Boolean(
    result.quoteFidelity || result.executionEconomics,
  );
  const hasMinimumBoundary = result.minimumReceivedSource !== "unavailable";

  return (
    <div className="flex flex-col gap-2.5">
      <section
        className={`flex items-start gap-2.5 rounded-[12px] border p-3.5 ${VERDICT_TONE[verdict]}`}
      >
        <VerdictIcon className="mt-0.5 shrink-0" size={30} verdict={verdict} />
        <div className="min-w-0 flex-1">
          <strong className="block text-[20px] font-extrabold leading-[1.1] tracking-[-0.04em]">
            {say(language, VERDICT_TITLE[verdict])}
          </strong>
          <p className="mt-1 text-[13px] leading-[1.4] text-white">
            {say(language, VERDICT_EXPLANATION[verdict])}
          </p>
        </div>
      </section>

      <SwapSummary
        amountIn={amountIn}
        amountOut={amountOut}
        language={language}
        tokenIn={intent.tokenIn}
        tokenOut={intent.tokenOut}
      />

      {result.quoteFidelity && (
        <QuoteFidelityCard
          language={language}
          quoteFidelity={result.quoteFidelity}
          tokenSymbol={intent.tokenOut}
        />
      )}

      {hasMinimumBoundary && (
        <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "Minimum received", zh: "最低收到量" })}
          </div>
          <div className="mt-1 text-[16px] font-bold text-white">
            {say(language, {
              en: "Provided for this check",
              zh: "已为本次检查提供",
            })}
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-dim">
            {say(language, {
              en: "This is your acceptance boundary, not an estimate and not a way to improve the transaction.",
              zh: "这是你的接受边界，不是预估值，也不是改善交易结果的方法。",
            })}
          </p>
        </section>
      )}

      <div className="rounded-[16px] border border-line bg-ink-elev2/30 px-4 py-3 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-dim">
            {say(language, { en: "Route", zh: "路径" })}
          </span>
          <span className="font-bold text-white">
            {say(language, quote.route)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-dim">
            {say(language, { en: "Quote block", zh: "报价区块" })}
          </span>
          <span className="mono text-white">{quote.blockNumber}</span>
        </div>
      </div>

      {result.executionEconomics && (
        <ExecutionEconomicsCard
          economics={result.executionEconomics}
          language={language}
        />
      )}

      {hasDiagnosis && (
        <ScopeSummary
          expanded={scopeOpen}
          language={language}
          onToggle={() => setScopeOpen(!scopeOpen)}
          result={result}
        />
      )}
      {!hasDiagnosis && (
        <ScopeSummary
          expanded={scopeOpen}
          language={language}
          onToggle={() => setScopeOpen(!scopeOpen)}
          result={result}
        />
      )}

      <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
        <p className="m-0 text-[13px] leading-[1.6] text-dim">
          {say(language, RECHECK_COPY)}
        </p>
      </section>

      {hasOptions && (
        <button
          type="button"
          className="btn btn-monad mt-1 w-full"
          onClick={onNext}
        >
          {say(language, {
            en: "View verified options →",
            zh: "查看已验证选项 →",
          })}
        </button>
      )}
      {!hasOptions && (
        <div className="rounded-[16px] border border-line bg-ink-elev2/30 p-4 text-center text-[13px] text-dim">
          {say(language, {
            en: "No verified transaction adjustment is available for this result.",
            zh: "此结果没有可用的已验证交易调整。",
          })}
        </div>
      )}
    </div>
  );
}

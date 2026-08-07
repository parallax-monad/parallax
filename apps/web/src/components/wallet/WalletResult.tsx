import { useState } from "react";
import { ActionsCard } from "@/components/analyze/ActionsCard";
import { DiffCard } from "@/components/analyze/DiffCard";
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

/** Plain-language names, since the raw verdict words assume swap literacy. */
const VERDICT_PLAIN: Record<Verdict, Copy> = {
  PROCEED: { en: "No blocking evidence found", zh: "未发现阻断证据" },
  ADJUST: { en: "Change something first", zh: "先改一个条件" },
  STOP: { en: "Do not sign this", zh: "不要签名" },
  UNKNOWN: { en: "Not enough evidence", zh: "证据不足" },
};

/**
 * The keep-going button per verdict. It returns the user to the swap sheet
 * rather than signing, because this MVP never signs or broadcasts.
 */
const PRIMARY_ACTION: Record<Verdict, Copy> = {
  PROCEED: { en: "Keep this swap", zh: "保留这笔兑换" },
  ADJUST: { en: "Adjust this swap", zh: "调整这笔兑换" },
  STOP: { en: "Change route or pair", zh: "更换路径或代币对" },
  UNKNOWN: { en: "Review and run again", zh: "查看后重新检查" },
};

/** Abandoning the intent is the same choice under every verdict. */
const DISCARD_ACTION: Copy = { en: "Discard this swap", zh: "放弃这笔兑换" };

const INTEGRATION_ERROR_COPY = {
  title: { en: "Check could not be completed", zh: "检查无法完成" },
  explanation: {
    en: "No transaction conclusion was produced. Retry the check or view technical details.",
    zh: "本次没有生成交易结论。请重试检查或查看技术详情。",
  },
  retry: { en: "Retry", zh: "重试" },
  details: { en: "View details", zh: "查看详情" },
} satisfies Record<string, Copy>;

const NEXT_STEP: Record<Verdict, Copy> = {
  PROCEED: {
    en: "The backend found no blocking condition in its checked scope. This is not a safety guarantee.",
    zh: "后端在已检查范围内未发现阻断条件。这不构成安全保证。",
  },
  ADJUST: {
    en: "The backend suggests changing one verified transaction condition, then running it again.",
    zh: "后端建议修改一个已验证的交易条件，然后重新运行。",
  },
  STOP: {
    en: "The backend found a blocking condition. Review the details before deciding what to do.",
    zh: "后端发现了阻断条件。决定下一步之前请查看详情。",
  },
  UNKNOWN: {
    en: "The backend did not have enough information for a transaction conclusion. Unknown is never a pass.",
    zh: "后端没有足够信息得出交易结论。Unknown 不等于通过。",
  },
};

/** One side of the intent summary, drawn as coin + amount. */
function Side({
  caption,
  amount,
  symbol,
  muted = false,
}: {
  caption: string;
  amount: string;
  symbol: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
        {caption}
      </span>
      <div className="flex items-center gap-2">
        <TokenIcon size={22} symbol={symbol} />
        <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-dim">
          {symbol}
        </span>
      </div>
      <strong
        className={`truncate text-[20px] font-extrabold tracking-[-0.04em] ${muted ? "text-faint" : "text-white"}`}
      >
        {amount}
      </strong>
    </div>
  );
}

export function WalletResult({
  result,
  language,
  onKeep,
  onRetry,
  onDiscard,
  onOpenEvidence,
}: {
  result: CheckSwapResult;
  language: Language;
  onKeep: () => void;
  onRetry?: () => void;
  onDiscard: () => void;
  onOpenEvidence: () => void;
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { intent, quote, verdict } = result;
  const unresolved = quote.expectedOutput === "unavailable";
  const amountIn = Number(intent.amountIn);

  if (result.systemStatus === "INTEGRATION_ERROR") {
    return (
      <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow-monad m-0">
            {say(language, { en: "Before you sign", zh: "签名之前" })}
          </span>
          <span className="pill border-risk-elevated/50 text-risk-elevated">
            {say(language, { en: "Integration error", zh: "集成错误" })}
          </span>
        </div>

        <section className="flex items-start gap-3 border border-risk-elevated/50 bg-risk-elevated/10 p-4 text-risk-elevated">
          <VerdictIcon
            className="mt-0.5 shrink-0"
            size={30}
            verdict="UNKNOWN"
          />
          <div className="min-w-0">
            <strong className="block text-[22px] font-extrabold leading-[1.1] tracking-[-0.04em]">
              {say(language, INTEGRATION_ERROR_COPY.title)}
            </strong>
            <p className="mt-1.5 text-[14px] leading-[1.6] text-white">
              {say(
                language,
                result.apiFailure?.retryable
                  ? INTEGRATION_ERROR_COPY.explanation
                  : {
                      en: "No transaction conclusion was produced. This error cannot be retried as-is; view technical details or discard this check.",
                      zh: "本次没有生成交易结论。此错误无法原样重试；请查看技术详情或放弃本次检查。",
                    },
              )}
            </p>
            <p className="mt-2 text-[13px] leading-[1.6] text-dim">
              {say(language, result.summary)}
            </p>
            {result.apiFailure && (
              <dl className="mt-3 border-t border-risk-elevated/30 pt-2 text-[12px]">
                <div className="flex justify-between gap-3 py-1">
                  <dt className="font-bold uppercase tracking-[0.06em]">
                    error.code
                  </dt>
                  <dd className="mono m-0 text-right text-white">
                    {result.apiFailure.code}
                  </dd>
                </div>
                {result.apiFailure.reason && (
                  <div className="flex justify-between gap-3 py-1">
                    <dt className="font-bold uppercase tracking-[0.06em]">
                      error.reason
                    </dt>
                    <dd className="mono m-0 text-right text-white">
                      {result.apiFailure.reason}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 py-1">
                  <dt className="font-bold uppercase tracking-[0.06em]">
                    retryable
                  </dt>
                  <dd className="mono m-0 text-right text-white">
                    {String(result.apiFailure.retryable)}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        <div
          className={
            result.apiFailure?.retryable
              ? "grid grid-cols-2 gap-2"
              : "grid grid-cols-1 gap-2"
          }
        >
          {result.apiFailure?.retryable && (
            <button
              type="button"
              className="btn btn-monad"
              onClick={onRetry ?? onKeep}
            >
              {say(language, INTEGRATION_ERROR_COPY.retry)}
            </button>
          )}
          <button
            type="button"
            className="btn btn-monad-outline"
            onClick={onOpenEvidence}
          >
            {say(language, INTEGRATION_ERROR_COPY.details)}
          </button>
        </div>

        <button
          type="button"
          className="btn btn-monad-outline w-full"
          onClick={onDiscard}
        >
          {say(language, DISCARD_ACTION)}
        </button>

        <p className="text-center text-[12px] leading-[1.5] text-dim">
          {say(language, {
            en: "Nothing was signed or broadcast. No transaction conclusion was produced.",
            zh: "没有签名，也没有广播。本次未生成交易结论。",
          })}
        </p>
      </div>
    );
  }

  const scope = {
    checked: result.checked.length,
    unknown: result.unknowns.length,
    notChecked: result.notChecked.length,
  };

  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow-monad m-0">
          {say(language, { en: "Before you sign", zh: "签名之前" })}
        </span>
        {result.productRunMode === "LIVE" && (
          <span className="pill border-risk-low/50 text-risk-low">
            {say(language, { en: "Live check", zh: "实时检查" })}
          </span>
        )}
        {result.productRunMode === "RECORDED_REPLAY" && (
          <span className="pill">
            {say(language, { en: "Recorded replay", zh: "录制回放" })}
          </span>
        )}
      </div>

      <section
        className={`flex items-start gap-3 border p-4 ${VERDICT_TONE[verdict]}`}
      >
        <VerdictIcon className="mt-0.5 shrink-0" size={30} verdict={verdict} />
        <div className="min-w-0">
          <strong className="block text-[22px] font-extrabold leading-[1.1] tracking-[-0.04em]">
            {say(language, VERDICT_PLAIN[verdict])}
          </strong>
          <p className="mt-1.5 text-[14px] leading-[1.6] text-white">
            {say(language, result.summary)}
          </p>
        </div>
      </section>

      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-ink-rail px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.04em] text-dim">
        <legend className="sr-only">
          {say(language, { en: "Check scope", zh: "检查范围" })}
        </legend>
        <span>
          {say(language, { en: "Checked", zh: "已检查" })}: {scope.checked}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {say(language, { en: "Unknown", zh: "未知" })}: {scope.unknown}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {say(language, { en: "Not checked", zh: "未检查" })}:{" "}
          {scope.notChecked}
        </span>
      </fieldset>

      <section className="flex items-stretch gap-2 border border-line bg-ink-rail p-4">
        <Side
          amount={
            Number.isFinite(amountIn) ? formatAmount(amountIn) : intent.amountIn
          }
          caption={say(language, { en: "You pay", zh: "你支付" })}
          symbol={intent.tokenIn}
        />
        <span
          aria-hidden="true"
          className="self-center px-1 text-[18px] text-monad-dim"
        >
          →
        </span>
        <Side
          amount={
            unresolved
              ? say(language, { en: "No quote", zh: "无报价" })
              : quote.expectedOutput
          }
          caption={say(language, {
            en: "You receive (est.)",
            zh: "你收到（预估）",
          })}
          muted={unresolved}
          symbol={intent.tokenOut}
        />
      </section>

      <dl className="m-0">
        <div className="kv">
          <span className="kv-label">
            {say(language, { en: "Route", zh: "路径" })}
          </span>
          <span className="text-right text-[14px] text-white">
            {say(language, quote.route)}
          </span>
        </div>
        <div className="kv">
          <span className="kv-label">
            {say(language, { en: "Block", zh: "区块" })}
          </span>
          <span className="mono">{quote.blockNumber}</span>
        </div>
      </dl>

      <section className="border border-line bg-ink-rail p-4">
        <strong className="block text-[13px] font-bold uppercase tracking-[0.08em] text-monad-dim">
          {say(language, { en: "Backend actions", zh: "后端操作建议" })}
        </strong>
        <p className="mt-1.5 text-[14px] leading-[1.6] text-white">
          {say(language, NEXT_STEP[verdict])}
        </p>
        {result.recommendedActions.length > 0 && (
          <ul className="m-0 mt-3 list-none border-t border-line p-0">
            {result.recommendedActions.map((suggestion) => (
              <li
                className="border-b border-line py-2.5 text-[14px] leading-[1.6] text-dim last:border-b-0"
                key={suggestion.field}
              >
                {suggestion.proposedChange && (
                  <span className="mb-1 flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-dim">
                      {say(language, { en: "Amount", zh: "数量" })}
                    </span>
                    <span className="text-dim line-through">
                      {suggestion.proposedChange.before}{" "}
                      {suggestion.proposedChange.unit}
                    </span>
                    <span aria-hidden="true" className="text-faint">
                      →
                    </span>
                    <strong className="text-monad-dim">
                      {suggestion.proposedChange.after}{" "}
                      {suggestion.proposedChange.unit}
                    </strong>
                  </span>
                )}
                {say(language, suggestion.reason)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-1 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-monad" onClick={onKeep}>
          {say(language, PRIMARY_ACTION[verdict])}
        </button>
        <button
          type="button"
          className="btn btn-monad-outline"
          onClick={onDiscard}
        >
          {say(language, DISCARD_ACTION)}
        </button>
      </div>

      <button
        type="button"
        className="text-[13px] font-bold uppercase tracking-[0.08em] text-dim underline transition-colors hover:text-monad-dim"
        onClick={onOpenEvidence}
      >
        {say(language, { en: "View evidence", zh: "查看证据" })}
      </button>

      <button
        type="button"
        aria-expanded={breakdownOpen}
        className="text-[13px] font-bold uppercase tracking-[0.08em] text-dim underline transition-colors hover:text-monad-dim"
        onClick={() => setBreakdownOpen(!breakdownOpen)}
      >
        {say(
          language,
          breakdownOpen
            ? { en: "Hide full breakdown", zh: "收起完整分析" }
            : { en: "Show full breakdown", zh: "展开完整分析" },
        )}
      </button>

      {breakdownOpen && (
        <div className="flex flex-col gap-3">
          <ActionsCard language={language} result={result} />
          {result.diff && result.parentRunId && (
            <DiffCard
              diff={result.diff}
              language={language}
              previousRunId={result.parentRunId}
              runId={result.runId}
            />
          )}
        </div>
      )}

      <p className="text-center text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Nothing was signed or broadcast. This is a pre-sign check only.",
          zh: "没有签名，也没有广播。这里只做签名前检查。",
        })}
      </p>
    </div>
  );
}

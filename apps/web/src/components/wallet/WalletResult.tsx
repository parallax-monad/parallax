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
  PROCEED: { en: "Looks clear to sign", zh: "可以签名" },
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

const NEXT_STEP: Record<Verdict, Copy> = {
  PROCEED: {
    en: "No blocking evidence was identified in the checked scope. This is not a safety guarantee.",
    zh: "在已检查的范围内没有发现阻断性证据。这不等于安全保证。",
  },
  ADJUST: {
    en: "A transaction condition needs to change, then run the check again.",
    zh: "需要修改一个交易条件，然后重新检查。",
  },
  STOP: {
    en: "Blocking evidence was identified. Do not continue without reviewing it.",
    zh: "已发现阻断性证据。在查看之前不要继续。",
  },
  UNKNOWN: {
    en: "There is not enough evidence to make a reliable decision. Unknown is never a pass.",
    zh: "证据不足以作出可靠决策。Unknown 不等于通过。",
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
  onDiscard,
  onOpenEvidence,
}: {
  result: CheckSwapResult;
  language: Language;
  onKeep: () => void;
  onDiscard: () => void;
  onOpenEvidence: () => void;
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { intent, quote, verdict } = result;
  const unresolved = quote.expectedOutput === "unavailable";
  const amountIn = Number(intent.amountIn);

  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow-monad m-0">
          {say(language, { en: "Before you sign", zh: "签名之前" })}
        </span>
        {result.replayMode && (
          <span className="pill">
            {say(language, { en: "Replay fixture", zh: "录制回放" })}
          </span>
        )}
        {result.systemStatus === "INTEGRATION_ERROR" && (
          <span className="pill border-risk-elevated/50 text-risk-elevated">
            {say(language, { en: "Integration error", zh: "集成错误" })}
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
        <strong className="block text-[13px] font-bold uppercase tracking-[0.08em] text-dim">
          {say(language, { en: "What to do next", zh: "下一步做什么" })}
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
        <button type="button" className="btn" onClick={onDiscard}>
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

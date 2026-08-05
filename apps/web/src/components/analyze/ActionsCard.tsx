import type { ReactNode } from "react";
import {
  CheckedMark,
  NotCheckedMark,
  UnknownListMark,
} from "@/components/analyze/StatusIcon";
import type { ActionSuggestion, CheckSwapResult } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const FIELD_LABEL: Record<ActionSuggestion["field"], Copy> = {
  amountIn: { en: "Amount", zh: "数量" },
  tokenPair: { en: "Token pair", zh: "代币对" },
  protocol: { en: "Route / protocol", zh: "路径／协议" },
  slippage: { en: "Slippage", zh: "滑点" },
  minimumReceived: { en: "Minimum received", zh: "最低收到量" },
};

const CATEGORY_LABEL: Record<ActionSuggestion["category"], Copy> = {
  TRANSACTION_CONDITION: { en: "Transaction condition", zh: "交易条件" },
  ACCEPTANCE_BOUNDARY: { en: "Acceptance boundary", zh: "接受边界" },
};

/** A field worth changing, or explicitly not worth changing. */
function ActionRow({
  suggestion,
  language,
  tone,
}: {
  suggestion: ActionSuggestion;
  language: Language;
  tone: "relevant" | "irrelevant";
}) {
  const relevant = tone === "relevant";

  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
            relevant
              ? "border-monad text-monad-dim"
              : "border-line-strong text-faint"
          }`}
        >
          {relevant ? "!" : "="}
        </span>
        <strong
          className={`text-[15px] font-bold ${relevant ? "text-monad-dim" : "text-dim"}`}
        >
          {say(language, FIELD_LABEL[suggestion.field])}
        </strong>
        <span className="pill">
          {say(language, CATEGORY_LABEL[suggestion.category])}
        </span>
      </div>
      <p className="m-0 mt-1.5 text-[14px] leading-[1.6] text-dim">
        {say(language, suggestion.reason)}
      </p>
    </li>
  );
}

/**
 * One coverage column. The icon repeats the meaning of the colour so the three
 * columns stay distinguishable without relying on hue alone.
 */
function CoverageColumn({
  title,
  tone,
  icon,
  items,
  empty,
  language,
}: {
  title: string;
  tone: string;
  icon: ReactNode;
  items: Copy[];
  empty: string;
  language: Language;
}) {
  return (
    <div>
      <h4
        className={`m-0 mb-1.5 flex items-center gap-1.5 font-bold uppercase tracking-[0.08em] ${tone}`}
      >
        <span className="shrink-0">{icon}</span>
        {title}
      </h4>
      {items.length > 0 ? (
        <ul className="m-0 list-none p-0 text-dim">
          {items.map((item) => (
            <li className="py-0.5" key={item.en}>
              {say(language, item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-dim">{empty}</p>
      )}
    </div>
  );
}

export function ActionsCard({
  result,
  language,
}: {
  result: CheckSwapResult;
  language: Language;
}) {
  const hasActions =
    result.recommendedActions.length > 0 || result.irrelevantActions.length > 0;

  return (
    <div className="card">
      <span className="eyebrow-monad">
        {say(language, { en: "What to do next", zh: "下一步做什么" })}
      </span>

      {hasActions ? (
        <div className="mt-3 grid grid-cols-1 gap-7 lg:grid-cols-2">
          <div>
            <h3 className="m-0 mb-1 text-[13px] font-extrabold uppercase tracking-[0.04em] text-monad-dim">
              {say(language, { en: "Worth changing", zh: "值得修改" })}
            </h3>
            <p className="m-0 mb-2 text-[14px] leading-[1.6] text-dim">
              {say(language, {
                en: "Tied to the cause found in this run.",
                zh: "与本次发现的原因相关。",
              })}
            </p>
            <ul className="m-0 list-none border-t border-line p-0">
              {result.recommendedActions.map((suggestion) => (
                <ActionRow
                  key={suggestion.field}
                  language={language}
                  suggestion={suggestion}
                  tone="relevant"
                />
              ))}
            </ul>
          </div>

          <div>
            <h3 className="m-0 mb-1 text-[13px] font-extrabold uppercase tracking-[0.04em] text-faint">
              {say(language, { en: "Will not help", zh: "改了也无效" })}
            </h3>
            <p className="m-0 mb-2 text-[14px] leading-[1.6] text-dim">
              {say(language, {
                en: "Unrelated to the cause, so retrying with these changes nothing.",
                zh: "与原因无关，改这些重试不会有变化。",
              })}
            </p>
            <ul className="m-0 list-none border-t border-line p-0">
              {result.irrelevantActions.map((suggestion) => (
                <ActionRow
                  key={suggestion.field}
                  language={language}
                  suggestion={suggestion}
                  tone="irrelevant"
                />
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[14px] text-dim">
          {say(language, {
            en: "No condition needs to change based on this run.",
            zh: "根据本次检查，没有条件需要修改。",
          })}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 border-t border-line pt-4 text-[14px] sm:grid-cols-3">
        <CoverageColumn
          empty={say(language, { en: "Nothing listed.", zh: "没有项目。" })}
          icon={<CheckedMark />}
          language={language}
          items={result.checked}
          title={say(language, { en: "Checked", zh: "已检查" })}
          tone="text-risk-low"
        />
        <CoverageColumn
          empty={say(language, { en: "Nothing listed.", zh: "没有项目。" })}
          icon={<NotCheckedMark />}
          language={language}
          items={result.notChecked}
          title={say(language, { en: "Not checked", zh: "未检查" })}
          tone="text-faint"
        />
        <CoverageColumn
          empty={say(language, { en: "None in this run.", zh: "本次没有。" })}
          icon={<UnknownListMark />}
          language={language}
          items={result.unknowns.map((item) => item.label)}
          title={say(language, { en: "Unknown", zh: "未知" })}
          tone="text-risk-elevated"
        />
      </div>
    </div>
  );
}

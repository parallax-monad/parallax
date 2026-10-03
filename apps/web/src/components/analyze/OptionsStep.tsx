import { useState } from "react";
import { RemediationOptionsCard } from "@/components/analyze/RemediationOptionsCard";
import type { CheckSwapResult, RemediationOption } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

type SuggestionCard = {
  id: string;
  title: Copy;
  description: Copy;
  change?: { label: Copy; before: string; after: string; unit: string };
  outcome?: { label: Copy; text: Copy };
  tradeoff?: { label: Copy; text: Copy };
};

export function OptionsStep({
  result,
  language,
  onSelectOption,
  onBack,
  onKeep,
}: {
  result: CheckSwapResult;
  language: Language;
  onSelectOption?: (option: RemediationOption) => void;
  onBack: () => void;
  onKeep?: () => void;
}) {
  const hasOptions =
    result.remediationOptions && result.remediationOptions.length > 0;
  const adjustReason = result.adjustReason ?? "UNKNOWN";
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const handlePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
    cardId: string,
  ) => {
    if (hoveredCard !== cardId) setHoveredCard(cardId);
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  if (!hasOptions) {
    const suggestions: SuggestionCard[] = adjustReason === "QUOTED_OUTPUT_BELOW_MINIMUM" ? [
      {
        id: "accept-quote",
        title: { en: "Accept current quote", zh: "接受当前报价" },
        description: { en: "Lower minimum and accept fresh quote", zh: "降低最低要求并接受新报价" },
        change: {
          label: { en: "CHANGE", zh: "变化" },
          before: result.intent.amountIn,
          after: result.quote.expectedOutput,
          unit: `${result.intent.tokenIn} → ${result.intent.tokenOut}`,
        },
        outcome: {
          label: { en: "PREDICTED OUTCOME", zh: "预期结果" },
          text: { en: "You will receive the quoted amount under current market conditions", zh: "在当前市场条件下你将收到报价金额" },
        },
        tradeoff: {
          label: { en: "TRADE-OFF", zh: "权衡" },
          text: { en: "Market conditions may change after this quote", zh: "此报价后市场条件可能变化" },
        },
      },
    ] : adjustReason === "INPUT_BALANCE_INSUFFICIENT" ? [
      {
        id: "reduce-input",
        title: { en: "Reduce input amount", zh: "减少输入金额" },
        description: { en: "Lower amount to fit balance", zh: "降低金额以适应余额" },
        change: {
          label: { en: "CHANGE", zh: "变化" },
          before: result.intent.amountIn,
          after: "Available",
          unit: result.intent.tokenIn,
        },
        outcome: {
          label: { en: "PREDICTED OUTCOME", zh: "预期结果" },
          text: { en: "Complete swap with available balance", zh: "用可用余额完成兑换" },
        },
        tradeoff: {
          label: { en: "TRADE-OFF", zh: "权衡" },
          text: { en: "You will receive proportionally less output", zh: "你将按比例收到更少的输出" },
        },
      },
    ] : [];

    return (
      <div className="flex flex-col gap-4">
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            className="relative w-full overflow-hidden rounded-[16px] border border-line bg-ink-elev2/30 p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-risk-low/70 hover:bg-risk-low/5"
            onPointerMove={(e) => handlePointerMove(e, s.id)}
            onPointerLeave={() => { setHoveredCard(null); setPointer(null); }}
            onClick={onKeep || onBack}
          >
            {hoveredCard === s.id && pointer && (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[16px] opacity-60 transition-opacity duration-150"
                  style={{ background: `radial-gradient(280px circle at ${pointer.x}px ${pointer.y}px, rgba(74,222,128,0.2), transparent 65%)` }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[16px] opacity-40 blur-md"
                  style={{ background: `radial-gradient(200px circle at ${pointer.x}px ${pointer.y}px, rgba(74,222,128,0.3), transparent 50%)` }}
                />
              </>
            )}
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <strong className="text-[18px] font-bold text-white">{say(language, s.title)}</strong>
                <span className="shrink-0 rounded-full border border-risk-low/40 bg-risk-low/8 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-risk-low/80">
                  Verified
                </span>
              </div>
              <p className="mt-1.5 text-[14px] text-dim">{say(language, s.description)}</p>
              {s.change && (
                <div className="mt-4 border-t border-line/30 pt-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-dim">{say(language, s.change.label)}</div>
                  <div className="mt-2 text-[16px] text-white">{s.change.before} → {s.change.after}</div>
                  <div className="mt-1 text-[12px] text-dim">{s.change.unit}</div>
                </div>
              )}
              {s.outcome && (
                <div className="mt-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-dim">{say(language, s.outcome.label)}</div>
                  <p className="mt-1.5 text-[14px] text-white">{say(language, s.outcome.text)}</p>
                </div>
              )}
              {s.tradeoff && (
                <div className="mt-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-dim">{say(language, s.tradeoff.label)}</div>
                  <p className="mt-1.5 text-[13px] text-dim">{say(language, s.tradeoff.text)}</p>
                </div>
              )}
            </div>
          </button>
        ))}
        <button type="button" className="btn btn-monad-outline" onClick={onBack}>
          {say(language, { en: "Back to result", zh: "返回结果" })}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <RemediationOptionsCard
        language={language}
        options={result.remediationOptions ?? []}
        onSelect={onSelectOption}
      />

      <button
        type="button"
        className="btn btn-monad-outline mt-2"
        onClick={onBack}
      >
        {say(language, { en: "Back to result", zh: "返回结果" })}
      </button>
    </div>
  );
}

import { useState } from "react";
import { RemediationOptionsCard } from "@/components/analyze/RemediationOptionsCard";
import type {
  AccountStateSnapshot,
  CheckSwapResult,
  RemediationOption,
} from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

export function suggestedMinimumReceived(
  quote: string,
  current: string,
): string | undefined {
  const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
  if (!decimal.test(quote) || !decimal.test(current)) return undefined;
  const [whole, fraction = ""] = quote.split(".");
  const cents =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  const belowQuote = cents - (/[^0]/.test(fraction.slice(2)) ? 0n : 1n);
  const [currentWhole, currentFraction = ""] = current.split(".");
  const scale = Math.max(fraction.length, currentFraction.length);
  const quoteScaled = BigInt(whole + fraction.padEnd(scale, "0"));
  const currentScaled = BigInt(
    currentWhole + currentFraction.padEnd(scale, "0"),
  );
  if (belowQuote <= 0n || currentScaled <= quoteScaled) return undefined;
  return `${belowQuote / 100n}.${(belowQuote % 100n).toString().padStart(2, "0")}`;
}

type SuggestionCard = {
  id: string;
  title: Copy;
  description: Copy;
  change?: { label: Copy; before: string; after: string; unit: string };
  outcome?: { label: Copy; text: Copy };
  tradeoff?: { label: Copy; text: Copy };
};

function formatAvailableBalance(
  snapshot: AccountStateSnapshot | undefined,
  isNativeToken: boolean,
): string | undefined {
  if (snapshot?.status !== "AVAILABLE") return undefined;
  const balance = snapshot.balances.inputToken;
  if (balance.status !== "AVAILABLE") return undefined;
  const { amountAtomic, metadata } = balance;
  if (!amountAtomic || !/^\d+$/.test(amountAtomic)) return undefined;

  const divisor = 10n ** BigInt(metadata.decimals);
  const balanceWei = BigInt(amountAtomic);

  const gasReserveWei = isNativeToken
    ? BigInt(Math.floor(0.001 * 10 ** metadata.decimals))
    : 0n;

  if (balanceWei <= gasReserveWei) return undefined;

  const availableWei = balanceWei - gasReserveWei;
  const integerPart = availableWei / divisor;
  const fractionalPart = availableWei % divisor;

  const fractionalStr = fractionalPart
    .toString()
    .padStart(metadata.decimals, "0");
  const twoDecimals = fractionalStr.slice(0, 2);

  return `${integerPart}.${twoDecimals}`;
}

export function OptionsStep({
  result,
  language,
  onSelectOption,
  onBack,
  onKeep,
  currentMinimumReceived,
  onApplyMinimumReceived,
  onApplyAmountIn,
}: {
  result: CheckSwapResult;
  language: Language;
  onSelectOption?: (option: RemediationOption) => void;
  onBack: () => void;
  onKeep?: () => void;
  currentMinimumReceived?: string;
  onApplyMinimumReceived?: (value: string) => void;
  onApplyAmountIn?: (value: string) => void;
}) {
  const hasOptions =
    result.remediationOptions && result.remediationOptions.length > 0;
  const adjustReason = result.adjustReason ?? "UNKNOWN";
  const suggestedMinimum =
    currentMinimumReceived &&
    suggestedMinimumReceived(
      result.quote.expectedOutput,
      currentMinimumReceived,
    );
  const isNativeToken =
    result.intent.tokenIn === "ETH" ||
    result.intent.tokenIn === "MATIC" ||
    result.intent.tokenIn === "BNB";
  const availableBalance = formatAvailableBalance(
    result.accountState,
    isNativeToken,
  );
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
    const suggestions: SuggestionCard[] =
      adjustReason === "QUOTED_OUTPUT_BELOW_MINIMUM" && suggestedMinimum
        ? [
            {
              id: "lower-minimum",
              title: {
                en: "Lower minimum received",
                zh: "降低最低接受量",
              },
              description: {
                en: "Consider a lower acceptance boundary and review a fresh quote before signing",
                zh: "可考虑降低接受边界，并在签名前重新检查报价",
              },
              change: {
                label: { en: "SUGGESTED MINIMUM", zh: "建议最低接受量" },
                before: currentMinimumReceived || result.quote.expectedOutput,
                after: suggestedMinimum,
                unit: result.intent.tokenOut,
              },
              outcome: {
                label: { en: "PREDICTED OUTCOME", zh: "预期结果" },
                text: {
                  en: "The expected output is no longer below your acceptance boundary",
                  zh: "预期出币数量不会低于最低接受量",
                },
              },
              tradeoff: {
                label: { en: "TRADE-OFF", zh: "权衡" },
                text: {
                  en: "You accept less output protection if market conditions change",
                  zh: "市场条件变化时，你接受的出币保护会降低",
                },
              },
            },
          ]
        : adjustReason === "INPUT_BALANCE_INSUFFICIENT" && availableBalance
          ? [
              {
                id: "reduce-input",
                title: { en: "Reduce input amount", zh: "减少输入金额" },
                description: {
                  en: "Lower amount to fit balance",
                  zh: "降低金额以适应余额",
                },
                change: {
                  label: { en: "SUGGESTED AMOUNT", zh: "建议金额" },
                  before: result.intent.amountIn,
                  after: availableBalance,
                  unit: result.intent.tokenIn,
                },
                outcome: {
                  label: { en: "PREDICTED OUTCOME", zh: "预期结果" },
                  text: {
                    en: "Complete swap with available balance",
                    zh: "用可用余额完成兑换",
                  },
                },
                tradeoff: {
                  label: { en: "TRADE-OFF", zh: "权衡" },
                  text: {
                    en: "You will receive proportionally less output",
                    zh: "你将按比例收到更少的输出",
                  },
                },
              },
            ]
          : [];

    return (
      <div className="flex flex-col gap-4">
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={
              (s.id === "lower-minimum" &&
                (!suggestedMinimum || !onApplyMinimumReceived)) ||
              (s.id === "reduce-input" &&
                (!availableBalance || !onApplyAmountIn))
            }
            className="relative w-full overflow-hidden rounded-[16px] border border-line bg-ink-elev2/30 p-5 text-left transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:border-risk-low/70 enabled:hover:bg-risk-low/5 disabled:cursor-default"
            onPointerMove={(e) => handlePointerMove(e, s.id)}
            onPointerLeave={() => {
              setHoveredCard(null);
              setPointer(null);
            }}
            onClick={() => {
              if (s.id === "lower-minimum") {
                if (suggestedMinimum)
                  onApplyMinimumReceived?.(suggestedMinimum);
              } else if (s.id === "reduce-input") {
                if (availableBalance) onApplyAmountIn?.(availableBalance);
              } else {
                (onKeep || onBack)();
              }
            }}
          >
            {hoveredCard === s.id && pointer && (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[16px] opacity-60 transition-opacity duration-150"
                  style={{
                    background: `radial-gradient(280px circle at ${pointer.x}px ${pointer.y}px, rgba(74,222,128,0.2), transparent 65%)`,
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[16px] opacity-40 blur-md"
                  style={{
                    background: `radial-gradient(200px circle at ${pointer.x}px ${pointer.y}px, rgba(74,222,128,0.3), transparent 50%)`,
                  }}
                />
              </>
            )}
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <strong className="block text-[15px] font-bold leading-tight text-white">
                    {say(language, s.title)}
                  </strong>
                  <p className="mt-0.5 text-[13px] leading-[1.4] text-dim">
                    {say(language, s.description)}
                  </p>
                </div>
                {s.id !== "lower-minimum" && (
                  <span className="shrink-0 rounded-full border border-risk-low/40 bg-risk-low/8 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-risk-low/80">
                    Verified
                  </span>
                )}
              </div>
              {s.change && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-dim/70">
                    {say(language, s.change.label)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[15px] font-semibold text-white">
                    <del className="text-dim">{s.change.before}</del>
                    <span aria-hidden="true">→</span>
                    <span>
                      {s.change.after} {s.change.unit}
                    </span>
                  </div>
                </div>
              )}
              {s.outcome && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-dim/70">
                    {say(language, s.outcome.label)}
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.4] text-white">
                    {say(language, s.outcome.text)}
                  </p>
                </div>
              )}
              {s.tradeoff && (
                <div className="mt-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-dim/70">
                    {say(language, s.tradeoff.label)}
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.4] text-dim">
                    {say(language, s.tradeoff.text)}
                  </p>
                </div>
              )}
            </div>
          </button>
        ))}
        <button
          type="button"
          className="btn btn-monad-outline"
          onClick={onBack}
        >
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

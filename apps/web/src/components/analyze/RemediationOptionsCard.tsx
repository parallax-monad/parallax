import { type PointerEvent, useState } from "react";
import type { RemediationOption } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

export function RemediationOptionsCard({
  options,
  language,
  onSelect,
}: {
  options: RemediationOption[];
  language: Language;
  onSelect?: (option: RemediationOption) => void;
}) {
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const verifiedOptions = options.filter(
    (option) => option.verificationStatus === "VERIFIED",
  );
  const guidanceOptions = options.filter(
    (option) => option.verificationStatus !== "VERIFIED",
  );

  if (options.length === 0) return null;

  const renderOption = (option: RemediationOption) => (
    <RemediationOptionRow
      key={option.id}
      language={language}
      option={option}
      selected={selectedOptionId === option.id}
      onSelect={onSelect}
      onSelectOption={(selected) => {
        setSelectedOptionId(selected.id);
        onSelect?.(selected);
      }}
    />
  );

  return (
    <section className="pointer-events-none border-none bg-transparent p-0 shadow-none">
      <span className="eyebrow-monad">
        {say(language, { en: "Your options", zh: "你的选项" })}
      </span>
      <p className="mt-2 text-[14px] leading-[1.6] text-dim">
        {say(language, {
          en: "Choose the objective that best matches what you want to do.",
          zh: "选择最符合你目标的方案。",
        })}
      </p>

      {verifiedOptions.length > 0 && (
        <div className="mt-5">
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-white">
            {say(language, {
              en: "Verified changes",
              zh: "已验证的变更",
            })}
          </div>
          <p className="mt-1 text-[13px] leading-[1.5] text-dim">
            {say(language, {
              en: "These changes were checked and can be applied.",
              zh: "这些变更已经过检查，可以套用。",
            })}
          </p>
          <div className="mt-3 space-y-4">
            {verifiedOptions.map(renderOption)}
          </div>
        </div>
      )}

      {guidanceOptions.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, {
              en: "Wait and re-check",
              zh: "等待后重新检查",
            })}
          </div>
          <p className="mt-1 text-[13px] leading-[1.5] text-dim">
            {say(language, {
              en: "These are guidance only. They cannot be applied directly.",
              zh: "这些只是参考建议，不能直接套用。",
            })}
          </p>
          <div className="mt-3 space-y-4">
            {guidanceOptions.map(renderOption)}
          </div>
        </div>
      )}
    </section>
  );
}

function RemediationOptionRow({
  option,
  language,
  selected,
  onSelect,
  onSelectOption,
}: {
  option: RemediationOption;
  language: Language;
  selected: boolean;
  onSelect?: (option: RemediationOption) => void;
  onSelectOption: (option: RemediationOption) => void;
}) {
  const verificationColor = {
    VERIFIED: "text-risk-low",
    UNVERIFIED: "text-faint",
    CONDITIONAL: "text-risk-moderate",
  }[option.verificationStatus];

  const verificationLabel = {
    VERIFIED: { en: "Verified", zh: "已验证" },
    UNVERIFIED: { en: "Unverified", zh: "未验证" },
    CONDITIONAL: { en: "Conditional", zh: "条件性" },
  }[option.verificationStatus];

  const selectable =
    option.verificationStatus === "VERIFIED" &&
    option.swapIntent !== undefined &&
    onSelect !== undefined;
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };
  const cardStyle = selected
    ? "border-monad-bright/70 bg-ink-rail shadow-[0_0_0_1px_rgba(123,97,255,0.2),0_8px_24px_rgba(0,0,0,0.2)]"
    : selectable
      ? "border-line bg-ink-elev2/40 hover:border-risk-low/70 hover:bg-ink-elev2/70 hover:shadow-[0_4px_16px_rgba(0,0,0,0.14)]"
      : "border-line bg-ink-elev2/40";
  const secondaryText = "text-dim";
  const divider = selected ? "border-monad-bright/25" : "border-line";

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-[15px] font-bold">
          {say(language, option.objective)}
        </strong>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${verificationColor}`}
        >
          {say(language, verificationLabel)}
        </span>
      </div>

      <p className={`m-0 mt-2 text-[14px] leading-[1.6] ${secondaryText}`}>
        {say(language, option.candidateAdjustment)}
      </p>

      <div
        className={`mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2 ${divider}`}
      >
        <div>
          <span
            className={`block text-[11px] font-bold uppercase tracking-[0.08em] ${secondaryText}`}
          >
            {say(language, { en: "Change", zh: "变化" })}
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-[14px] ${secondaryText}`}>
              {option.quantification.before} {option.quantification.unit}
            </span>
            <span aria-hidden="true" className={secondaryText}>
              →
            </span>
            <strong className="text-[16px] font-bold">
              {option.quantification.after} {option.quantification.unit}
            </strong>
          </div>
        </div>

        <div>
          <span
            className={`block text-[11px] font-bold uppercase tracking-[0.08em] ${secondaryText}`}
          >
            {say(language, { en: "Predicted outcome", zh: "预测结果" })}
          </span>
          <p className="m-0 mt-1 text-[14px] leading-[1.5]">
            {say(language, option.predictedOutcome)}
          </p>
        </div>
      </div>

      {option.tradeOff && (
        <div className={`mt-3 border-t pt-3 ${divider}`}>
          <span
            className={`block text-[11px] font-bold uppercase tracking-[0.08em] ${secondaryText}`}
          >
            {say(language, { en: "Trade-off", zh: "权衡" })}
          </span>
          <p className={`m-0 mt-1 text-[13px] leading-[1.6] ${secondaryText}`}>
            {say(language, option.tradeOff)}
          </p>
        </div>
      )}

      {option.verificationStatus === "CONDITIONAL" && (
        <p
          className={`m-0 mt-3 border-t pt-3 text-[12px] leading-[1.5] ${divider} ${secondaryText}`}
        >
          {say(language, {
            en: "Wait until the condition is met, then run the check again.",
            zh: "等待条件满足后，再重新运行检查。",
          })}
        </p>
      )}

      {option.verificationStatus === "UNVERIFIED" && (
        <p
          className={`m-0 mt-3 border-t pt-3 text-[12px] leading-[1.5] ${divider} ${secondaryText}`}
        >
          {say(language, {
            en: "This change has not been verified and cannot be applied.",
            zh: "此变更尚未验证，不能直接套用。",
          })}
        </p>
      )}
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={`pointer-events-auto w-full rounded-[14px] border p-5 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 ${cardStyle}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setPointer(null)}
        onClick={() => onSelectOption(option)}
      >
        {pointer && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[14px] opacity-70 transition-opacity duration-150"
            style={{
              background: `radial-gradient(234px circle at ${pointer.x}px ${pointer.y}px, rgba(74,222,128,0.16), transparent 70%)`,
            }}
          />
        )}
        <span className="relative z-10">{content}</span>
      </button>
    );
  }

  return (
    <div className={`rounded-[14px] border p-5 ${cardStyle}`}>{content}</div>
  );
}

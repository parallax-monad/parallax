import type { RemediationOption } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

/**
 * Multi-Objective Remediation Options
 * Per P0 Economic Diagnosis spec section 9 - shows multiple verified options
 * rather than a single "best" recommendation
 */
export function RemediationOptionsCard({
  options,
  language,
  onSelect,
}: {
  options: RemediationOption[];
  language: Language;
  onSelect?: (option: RemediationOption) => void;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <section className="card">
      <span className="eyebrow-monad">
        {say(language, {
          en: "Your options",
          zh: "你的选项",
        })}
      </span>
      <p className="mt-2 text-[14px] leading-[1.6] text-dim">
        {say(language, {
          en: "Parallax does not assume which objective matters most to you. Tap a verified option to apply it on the swap sheet.",
          zh: "Parallax 不会假设哪个目标对你最重要。点按已验证选项即可套用到兑换输入。",
        })}
      </p>

      <div className="mt-4 space-y-4">
        {options.map((option) => (
          <RemediationOptionRow
            key={option.id}
            language={language}
            option={option}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function RemediationOptionRow({
  option,
  language,
  onSelect,
}: {
  option: RemediationOption;
  language: Language;
  onSelect?: (option: RemediationOption) => void;
}) {
  const verificationColor = {
    VERIFIED: "text-risk-low border-risk-low/50 bg-risk-low/10",
    UNVERIFIED: "text-faint border-line bg-ink-rail",
    CONDITIONAL:
      "text-risk-moderate border-risk-moderate/50 bg-risk-moderate/10",
  }[option.verificationStatus];

  const verificationLabel = {
    VERIFIED: { en: "Verified", zh: "已验证" },
    UNVERIFIED: { en: "Unverified", zh: "未验证" },
    CONDITIONAL: { en: "Conditional", zh: "条件性" },
  }[option.verificationStatus];

  const selectable = option.swapIntent !== undefined && onSelect !== undefined;

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-[15px] font-bold">
          {say(language, option.objective)}
        </strong>
        <span className="pill text-[11px]">
          {say(language, verificationLabel)}
        </span>
      </div>

      <p className="m-0 mt-2 text-[14px] leading-[1.6]">
        {say(language, option.candidateAdjustment)}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-current/20 pt-3 sm:grid-cols-2">
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] opacity-70">
            {say(language, { en: "Change", zh: "变化" })}
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[14px] text-dim">
              {option.quantification.before} {option.quantification.unit}
            </span>
            <span aria-hidden="true" className="text-dim">
              →
            </span>
            <strong className="text-[16px] font-bold">
              {option.quantification.after} {option.quantification.unit}
            </strong>
          </div>
        </div>

        <div>
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] opacity-70">
            {say(language, { en: "Predicted outcome", zh: "预测结果" })}
          </span>
          <p className="m-0 mt-1 text-[14px] leading-[1.5]">
            {say(language, option.predictedOutcome)}
          </p>
        </div>
      </div>

      {option.tradeOff && (
        <div className="mt-3 border-t border-current/20 pt-3">
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] opacity-70">
            {say(language, { en: "Trade-off", zh: "权衡" })}
          </span>
          <p className="m-0 mt-1 text-[13px] leading-[1.6] text-dim">
            {say(language, option.tradeOff)}
          </p>
        </div>
      )}

      {option.verificationStatus === "CONDITIONAL" && (
        <div className="mt-3 border-t border-risk-moderate/30 pt-3">
          <p className="m-0 text-[12px] leading-[1.5] text-dim">
            {say(language, {
              en: "This is conditional guidance, not a verified improvement. Re-check when the condition is met.",
              zh: "这是条件性指导，不是已验证的改进。条件满足时请重新检查。",
            })}
          </p>
        </div>
      )}

      {option.verificationStatus === "UNVERIFIED" && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="m-0 text-[12px] leading-[1.5] text-dim">
            {say(language, {
              en: "This change has not been verified. It remains speculative until evidence supports it.",
              zh: "此变更尚未验证。在证据支持之前，它仍然是推测性的。",
            })}
          </p>
        </div>
      )}
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        className={`w-full rounded-[14px] border-none p-5 text-left backdrop-blur-xl transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${verificationColor}`}
        onClick={() => onSelect(option)}
      >
        {content}
      </button>
    );
  }

  return <div className={`rounded-[14px] border-none p-5 backdrop-blur-xl ${verificationColor}`}>{content}</div>;
}

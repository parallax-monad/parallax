import { RemediationOptionsCard } from "@/components/analyze/RemediationOptionsCard";
import type { CheckSwapResult, RemediationOption } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

export function OptionsStep({
  result,
  language,
  onSelectOption,
  onBack,
}: {
  result: CheckSwapResult;
  language: Language;
  onSelectOption?: (option: RemediationOption) => void;
  onBack: () => void;
}) {
  const hasOptions = result.remediationOptions && result.remediationOptions.length > 0;

  if (!hasOptions) {
    return (
      <div className="flex flex-col gap-4">
        <section className="border border-line bg-ink-elev2 p-5">
          <strong className="block text-[16px] font-bold text-white">
            {say(language, {
              en: "No verified options available",
              zh: "无可用的已验证选项",
            })}
          </strong>
          <p className="mt-2 text-[14px] leading-[1.6] text-dim">
            {say(language, {
              en: "The current check did not produce any verified remediation options. Review the result step or modify parameters and retry.",
              zh: "当前检查未产生任何已验证的修复选项。请查看结果步骤或修改参数重试。",
            })}
          </p>
        </section>

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

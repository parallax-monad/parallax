import { useState } from "react";
import { OptionsStep } from "@/components/analyze/OptionsStep";
import { P0ExecutionCard } from "@/components/analyze/P0ExecutionCard";
import { ResultStep } from "@/components/analyze/ResultStep";
import { VerdictIcon } from "@/components/analyze/StatusIcon";
import { StepTimeline } from "@/components/analyze/StepTimeline";
import type {
  CheckSwapResult,
  ProductRunMode,
  RemediationOption,
} from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const MODE_LABEL: Record<ProductRunMode, Copy> = {
  LIVE: { en: "Live check", zh: "实时检查" },
  RECORDED_REPLAY: { en: "Recorded replay", zh: "录制回放" },
};
const SAMPLE_LABEL: Copy = { en: "Sample result", zh: "示例结果" };
const SAMPLE_EXPLANATION: Copy = {
  en: "This is a sample result for exploring the steps. It is not current live evidence.",
  zh: "这是用于了解步骤的示例结果，并非当前实时证据。",
};

const MODE_EXPLANATION: Record<ProductRunMode, Copy> = {
  LIVE: {
    en: "This is the backend response for a live Check. Nothing here is signed or broadcast.",
    zh: "这是实时检查的后端响应。这里不会签名，也不会广播。",
  },
  RECORDED_REPLAY: {
    en: "This result reproduces previously recorded real Evidence. It is not a current Live Run.",
    zh: "此结果复现此前录制的真实证据，并非当前实时运行。",
  },
};

const PRIMARY_ACTION: Copy = { en: "Review swap inputs", zh: "查看兑换输入" };
const RECHECK_ACTION: Copy = { en: "Edit and re-check", zh: "修改并重新检查" };
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

export function WalletResult({
  result,
  language,
  onKeep,
  onRetry,
  onDiscard,
  onOpenEvidence,
  onSelectOption,
}: {
  result: CheckSwapResult;
  language: Language;
  onKeep: () => void;
  onRetry?: () => void;
  onDiscard: () => void;
  onOpenEvidence: () => void;
  onSelectOption?: (option: RemediationOption) => void;
}) {
  const [currentStep, setCurrentStep] = useState<"result" | "options">(
    "result",
  );

  if (result.systemStatus === "INTEGRATION_ERROR") {
    return (
      <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow-monad m-0">
            {say(language, { en: "Before you sign", zh: "签名之前" })}
          </span>
          <span className="pill border-risk-moderate/50 text-risk-moderate">
            {say(language, { en: "Integration error", zh: "集成错误" })}
          </span>
          <span className="pill">
            {say(
              language,
              result.presentationOrigin === "sample"
                ? SAMPLE_LABEL
                : MODE_LABEL[result.productRunMode],
            )}
          </span>
        </div>

        <section className="flex items-start gap-3 border border-risk-moderate/50 bg-risk-moderate/10 p-4 text-risk-moderate">
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
                      zh: "本次未生成交易结论。此错误无法原样重试，请查看技术详情或放弃本次检查。",
                    },
              )}
            </p>
            <p className="mt-2 text-[13px] leading-[1.6] text-dim">
              {say(language, result.summary)}
            </p>
            {result.apiFailure && (
              <dl className="mt-3 border-t border-risk-moderate/30 pt-2 text-[12px]">
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
                {result.apiFailure.issues?.map((issue) => (
                  <div
                    className="flex justify-between gap-3 py-1"
                    key={`${issue.field ?? ""}:${issue.code ?? ""}`}
                  >
                    <dt className="min-w-0 break-all font-bold uppercase tracking-[0.06em]">
                      {issue.field ?? "error.issue"}
                    </dt>
                    <dd className="mono m-0 min-w-0 break-words text-right text-white">
                      {issue.message ?? issue.code}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>
        <P0ExecutionCard language={language} result={result} />
        <p className="text-[12px] leading-[1.6] text-dim">
          {say(
            language,
            result.presentationOrigin === "sample"
              ? SAMPLE_EXPLANATION
              : MODE_EXPLANATION[result.productRunMode],
          )}
        </p>

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

  const hasOptions =
    result.remediationOptions && result.remediationOptions.length > 0;

  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow-monad m-0">
          {say(language, { en: "Before you sign", zh: "签名之前" })}
        </span>
        <span className="pill">
          {say(
            language,
            result.presentationOrigin === "sample"
              ? SAMPLE_LABEL
              : MODE_LABEL[result.productRunMode],
          )}
        </span>
      </div>

      {hasOptions && (
        <div className="sticky top-0 z-30 -mx-5 border-b border-line/50 bg-gradient-to-b from-ink-elev/95 via-ink-elev/80 to-transparent px-5 pb-2 pt-1 backdrop-blur-xl">
          <StepTimeline
            currentStep={currentStep}
            language={language}
            onStepClick={(step) => setCurrentStep(step)}
          />
        </div>
      )}

      <p className="text-[12px] leading-[1.6] text-dim">
        {say(
          language,
          result.presentationOrigin === "sample"
            ? SAMPLE_EXPLANATION
            : MODE_EXPLANATION[result.productRunMode],
        )}
      </p>

      {currentStep === "result" ? (
        <ResultStep
          language={language}
          result={result}
          onNext={() => setCurrentStep("options")}
        />
      ) : (
        <OptionsStep
          language={language}
          result={result}
          onSelectOption={onSelectOption}
          onBack={() => setCurrentStep("result")}
        />
      )}

      <div className="mt-1 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-monad" onClick={onKeep}>
          {say(language, result.backendRunId ? RECHECK_ACTION : PRIMARY_ACTION)}
        </button>
        <button
          type="button"
          className="btn btn-monad-outline"
          onClick={onDiscard}
        >
          {say(language, DISCARD_ACTION)}
        </button>
      </div>

      <p className="text-center text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Nothing was signed or broadcast. This is a pre-sign check only.",
          zh: "没有签名，也没有广播。这里只做签名前检查。",
        })}
      </p>
    </div>
  );
}

import { useState } from "react";
import { OptionsStep } from "@/components/analyze/OptionsStep";
import { ResultStep } from "@/components/analyze/ResultStep";
import { VerdictIcon } from "@/components/analyze/StatusIcon";
import { StepTimeline } from "@/components/analyze/StepTimeline";
import type {
  BasicSimulation,
  CheckSwapResult,
  ProductRunMode,
  RemediationOption,
} from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const MODE_LABEL: Record<ProductRunMode, Copy> = {
  LIVE: { en: "Live check", zh: "实时检查" },
  RECORDED_REPLAY: { en: "Recorded replay", zh: "录制回放" },
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

function FactRow({ label, value }: { label: Copy; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-0">
      <dt className="text-dim">{label.en}</dt>
      <dd className="mono m-0 min-w-0 break-all text-right text-white">
        {value}
      </dd>
    </div>
  );
}

function P0Facts({
  result,
  language,
}: {
  result: CheckSwapResult;
  language: Language;
}) {
  const simulation: BasicSimulation | undefined = result.basicSimulation;
  const callStatus = simulation?.call.status ?? "UNAVAILABLE";
  const gasStatus = simulation?.gasEstimate.status ?? "UNAVAILABLE";
  const evidenceState = result.evidenceState ?? "UNKNOWN";
  const providerStatus = result.providerEvidence?.status ?? "UNKNOWN";
  const remediation = result.remediationStatus ?? "UNKNOWN";

  return (
    <section
      className="border-y border-line py-3"
      aria-label="P0 execution facts"
    >
      <h3 className="m-0 text-[12px] font-bold uppercase text-dim">
        {say(language, {
          en: "Arbitrum Sepolia · Camelot V3",
          zh: "Arbitrum Sepolia · Camelot V3",
        })}
      </h3>
      <dl className="m-0 mt-2">
        <FactRow
          label={{ en: "Provider status", zh: "Provider 狀態" }}
          value={providerStatus}
        />
        <FactRow
          label={{ en: "basicSimulation call", zh: "basicSimulation 呼叫" }}
          value={callStatus}
        />
        <FactRow
          label={{ en: "Gas status", zh: "Gas 狀態" }}
          value={gasStatus}
        />
        <FactRow
          label={{ en: "Evidence quality", zh: "Evidence 品質" }}
          value={evidenceState}
        />
        <FactRow
          label={{ en: "Risk verdict", zh: "風險判定" }}
          value={result.verdict}
        />
        <FactRow
          label={{ en: "Remediation", zh: "修復狀態" }}
          value={remediation}
        />
        <FactRow label={{ en: "Run ID", zh: "Run ID" }} value={result.runId} />
        {result.parentRunId && (
          <FactRow
            label={{ en: "Parent Run", zh: "Parent Run" }}
            value={result.parentRunId}
          />
        )}
        <FactRow
          label={{ en: "Block", zh: "區塊" }}
          value={
            simulation?.blockNumber ??
            simulation?.call.blockNumber ??
            result.simulatorPinnedBlock ??
            "UNAVAILABLE"
          }
        />
        <FactRow
          label={{ en: "Observed at", zh: "觀測時間" }}
          value={
            simulation?.observedAt ??
            result.providerEvidence?.observedAt ??
            "UNAVAILABLE"
          }
        />
      </dl>
      {simulation?.call.status === "SUCCEEDED" && (
        <p className="mb-0 mt-3 border-l-2 border-risk-elevated pl-3 text-[12px] leading-[1.5] text-dim">
          {say(language, {
            en: "eth_call success is an execution fact, not a safety or Risk pass.",
            zh: "eth_call 成功只代表執行檢查結果，不代表安全或風險通過。",
          })}
        </p>
      )}
      {(evidenceState === "INCOMPLETE" || result.verdict === "UNKNOWN") && (
        <p className="mb-0 mt-2 text-[12px] font-semibold text-risk-elevated">
          {say(language, {
            en: "UNKNOWN is not a pass.",
            zh: "UNKNOWN 不代表通過。",
          })}
        </p>
      )}
    </section>
  );
}

export function WalletResult({
  result,
  language,
  onKeep,
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
            {say(language, MODE_LABEL[result.productRunMode])}
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
        <p className="text-[12px] leading-[1.6] text-dim">
          {say(language, MODE_EXPLANATION[result.productRunMode])}
        </p>

        <div
          className={
            result.apiFailure?.retryable
              ? "grid grid-cols-2 gap-2"
              : "grid grid-cols-1 gap-2"
          }
        >
          {result.apiFailure?.retryable && (
            <button type="button" className="btn btn-monad" onClick={onKeep}>
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
          {say(language, MODE_LABEL[result.productRunMode])}
        </span>
      </div>

      <P0Facts language={language} result={result} />

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
        {say(language, MODE_EXPLANATION[result.productRunMode])}
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
          {say(language, PRIMARY_ACTION)}
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

import { type Language, say } from "@/lib/i18n";

type Step = {
  id: string;
  label: { en: string; zh: string };
  description: { en: string; zh: string };
};

const STEPS: Step[] = [
  {
    id: "result",
    label: { en: "Step 1", zh: "步骤 1" },
    description: { en: "Result Diagnosis", zh: "结果诊断" },
  },
  {
    id: "options",
    label: { en: "Step 2", zh: "步骤 2" },
    description: { en: "Choose Options", zh: "选择方案" },
  },
];

export function StepTimeline({
  currentStep,
  language,
  onStepClick,
}: {
  currentStep: "result" | "options";
  language: Language;
  onStepClick?: (step: "result" | "options") => void;
}) {
  const currentIndex = STEPS.findIndex((step) => step.id === currentStep);

  return (
    <div className="relative w-full py-6">
      <div className="relative flex items-start justify-between">
        {STEPS.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = index < currentIndex;
          const isClickable = onStepClick !== undefined && index <= currentIndex;
          const isLast = index === STEPS.length - 1;

          return (
            <div key={step.id} className="relative flex flex-1 flex-col items-center">
              {!isLast && (
                <div className="absolute left-1/2 top-[20px] h-[2px] w-full">
                  <div className="absolute inset-0 bg-line" />
                  {isCompleted && <div className="absolute inset-0 bg-monad-bright" />}
                  {isActive && (
                    <div
                      className="absolute inset-0 bg-monad-bright"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(90deg, transparent, transparent 6px, var(--color-ink-base) 6px, var(--color-ink-base) 12px)",
                        animation: "dash 0.5s linear infinite",
                      }}
                    />
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={!isClickable}
                className={`group relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                  isActive
                    ? "scale-110 border-monad-bright bg-monad-bright shadow-[0_0_16px_rgba(123,97,255,0.6)]"
                    : isCompleted
                      ? "border-monad-bright bg-monad-bright"
                      : "border-line bg-ink-elev2"
                } ${isClickable ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
                onClick={() => isClickable && onStepClick(step.id as "result" | "options")}
              >
                {isCompleted && !isActive ? (
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className={`text-[14px] font-bold ${isActive || isCompleted ? "text-white" : "text-dim"}`}>
                    {index + 1}
                  </span>
                )}
                {isActive && <span className="absolute inset-0 animate-ping rounded-full border-2 border-monad-bright opacity-75" />}
              </button>

              <div className="mt-3 flex flex-col items-center text-center">
                <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${isActive ? "text-monad-bright" : isCompleted ? "text-white" : "text-dim"}`}>
                  {say(language, step.label)}
                </span>
                <span className={`mt-0.5 text-[12px] leading-[1.3] ${isActive ? "text-white" : isCompleted ? "text-dim" : "text-faint"}`}>
                  {say(language, step.description)}
                </span>
                {isCompleted && !isActive && (
                  <span className="mt-1.5 rounded-full bg-monad-bright/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-monad-bright">
                    {say(language, { en: "Completed", zh: "已完成" })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes dash {
          to { background-position: 24px 0; }
        }
      `}</style>
    </div>
  );
}

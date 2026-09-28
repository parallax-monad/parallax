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
  const activePosition = `${25 + currentIndex * 50}%`;

  return (
    <div className="relative w-full py-3">
      <div className="relative flex items-start justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-20 h-10 w-10 -translate-x-1/2 rounded-full border-2 border-monad-bright bg-monad-bright/20 shadow-[0_0_16px_rgba(123,97,255,0.6)] transition-[left] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ left: activePosition }}
        />

        {STEPS.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = index < currentIndex;
          const isClickable =
            onStepClick !== undefined && index <= currentIndex;
          const isLast = index === STEPS.length - 1;

          return (
            <div
              key={step.id}
              className="relative flex flex-1 flex-col items-center"
            >
              {!isLast && (
                <div className="absolute left-1/2 top-[20px] h-[2px] w-full">
                  <div className="absolute inset-0 bg-line" />
                  <div
                    className="absolute inset-y-0 left-0 bg-monad-bright transition-[width] duration-500 ease-out"
                    style={{ width: isCompleted ? "100%" : "0%" }}
                  />
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
                className={`group relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-[transform,background-color,border-color] duration-500 ease-out ${isActive ? "scale-110 border-monad-bright bg-monad-bright shadow-[0_0_16px_rgba(123,97,255,0.6)]" : isCompleted ? "border-monad-bright bg-monad-bright" : "border-line bg-ink-elev2"} ${isClickable ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
                onClick={() =>
                  isClickable && onStepClick(step.id as "result" | "options")
                }
              >
                {isCompleted && !isActive ? (
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span
                    className={`text-[14px] font-bold ${isActive || isCompleted ? "text-white" : "text-dim"}`}
                  >
                    {index + 1}
                  </span>
                )}
                {isActive && (
                  <>
                    <span className="pointer-events-none absolute -inset-0.5 animate-ping rounded-full border border-monad-bright/60 opacity-45" />
                    <span className="pointer-events-none absolute inset-0 animate-[pulse_1.8s_ease-out_infinite] rounded-full border border-monad-bright/40 opacity-60" />
                  </>
                )}
              </button>

              <div className="mt-2 flex flex-col items-center text-center">
                <span
                  className={`text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-500 ${isActive ? "text-monad-bright" : isCompleted ? "text-white" : "text-dim"}`}
                >
                  {say(language, step.label)}
                </span>
                <span
                  className={`mt-0.5 text-[12px] leading-[1.3] transition-colors duration-500 ${isActive ? "text-white" : isCompleted ? "text-dim" : "text-faint"}`}
                >
                  {say(language, step.description)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes dash { to { background-position: 24px 0; } }`}</style>
    </div>
  );
}

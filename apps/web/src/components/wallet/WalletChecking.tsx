import { type Language, say } from "@/lib/i18n";

/**
 * Names the Moss pipeline in user language: intent → quote → action →
 * simulation → evidence → verdict. No JSON or raw fields surface here.
 */
const STAGES = [
  { en: "Preparing quote", zh: "准备报价" },
  { en: "Preparing transaction action", zh: "准备交易操作" },
  { en: "Simulating execution", zh: "模拟执行" },
  { en: "Reviewing evidence", zh: "审阅证据" },
  { en: "Finalizing result", zh: "生成最终结果" },
];

export const WALLET_STAGE_COUNT = STAGES.length;

export function WalletChecking({
  language,
  stage,
}: {
  language: Language;
  stage: number;
}) {
  return (
    <div
      aria-live="polite"
      className="flex flex-1 flex-col justify-center px-5 pb-10"
    >
      <span className="eyebrow-monad">
        {say(language, {
          en: "Parallax · Demo preset",
          zh: "Parallax · 演示预设",
        })}
      </span>
      <h2 className="m-0 text-[24px] font-extrabold leading-[1.15] tracking-[-0.04em]">
        {say(language, {
          en: "Checking this demo swap before signing.",
          zh: "正在签名前检查这笔演示兑换。",
        })}
      </h2>

      <ol className="m-0 mt-6 list-none p-0">
        {STAGES.map((label, index) => {
          const done = index < stage;
          const active = index === stage;
          return (
            <li
              className={`flex items-center gap-3 py-2.5 text-[16px] transition-colors ${
                done ? "text-monad-dim" : active ? "text-white" : "text-dim"
              }`}
              key={label.en}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  done
                    ? "bg-monad"
                    : active
                      ? "animate-flow-pulse bg-white"
                      : "bg-line-strong"
                }`}
              />
              {say(language, label)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

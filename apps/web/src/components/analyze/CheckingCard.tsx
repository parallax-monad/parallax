import { type Language, say } from "@/lib/i18n";

const STAGES = [
  { en: "Discovering protocol", zh: "发现协议" },
  { en: "Loading route", zh: "加载路径" },
  { en: "Building unsigned action", zh: "构建未签名交易" },
  { en: "Simulating", zh: "模拟执行" },
  { en: "Applying rules", zh: "执行规则" },
];

export const CHECK_STAGE_COUNT = STAGES.length;

export function CheckingCard({
  language,
  stage,
}: {
  language: Language;
  stage: number;
}) {
  return (
    <div className="card" aria-live="polite">
      <span className="eyebrow">
        {say(language, { en: "Running check", zh: "检查中" })}
      </span>
      <h2 className="m-0 mb-4 text-[20px] font-extrabold tracking-[-0.03em]">
        {say(language, {
          en: "Gathering execution evidence.",
          zh: "正在收集执行证据。",
        })}
      </h2>
      <ol className="m-0 list-none p-0">
        {STAGES.map((label, index) => {
          const done = index < stage;
          const active = index === stage;
          return (
            <li
              className={`flex items-center gap-3 py-2 text-[15px] transition-colors ${
                done ? "text-accent" : active ? "text-white" : "text-dim"
              }`}
              key={label.en}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  done
                    ? "bg-accent"
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

import type { RunDiff } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

const DIRECTION_TONE: Record<RunDiff[number]["direction"], string> = {
  improved: "text-risk-low",
  worsened: "text-risk-high",
  changed: "text-risk-moderate",
};

export function DiffCard({
  diff,
  previousRunId,
  runId,
  language,
}: {
  diff: RunDiff;
  previousRunId: string;
  runId: string;
  language: Language;
}) {
  return (
    <div className="card">
      <span className="eyebrow-monad">
        {say(language, { en: "Previous vs new", zh: "前后对比" })}
      </span>
      <h2 className="m-0 mb-1.5 text-[20px] font-extrabold tracking-[-0.03em]">
        {say(language, {
          en: "What your change did.",
          zh: "你的修改带来了什么。",
        })}
      </h2>
      <p className="mono mb-3 text-dim">
        {previousRunId} → {runId}
      </p>

      <ul className="m-0 list-none border-t border-line p-0">
        {diff.map((row) => (
          <li
            className="grid grid-cols-1 gap-1 border-b border-line py-3 sm:grid-cols-[minmax(0,150px)_1fr] sm:gap-6"
            key={row.field.en}
          >
            <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
              {say(language, row.field)}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-[15px]">
              <span className="text-dim line-through">
                {say(language, row.previous)}
              </span>
              <span aria-hidden="true" className="text-faint">
                →
              </span>
              <span className={DIRECTION_TONE[row.direction]}>
                {say(language, row.next)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

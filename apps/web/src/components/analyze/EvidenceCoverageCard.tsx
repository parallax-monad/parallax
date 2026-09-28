import type { EvidenceCoverage } from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const STATUS: Record<NonNullable<EvidenceCoverage["status"]>, Copy> = {
  success: { en: "Observed", zh: "已观察" },
  partial: { en: "Partial evidence", zh: "部分证据" },
  unknown: { en: "Unknown", zh: "未知" },
  unavailable: { en: "Unavailable", zh: "不可用" },
  invalid: { en: "Context unverified", zh: "上下文未验证" },
};
const MODE: Record<EvidenceCoverage["mode"], Copy> = {
  LIVE: { en: "Live observation", zh: "实时观察" },
  RECORDED_REPLAY: { en: "Recorded replay", zh: "录制回放" },
  MOCK: { en: "Mock", zh: "模拟数据" },
};

function ScopeList({
  title,
  items,
  language,
}: {
  title: Copy;
  items: readonly { label: Copy; reason?: Copy }[];
  language: Language;
}) {
  return (
    <div>
      <h4 className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
        {say(language, title)}
      </h4>
      {items.length === 0 ? (
        <p className="m-0 mt-1 text-[12px] text-dim">
          {say(language, { en: "None recorded", zh: "未记录" })}
        </p>
      ) : (
        <ul className="m-0 mt-1 list-disc space-y-1 pl-4 text-[12px] leading-[1.5] text-white">
          {items.map((item) => (
            <li key={item.label.en}>
              {say(language, item.label)}
              {item.reason && (
                <span className="text-dim">
                  {" — "}
                  {say(language, item.reason)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceCoverageCard({
  sources,
  notice,
  language,
}: {
  sources?: readonly EvidenceCoverage[];
  notice?: Copy;
  language: Language;
}) {
  if (!sources?.length && !notice) return null;

  return (
    <section className="rounded-[12px] border border-line bg-ink-elev2/30 p-3">
      <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
        {say(language, { en: "Evidence sources", zh: "证据来源" })}
      </h3>
      <p className="m-0 mt-1 text-[12px] leading-[1.5] text-dim">
        {say(language, {
          en: "Each source has its own scope. More checked items do not mean a safer swap; the result above is unchanged.",
          zh: "每个来源都有自己的检查范围。已检查项目更多不代表兑换更安全；上方结果不会因此改变。",
        })}
      </p>
      {notice && (
        <p className="mt-2 rounded-md border border-line p-2 text-[12px] text-dim">
          {say(language, notice)}
        </p>
      )}
      <div className="mt-3 space-y-3">
        {sources?.map((source) => (
          <div
            className="rounded-md border border-line bg-ink-elev/40 p-3"
            key={`${source.role}:${source.sourceId}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <strong className="text-[14px] text-white">
                {say(language, source.source)}
              </strong>
              <span className="text-[11px] text-dim">
                {say(
                  language,
                  source.role === "primary"
                    ? { en: "Primary check", zh: "主要检查" }
                    : { en: "Supplementary evidence", zh: "补充证据" },
                )}
              </span>
              {source.status && (
                <span className="text-[11px] text-dim">
                  · {say(language, STATUS[source.status])}
                </span>
              )}
              <span className="text-[11px] text-dim">
                · {say(language, MODE[source.mode])}
              </span>
            </div>
            <p className="mono m-0 mt-1 break-all text-[11px] text-dim">
              {say(language, { en: "Source ID", zh: "来源 ID" })}:{" "}
              {source.sourceId}
            </p>
            <dl className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-dim">
              <div className="flex gap-1">
                <dt>{say(language, { en: "Block", zh: "区块" })}:</dt>
                <dd className="mono m-0 text-white">
                  {source.blockNumber ??
                    say(language, { en: "Not verified", zh: "未验证" })}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>{say(language, { en: "Observed", zh: "观察时间" })}:</dt>
                <dd className="mono m-0 break-all text-white">
                  {source.observedAt ? (
                    <time dateTime={source.observedAt}>
                      {source.observedAt}
                    </time>
                  ) : (
                    say(language, { en: "Not recorded", zh: "未记录" })
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
              <ScopeList
                items={source.checked.map((item) => ({ label: item }))}
                language={language}
                title={{ en: "What was checked", zh: "已检查" }}
              />
              <ScopeList
                items={source.notChecked.map((item) => ({ label: item }))}
                language={language}
                title={{ en: "What was not checked", zh: "未检查" }}
              />
              <ScopeList
                items={source.unknown}
                language={language}
                title={{ en: "What is unknown", zh: "未知项目" }}
              />
              <ScopeList
                items={source.unavailable}
                language={language}
                title={{ en: "What is unavailable", zh: "不可用项目" }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

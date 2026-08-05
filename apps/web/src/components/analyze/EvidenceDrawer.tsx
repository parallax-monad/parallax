import { useEffect, useRef } from "react";
import type {
  CheckSwapResult,
  EvidenceItem,
  RuleResult,
} from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const ORIGIN_TONE: Record<EvidenceItem["origin"], string> = {
  live: "border-risk-low/50 text-risk-low",
  replay: "",
  derived: "border-risk-moderate/50 text-risk-moderate",
  mock: "border-risk-high/50 text-risk-high",
};

const OUTCOME_TONE: Record<RuleResult["outcome"], string> = {
  PASS: "text-risk-low",
  FAIL: "text-risk-high",
  UNKNOWN: "text-risk-elevated",
  SKIPPED: "text-faint",
};

const STAGE_LABEL: Record<EvidenceItem["stage"], Copy> = {
  discover: { en: "Discover", zh: "发现" },
  load: { en: "Load", zh: "加载" },
  action: { en: "Action", zh: "构建" },
  simulate: { en: "Simulate", zh: "模拟" },
  rpc: { en: "RPC query", zh: "RPC 查询" },
};

export function EvidenceDrawer({
  result,
  language,
  onClose,
}: {
  result: CheckSwapResult;
  language: Language;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={say(language, { en: "Close evidence", zh: "关闭证据" })}
        className="absolute inset-0 cursor-default bg-black/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={say(language, {
          en: "Technical evidence",
          zh: "技术证据",
        })}
        className="no-scrollbar relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-l border-line bg-ink-elev px-6 py-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="eyebrow-monad">
              {say(language, { en: "Technical evidence", zh: "技术证据" })}
            </span>
            <h2 className="mono m-0 text-[15px] font-extrabold">
              {result.runId}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-monad-outline"
            onClick={onClose}
          >
            {say(language, { en: "Close", zh: "关闭" })}
          </button>
        </div>

        <section className="mt-6">
          <h3 className="m-0 mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, {
              en: "Moss workflow stages",
              zh: "Moss 工作流阶段",
            })}
          </h3>
          <ul className="m-0 list-none border-t border-line p-0">
            {result.evidence.map((item) => (
              <li className="border-b border-line py-3" key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[14px] text-white">
                    {say(language, STAGE_LABEL[item.stage])}
                  </strong>
                  <span className={`pill ${ORIGIN_TONE[item.origin]}`}>
                    {item.origin}
                  </span>
                  {item.blockNumber && (
                    <span className="text-[12px] text-dim">
                      block {item.blockNumber}
                    </span>
                  )}
                </div>
                <p className="m-0 mt-1 text-[11px] text-faint">
                  {say(language, item.label)}
                </p>
                <p className="m-0 mt-0.5 break-words text-[12px] text-dim">
                  {item.value}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <h3 className="m-0 mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "Rule results", zh: "规则结果" })}
          </h3>
          <ul className="m-0 list-none border-t border-line p-0">
            {result.ruleResults.map((rule) => (
              <li className="border-b border-line py-3" key={rule.id}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong className="text-[14px] text-white">
                    {say(language, rule.label)}
                  </strong>
                  <span
                    className={`text-[12px] font-bold uppercase tracking-[0.08em] ${OUTCOME_TONE[rule.outcome]}`}
                  >
                    {rule.outcome}
                  </span>
                </div>
                <p className="m-0 mt-1 text-[12px] leading-[1.6] text-dim">
                  {say(language, rule.detail)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 pb-4">
          <h3 className="m-0 mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "Decision receipt", zh: "决策凭证" })}
          </h3>
          <dl className="m-0 border-t border-line pt-1">
            {[
              ["runId", result.runId],
              ["parentRunId", result.parentRunId ?? "—"],
              ["systemStatus", result.systemStatus],
              ["verdict", result.verdict],
              ["blockNumber", result.quote.blockNumber],
              ["minimumReceivedSource", result.minimumReceivedSource],
              ["replayMode", String(result.replayMode)],
              ["ruleVersion", result.ruleVersion],
              ["mossVersion", result.mossVersion],
              ["createdAt", result.createdAt],
            ].map(([key, value]) => (
              <div className="kv" key={key}>
                <span className="kv-label">{key}</span>
                <span className="mono text-right text-dim">{value}</span>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12px] leading-[1.6] text-dim">
            {say(language, {
              en: "Replay evidence is recorded, not a live call. Nothing here is signed or broadcast.",
              zh: "回放证据来自录制，并非实时调用。这里不会签名，也不会广播。",
            })}
          </p>
        </section>
      </div>
    </div>
  );
}

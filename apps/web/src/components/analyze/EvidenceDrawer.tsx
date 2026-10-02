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
  quote: { en: "Quote", zh: "报价" },
  action: { en: "Action", zh: "构建" },
  simulate: { en: "Simulate", zh: "模拟" },
  rpc: { en: "RPC query", zh: "RPC 查询" },
  unknown: { en: "Unknown", zh: "未知" },
};

const MODE_LABEL: Record<CheckSwapResult["productRunMode"], Copy> = {
  LIVE: { en: "Live check", zh: "实时检查" },
  RECORDED_REPLAY: { en: "Recorded replay", zh: "录制回放" },
};

const CAPABILITY_TONE: Record<
  "checked" | "not_checked" | "unknown" | "unavailable",
  string
> = {
  checked: "text-risk-low",
  not_checked: "text-faint",
  unknown: "text-risk-elevated",
  unavailable: "text-faint",
};

function sourceLabel(source: EvidenceItem["source"] = "unknown"): Copy {
  return {
    native_rpc: { en: "Native RPC", zh: "Native RPC" },
    trace_rpc: { en: "Trace RPC", zh: "Trace RPC" },
    account_allowance: { en: "Account / allowance", zh: "账户 / 授权" },
    explorer: { en: "Explorer", zh: "浏览器" },
    quote: { en: "Quote", zh: "报价" },
    simulation: { en: "Simulation", zh: "模拟" },
    unknown: { en: "Unknown source", zh: "未知来源" },
  }[source];
}

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
          en: "Evidence and scope",
          zh: "证据与检查范围",
        })}
        className="no-scrollbar relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-l border-line bg-ink-elev px-6 py-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="eyebrow-monad">
              {say(language, {
                en: "Evidence and scope",
                zh: "证据与检查范围",
              })}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="mono m-0 text-[15px] font-extrabold">
                {result.runId}
              </h2>
              <span className="pill">
                {say(language, MODE_LABEL[result.productRunMode])}
              </span>
            </div>
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
                  <span
                    className={
                      item.status === "checked"
                        ? "text-risk-low"
                        : item.status === "unavailable"
                          ? "text-faint"
                          : "text-risk-elevated"
                    }
                  >
                    {item.status}
                  </span>
                  <span className="text-[12px] text-dim">
                    {say(language, sourceLabel(item.source))}
                  </span>
                </div>
                <p className="m-0 mt-1 text-[11px] text-faint">
                  {say(language, item.label)}
                </p>
                {item.reason && (
                  <p className="m-0 mt-1 text-[11px] leading-[1.5] text-dim">
                    {say(language, item.reason)}
                  </p>
                )}
                <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="text-dim">Observed</dt>
                  <dd className="m-0 break-words text-right text-white">
                    {item.observedAt ?? "Not recorded"}
                  </dd>
                  {item.blockNumber && (
                    <>
                      <dt className="text-dim">Block</dt>
                      <dd className="mono m-0 break-words text-right text-white">
                        {item.blockNumber}
                      </dd>
                    </>
                  )}
                  {item.mode && (
                    <>
                      <dt className="text-dim">Mode</dt>
                      <dd className="m-0 text-right text-white">{item.mode}</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </section>

        {result.providerEvidence?.capabilities && (
          <section className="mt-6">
            <h3 className="m-0 mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
              {say(language, { en: "Capabilities", zh: "能力范围" })}
            </h3>
            {(
              ["checked", "unknown", "not_checked", "unavailable"] as const
            ).map((status) => {
              const items =
                result.providerEvidence?.capabilities?.filter(
                  (capability) => capability.status === status,
                ) ?? [];
              const label = {
                checked: { en: "Checked", zh: "已检查" },
                unknown: { en: "Unknown", zh: "未知" },
                not_checked: { en: "Not checked", zh: "未检查" },
                unavailable: { en: "Unavailable", zh: "不可用" },
              }[status];
              return (
                <div className="border-t border-line py-3" key={status}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
                    {say(language, label)}
                  </div>
                  {items.length === 0 ? (
                    <p className="m-0 mt-1 text-[13px] text-dim">
                      {say(language, {
                        en: "No items reported",
                        zh: "没有报告项目",
                      })}
                    </p>
                  ) : (
                    <ul className="m-0 mt-1 list-none p-0">
                      {items.map((capability) => (
                        <li
                          className="border-b border-line py-2 last:border-b-0"
                          key={capability.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <strong className="text-[13px] text-white">
                                {capability.summary}
                              </strong>
                              <div className="mono mt-1 break-all text-[11px] text-faint">
                                {capability.id}
                              </div>
                            </div>
                            {status === "unavailable" && (
                              <span
                                className={`shrink-0 ${CAPABILITY_TONE[status]}`}
                              >
                                {say(language, {
                                  en: "Unavailable",
                                  zh: "不可用",
                                })}
                              </span>
                            )}
                          </div>
                          {capability.reason && (
                            <p className="m-0 mt-1 text-[12px] text-dim">
                              {capability.reason}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}

        <section className="mt-6">
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
              ["productRunMode", result.productRunMode],
              ["evidenceReplayMode", String(result.replayMode)],
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
            {say(
              language,
              result.productRunMode === "RECORDED_REPLAY"
                ? {
                    en: "This result reproduces previously recorded real Evidence. It is not a current Live Run. Nothing here is signed or broadcast.",
                    zh: "此结果复现此前录制的真实证据，并非当前实时运行。这里不会签名，也不会广播。",
                  }
                : {
                    en: "This result uses an explicitly labelled demo preset. It is not current Live Evidence. Nothing here is signed or broadcast.",
                    zh: "此结果使用明确标注的演示预设，并非当前实时证据。这里不会签名，也不会广播。",
                  },
            )}
          </p>
        </section>
      </div>
    </div>
  );
}

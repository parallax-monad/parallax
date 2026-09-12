import { type Language, say } from "@/lib/i18n";

/**
 * State-Bound Re-verification Warning
 * Per P0 Economic Diagnosis spec section 14 - reminds users that verified
 * results are only valid relative to the state they were verified in
 */
export function StateWarningCard({
  language,
  blockNumber,
  timestamp,
}: {
  language: Language;
  blockNumber?: string;
  timestamp?: string;
}) {
  return (
    <div className="card border-risk-moderate/30 bg-risk-moderate/5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-risk-moderate/50 text-[14px] font-bold text-risk-moderate"
        >
          ⚠
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-[13px] font-bold uppercase tracking-[0.08em] text-risk-moderate">
            {say(language, {
              en: "Re-check immediately before signing if conditions changed",
              zh: "如果条件改变，签署前立即重新检查",
            })}
          </strong>
          <p className="m-0 mt-1.5 text-[13px] leading-[1.6] text-dim">
            {say(language, {
              en: "A verified result is only valid relative to the state in which it was verified. If the market has moved, pool state changed, or time has passed, re-check before signing.",
              zh: "验证结果仅在其被验证时的状态下有效。如果市场已移动、池状态已改变或时间已过，请在签署前重新检查。",
            })}
          </p>
          {(blockNumber || timestamp) && (
            <dl className="m-0 mt-3 space-y-1 border-t border-risk-moderate/20 pt-2 text-[12px]">
              {blockNumber && (
                <div className="flex justify-between gap-3">
                  <dt className="font-bold uppercase tracking-[0.06em] text-dim">
                    {say(language, { en: "Verified at block", zh: "验证区块" })}
                  </dt>
                  <dd className="mono m-0 text-white">{blockNumber}</dd>
                </div>
              )}
              {timestamp && (
                <div className="flex justify-between gap-3">
                  <dt className="font-bold uppercase tracking-[0.06em] text-dim">
                    {say(language, { en: "Verified at", zh: "验证时间" })}
                  </dt>
                  <dd className="mono m-0 text-white">
                    {new Date(timestamp).toLocaleString(
                      language === "zh-CN" ? "zh-CN" : "en-US",
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

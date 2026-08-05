import { VerdictIcon } from "@/components/analyze/StatusIcon";
import { SwapFlow } from "@/components/analyze/SwapFlow";
import type {
  BoundarySource,
  CheckSwapResult,
  Verdict,
} from "@/lib/analyze/types";
import { type Copy, type Language, say } from "@/lib/i18n";

const VERDICT_TONE: Record<Verdict, string> = {
  PROCEED: "border-risk-low/50 text-risk-low",
  ADJUST: "border-risk-moderate/50 text-risk-moderate",
  UNKNOWN: "border-risk-elevated/50 text-risk-elevated",
  STOP: "border-risk-high/50 text-risk-high",
};

/** Explains where the floor came from, so a blank one does not read as zero. */
const BOUNDARY_LABEL: Record<BoundarySource, Copy> = {
  user_declared: { en: "You set this", zh: "你设定的" },
  original_swap: { en: "From the original swap", zh: "来自原交易" },
  demo_preset: { en: "Demo preset", zh: "演示预设" },
  unavailable: { en: "You did not set one", zh: "你没有设定" },
};

/** Plain-language names, since the raw verdict words assume swap literacy. */
const VERDICT_PLAIN: Record<Verdict, Copy> = {
  PROCEED: { en: "No blocking evidence found", zh: "未发现阻断证据" },
  ADJUST: { en: "Change something first", zh: "先改一个条件" },
  STOP: { en: "Do not sign this", zh: "不要签名" },
  UNKNOWN: { en: "Not enough evidence", zh: "证据不足" },
};

const VERDICT_ACTION: Record<Verdict, Copy> = {
  PROCEED: {
    en: "Return to your transaction flow, or open the evidence.",
    zh: "回到原交易流程，或查看证据。",
  },
  ADJUST: {
    en: "Change one relevant condition above, then run the check again.",
    zh: "修改上方一个相关条件，然后重新检查。",
  },
  STOP: {
    en: "Switch route or token pair, or stop here.",
    zh: "更换路径或代币对，或就此停止。",
  },
  UNKNOWN: {
    en: "Review what is missing. This is not a pass.",
    zh: "查看缺失的证据。这不等于通过。",
  },
};

export function VerdictCard({
  result,
  language,
  onOpenEvidence,
}: {
  result: CheckSwapResult;
  language: Language;
  onOpenEvidence: () => void;
}) {
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow m-0">
          {say(language, { en: "Decision", zh: "决策" })}
        </span>
        {result.replayMode && (
          <span className="pill">
            {say(language, { en: "Demo preset", zh: "演示预设" })}
          </span>
        )}
        {result.systemStatus === "INTEGRATION_ERROR" && (
          <span className="pill border-risk-elevated/50 text-risk-elevated">
            {say(language, { en: "Integration error", zh: "集成错误" })}
          </span>
        )}
      </div>

      <strong
        className={`mt-3 inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-[clamp(17px,1.9vw,24px)] font-extrabold leading-none tracking-[-0.04em] ${VERDICT_TONE[result.verdict]}`}
      >
        <VerdictIcon size={26} verdict={result.verdict} />
        {say(language, VERDICT_PLAIN[result.verdict])}
      </strong>

      <p className="mt-4 text-[16px] leading-[1.7] text-white">
        {say(language, result.summary)}
      </p>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-dim">
        {say(language, VERDICT_ACTION[result.verdict])}
      </p>

      <SwapFlow language={language} result={result} />

      <dl className="m-0 mt-5">
        <div className="kv">
          <span className="kv-label">
            {say(language, { en: "Your accepted floor", zh: "你的接受下限" })}
          </span>
          <span className="text-[14px] text-white">
            {say(language, BOUNDARY_LABEL[result.minimumReceivedSource])}
          </span>
        </div>
        <div className="kv">
          <span className="kv-label">
            {say(language, { en: "Route", zh: "路径" })}
          </span>
          <span className="text-[14px] text-white">
            {say(language, result.quote.route)}
          </span>
        </div>
        <div className="kv">
          <span className="kv-label">
            {say(language, { en: "Block", zh: "区块" })}
          </span>
          <span className="mono">{result.quote.blockNumber}</span>
        </div>
      </dl>

      <button type="button" className="btn mt-5" onClick={onOpenEvidence}>
        {say(language, { en: "Open technical evidence", zh: "查看技术证据" })}
      </button>
    </div>
  );
}

import { TokenIcon } from "@/components/analyze/TokenIcon";
import type { CheckSwapResult } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

/**
 * Shows the pair as two labelled coins with the quote between them. Written for
 * readers who do not know swap jargon: amounts are large, the direction is an
 * arrow, and an unavailable output stays visibly empty rather than reading 0.
 */
export function SwapFlow({
  result,
  language,
}: {
  result: CheckSwapResult;
  language: Language;
}) {
  const { intent, quote } = result;
  const unresolved = quote.expectedOutput === "unavailable";

  return (
    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 border border-line bg-ink-rail p-4">
      <Side
        caption={say(language, { en: "You pay", zh: "你支付" })}
        amount={intent.amountIn}
        symbol={intent.tokenIn}
      />
      <div className="flex flex-col items-center justify-center gap-1 px-1">
        <svg
          aria-hidden="true"
          className="text-accent"
          fill="none"
          height="20"
          viewBox="0 0 24 24"
          width="20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 12h15m0 0-5-5m5 5-5 5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
          />
        </svg>
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
          {say(language, { en: "swap", zh: "兑换" })}
        </span>
      </div>
      <Side
        caption={say(language, {
          en: "You receive (est.)",
          zh: "你收到（预估）",
        })}
        amount={
          unresolved
            ? say(language, { en: "No quote", zh: "无报价" })
            : quote.expectedOutput
        }
        muted={unresolved}
        symbol={intent.tokenOut}
      />
    </div>
  );
}
function Side({
  caption,
  amount,
  symbol,
  muted = false,
}: {
  caption: string;
  amount: string;
  symbol: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
        {caption}
      </span>
      <div className="flex items-center gap-2">
        <TokenIcon size={26} symbol={symbol} />
        <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-dim">
          {symbol}
        </span>
      </div>
      <strong
        className={`truncate text-[clamp(15px,2vw,22px)] font-extrabold tracking-[-0.04em] ${
          muted ? "text-faint" : "text-white"
        }`}
      >
        {amount}
      </strong>
    </div>
  );
}

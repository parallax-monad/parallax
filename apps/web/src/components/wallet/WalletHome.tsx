import { TokenIcon } from "@/components/analyze/TokenIcon";
import { SwapIcon } from "@/components/wallet/WalletIcons";
import {
  ASSETS,
  DEMO_ADDRESS,
  formatAmount,
  formatUsd,
  TOTAL_BALANCE_USD,
} from "@/components/wallet/walletData";
import { type Language, say } from "@/lib/i18n";

export function WalletHome({
  language,
  onSwap,
  onLoadArbitrumSample,
}: {
  language: Language;
  onSwap: () => void;
  onLoadArbitrumSample?: (verdict: "ADJUST" | "PROCEED" | "STOP" | "UNKNOWN" | "ERROR") => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-2">
      <section className="text-center">
        <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-dim">
          {say(language, { en: "Demo balance", zh: "演示余额" })}
        </span>
        <strong className="mt-1 block text-[38px] font-extrabold leading-none tracking-[-0.05em]">
          {formatUsd(TOTAL_BALANCE_USD)}
        </strong>
        <div className="mt-2">
          <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            {say(language, { en: "Demo wallet", zh: "演示钱包" })}
          </span>
          <p className="mono mt-1 truncate text-dim">{DEMO_ADDRESS}</p>
        </div>
      </section>

      <div className="flex w-full flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          aria-label={say(language, { en: "Swap", zh: "兑换" })}
          className="btn btn-monad flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.16)] transition-transform hover:-translate-y-0.5"
          onClick={onSwap}
        >
          <SwapIcon size={21} />
          <span className="text-[11px] font-bold leading-none">
            {say(language, { en: "Swap", zh: "兑换" })}
          </span>
        </button>

        {onLoadArbitrumSample && (
          <>
            <button
              type="button"
              className="btn btn-monad-outline flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-2"
              onClick={() => onLoadArbitrumSample("ADJUST")}
            >
              <SwapIcon size={21} />
              <span className="text-[11px] font-bold leading-none">
                {say(language, {
                  en: "ADJUST",
                  zh: "调整",
                })}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-monad-outline flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-2"
              onClick={() => onLoadArbitrumSample("PROCEED")}
            >
              <SwapIcon size={21} />
              <span className="text-[11px] font-bold leading-none">
                {say(language, {
                  en: "PROCEED",
                  zh: "继续",
                })}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-monad-outline flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-2"
              onClick={() => onLoadArbitrumSample("STOP")}
            >
              <SwapIcon size={21} />
              <span className="text-[11px] font-bold leading-none">
                {say(language, {
                  en: "STOP",
                  zh: "停止",
                })}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-monad-outline flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-2"
              onClick={() => onLoadArbitrumSample("UNKNOWN")}
            >
              <SwapIcon size={21} />
              <span className="text-[11px] font-bold leading-none">
                {say(language, {
                  en: "UNKNOWN",
                  zh: "未知",
                })}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-monad-outline flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-2"
              onClick={() => onLoadArbitrumSample("ERROR")}
            >
              <SwapIcon size={21} />
              <span className="text-[11px] font-bold leading-none">
                {say(language, {
                  en: "ERROR",
                  zh: "错误",
                })}
              </span>
            </button>
          </>
        )}
      </div>

      <section
        aria-label={say(language, {
          en: "Parallax notice",
          zh: "Parallax 说明",
        })}
        className="rounded-2xl border border-monad/40 bg-[#0e1114] p-4"
      >
        <strong className="block text-[14px] font-bold text-monad-dim">
          {say(language, {
            en: "This demo checks a supported swap intent before signing",
            zh: "本演示会在签名前检查一个受支持的兑换意图",
          })}
        </strong>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-dim">
          {say(language, {
            en: "Nothing is signed or broadcast in this demo.",
            zh: "本演示不会签名，也不会广播。",
          })}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-dim">
          {say(language, { en: "Tokens", zh: "代币" })}
        </h2>
        <ul className="m-0 list-none p-0">
          {ASSETS.map((asset) => (
            <li
              className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
              key={asset.symbol}
            >
              <TokenIcon size={34} symbol={asset.symbol} />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[15px] font-bold">
                  {asset.name}
                </strong>
                <span className="text-[13px] text-dim">
                  {formatAmount(asset.balance)} {asset.symbol}
                </span>
              </div>
              <span className="text-[15px] font-bold">
                {formatUsd(asset.balance * asset.price)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
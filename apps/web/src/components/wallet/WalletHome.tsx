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
}: {
  language: Language;
  onSwap: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-2">
      <section>
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
          <p className="mono mt-1 text-dim">{DEMO_ADDRESS}</p>
        </div>
      </section>

      <button
        type="button"
        className="btn btn-monad flex w-full items-center justify-center gap-2 py-4"
        onClick={onSwap}
      >
        <SwapIcon size={20} />
        {say(language, { en: "Swap", zh: "兑换" })}
      </button>

      <section
        aria-label={say(language, {
          en: "Parallax notice",
          zh: "Parallax 说明",
        })}
        className="border border-monad/40 bg-monad/[0.08] p-4"
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

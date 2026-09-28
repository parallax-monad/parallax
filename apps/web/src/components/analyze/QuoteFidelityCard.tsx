import type { QuoteFidelity } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

/**
 * Quote Fidelity Card
 * Per P0 Economic Diagnosis spec section 5.2 - shows when selected quote
 * differs from current simulation
 */
export function QuoteFidelityCard({
  quoteFidelity,
  tokenSymbol,
  language,
}: {
  quoteFidelity: QuoteFidelity;
  tokenSymbol: string;
  language: Language;
}) {
  const isNegative = quoteFidelity.difference.startsWith("-");

  return (
    <section className="card border-risk-moderate/50 bg-risk-moderate/10">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-risk-moderate text-[18px] font-bold text-risk-moderate"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-[18px] font-extrabold leading-[1.1] tracking-[-0.02em] text-risk-moderate">
            {say(language, {
              en: "Your quote has changed",
              zh: "你的报价已改变",
            })}
          </strong>
          <p className="mt-2 text-[14px] leading-[1.6] text-white">
            {say(language, quoteFidelity.observation)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-risk-moderate/30 pt-4 sm:grid-cols-3">
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-risk-moderate/80">
            {say(language, { en: "Selected quote", zh: "选择的报价" })}
          </span>
          <strong className="mt-1 block text-[20px] font-extrabold tracking-[-0.02em] text-white">
            {quoteFidelity.selectedQuote} {tokenSymbol}
          </strong>
        </div>
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-risk-moderate/80">
            {say(language, { en: "Current simulation", zh: "当前模拟" })}
          </span>
          <strong className="mt-1 block text-[20px] font-extrabold tracking-[-0.02em] text-white">
            {quoteFidelity.currentSimulation} {tokenSymbol}
          </strong>
        </div>
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-risk-moderate/80">
            {say(language, { en: "Difference", zh: "差异" })}
          </span>
          <strong
            className={`mt-1 block text-[20px] font-extrabold tracking-[-0.02em] ${
              isNegative ? "text-risk-high" : "text-risk-low"
            }`}
          >
            {quoteFidelity.difference} {tokenSymbol}
          </strong>
          <span className="mt-0.5 block text-[13px] text-dim">
            ({quoteFidelity.relativeDelta})
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-risk-moderate/30 pt-4">
        <h4 className="m-0 text-[13px] font-bold uppercase tracking-[0.08em] text-risk-moderate">
          {say(language, { en: "Why:", zh: "原因：" })}
        </h4>
        <p className="m-0 mt-1.5 text-[14px] leading-[1.6] text-white">
          {say(language, quoteFidelity.primaryCause)}
        </p>
        {quoteFidelity.contributingFactors &&
          quoteFidelity.contributingFactors.length > 0 && (
            <div className="mt-3">
              <h5 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-dim">
                {say(language, {
                  en: "Contributing factors:",
                  zh: "促成因素：",
                })}
              </h5>
              <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                {quoteFidelity.contributingFactors.map((factor) => (
                  <li
                    key={factor.en}
                    className="text-[13px] leading-[1.6] text-dim before:mr-2 before:content-['·']"
                  >
                    {say(language, factor)}
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    </section>
  );
}

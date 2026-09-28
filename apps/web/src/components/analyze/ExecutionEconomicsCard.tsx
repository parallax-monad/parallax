import { useState } from "react";
import type { ExecutionEconomics } from "@/lib/analyze/types";
import { type Language, say } from "@/lib/i18n";

/**
 * Execution Economics Decomposition
 * Per P0 Economic Diagnosis spec section 6 - breaks down execution economics
 * instead of showing a generic "bad price" label
 */
export function ExecutionEconomicsCard({
  economics,
  language,
}: {
  economics: ExecutionEconomics;
  language: Language;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasData = Object.values(economics).some((v) => v !== undefined);
  if (!hasData) return null;

  const mainMetrics = [
    {
      key: "effectiveRate",
      label: { en: "Effective rate", zh: "有效汇率" },
      value: economics.effectiveRate,
    },
    {
      key: "priceImpact",
      label: { en: "Price impact", zh: "价格影响" },
      value: economics.priceImpact,
      highlight: true,
    },
    {
      key: "usableLiquidity",
      label: { en: "Usable liquidity", zh: "可用流动性" },
      value: economics.usableLiquidity,
    },
  ].filter((m) => m.value !== undefined);

  const detailedMetrics = [
    {
      key: "referencePrice",
      label: { en: "Reference price", zh: "参考价格" },
      value: economics.referencePrice,
    },
    {
      key: "quotedExecutionPrice",
      label: { en: "Quoted execution price", zh: "报价执行价格" },
      value: economics.quotedExecutionPrice,
    },
    {
      key: "protocolFee",
      label: { en: "Protocol / LP fee", zh: "协议 / LP 费用" },
      value: economics.protocolFee,
    },
    {
      key: "commission",
      label: { en: "Commission", zh: "佣金" },
      value: economics.commission,
    },
    {
      key: "gasEstimate",
      label: { en: "Gas estimate", zh: "Gas 估算" },
      value: economics.gasEstimate,
    },
    {
      key: "allInCost",
      label: { en: "All-in execution cost", zh: "总执行成本" },
      value: economics.allInCost,
    },
  ].filter((m) => m.value !== undefined);

  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <span className="eyebrow-monad">
          {say(language, {
            en: "Execution economics",
            zh: "执行经济学",
          })}
        </span>
        {detailedMetrics.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            className="text-[12px] font-bold uppercase tracking-[0.08em] text-monad-dim underline transition-colors hover:text-monad"
            onClick={() => setExpanded(!expanded)}
          >
            {say(
              language,
              expanded
                ? { en: "Show less", zh: "收起" }
                : { en: "Show details", zh: "展开详情" },
            )}
          </button>
        )}
      </div>

      <p className="mt-2 text-[13px] leading-[1.6] text-dim">
        {say(language, {
          en: "This breakdown explains the execution economics rather than showing a generic bad price label.",
          zh: "此分解说明执行经济学，而不是显示通用的价格不好标签。",
        })}
      </p>

      {mainMetrics.length > 0 && (
        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-3">
          {mainMetrics.map((metric) => (
            <div key={metric.key}>
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
                {say(language, metric.label)}
              </dt>
              <dd
                className={`m-0 mt-1 text-[18px] font-extrabold tracking-[-0.02em] ${
                  metric.highlight ? "text-risk-moderate" : "text-white"
                }`}
              >
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {expanded && detailedMetrics.length > 0 && (
        <dl className="mt-4 space-y-2 border-t border-line pt-4">
          {detailedMetrics.map((metric) => (
            <div
              key={metric.key}
              className="flex items-baseline justify-between gap-3 border-b border-line/50 py-2 last:border-b-0"
            >
              <dt className="text-[13px] font-bold text-dim">
                {say(language, metric.label)}
              </dt>
              <dd className="mono m-0 text-right text-[14px] text-white">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {economics.routeInfo && (
        <div className="mt-4 border-t border-line pt-4">
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-dim">
            {say(language, { en: "Route", zh: "路径" })}
          </span>
          <p className="m-0 mt-1 text-[13px] leading-[1.6] text-white">
            {say(language, economics.routeInfo)}
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <p className="m-0 text-[12px] leading-[1.5] text-dim">
          {say(language, {
            en: "These metrics are diagnostic. Without an explicit constraint, they do not automatically mean the transaction is unacceptable.",
            zh: "这些指标是诊断性的。在没有明确约束的情况下，它们不会自动意味着交易不可接受。",
          })}
        </p>
      </div>
    </section>
  );
}

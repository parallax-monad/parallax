import type { Language } from "../lib/i18n";
import { pick } from "../lib/i18n";

const EVIDENCE_ROWS = [
  {
    index: "01",
    label: ["Intent", "交易意图"] as const,
    value: ["4.00 MON → USDC", "4.00 MON → USDC"] as const,
    status: ["BOUND", "已绑定"] as const,
  },
  {
    index: "02",
    label: ["Quote & route", "报价与路径"] as const,
    value: ["KURU / 1.1s", "KURU / 1.1s"] as const,
    status: ["FOUND", "已找到"] as const,
  },
  {
    index: "03",
    label: ["Prepared action", "已生成操作"] as const,
    value: ["swapExactIn", "swapExactIn"] as const,
    status: ["READY", "已就绪"] as const,
  },
  {
    index: "04",
    label: ["Simulation", "交易模拟"] as const,
    value: ["SUCCESS / 148,210 GAS", "SUCCESS / 148,210 GAS"] as const,
    status: ["COMPLETE", "已完成"] as const,
  },
  {
    index: "05",
    label: ["Economic boundary", "经济边界"] as const,
    value: ["91.77 USDC", "91.77 USDC"] as const,
    status: ["BELOW 93.40 USDC", "低于 93.40 USDC"] as const,
    active: true,
  },
  {
    index: "06",
    label: ["Provenance", "证据溯源"] as const,
    value: ["DEMO PRESET / SAMPLE", "演示预设／示例"] as const,
    status: ["TRACEABLE", "可追溯"] as const,
  },
];

export function HeroEvidenceReceipt({ language }: { language: Language }) {
  return (
    <aside
      className="hero-evidence-receipt"
      aria-label={pick(language, "Evidence receipt", "证据回执")}
    >
      <header className="hero-receipt-header">
        <div>
          <span>PARALLAX / 0042</span>
          <strong>EVIDENCE RECEIPT</strong>
        </div>
        <span className="hero-receipt-fixture">
          {pick(language, "DEMO PRESET", "演示预设")}
        </span>
      </header>

      <div className="hero-receipt-meta">
        <span>{pick(language, "DEMO PRESET", "演示预设")}</span>
        <span>{pick(language, "SAMPLE DATA", "示例数据")}</span>
        <span>{pick(language, "READ ONLY", "只读")}</span>
      </div>

      <div className="hero-receipt-evidence">
        {EVIDENCE_ROWS.map((row) => (
          <div
            className="hero-receipt-row"
            data-active={row.active ? "true" : undefined}
            data-evidence-row=""
            key={row.index}
          >
            <span className="hero-receipt-index">{row.index}</span>
            <div>
              <strong>{pick(language, row.label[0], row.label[1])}</strong>
              <span>{pick(language, row.value[0], row.value[1])}</span>
            </div>
            <b>{pick(language, row.status[0], row.status[1])}</b>
          </div>
        ))}
      </div>

      <footer className="hero-receipt-verdict">
        <span>{pick(language, "DEMO OUTCOME", "演示结果")}</span>
        <strong>{pick(language, "ADJUST", "调整")}</strong>
        <p>
          {pick(
            language,
            "The sample output is below the demo Minimum Received boundary.",
            "示例输出低于演示中的最低收到量边界。",
          )}
        </p>
      </footer>
    </aside>
  );
}

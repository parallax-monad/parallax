import { localizeText, pick, type Language } from "@/lib/i18n";
import { formatBps, formatGwei, formatPercent, formatUsd } from "@/lib/format";
import type {
  PreliminaryAssessment,
  QuoteSnapshot,
  SimulationResult,
  Sourced,
} from "@/lib/types";
import { SourceTag } from "./Indicators";

function Row({
  label,
  value,
  source,
  note,
}: {
  label: string;
  value: React.ReactNode;
  source?: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="kv">
      <div>
        <div className="kv-label">{label}</div>
        {note ? <div className="kv-note">{note}</div> : null}
      </div>
      <div className="text-right text-[11.5px] tabular-nums">
        {value}
        {source}
      </div>
    </div>
  );
}

export function SimulationPanel({
  sim,
  language,
}: {
  sim: SimulationResult;
  language: Language;
}) {
  const source = sim.simulatorVersion?.startsWith("fixture-") ? "fixture" : "moss";
  const stageLabel = pick(
    language,
    source === "fixture" ? "Stage 2 · Fixture simulation" : "Stage 2 · Moss",
    source === "fixture" ? "阶段 2 · 样例模拟" : "阶段 2 · Moss",
  );

  return (
    <div className="card">
      <div className="card-head">
        <h3>{pick(language, "Simulation result", "模拟结果")}</h3>
        <span className="pill">{stageLabel}</span>
      </div>
      <Row
        label={pick(language, "Execution status", "执行状态")}
        value={
          <span className={sim.success ? "text-risk-low" : "text-risk-high"}>
            {pick(language, sim.success ? "Success" : "Reverted", sim.success ? "成功" : "回滚")}
          </span>
        }
        source={<SourceTag source={source} language={language} />}
        note={sim.revertReason}
      />
      <Row
        label={pick(language, "Gas used", "Gas 用量")}
        value={<span>{sim.gasUsed}</span>}
        source={<SourceTag source={source} language={language} />}
        note={pick(language, `Limit ${sim.gasLimit}`, `上限 ${sim.gasLimit}`)}
      />
      <Row
        label={pick(language, "Gas price", "Gas 单价")}
        value={<span>{formatGwei(sim.gasPriceWei)}</span>}
        source={<SourceTag source={source} language={language} />}
      />
      <Row
        label={pick(language, "Gas cost", "Gas 成本")}
        value={
          <span>
            {sim.gasCostNative} MON
            {sim.gasCostUsd !== null ? ` · ${formatUsd(sim.gasCostUsd)}` : ""}
          </span>
        }
        source={<SourceTag source={source} language={language} />}
      />
      <Row
        label={pick(language, "Receipt status", "回执状态")}
        value={sim.receipt.status}
        source={<SourceTag source={source} language={language} />}
        note={pick(
          language,
          `Block ${sim.receipt.blockNumber ?? "unavailable"} · ${sim.receipt.logsCount} logs`,
          `区块 ${sim.receipt.blockNumber ?? "不可用"} · 日志 ${sim.receipt.logsCount} 条`,
        )}
      />
      <Row
        label={pick(language, "Simulator warnings", "模拟器警告")}
        value={
          <span>
            {pick(
              language,
              sim.warnings.length === 0 ? "None" : `${sim.warnings.length} warnings`,
              sim.warnings.length === 0 ? "无" : `${sim.warnings.length} 条`,
            )}
          </span>
        }
        source={<SourceTag source={source} language={language} />}
        note={
          sim.simulatorVersion
            ? pick(
                language,
                `Simulator version ${sim.simulatorVersion}`,
                `模拟器版本 ${sim.simulatorVersion}`,
              )
            : undefined
        }
      />
      {sim.assetDeltas.length > 0 ? (
        sim.assetDeltas.map((delta, index) => (
          <Row
            key={`${delta.token}-${index}`}
            label={`${pick(language, "Asset change", "资产变动")} · ${delta.symbol}`}
            value={
              <span
                className={
                  delta.direction === "in" ? "text-risk-low" : "text-risk-moderate"
                }
              >
                {delta.direction === "in" ? "+" : "−"}
                {delta.amount}
              </span>
            }
            source={<SourceTag source={source} language={language} />}
          />
        ))
      ) : (
        <Row
          label={pick(language, "Asset changes", "资产变动")}
          value={pick(language, "No details returned by simulator", "模拟器未返回明细")}
          source={<SourceTag source={source} language={language} />}
        />
      )}
    </div>
  );
}

export function ProfilePanel({ pre }: { pre: PreliminaryAssessment }) {
  const profile = pre.profile;

  return (
    <div className="card">
      <div className="card-head">
        <h3>協議基礎資料</h3>
        <span className="pill">階段 1</span>
      </div>
      <Row
        label="協議"
        value={`${profile.name}（${profile.category}）`}
        source={<SourceTag source="static" />}
      />
      <Row
        label="審計"
        value={`${profile.auditCount} 次${profile.topAuditor ? " · 含頭部機構" : ""}`}
        source={<SourceTag source="static" />}
      />
      <Row
        label="合約開源驗證"
        value={profile.openSourceVerified ? "已驗證" : "未驗證"}
        source={<SourceTag source="static" />}
      />
      <Row
        label="可升級性"
        value={
          profile.upgradeable
            ? `可升級 · 時間鎖 ${profile.timelockHours}h`
            : "不可升級"
        }
        source={<SourceTag source="static" />}
      />
      <Row
        label="權限控制"
        value={profile.adminControl}
        source={<SourceTag source="static" />}
      />
      <Row
        label="預言機"
        value={`${profile.oracleProvider} · ${profile.oracleRedundancy} 源`}
        source={<SourceTag source="static" />}
      />
      <Row
        label="運行時長"
        value={<span>{profile.daysLive} 天</span>}
        source={<SourceTag source="static" />}
      />
      <Row
        label="歷史攻擊損失"
        value={
          profile.pastExploitLossUsd > 0
            ? formatUsd(profile.pastExploitLossUsd)
            : "無公開記錄"
        }
        source={<SourceTag source="static" />}
      />
      {profile.contracts.map((contract) => (
        <Row
          key={contract.address}
          label={`合約 · ${contract.label}`}
          value={<span className="mono">{contract.address}</span>}
          source={<SourceTag source="static" />}
        />
      ))}
    </div>
  );
}

export function QuotePanel({ pre }: { pre: PreliminaryAssessment }) {
  const quote: QuoteSnapshot = pre.quote;
  const ratio = Number.isFinite(pre.liquidityRatioBps)
    ? pre.liquidityRatioBps / 100
    : null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>報價與市場數據</h3>
        <span className="pill">階段 1</span>
      </div>
      <SourcedRow
        label="預期產出"
        field={quote.amountOut}
        render={(value) => (
          <span>
            {value} {pre.intent.tokenOut?.symbol ?? ""}
          </span>
        )}
      />
      <SourcedRow
        label="名義金額"
        field={quote.notionalUsd}
        render={(value) => <span>{formatUsd(value)}</span>}
      />
      <SourcedRow
        label="成交價"
        field={quote.executionPrice}
        render={(value) => <span>{value.toFixed(6)}</span>}
      />
      <SourcedRow
        label="價格影響"
        field={quote.priceImpactBps}
        render={(value) => <span>{formatBps(value)}</span>}
      />
      <SourcedRow
        label="預期滑點"
        field={quote.expectedSlippageBps}
        render={(value) => <span>{formatBps(value)}</span>}
      />
      <Row
        label="滑點容忍度"
        value={<span>{formatBps(pre.intent.slippageToleranceBps)}</span>}
        source={<SourceTag source="static" />}
        note="用戶輸入"
      />
      <SourcedRow
        label="池內流動性"
        field={quote.poolLiquidityUsd}
        render={(value) => <span>{formatUsd(value)}</span>}
      />
      <Row
        label="交易佔流動性比例"
        value={<span>{formatPercent(ratio)}</span>}
        note="名義金額 / 池內流動性"
      />
      <SourcedRow
        label="路由"
        field={quote.route}
        render={(value) => <span className="mono">{value.join(" → ")}</span>}
      />
    </div>
  );
}

function SourcedRow<T>({
  label,
  field,
  render,
  note,
}: {
  label: string;
  field: Sourced<T>;
  render: (value: T) => React.ReactNode;
  note?: string;
}) {
  return (
    <Row
      label={label}
      value={render(field.value)}
      source={<SourceTag source={field.source} />}
      note={note ?? field.detail}
    />
  );
}

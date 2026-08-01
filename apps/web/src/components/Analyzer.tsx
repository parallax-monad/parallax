import { localizeText, pick, type Language } from "@/lib/i18n";
import { formatBps } from "@/lib/format";
import type {
  AnalysisSession,
  FinalAssessment,
  PolicyTemplate,
  ProtocolProfile,
  RiskDimensionAssessment,
} from "@/lib/types";
import { useAnalyzerViewModel } from "@/viewmodels/useAnalyzerViewModel";
import { FindingList } from "./FindingList";
import { LEVEL_TEXT, RiskBadge } from "./Indicators";
import { SimulationPanel } from "./StagePanels";

const HEADING =
  "m-0 text-[clamp(20px,3vw,31px)] font-extrabold uppercase leading-none tracking-[-0.055em]";

function CandidateCard({
  id,
  session,
  selected,
  onToggle,
  language,
}: {
  id: string;
  session: AnalysisSession;
  selected: boolean;
  onToggle: (id: string) => void;
  language: Language;
}) {
  const pre = session.preliminary;
  const risk = highestRisk(pre.dimensions);

  return (
    <article
      className={`card p-6 ${
        selected
          ? "border-accent bg-gradient-to-br from-accent/[0.12] via-transparent to-transparent shadow-[0_0_0_1px_rgba(204,255,0,0.12)]"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="eyebrow mb-1">{pre.profile.category}</span>
          <h3 className="m-0 text-xl tracking-[-0.045em]">{pre.profile.name}</h3>
        </div>
        <RiskBadge level={risk} />
      </div>

      <div className="my-6">
        <span className="block text-[9px] font-bold uppercase tracking-[0.09em] text-faint">
          {pick(language, "Expected output", "预期输出")}
        </span>
        <strong className="my-1 block text-2xl tracking-[-0.06em] text-accent">
          {pre.quote.amountOut.value} {pre.intent.tokenOut?.symbol}
        </strong>
        <small className="block text-[9px] uppercase tracking-[0.09em] text-faint">
          {pick(language, "Quoted at", "报价时间")} · {new Date(pre.generatedAt).toLocaleTimeString(language)}
        </small>
      </div>

      <div className="grid grid-cols-3 gap-2 border-y border-line py-3.5">
        <Metric
          label={pick(language, "Minimum output", "最小输出")}
          value={(
            Number(pre.quote.amountOut.value) *
            (1 - pre.policy.maxSlippageBps / 10000)
          ).toFixed(4)}
        />
        <Metric label={pick(language, "Price impact", "价格影响")} value={formatBps(pre.quote.priceImpactBps.value)} />
        <Metric label={pick(language, "Data confidence", "数据置信度")} value={pre.dataCompleteness} />
      </div>

      <div className="my-4 flex flex-wrap gap-1.5 font-mono text-[9px] text-dim">
        {pre.quote.route.value.map((hop, index) => (
          <span key={`${hop}-${index}`}>
            {hop}
            {index < pre.quote.route.value.length - 1 ? (
              <i className="ml-1.5 not-italic text-accent">→</i>
            ) : null}
          </span>
        ))}
        <small className="block w-full text-faint">
          {pick(language, "Evidence sources", "证据来源")}：{pre.evidenceSources.join(" · ")}
        </small>
      </div>

      <div className="min-h-[93px] pt-1">
        <span className="kv-label">{pick(language, "Preliminary findings", "初步标记")}</span>
        {pre.findings.length ? (
          <FindingList findings={pre.findings.slice(0, 2)} language={language} />
        ) : (
          <p className="my-2 text-[10px] text-dim">
            {pick(
              language,
              "No preliminary risk findings detected; simulation is still required to verify asset changes and execution results.",
              "未检测到初步风险标记；仍需模拟以验证资产变化和执行结果。",
            )}
          </p>
        )}
      </div>

      <button
        className={`btn mt-3 w-full ${selected ? "border-accent text-accent" : ""}`}
        type="button"
        onClick={() => onToggle(id)}
      >
        {selected
          ? pick(language, "Selected for simulation", "已选择模拟")
          : `${pick(language, "Select", "选择")} ${pre.profile.name}`}
      </button>
    </article>
  );
}

function FinalReceipt({
  final,
  language,
}: {
  final: FinalAssessment;
  language: Language;
}) {
  return (
    <article className="card p-6 sm:p-8">
      <div className="card-head">
        <div>
          <span className="eyebrow">
            {final.preliminary.profile.name} / Risk Receipt
          </span>
          <h3 className="text-[15px]">
            {final.simulation.success
              ? pick(language, "Simulation succeeded", "模拟成功")
              : pick(language, "Simulation failed", "模拟失败")}
          </h3>
        </div>
        <RiskBadge level={final.overallRisk} />
      </div>

      <div className="mt-4 border border-line border-l-2 border-l-accent bg-ink-elev px-4 py-3 text-xs">
        {pick(language, "Overall policy status", "总体政策状态")}：
        <strong className={LEVEL_TEXT[final.overallRisk] ?? "text-faint"}>
          {final.overallStatus.toUpperCase()}
        </strong>
        。{localizeText(final.summary, language)}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="card-head">
            <h3>{pick(language, "Risk breakdown", "风险分解")}</h3>
          </div>
          {final.dimensions.map((dimension) => (
            <div className="kv" key={dimension.dimension}>
              <span className="kv-label">{localizeText(dimension.label, language)}</span>
              <RiskBadge level={dimension.level} />
            </div>
          ))}
        </div>

        <SimulationPanel sim={final.simulation} language={language} />

        <div className="card">
          <div className="card-head">
            <h3>{pick(language, "Rules and evidence", "规则与证据")}</h3>
            <span className="pill">{final.overallStatus}</span>
          </div>
          {final.policyRules.map((rule) => (
            <div className="kv" key={rule.id}>
              <div>
                <div className="kv-label">{localizeText(rule.label, language)}</div>
                <div className="kv-note">
                  {localizeText(rule.observed, language)} · {localizeText(rule.threshold, language)}
                </div>
              </div>
              <RiskBadge
                level={
                  rule.status === "fail"
                    ? "high"
                    : rule.status === "warn"
                      ? "moderate"
                      : "low"
                }
              />
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>{pick(language, "Evidence and coverage", "证据与覆盖率")}</h3>
            <span className="pill">
              {final.coverage.known} {pick(language, "known", "已知")}
            </span>
          </div>
          <p className="text-xs text-faint">
            {pick(
              language,
              "Protocol facts, quote sources, Moss receipts, asset changes, and warnings are retained in this receipt.",
              "协议事实、报价来源、Moss 回执、资产变化和警告均保留在此收据中。",
            )}
          </p>
          <div className="kv">
            <span className="kv-label">{pick(language, "Unknown evidence", "未知证据")}</span>
            <span>{final.coverage.unknown}</span>
          </div>
          <div className="kv">
            <span className="kv-label">{pick(language, "Data sources", "数据来源")}</span>
            <span>{final.preliminary.evidenceSources.join(", ")}</span>
          </div>
          <button
            className="btn mt-3 w-full"
            type="button"
            onClick={() => downloadReceipt(final)}
          >
            {pick(language, "Export JSON", "导出 JSON")}
          </button>
        </div>
      </div>

      <details className="card mt-4">
        <summary className="flex cursor-pointer items-center justify-between text-[11px] font-bold uppercase tracking-[0.04em]">
          {pick(language, "View raw Moss evidence", "查看原始 Moss 证据")} <span className="text-base text-accent">+</span>
        </summary>
        <ul className="mt-3 list-disc pl-5 text-[11px] text-dim">
          {final.unverified.map((item) => (
            <li key={item}>{localizeText(item, language)}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function WalletBar({
  vm,
  language,
}: {
  vm: ReturnType<typeof useAnalyzerViewModel>;
  language: Language;
}) {
  return (
    <section className="card mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <div className="kv-label">{pick(language, "Wallet address", "钱包地址")}</div>
        {vm.wallet ? (
          <div>
            <span className="mono">{vm.wallet.address}</span>{" "}
            <span className="pill">
              {vm.wallet.isMock
                ? pick(language, "Mock wallet", "模拟钱包")
                : pick(language, "Connected", "已连接")}
            </span>
          </div>
        ) : (
          <div className="text-xs text-faint">
            {pick(
              language,
              "Connect a wallet to load account context and begin analysis.",
              "连接钱包后才会获取账户上下文并开始分析。",
            )}
          </div>
        )}
      </div>
      <button
        className="btn"
        type="button"
        onClick={() =>
          vm.wallet ? void vm.disconnectWallet() : void vm.connectWallet()
        }
      >
        {vm.wallet
          ? pick(language, "Disconnect", "断开连接")
          : pick(language, "Connect wallet", "连接钱包")}
      </button>
    </section>
  );
}

function StepLabel({ number, label }: { number: string; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-accent">
      <span className="grid h-7 w-7 place-items-center border border-accent font-mono text-[9px] shadow-[0_0_18px_rgba(204,255,0,0.14)]">
        {number}
      </span>
      {label}
    </div>
  );
}

function FlowConnector({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      className="mt-7 grid animate-flow-reveal justify-items-center gap-2 text-[9px] font-bold uppercase tracking-[0.1em] text-faint before:h-6 before:w-px before:bg-gradient-to-b before:from-transparent before:to-accent before:content-['']"
    >
      <span>{label}</span>
      <i className="animate-flow-pulse text-2xl not-italic leading-[0.65] text-accent">
        ↓
      </i>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[11px] text-dim">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent"
      />
      {label}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-faint">
        {label}
      </span>
      <strong className="mt-0.5 block text-[11px] tracking-[-0.02em]">{value}</strong>
    </div>
  );
}

function DiffGroup({
  title,
  items,
  language,
}: {
  title: string;
  items: string[];
  language: Language;
}) {
  if (!items.length) return null;
  return (
    <section className="border border-line bg-ink-rail px-4 py-3.5">
      <span className="kv-label block pb-2 font-extrabold tracking-[0.09em] text-accent">
        {title}
      </span>
      {items.map((item) => (
        <div className="kv font-mono text-[11px] leading-relaxed" key={item}>
          <span>{localizeText(item, language)}</span>
          <span className="pill">{pick(language, "Updated", "已更新")}</span>
        </div>
      ))}
    </section>
  );
}

function highestRisk(dimensions: RiskDimensionAssessment[]) {
  const priority = ["high", "elevated", "moderate", "low"] as const;
  return (
    priority.find((level) =>
      dimensions.some((dimension) => dimension.level === level),
    ) ?? "low"
  );
}

function downloadReceipt(receipt: FinalAssessment) {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${receipt.preliminary.profile.id}-risk-receipt.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Analyzer({
  profiles,
  language,
}: {
  profiles: ProtocolProfile[];
  language: Language;
}) {
  const vm = useAnalyzerViewModel(profiles);
  const candidates = Object.entries(vm.candidates);
  const finals = Object.entries(vm.finals);

  return (
    <main className="shell">
      <header className="mb-6">
          <span className="eyebrow text-xs">
            {pick(language, "Monad / Pre-transaction risk layer", "Monad / 交易前风险层")}
          </span>
      </header>
      <WalletBar vm={vm} language={language} />

      <section className="mt-10" id="intent">
        <StepLabel
          number="01"
          label={pick(language, "Set trade intent and risk policy", "设置交易意图与风险政策")}
        />
        <form
          className="card bg-gradient-to-br from-accent/[0.09] via-transparent to-transparent p-6 sm:p-10"
          onSubmit={(event) => {
            event.preventDefault();
            void vm.discover();
          }}
        >
          <div className="card-head items-start">
            <div>
              <span className="eyebrow">{pick(language, "Your trade", "您的交易")}</span>
              <h2 className={HEADING}>
                {pick(language, "What do you want to do?", "您想进行什么操作？")}
              </h2>
            </div>
            <span className="pill">
              {pick(language, "Risk policy", "风险政策")} / {vm.policy.template}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={pick(language, "Action", "操作")}>
              <select value={vm.action} onChange={() => undefined}>
                <option value="swap">Swap</option>
              </select>
            </Field>
            <Field label={pick(language, "Input token", "输入代币")}>
              <select defaultValue="MON">
                <option>MON</option>
              </select>
            </Field>
            <Field label={pick(language, "Output token", "输出代币")}>
              <select defaultValue="USDC">
                <option>USDC</option>
              </select>
            </Field>
            <Field label={pick(language, "Amount", "金额")}>
              <input
                value={vm.amount}
                onChange={(event) => vm.setAmount(event.target.value)}
                inputMode="decimal"
                required
              />
            </Field>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
            <div className="bg-ink-rail p-4">
              <Field label={pick(language, "Risk policy", "风险政策")}>
                <select
                  value={vm.policy.template}
                  onChange={(event) =>
                    vm.setTemplate(event.target.value as PolicyTemplate)
                  }
                >
                  <option value="standard">{pick(language, "Standard", "标准")}</option>
                  <option value="conservative">{pick(language, "Conservative", "保守")}</option>
                  <option value="custom">{pick(language, "Custom", "自定义")}</option>
                </select>
              </Field>
            </div>
            <div className="bg-ink-rail p-4">
              <Field label={pick(language, "Maximum slippage (bps)", "最大滑点 (bps)")}>
                <input
                  value={vm.policy.maxSlippageBps}
                  inputMode="numeric"
                  onChange={(event) =>
                    vm.setPolicy({
                      ...vm.policy,
                      template: "custom",
                      maxSlippageBps: Number(event.target.value) || 0,
                    })
                  }
                />
              </Field>
            </div>
            <div className="bg-ink-rail p-4">
              <Field label={pick(language, "Maximum price impact (bps)", "最大价格影响 (bps)")}>
                <input
                  value={vm.policy.maxPriceImpactBps}
                  inputMode="numeric"
                  onChange={(event) =>
                    vm.setPolicy({
                      ...vm.policy,
                      template: "custom",
                      maxPriceImpactBps: Number(event.target.value) || 0,
                    })
                  }
                />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Toggle
              label={pick(language, "Fail on any Moss warning", "出现 Moss 警告即失败")}
              checked={vm.policy.failOnSimulationWarning}
              onChange={(checked) =>
                vm.setPolicy({
                  ...vm.policy,
                  template: "custom",
                  failOnSimulationWarning: checked,
                })
              }
            />
            <Toggle
              label={pick(language, "Require a verified contract", "要求已验证合约")}
              checked={vm.policy.requireVerifiedContract}
              onChange={(checked) =>
                vm.setPolicy({
                  ...vm.policy,
                  template: "custom",
                  requireVerifiedContract: checked,
                })
              }
            />
          </div>

          <div className="mt-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <p className="m-0 max-w-[560px] text-[11px] text-dim">
              {pick(
                language,
                "The system queries Moss-supported protocols for comparable quotes and preliminary risk evidence.",
                "系统会查询 Moss 支持的协议，获取可比较的报价与初步风险证据。",
              )}
            </p>
            <button
              className="btn btn-primary w-full sm:w-auto"
              type="submit"
              disabled={!vm.canAnalyze}
            >
              {vm.phase === "discovering"
                ? pick(language, "Discovering routes…", "正在发现路由…")
                : pick(language, "Analyze routes", "分析路由")}
            </button>
          </div>
        </form>
      </section>

      {vm.error ? (
        <div className="mt-5 border border-risk-high/50 border-l-2 border-l-risk-high bg-ink-elev px-4 py-3 text-xs text-dim">
          {vm.error}
        </div>
      ) : null}
      {candidates.length > 0 ? (
        <>
          <FlowConnector label={pick(language, "Moss capability discovery", "Moss 能力发现")} />
          <section className="mt-10" id="candidates">
            <StepLabel number="02" label={pick(language, "Compare available routes", "比较可用路径")} />
            <div className="mb-5 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <span className="eyebrow">
                  {pick(language, "Moss-supported candidates", "Moss 支持的候选路径")}
                </span>
                <h2 className={HEADING}>
                  {pick(language, "Choose what to simulate.", "选择要模拟的路径。")}
                </h2>
                <p className="mt-2 max-w-[630px] text-xs text-dim">
                  {pick(
                    language,
                    "These candidates serve the same trade intent. Select one or two to receive independent simulations and risk receipts.",
                    "这些是同一交易意图下可用的候选路径。选择一个或两个，以获取各自独立的模拟与风险收据。",
                  )}
                </p>
              </div>
              <span className="whitespace-nowrap font-mono text-[10px] text-accent">
                {pick(language, `Found ${candidates.length} routes`, `发现 ${candidates.length} 条路径`)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {candidates.map(([id, session]) => (
                <CandidateCard
                  key={id}
                  id={id}
                  session={session}
                  selected={vm.selectedProtocolIds.includes(id)}
                  onToggle={vm.toggleProtocol}
                  language={language}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-col items-start justify-between gap-5 border border-line bg-ink-rail p-5 sm:flex-row sm:items-center">
              <div>
                <span className="eyebrow">
                  {pick(language, "Routes to simulate", "待模拟路径")}
                </span>
                <p className="m-0 text-[11px] text-dim">
                  {vm.selectedProtocolIds.length === 0
                    ? pick(language, "Select at least one candidate to build an unsigned transaction and call Moss simulation.", "至少选择一条候选路径，才能建立未签名交易并调用 Moss 模拟。")
                    : pick(language, `${vm.selectedProtocolIds.length} routes will be simulated; a failure in one protocol will not block another.`, `将模拟 ${vm.selectedProtocolIds.length} 条路径；任何协议失败都不会阻断另一条路径。`)}
                </p>
              </div>
              <button
                className="btn btn-primary w-full sm:w-auto"
                type="button"
                onClick={() => void vm.simulateSelected()}
                disabled={!vm.canSimulate}
              >
                {vm.phase === "simulating"
                  ? pick(language, "Moss is simulating…", "Moss 正在模拟…")
                  : pick(language, `Simulate ${vm.selectedProtocolIds.length || ""} selected routes`, `模拟已选 ${vm.selectedProtocolIds.length || ""} 条路径`)}
              </button>
            </div>
          </section>
        </>
      ) : null}
      {finals.length > 0 ? (
        <>
          <FlowConnector label={pick(language, "Moss simulation", "Moss 模拟")} />
          <section className="mt-10" id="receipt">
            <StepLabel number="03" label={pick(language, "Apply evidence to your policy", "将证据应用到您的政策")} />
            <div className="mb-5 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <span className="eyebrow">{pick(language, "Final risk report", "最终风险报告")}</span>
                <h2 className={HEADING}>
                  {pick(language, "What will happen — and why.", "将会发生什么，以及为什么。")}
                </h2>
                <p className="mt-2 max-w-[630px] text-xs text-dim">
                  {pick(
                    language,
                    "The risk engine combines protocol facts, quotes, Moss simulation evidence, and your rules into a traceable result for each route.",
                    "风险引擎将协议事实、报价、Moss 模拟证据与您的规则合并成每条路径可追踪的结果。",
                  )}
                </p>
              </div>
              <span className="pill">{pick(language, "Simulation complete", "模拟完成")}</span>
            </div>
            <div className="grid gap-4">
              {finals.map(([id, final]) => (
                <FinalReceipt key={id} final={final} language={language} />
              ))}
            </div>
          </section>

          {vm.history.length > 1 ? (
            <section className="mt-9">
              <div className="card bg-gradient-to-br from-accent/[0.07] via-transparent to-transparent p-6">
                <div className="card-head items-start">
                  <div>
                    <span className="eyebrow">{pick(language, "Session history / Risk diff", "会话历史 / 风险差异")}</span>
                    <h3 className="text-[15px]">{pick(language, "Risk change details", "风险变化明细")}</h3>
                  </div>
                  <span className="pill">
                    {pick(language, `${vm.history.length} runs`, `${vm.history.length} 次运行`)}
                  </span>
                </div>
                {vm.diff ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <DiffGroup title={pick(language, "Inputs and policy", "输入与政策")} items={vm.diff.changes} language={language} />
                    <DiffGroup title={pick(language, "Quote changes", "报价变化")} items={vm.diff.quoteChanges} language={language} />
                    <DiffGroup
                      title={pick(language, "Risk and rules", "风险与规则")}
                      items={[...vm.diff.riskChanges, ...vm.diff.ruleChanges]}
                      language={language}
                    />
                    <DiffGroup
                      title={pick(language, "Simulation and asset changes", "模拟与资产变化")}
                      items={[...vm.diff.warningChanges, ...vm.diff.assetChanges]}
                      language={language}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-faint">
                    {pick(
                      language,
                      "The first run has no previous result to compare.",
                      "首次运行没有可比较的上一次结果。",
                    )}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {vm.history.map((run) => (
                    <span key={run.runId} className="pill">
                      {pick(
                        language,
                        `Run ${run.runId.slice(0, 10)} · ${run.receipts.length} receipts`,
                        `运行 ${run.runId.slice(0, 10)} · ${run.receipts.length} 份报告`,
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <FlowConnector label={pick(language, "Adjust and run again", "调整并重新运行")} />
          <section className="mt-10" id="rerun">
            <StepLabel number="04" label={pick(language, "Test different boundaries", "测试不同边界")} />
            <div className="card flex flex-col items-start justify-between gap-6 border-accent/45 bg-gradient-to-br from-accent/[0.11] via-transparent to-transparent p-6 sm:flex-row sm:items-end sm:p-10">
              <div>
                <span className="eyebrow">
                  {pick(language, "Risk diff / Next run", "风险差异 / 下一次运行")}
                </span>
                <h2 className={HEADING}>
                  Change the input.
                  <br />
                  See what changes.
                </h2>
                <p className="mt-3 max-w-[600px] text-xs text-dim">
                  {pick(
                    language,
                    "Change the amount, risk thresholds, or protocol and analyze again. Existing receipts are retained so the new quote, rules, and simulation differences can be compared side by side.",
                    "修改金额、风险阈值或协议后重新分析。原有收据会保留，新结果可与当前的报价、规则和模拟差异并排比较。",
                  )}
                </p>
              </div>
              <button
                className="btn btn-primary w-full sm:w-auto"
                type="button"
                onClick={() => {
                  vm.reset();
                  document
                    .getElementById("intent")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {pick(language, "Adjust and run again", "调整并重新运行")}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

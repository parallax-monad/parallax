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
}: {
  id: string;
  session: AnalysisSession;
  selected: boolean;
  onToggle: (id: string) => void;
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
          預期輸出
        </span>
        <strong className="my-1 block text-2xl tracking-[-0.06em] text-accent">
          {pre.quote.amountOut.value} {pre.intent.tokenOut?.symbol}
        </strong>
        <small className="block text-[9px] uppercase tracking-[0.09em] text-faint">
          報價時間 · {new Date(pre.generatedAt).toLocaleTimeString()}
        </small>
      </div>

      <div className="grid grid-cols-3 gap-2 border-y border-line py-3.5">
        <Metric
          label="最小輸出"
          value={(
            Number(pre.quote.amountOut.value) *
            (1 - pre.policy.maxSlippageBps / 10000)
          ).toFixed(4)}
        />
        <Metric label="價格影響" value={formatBps(pre.quote.priceImpactBps.value)} />
        <Metric label="數據置信度" value={pre.dataCompleteness} />
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
          證據來源：{pre.evidenceSources.join(" · ")}
        </small>
      </div>

      <div className="min-h-[93px] pt-1">
        <span className="kv-label">初步標記</span>
        {pre.findings.length ? (
          <FindingList findings={pre.findings.slice(0, 2)} />
        ) : (
          <p className="my-2 text-[10px] text-dim">
            未檢測到初步風險標記；仍需模擬以驗證資產變化和執行結果。
          </p>
        )}
      </div>

      <button
        className={`btn mt-3 w-full ${selected ? "border-accent text-accent" : ""}`}
        type="button"
        onClick={() => onToggle(id)}
      >
        {selected ? "已選擇模擬" : `選擇 ${pre.profile.name}`}
      </button>
    </article>
  );
}

function FinalReceipt({ final }: { final: FinalAssessment }) {
  return (
    <article className="card p-6 sm:p-8">
      <div className="card-head">
        <div>
          <span className="eyebrow">
            {final.preliminary.profile.name} / Risk Receipt
          </span>
          <h3 className="text-[15px]">
            {final.simulation.success ? "模擬成功" : "模擬失敗"}
          </h3>
        </div>
        <RiskBadge level={final.overallRisk} />
      </div>

      <div className="mt-4 border border-line border-l-2 border-l-accent bg-ink-elev px-4 py-3 text-xs">
        總體政策狀態：
        <strong className={LEVEL_TEXT[final.overallRisk] ?? "text-faint"}>
          {final.overallStatus.toUpperCase()}
        </strong>
        。{final.summary}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="card-head">
            <h3>風險分解</h3>
          </div>
          {final.dimensions.map((dimension) => (
            <div className="kv" key={dimension.dimension}>
              <span className="kv-label">{dimension.label}</span>
              <RiskBadge level={dimension.level} />
            </div>
          ))}
        </div>

        <SimulationPanel sim={final.simulation} />

        <div className="card">
          <div className="card-head">
            <h3>規則與證據</h3>
            <span className="pill">{final.overallStatus}</span>
          </div>
          {final.policyRules.map((rule) => (
            <div className="kv" key={rule.id}>
              <div>
                <div className="kv-label">{rule.label}</div>
                <div className="kv-note">
                  {rule.observed} · {rule.threshold}
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
            <h3>證據與覆蓋率</h3>
            <span className="pill">{final.coverage.known} 已知</span>
          </div>
          <p className="text-xs text-faint">
            協議事實、報價來源、Moss 回執、資產變化和告警均保留在此 Receipt 中。
          </p>
          <div className="kv">
            <span className="kv-label">未知證據</span>
            <span>{final.coverage.unknown}</span>
          </div>
          <div className="kv">
            <span className="kv-label">數據來源</span>
            <span>{final.preliminary.evidenceSources.join(", ")}</span>
          </div>
          <button
            className="btn mt-3 w-full"
            type="button"
            onClick={() => downloadReceipt(final)}
          >
            匯出 JSON
          </button>
        </div>
      </div>

      <details className="card mt-4">
        <summary className="flex cursor-pointer items-center justify-between text-[11px] font-bold uppercase tracking-[0.04em]">
          查看原始 Moss 證據 <span className="text-base text-accent">+</span>
        </summary>
        <ul className="mt-3 list-disc pl-5 text-[11px] text-dim">
          {final.unverified.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function WalletBar({ vm }: { vm: ReturnType<typeof useAnalyzerViewModel> }) {
  return (
    <section className="card mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <div className="kv-label">錢包地址</div>
        {vm.wallet ? (
          <div>
            <span className="mono">{vm.wallet.address}</span>{" "}
            <span className="pill">{vm.wallet.isMock ? "模擬錢包" : "已連接"}</span>
          </div>
        ) : (
          <div className="text-xs text-faint">
            連接錢包後才會取得帳戶情境並開始分析。
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
        {vm.wallet ? "斷開連接" : "連接錢包"}
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

function DiffGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="border border-line bg-ink-rail px-4 py-3.5">
      <span className="kv-label block pb-2 font-extrabold tracking-[0.09em] text-accent">
        {title}
      </span>
      {items.map((item) => (
        <div className="kv font-mono text-[11px] leading-relaxed" key={item}>
          <span>{item}</span>
          <span className="pill">已更新</span>
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

export default function Analyzer({ profiles }: { profiles: ProtocolProfile[] }) {
  const vm = useAnalyzerViewModel(profiles);
  const candidates = Object.entries(vm.candidates);
  const finals = Object.entries(vm.finals);

  return (
    <main className="shell">
      <header className="mb-6">
        <span className="eyebrow text-xs">Monad / Pre-transaction risk layer</span>
      </header>
      <WalletBar vm={vm} />

      <section className="mt-10" id="intent">
        <StepLabel number="01" label="設置交易意圖與風險政策" />
        <form
          className="card bg-gradient-to-br from-accent/[0.09] via-transparent to-transparent p-6 sm:p-10"
          onSubmit={(event) => {
            event.preventDefault();
            void vm.discover();
          }}
        >
          <div className="card-head items-start">
            <div>
              <span className="eyebrow">您的交易</span>
              <h2 className={HEADING}>What do you want to do?</h2>
            </div>
            <span className="pill">風險政策 / {vm.policy.template}</span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="操作">
              <select value={vm.action} onChange={() => undefined}>
                <option value="swap">Swap</option>
              </select>
            </Field>
            <Field label="輸入代幣">
              <select defaultValue="MON">
                <option>MON</option>
              </select>
            </Field>
            <Field label="輸出代幣">
              <select defaultValue="USDC">
                <option>USDC</option>
              </select>
            </Field>
            <Field label="金額">
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
              <Field label="風險政策">
                <select
                  value={vm.policy.template}
                  onChange={(event) =>
                    vm.setTemplate(event.target.value as PolicyTemplate)
                  }
                >
                  <option value="standard">標準</option>
                  <option value="conservative">保守</option>
                  <option value="custom">自定義</option>
                </select>
              </Field>
            </div>
            <div className="bg-ink-rail p-4">
              <Field label="最大滑點 (bps)">
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
              <Field label="最大價格影響 (bps)">
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
              label="出現 Moss 警告即失敗"
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
              label="要求已驗證合約"
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
              系統會詢問 Moss 支援的協議，取得可比較的 Quote 與初步風險證據。
            </p>
            <button
              className="btn btn-primary w-full sm:w-auto"
              type="submit"
              disabled={!vm.canAnalyze}
            >
              {vm.phase === "discovering" ? "正在發現路由…" : "分析路由"}
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
          <FlowConnector label="Moss 能力發現" />
          <section className="mt-10" id="candidates">
            <StepLabel number="02" label="比較可用路徑" />
            <div className="mb-5 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <span className="eyebrow">Moss 支援的候選路徑</span>
                <h2 className={HEADING}>Choose what to simulate.</h2>
                <p className="mt-2 max-w-[630px] text-xs text-dim">
                  這些是同一交易意圖下可用的候選路徑。選擇一個或兩個，以取得各自獨立的模擬與 Risk Receipt。
                </p>
              </div>
              <span className="whitespace-nowrap font-mono text-[10px] text-accent">
                發現 {candidates.length} 條路徑
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
                />
              ))}
            </div>

            <div className="mt-4 flex flex-col items-start justify-between gap-5 border border-line bg-ink-rail p-5 sm:flex-row sm:items-center">
              <div>
                <span className="eyebrow">待模擬路徑</span>
                <p className="m-0 text-[11px] text-dim">
                  {vm.selectedProtocolIds.length === 0
                    ? "選擇至少一條候選路徑，才會建立未簽名交易並呼叫 Moss 模擬。"
                    : `將模擬 ${vm.selectedProtocolIds.length} 條路徑；任何協議失敗都不會阻斷另一條路徑。`}
                </p>
              </div>
              <button
                className="btn btn-primary w-full sm:w-auto"
                type="button"
                onClick={() => void vm.simulateSelected()}
                disabled={!vm.canSimulate}
              >
                {vm.phase === "simulating"
                  ? "Moss 正在模擬…"
                  : `模擬已選 ${vm.selectedProtocolIds.length || ""} 條路徑`}
              </button>
            </div>
          </section>
        </>
      ) : null}
      {finals.length > 0 ? (
        <>
          <FlowConnector label="Moss 模擬" />
          <section className="mt-10" id="receipt">
            <StepLabel number="03" label="應用證據到您的政策" />
            <div className="mb-5 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <span className="eyebrow">最終風險報告</span>
                <h2 className={HEADING}>What will happen — and why.</h2>
                <p className="mt-2 max-w-[630px] text-xs text-dim">
                  風險引擎將協議事實、Quote、Moss 模擬證據與您的規則合併成每條路徑可追蹤的結果。
                </p>
              </div>
              <span className="pill">模擬完成</span>
            </div>
            <div className="grid gap-4">
              {finals.map(([id, final]) => (
                <FinalReceipt key={id} final={final} />
              ))}
            </div>
          </section>

          {vm.history.length > 1 ? (
            <section className="mt-9">
              <div className="card bg-gradient-to-br from-accent/[0.07] via-transparent to-transparent p-6">
                <div className="card-head items-start">
                  <div>
                    <span className="eyebrow">Session 歷史 / 風險差異</span>
                    <h3 className="text-[15px]">風險變化明細</h3>
                  </div>
                  <span className="pill">{vm.history.length} 次運行</span>
                </div>
                {vm.diff ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <DiffGroup title="輸入與政策" items={vm.diff.changes} />
                    <DiffGroup title="報價變化" items={vm.diff.quoteChanges} />
                    <DiffGroup
                      title="風險與規則"
                      items={[...vm.diff.riskChanges, ...vm.diff.ruleChanges]}
                    />
                    <DiffGroup
                      title="模擬與資產變化"
                      items={[...vm.diff.warningChanges, ...vm.diff.assetChanges]}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-faint">
                    首次運行沒有可比較的上一次結果。
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {vm.history.map((run) => (
                    <span key={run.runId} className="pill">
                      運行 {run.runId.slice(0, 10)} · {run.receipts.length} 份報告
                    </span>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <FlowConnector label="調整並重新運行" />
          <section className="mt-10" id="rerun">
            <StepLabel number="04" label="測試不同的邊界" />
            <div className="card flex flex-col items-start justify-between gap-6 border-accent/45 bg-gradient-to-br from-accent/[0.11] via-transparent to-transparent p-6 sm:flex-row sm:items-end sm:p-10">
              <div>
                <span className="eyebrow">風險差異 / 下一次運行</span>
                <h2 className={HEADING}>
                  Change the input.
                  <br />
                  See what changes.
                </h2>
                <p className="mt-3 max-w-[600px] text-xs text-dim">
                  修改金額、風險閾值或協議後重新分析。原本的 Receipt 會保留，新結果可與當前的 Quote、規則和模擬差異並排比較。
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
                調整並重新運行
              </button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

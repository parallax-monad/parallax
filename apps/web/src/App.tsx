import { useEffect, useState } from "react";
import Analyzer from "@/components/Analyzer";
import { SiteNav } from "@/components/SiteNav";
import { PROTOCOL_PROFILES } from "@/lib/protocols";
import { RouteGraph } from "@/components/RouteGraph";

const DIMENSIONS = [
  ["Protocol", "協議風險", "審計、權限、預言機與安全歷史。"],
  ["Liquidity", "流動性風險", "池內深度、價格影響與路由複雜度。"],
  ["Transaction", "交易風險", "滑點、餘額、授權與執行條件。"],
  ["Simulation", "模擬證據", "Gas、回執、告警與資產變動。"],
];

const SCALE = [
  ["PASS", "low", "條件清晰", "已取得能支持低風險判斷的證據。"],
  ["WARN", "moderate", "需要注意", "存在需要在簽名前進一步確認的條件。"],
  ["CHECK", "elevated", "提高審查", "執行或流動性風險可能顯著影響結果。"],
  ["FAIL", "high", "停止並核實", "發現可能導致交易失敗或資產損失的信號。"],
];

const SCALE_COLOR: Record<string, string> = {
  low: "text-risk-low",
  moderate: "text-risk-moderate",
  elevated: "text-risk-elevated",
  high: "text-risk-high",
};

const SCALE_BADGE: Record<string, string> = {
  low: "border-risk-low/50 text-risk-low",
  moderate: "border-risk-moderate/50 text-risk-moderate",
  elevated: "border-risk-elevated/50 text-risk-elevated",
  high: "border-risk-high/50 text-risk-high",
};

export default function App() {
  const [route, setRoute] = useState(
    window.location.hash === "#/analyze" ? "analyze" : "home",
  );

  useEffect(() => {
    const change = () =>
      setRoute(window.location.hash === "#/analyze" ? "analyze" : "home");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  return (
    <div className="min-h-[calc(100vh-65px)]">
      <SiteNav active={route} />
      {route === "analyze" ? <Analyzer profiles={PROTOCOL_PROFILES} /> : <Home />}
    </div>
  );
}

function Home() {
  return (
    <main className="shell">
      <section className="relative grid min-h-[560px] items-center overflow-hidden border border-line">
        <RouteGraph />
        <div className="relative z-[2] w-full p-8 sm:w-[min(46%,620px)] sm:p-14">
          <span className="eyebrow">PARALLAX / MOSS ON MONAD</span>
          <h1 className="m-0 mb-5 text-[clamp(48px,6vw,92px)] font-extrabold leading-[0.88] tracking-[-0.09em]">
            SEE IT
            <br />
            <em className="not-italic text-accent">BEFORE YOU SIGN.</em>
          </h1>
          <p className="m-0 max-w-[570px] text-[15px] leading-[1.8] text-dim">
            基於 Moss 的 Monad Swap 簽名前解釋與調整層。簽名前看清交易會發生什麼、哪裡可能造成明顯損耗或暴露，以及現在可以調整什麼。
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#/analyze" className="btn btn-primary">
              Analyze transaction
            </a>
            <a href="#framework" className="btn">
              How it works
            </a>
          </div>
        </div>
      </section>

      <section className="flex flex-col justify-between gap-4 border-y border-line py-3.5 text-[9px] font-bold tracking-[0.08em] text-faint sm:flex-row">
        <span>READ-ONLY WALLET ACCESS</span>
        <span>FIXTURE DATA CLEARLY LABELLED</span>
        <span>NO SIGNING · NO BROADCASTING</span>
      </section>

      <section className="mt-12" id="framework">
        <span className="eyebrow">Risk framework</span>
        <h2 className="m-0 mb-1.5 text-[clamp(24px,3vw,40px)] font-extrabold uppercase tracking-[-0.05em]">
          Four layers. One receipt.
        </h2>
        <p className="mb-5 text-xs text-faint">
          不將複雜風險壓成黑箱分數；每個結論都保留原因與來源。
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DIMENSIONS.map(([key, title, body]) => (
            <article
              className="card min-h-[180px] transition-transform hover:-translate-y-1 hover:border-accent"
              key={key}
            >
              <span className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-accent">
                {key}
              </span>
              <h3 className="mb-2 mt-5 text-[15px]">{title}</h3>
              <p className="m-0 min-h-[53px] text-[11px] text-dim">{body}</p>
              <b className="text-[8.5px] tracking-[0.08em]">VIEW EVIDENCE →</b>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-10 border-t border-line py-14 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)] lg:gap-24">
        <div>
          <span className="eyebrow">Risk language</span>
          <h2 className="m-0 text-[clamp(28px,3.4vw,52px)] font-extrabold uppercase leading-[0.95] tracking-[-0.06em]">
            Read the signal.
          </h2>
          <p className="mt-3 max-w-[410px] text-[15px] leading-[1.75] text-faint">
            色彩輔助判斷，但每個狀態永遠以文字說明。
          </p>
        </div>
        <div className="border-t border-line">
          {SCALE.map(([grade, level, title, body]) => (
            <div
              className="grid grid-cols-[95px_1fr] items-center gap-6 border-b border-line py-5"
              key={grade}
            >
              <strong
                className={`text-[clamp(28px,3vw,43px)] tracking-[-0.08em] ${SCALE_COLOR[level]}`}
              >
                {grade}
              </strong>
              <div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${SCALE_BADGE[level]}`}
                >
                  {title}
                </span>
                <p className="mt-2 text-sm leading-[1.65] text-faint">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-line bg-gradient-to-br from-ink-elev via-ink-elev to-accent/[0.12] px-7 py-16">
        <span className="eyebrow">Risk receipt</span>
        <h2 className="m-0 mb-6 text-[clamp(28px,4vw,48px)] font-extrabold uppercase leading-[0.95] tracking-[-0.07em]">
          Know what happens
          <br />
          before it happens.
        </h2>
        <a href="#/analyze" className="btn btn-primary">
          Start analysis
        </a>
      </section>

      <footer className="pt-6 text-[9px] font-semibold tracking-[0.04em] text-faint">
        Parallax · Fixture-only Demo · Risk analysis only; not investment advice.
      </footer>
    </main>
  );
}

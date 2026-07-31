import { useEffect, useRef, useState } from "react";
import Analyzer from "@/components/Analyzer";
import { SiteNav } from "@/components/SiteNav";
import { localizeText, getInitialLanguage, pick, type Language } from "@/lib/i18n";
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
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
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
      <SiteNav active={route} language={language} onLanguageChange={setLanguage} />
      {route === "analyze" ? (
        <Analyzer profiles={PROTOCOL_PROFILES} language={language} />
      ) : (
        <Home language={language} />
      )}
    </div>
  );
}

function Home({ language }: { language: Language }) {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const moveGlow = (event: PointerEvent) => {
      const glow = glowRef.current;
      if (!glow) return;

      const bounds = glow.getBoundingClientRect();
      const isOverGrid =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (!isOverGrid) {
        glow.style.opacity = "0";
        return;
      }

      glow.style.setProperty("--glow-x", `${event.clientX - bounds.left}px`);
      glow.style.setProperty("--glow-y", `${event.clientY - bounds.top}px`);
      glow.style.opacity = "1";
    };

    const hideGlow = () => {
      if (glowRef.current) glowRef.current.style.opacity = "0";
    };

    window.addEventListener("pointermove", moveGlow, { passive: true });
    window.addEventListener("blur", hideGlow);
    document.documentElement.addEventListener("pointerleave", hideGlow);

    return () => {
      window.removeEventListener("pointermove", moveGlow);
      window.removeEventListener("blur", hideGlow);
      document.documentElement.removeEventListener("pointerleave", hideGlow);
    };
  }, []);

  return (
    <main className="shell">
      <section className="relative grid min-h-[560px] items-center border border-line">
        {/* Full-bleed grid that bleeds upward behind the transparent header. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[calc(-1*(var(--header-h)+4rem))] z-0 h-[calc(100%+var(--header-h)+4rem)] w-screen -translate-x-1/2 bg-[linear-gradient(rgba(30,30,30,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(30,30,30,0.55)_1px,transparent_1px),linear-gradient(#0c0c0c,#0c0c0c)] bg-[length:28px_28px,28px_28px,100%_100%]"
        />
        <div
          ref={glowRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[calc(-1*(var(--header-h)+4rem))] z-[1] h-[calc(100%+var(--header-h)+4rem)] w-screen -translate-x-1/2 opacity-0 transition-opacity duration-300 [background:radial-gradient(200px_circle_at_var(--glow-x)_var(--glow-y),rgba(204,255,0,0.16),transparent_70%)]"
        />
        <RouteGraph language={language} />
        <div className="relative z-[2] w-full p-8 sm:w-[min(46%,620px)] sm:p-14">
          <span className="eyebrow">PARALLAX / MOSS ON MONAD</span>
          <h1 className="m-0 mb-5 text-[clamp(48px,6vw,92px)] font-extrabold leading-[0.88] tracking-[-0.09em]">
            SEE IT
            <br />
            <em className="not-italic text-accent">BEFORE YOU SIGN.</em>
          </h1>
          <p className="m-0 max-w-[570px] text-[15px] leading-[1.8] text-dim">
            {pick(
              language,
              "A pre-sign explanation and adjustment layer for Monad swaps powered by Moss. Understand what will happen, where material loss or exposure may occur, and what you can adjust before signing.",
              "基于 Moss 的 Monad Swap 签名前解释与调整层。签名前看清交易会发生什么、哪里可能造成明显损耗或暴露，以及现在可以调整什么。",
            )}
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
          {pick(
            language,
            "Keep the reason and source behind every conclusion instead of compressing complex risk into a black-box score.",
            "不将复杂风险压成黑箱分数；每个结论都保留原因与来源。",
          )}
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
              <h3 className="mb-2 mt-5 text-[15px]">{localizeText(title, language)}</h3>
              <p className="m-0 min-h-[53px] text-[11px] text-dim">
                {localizeText(body, language)}
              </p>
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
            {pick(
              language,
              "Color supports judgment, but every status is always explained in words.",
              "色彩辅助判断，但每个状态始终以文字说明。",
            )}
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
                {localizeText(title, language)}
                </span>
                <p className="mt-2 text-sm leading-[1.65] text-faint">
                  {localizeText(body, language)}
                </p>
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

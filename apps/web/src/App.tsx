import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { HeroEvidenceReceipt } from "@/components/HeroEvidenceReceipt";
import { RouteGraph } from "@/components/RouteGraph";
import { SiteNav } from "@/components/SiteNav";
import { VerdictActions } from "@/components/VerdictActions";
import {
  type Copy,
  getInitialLanguage,
  type Language,
  pick,
  say,
} from "@/lib/i18n";

type Dimension = {
  key: string;
  displayKey: Copy;
  title: Copy;
  body: Copy;
  accent: string;
};

const DIMENSIONS: Dimension[] = [
  {
    key: "Cause",
    displayKey: { en: "Cause", zh: "原因" },
    accent: "#ff8ea1",
    title: { en: "What happened", zh: "发生了什么" },
    body: {
      en: "Moss runs quote, action, and simulation to show the real execution result of this intent.",
      zh: "Moss 会执行报价、操作生成与模拟，呈现这笔交易意图的实际执行结果。",
    },
  },
  {
    key: "Evidence",
    displayKey: { en: "Evidence", zh: "证据" },
    accent: "#9d8cff",
    title: { en: "What proves it", zh: "证据是什么" },
    body: {
      en: "Every conclusion traces back to normalized execution evidence, labelled with source, block, and replay.",
      zh: "每个结论都可追溯至标准化后的执行证据，并标注来源、区块与回放信息。",
    },
  },
  {
    key: "Adjust",
    displayKey: { en: "Adjust", zh: "调整" },
    accent: "#75e6b1",
    title: { en: "What you can change", zh: "可以改什么" },
    body: {
      en: "Adjustments tied to the actual cause: route, token pair, amount, or slippage.",
      zh: "仅建议与实际原因相关的调整：路由、代币对、数量或滑点。",
    },
  },
  {
    key: "Irrelevant",
    displayKey: { en: "Irrelevant", zh: "无关项" },
    accent: "#91b8ff",
    title: { en: "What will not help", zh: "改了也无效" },
    body: {
      en: "Changes unrelated to the cause are marked irrelevant, so retries stop being guesswork.",
      zh: "与当前原因无关的修改会被标为无效，避免反复进行无效重试。",
    },
  },
];

function moveSurfaceGlow(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") return;
  const surface = event.currentTarget;
  const bounds = surface.getBoundingClientRect();
  surface.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
  surface.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
}

export default function App() {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

  return (
    <div className="min-h-[calc(100vh-65px)]">
      <SiteNav language={language} onLanguageChange={setLanguage} />
      <Home language={language} />
    </div>
  );
}

function useScrollReveal(
  heroRef: React.RefObject<HTMLDivElement>,
  shadeRef: React.RefObject<HTMLDivElement>,
  revealRef: React.RefObject<HTMLDivElement>,
  progressRef: React.MutableRefObject<number>,
) {
  useEffect(() => {
    const hero = heroRef.current;
    const shade = shadeRef.current;
    const reveal = revealRef.current;
    if (!hero || !shade || !reveal) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Measured on resize only, so the animation loop never reads layout.
    let heroTop = 0;
    let travel = 1;
    const measure = () => {
      heroTop = hero.getBoundingClientRect().top + window.scrollY;
      travel = Math.max(hero.offsetHeight - window.innerHeight, 1);
    };

    const target = () =>
      Math.min(Math.max((window.scrollY - heroTop) / travel, 0), 1);

    const paint = (progress: number) => {
      const visualProgress = reduceMotion ? Math.max(progress, 0.82) : progress;
      progressRef.current = visualProgress;
      const eased = visualProgress * visualProgress * (3 - 2 * visualProgress);
      const revealProgress = Math.min(
        Math.max((visualProgress - 0.48) / 0.22, 0),
        1,
      );
      shade.style.opacity = String(
        Math.min(Math.max((visualProgress - 0.38) / 0.62, 0), 1) * 0.78,
      );
      reveal.style.opacity = String(revealProgress);
      reveal.style.pointerEvents = revealProgress > 0.35 ? "auto" : "none";
      reveal.style.transform = `translate3d(0,${(1 - eased) * 54}px,0)`;
    };

    measure();
    const snap = () => paint(target());
    const onResize = () => {
      measure();
      snap();
    };

    if (reduceMotion) {
      snap();
      window.addEventListener("scroll", snap, { passive: true });
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("scroll", snap);
        window.removeEventListener("resize", onResize);
      };
    }

    // Lerp toward the scroll target so discrete wheel ticks read as a glide.
    let current = target();
    let frame = 0;
    const tick = () => {
      const next = target();
      current += (next - current) * 0.12;
      if (Math.abs(next - current) < 0.0005) current = next;
      paint(current);
      frame = requestAnimationFrame(tick);
    };

    paint(current);
    frame = requestAnimationFrame(tick);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [heroRef, progressRef, revealRef, shadeRef]);
}

function Home({ language }: { language: Language }) {
  const heroRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const heroProgressRef = useRef(0);
  useScrollReveal(heroRef, shadeRef, revealRef, heroProgressRef);

  return (
    <main className="shell">
      <div
        ref={heroRef}
        data-hero-scroll=""
        className="relative -mt-[calc(var(--header-h)+4rem)] ml-[calc(50%-50vw)] h-[200vh] w-screen"
      >
        <section className="sticky top-0 h-screen overflow-hidden">
          <div
            aria-hidden="true"
            className="hero-monad-light pointer-events-none absolute inset-0 z-0"
          />
          <div className="hero-route-trace absolute inset-0 z-[1]">
            <RouteGraph language={language} progressRef={heroProgressRef} />
          </div>
          <div
            ref={shadeRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[2] opacity-0 [background:radial-gradient(ellipse_at_center,rgba(5,5,10,0.97)_0%,rgba(5,5,10,0.88)_40%,rgba(8,7,15,0.42)_72%,rgba(22,16,47,0.24)_100%)]"
          />
          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center px-5 pt-[7vh] sm:px-10">
            <div
              ref={revealRef}
              data-hero-copy=""
              className="hero-reveal-grid w-full max-w-[1260px] opacity-0 will-change-[opacity,transform]"
            >
              <div className="hero-copy-column">
                <span className="hero-copy-kicker">
                  PARALLAX / PRE-SIGN EVIDENCE
                </span>
                <h1
                  data-hero-title=""
                  className="m-0 text-[clamp(46px,10vw,74px)] font-extrabold uppercase leading-[0.9] tracking-[-0.05em] sm:text-[clamp(54px,6.2vw,92px)]"
                >
                  {language === "zh-CN" ? (
                    <>
                      <span className="block">先看证据</span>
                      <em className="mt-[0.08em] block not-italic text-accent">
                        再决定是否签署
                      </em>
                    </>
                  ) : (
                    <>
                      <span className="block">READ THE</span>
                      <span className="block">EVIDENCE.</span>
                      <em className="mt-[0.08em] block not-italic text-accent">
                        BEFORE YOU SIGN.
                      </em>
                    </>
                  )}
                </h1>
                <p className="m-0 mt-7 max-w-[620px] text-[14px] leading-[1.75] text-dim sm:mt-9 sm:text-[16px]">
                  {pick(
                    language,
                    "Parallax turns one Moss replay into a traceable receipt—showing the intent, route, prepared action, simulation, boundary, and provenance before anything is signed.",
                    "Parallax 将一次 Moss 回放整理为可追溯的证据回执，在签署前呈现交易意图、路径、已生成操作、模拟结果、经济边界与证据来源。",
                  )}
                </p>
                <div className="pointer-events-auto mt-8 flex flex-wrap gap-3 sm:mt-10">
                  <a href="#/analyze" className="btn btn-primary">
                    {pick(language, "Analyze transaction", "分析交易")}
                  </a>
                  <a href="#framework" className="btn">
                    {pick(language, "How it works", "运作方式")}
                  </a>
                </div>
              </div>
              <HeroEvidenceReceipt language={language} />
            </div>
          </div>
        </section>
      </div>

      <div className="landing-space">
        <div aria-hidden="true" className="landing-space-background" />
        <div className="landing-space-content relative z-[1]">
          <section className="flex flex-col justify-between gap-4 border-y border-line py-3.5 text-[9px] font-bold tracking-[0.08em] text-faint sm:flex-row">
            <span>
              {pick(language, "READ-ONLY WALLET ACCESS", "只读钱包访问")}
            </span>
            <span>
              {pick(
                language,
                "REPLAY FIXTURES CLEARLY LABELLED",
                "回放样本均有明确标注",
              )}
            </span>
            <span>
              {pick(
                language,
                "NO SIGNING · NO BROADCASTING",
                "不签名 · 不广播",
              )}
            </span>
          </section>

          <section className="mt-20 sm:mt-28" id="framework">
            <span className="eyebrow">
              {pick(language, "Decision framework", "决策框架")}
            </span>
            <h2
              data-section-heading=""
              className="m-0 mb-5 max-w-[980px] text-[clamp(34px,4.5vw,64px)] font-extrabold uppercase leading-[0.95] tracking-[-0.045em] sm:mb-7"
            >
              {pick(
                language,
                "Four questions. One decision.",
                "四个问题，一个决定",
              )}
            </h2>
            <p className="mb-9 max-w-[700px] text-[14px] leading-[1.7] text-faint sm:mb-11 sm:text-[16px]">
              {pick(
                language,
                "Every result answers the same four questions, so a failed swap turns into one concrete next step instead of another blind retry.",
                "每个结果都回答同样的四个问题，让一次失败的兑换交易转化为一个明确的下一步，而不是再次盲目重试。",
              )}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {DIMENSIONS.map((dimension) => (
                <article
                  className="question-card card flex min-h-[230px] flex-col p-6 sm:min-h-[250px] sm:p-7"
                  key={dimension.key}
                  onPointerMove={moveSurfaceGlow}
                  style={
                    { "--surface-accent": dimension.accent } as CSSProperties
                  }
                >
                  <span className="question-card-key relative z-[1] text-[10px] font-extrabold uppercase tracking-[0.12em] text-accent">
                    {say(language, dimension.displayKey)}
                  </span>
                  <h3 className="question-card-title relative z-[1] mb-3 mt-7 text-[19px] leading-tight sm:text-[21px]">
                    {say(language, dimension.title)}
                  </h3>
                  <p className="relative z-[1] m-0 text-[13px] leading-[1.7] text-dim sm:text-[14px]">
                    {say(language, dimension.body)}
                  </p>
                  <b className="relative z-[1] mt-auto pt-8 text-[9px] tracking-[0.1em]">
                    {pick(language, "OPEN EVIDENCE →", "查看证据 →")}
                  </b>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-24 border-t border-line py-20 sm:mt-32 sm:py-28">
            <div className="text-center">
              <span className="eyebrow">
                {pick(language, "Audience verdict", "观众投票")}
              </span>
              <h2
                data-section-heading=""
                className="m-0 text-[clamp(32px,5.5vw,76px)] font-extrabold uppercase leading-[0.92] tracking-[-0.05em]"
              >
                {pick(language, "What would you do next?", "下一步你会怎么做")}
              </h2>
              <p className="mx-auto mt-6 max-w-[680px] text-[15px] leading-[1.75] text-faint sm:text-[16px]">
                {pick(
                  language,
                  "If this were your transaction, review the evidence and choose one outcome below. One person, one vote—change your choice and the same dot moves with you.",
                  "如果这是你的交易，看完证据后从下方四个结论中选择一个。一人一票；改变选择时，同一枚圆点会随之移动，不会重复计票。",
                )}
              </p>
            </div>
            <VerdictActions language={language} />
          </section>

          <section className="decision-receipt border border-line px-7 py-16">
            <span className="eyebrow">
              {pick(language, "Decision receipt", "决策回执")}
            </span>
            <h2
              data-section-heading=""
              className="m-0 mb-6 text-[clamp(28px,4vw,48px)] font-extrabold uppercase leading-[0.95] tracking-[-0.07em]"
            >
              {pick(language, "Know what to do", "签署之前")}
              <br />
              {pick(language, "before you sign.", "明确该怎么做")}
            </h2>
            <a href="#/analyze" className="btn btn-primary">
              {pick(language, "Start analysis", "开始分析")}
            </a>
          </section>

          <footer className="pt-6 text-[9px] font-semibold tracking-[0.04em] text-faint">
            {pick(
              language,
              "Parallax · Pre-sign decision layer · Explanation and adjustment only; not investment advice.",
              "Parallax · 签名前决策层 · 仅提供解释与调整建议；不构成投资建议。",
            )}
          </footer>
        </div>
      </div>
    </main>
  );
}

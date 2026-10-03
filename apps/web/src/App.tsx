import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { HeroEvidenceReceipt } from "@/components/HeroEvidenceReceipt";
import { RouteGraph } from "@/components/RouteGraph";
import { SiteNav } from "@/components/SiteNav";
import { VerdictActions } from "@/components/VerdictActions";
import { WalletApp } from "@/components/wallet/WalletApp";
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
      en: "Parallax shows what the execution evidence actually revealed: the quote, prepared transaction, simulation result, and any warnings—without speculation.",
      zh: "Parallax 展示执行证据的真实结果：报价、已生成交易、模拟结果与警告信息，不做推测。",
    },
  },
  {
    key: "Evidence",
    displayKey: { en: "Evidence", zh: "证据" },
    accent: "#9d8cff",
    title: { en: "What proves it", zh: "哪些证据支持" },
    body: {
      en: "Every conclusion links to traceable evidence with disclosed source, reproducibility, and provenance. Unknown evidence stays unknown.",
      zh: "每个结论都关联到可追溯证据，明确披露来源、可重现性与溯源信息。未知证据保持未知。",
    },
  },
  {
    key: "Adjust",
    displayKey: { en: "Adjust", zh: "调整" },
    accent: "#75e6b1",
    title: { en: "What can change", zh: "哪些可以调整" },
    body: {
      en: "When a verified improvement exists, Parallax shows exactly what transaction condition to adjust and re-checks the result.",
      zh: "当存在经过验证的改进时，Parallax 明确指出应调整的交易条件，并重新检查结果。",
    },
  },
  {
    key: "Irrelevant",
    displayKey: { en: "Irrelevant", zh: "无关项" },
    accent: "#91b8ff",
    title: { en: "What will not help", zh: "哪些修改无效" },
    body: {
      en: "Changes that do not address the identified cause are clearly separated from relevant actions, preventing wasted attempts.",
      zh: "未针对已识别原因的修改会与相关操作明确区分，避免无效尝试。",
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

function readRoute() {
  return window.location.hash === "#/analyze" ? "analyze" : "home";
}

export function AppRouteSurface({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#05050a]" data-app-route-surface="">
      <div aria-hidden="true" className="route-transition-shield" />
      {children}
    </div>
  );
}

export function prepareAnalyzeNavigation(
  event: Pick<
    ReactMouseEvent<HTMLAnchorElement>,
    | "altKey"
    | "button"
    | "ctrlKey"
    | "defaultPrevented"
    | "metaKey"
    | "shiftKey"
  >,
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  document.documentElement.dataset.routeTransition = "analyze";
}

export default function App() {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (route !== "analyze") {
      delete document.documentElement.dataset.routeTransition;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      delete document.documentElement.dataset.routeTransition;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route]);

  return (
    <AppRouteSurface>
      <SiteNav
        active={route === "analyze" ? "analyze" : "home"}
        language={language}
        minimal={route === "analyze"}
        onAnalyzeNavigate={prepareAnalyzeNavigation}
        onLanguageChange={setLanguage}
      />
      {route === "analyze" ? (
        <WalletApp language={language} />
      ) : (
        <Home
          language={language}
          onAnalyzeNavigate={prepareAnalyzeNavigation}
        />
      )}
    </AppRouteSurface>
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
        Math.min(Math.max((visualProgress - 0.38) / 0.62, 0), 1) * 0.68,
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

function Home({
  language,
  onAnalyzeNavigate,
}: {
  language: Language;
  onAnalyzeNavigate: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
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
            className="pointer-events-none absolute inset-0 z-[2] opacity-0 [background:radial-gradient(ellipse_at_center,rgba(5,5,10,0.94)_0%,rgba(5,5,10,0.76)_38%,rgba(8,7,15,0.26)_70%,rgba(22,16,47,0.08)_100%)]"
          />
          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center px-5 pt-[2vh] sm:px-10">
            <div
              ref={revealRef}
              data-hero-copy=""
              className="hero-reveal-grid w-full max-w-[1160px] opacity-0 will-change-[opacity,transform]"
            >
              <div className="hero-copy-column">
                <span className="hero-copy-kicker">
                  PARALLAX / PRE-SIGN EVIDENCE
                </span>
                <h1
                  data-hero-title=""
                  className="m-0 text-[clamp(44px,10vw,68px)] font-extrabold uppercase leading-[0.9] tracking-[-0.05em] sm:text-[clamp(52px,5.6vw,82px)]"
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
                    "Parallax is a pre-sign decision layer that converts execution evidence into clear, actionable conclusions. This demo shows how a swap intent, sample execution evidence, and disclosed provenance are organized into a traceable decision receipt—without signing or broadcasting.",
                    "Parallax 是签名前决策层，将执行证据转化为清晰、可执行的结论。本演示展示如何将兑换意图、示例执行证据与明确披露的溯源信息整理为可追溯的决策回执，全程不签名，也不广播。",
                  )}
                </p>
                <div className="pointer-events-auto mt-8 flex flex-wrap gap-3 sm:mt-10">
                  {/* biome-ignore lint/a11y/useValidAnchor: this is a real client-side hash route with native link semantics */}
                  <a
                    href="#/analyze"
                    className="btn btn-primary"
                    onClick={onAnalyzeNavigate}
                  >
                    {pick(language, "Try demo", "体验 Demo")}
                  </a>
                  <a href="#how-it-works" className="btn">
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
          <section
            className="scroll-mt-4 flex flex-col justify-between gap-4 border-y border-line py-3.5 text-[9px] font-bold tracking-[0.08em] text-faint sm:flex-row"
            id="how-it-works"
          >
            <span>
              {pick(language, "READ-ONLY PRE-SIGN CHECK", "只读签名前检查")}
            </span>
            <span>
              {pick(
                language,
                "DEMO / REPLAY MODE CLEARLY LABELLED",
                "明确标注演示／回放模式",
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

          <section className="mt-16 sm:mt-20" id="framework">
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
                "Before you sign, Parallax answers four questions using real execution evidence: what happened, what proves it, what you can change, and what will not help. Missing evidence stays explicit—never hidden.",
                "签名之前，Parallax 使用真实执行证据回答四个问题：发生了什么、哪些证据支持、哪些可以调整、哪些修改无效。缺失证据明确展示，绝不隐藏。",
              )}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {DIMENSIONS.map((dimension) => (
                <article
                  className="question-card card min-h-[215px] p-6 sm:min-h-[230px] sm:p-7"
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
                  "If this were your transaction, review the checked evidence and choose what you would do next. One person, one vote—your vote replaces any previous choice.",
                  "如果这是你的交易，查看检查证据后选择你的下一步操作。一人一票，新投票会替换之前的选择。",
                )}
              </p>
            </div>
            <VerdictActions language={language} />
          </section>

          <section className="decision-receipt border border-line px-7 py-16">
            <span className="eyebrow">
              {pick(language, "Decision support", "决策支持")}
            </span>
            <h2
              data-section-heading=""
              className="m-0 mb-6 text-[clamp(28px,4vw,48px)] font-extrabold uppercase leading-[0.95] tracking-[-0.07em]"
            >
              {pick(language, "Evidence first.", "证据先行，")}
              <br />
              {pick(language, "Then decide.", "再做决定")}
            </h2>
            {/* biome-ignore lint/a11y/useValidAnchor: this is a real client-side hash route with native link semantics */}
            <a
              href="#/analyze"
              className="btn btn-primary"
              onClick={onAnalyzeNavigate}
            >
              {pick(language, "Try demo", "体验 Demo")}
            </a>
          </section>

          <footer className="pt-6 text-[9px] font-semibold tracking-[0.04em] text-faint">
            {pick(
              language,
              "Parallax · Pre-sign decision layer · Converts execution evidence into actionable decisions; does not guarantee safety or provide investment advice.",
              "Parallax · 签名前决策层 · 将执行证据转化为可执行决策；不保证安全，不构成投资建议。",
            )}
          </footer>
        </div>
      </div>
    </main>
  );
}

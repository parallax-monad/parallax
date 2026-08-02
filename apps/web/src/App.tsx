import { useEffect, useRef, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import {
  getInitialLanguage,
  pick,
  say,
  type Copy,
  type Language,
} from "@/lib/i18n";
import { RouteGraph } from "@/components/RouteGraph";

type Dimension = { key: string; title: Copy; body: Copy };

const DIMENSIONS: Dimension[] = [
  {
    key: "Cause",
    title: { en: "What happened", zh: "发生了什么" },
    body: {
      en: "Moss runs quote, action, and simulation to show the real execution result of this intent.",
      zh: "Moss 完成 quote、action 与 simulation，呈现这笔交易的真实执行结果。",
    },
  },
  {
    key: "Evidence",
    title: { en: "What proves it", zh: "证据是什么" },
    body: {
      en: "Every conclusion traces back to normalized execution evidence, labelled with source, block, and replay.",
      zh: "每个结论都追溯到归一化后的执行证据，并标注来源、区块与 Replay。",
    },
  },
  {
    key: "Adjust",
    title: { en: "What you can change", zh: "可以改什么" },
    body: {
      en: "Adjustments tied to the actual cause: route, token pair, amount, or slippage.",
      zh: "给出与真实原因相关的调整：Route、Token Pair、Amount 或 Slippage。",
    },
  },
  {
    key: "Irrelevant",
    title: { en: "What will not help", zh: "改了也无效" },
    body: {
      en: "Changes unrelated to the cause are marked irrelevant, so retries stop being guesswork.",
      zh: "与当前原因无关的修改会被标为无效，避免反复无效重试。",
    },
  },
];

type Verdict = { grade: string; level: string; title: Copy; body: Copy };

const SCALE: Verdict[] = [
  {
    grade: "PROCEED",
    level: "low",
    title: { en: "No blocking evidence", zh: "未发现阻断证据" },
    body: {
      en: "No blocking evidence was found in the checked scope. This is not a safety guarantee.",
      zh: "在本次已检查范围内未发现阻断证据，这不代表交易绝对安全。",
    },
  },
  {
    grade: "ADJUST",
    level: "moderate",
    title: { en: "Change one condition", zh: "修改一个条件" },
    body: {
      en: "A transaction condition needs to change, then the check can be re-run.",
      zh: "需要修改一个交易条件，之后可以重新检查。",
    },
  },
  {
    grade: "STOP",
    level: "high",
    title: { en: "Do not continue", zh: "不应继续" },
    body: {
      en: "This path cannot execute. Switch route or token pair, or stop here.",
      zh: "当前路径无法执行，请更换 Route／Token Pair 或停止。",
    },
  },
  {
    grade: "UNKNOWN",
    level: "elevated",
    title: { en: "Evidence missing", zh: "证据不足" },
    body: {
      en: "Evidence is insufficient for a trustworthy conclusion, and unknown is never auto-passed.",
      zh: "证据不足以作出可信结论；Unknown 不会被自动放行。",
    },
  },
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
) {
  useEffect(() => {
    const hero = heroRef.current;
    const shade = shadeRef.current;
    const reveal = revealRef.current;
    if (!hero || !shade || !reveal) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      const eased = progress * progress * (3 - 2 * progress);
      shade.style.opacity = String(eased * 0.68);
      reveal.style.opacity = String(
        Math.min(Math.max((progress - 0.18) / 0.72, 0), 1),
      );
      reveal.style.transform = `translate3d(0,${(1 - eased) * 48}px,0)`;
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
  }, [heroRef, revealRef, shadeRef]);
}

function Home({ language }: { language: Language }) {
  const glowRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  useScrollReveal(heroRef, shadeRef, revealRef);

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
      <div
        ref={heroRef}
        className="relative -mt-[calc(var(--header-h)+4rem)] ml-[calc(50%-50vw)] h-[200vh] w-screen"
      >
        <section className="sticky top-0 h-screen overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(30,30,30,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(30,30,30,0.55)_1px,transparent_1px),linear-gradient(#0c0c0c,#0c0c0c)] bg-[length:28px_28px,28px_28px,100%_100%]"
          />
          <div
            ref={glowRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[1] opacity-0 transition-opacity duration-300 [background:radial-gradient(200px_circle_at_var(--glow-x)_var(--glow-y),rgba(204,255,0,0.16),transparent_70%)]"
          />
          <div className="absolute inset-0 z-[2]">
            <RouteGraph language={language} />
          </div>
          <div
            ref={shadeRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[3] bg-black opacity-0"
          />
          <div
            ref={revealRef}
            className="absolute inset-x-0 bottom-[10vh] z-[4] mx-auto w-full max-w-[720px] px-8 text-center opacity-0 will-change-[opacity,transform] sm:px-14"
          >
            <h1 className="m-0 mb-5 text-[clamp(48px,6vw,92px)] font-extrabold leading-[0.88] tracking-[-0.09em]">
              SEE IT
              <br />
              <em className="not-italic text-accent">BEFORE YOU SIGN.</em>
            </h1>
            <p className="m-0 mx-auto max-w-[570px] text-[15px] leading-[1.8] text-dim">
              {pick(
                language,
                "A pre-sign explanation and adjustment layer for Monad swaps powered by Moss. Understand what will happen, where material loss or exposure may occur, and what you can adjust before signing.",
                "基于 Moss 的 Monad Swap 签名前解释与调整层。签名前看清交易会发生什么、哪里可能造成明显损耗或暴露，以及现在可以调整什么。",
              )}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a href="#/analyze" className="btn btn-primary">
                Analyze transaction
              </a>
              <a href="#framework" className="btn">
                How it works
              </a>
            </div>
          </div>
        </section>
      </div>

      <section className="flex flex-col justify-between gap-4 border-y border-line py-3.5 text-[9px] font-bold tracking-[0.08em] text-faint sm:flex-row">
        <span>READ-ONLY WALLET ACCESS</span>
        <span>REPLAY FIXTURES CLEARLY LABELLED</span>
        <span>NO SIGNING · NO BROADCASTING</span>
      </section>

      <section className="mt-12" id="framework">
        <span className="eyebrow">Decision framework</span>
        <h2 className="m-0 mb-1.5 text-[clamp(24px,3vw,40px)] font-extrabold uppercase tracking-[-0.05em]">
          Four questions. One decision.
        </h2>
        <p className="mb-5 text-xs text-faint">
          {pick(
            language,
            "Every result answers the same four questions, so a failed swap turns into one concrete next step instead of another blind retry.",
            "每个结果都回答同样的四个问题，让一次失败的 Swap 变成一个明确的下一步，而不是又一次盲目重试。",
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DIMENSIONS.map((dimension) => (
            <article
              className="card min-h-[180px] transition-transform hover:-translate-y-1 hover:border-accent"
              key={dimension.key}
            >
              <span className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-accent">
                {dimension.key}
              </span>
              <h3 className="mb-2 mt-5 text-[15px]">{say(language, dimension.title)}</h3>
              <p className="m-0 min-h-[53px] text-[11px] text-dim">
                {say(language, dimension.body)}
              </p>
              <b className="text-[8.5px] tracking-[0.08em]">OPEN EVIDENCE →</b>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-10 border-t border-line py-14 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)] lg:gap-24">
        <div>
          <span className="eyebrow">Verdict language</span>
          <h2 className="m-0 text-[clamp(28px,3.4vw,52px)] font-extrabold uppercase leading-[0.95] tracking-[-0.06em]">
            Read the verdict.
          </h2>
          <p className="mt-3 max-w-[410px] text-[15px] leading-[1.75] text-faint">
            {pick(
              language,
              "Four verdicts, each stated in words. Proceed never means safe, and unknown is never treated as a pass.",
              "四种结论，每一种都用文字说明。Proceed 不等于安全，Unknown 也不会被当作通过。",
            )}
          </p>
        </div>
        <div className="border-t border-line">
          {SCALE.map((verdict) => (
            <div
              className="grid grid-cols-1 gap-2 border-b border-line py-5 sm:grid-cols-[minmax(0,180px)_1fr] sm:items-baseline sm:gap-7"
              key={verdict.grade}
            >
              <strong
                className={`block whitespace-nowrap text-[clamp(24px,2.4vw,34px)] leading-none tracking-[-0.06em] ${SCALE_COLOR[verdict.level]}`}
              >
                {verdict.grade}
              </strong>
              <div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${SCALE_BADGE[verdict.level]}`}
                >
                  {say(language, verdict.title)}
                </span>
                <p className="mt-2 text-sm leading-[1.65] text-faint">
                  {say(language, verdict.body)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-line bg-gradient-to-br from-ink-elev via-ink-elev to-accent/[0.12] px-7 py-16">
        <span className="eyebrow">Decision receipt</span>
        <h2 className="m-0 mb-6 text-[clamp(28px,4vw,48px)] font-extrabold uppercase leading-[0.95] tracking-[-0.07em]">
          Know what to do
          <br />
          before you sign.
        </h2>
        <a href="#/analyze" className="btn btn-primary">
          Start analysis
        </a>
      </section>

      <footer className="pt-6 text-[9px] font-semibold tracking-[0.04em] text-faint">
        Parallax · Pre-sign decision layer · Explanation and adjustment only; not investment advice.
      </footer>
    </main>
  );
}

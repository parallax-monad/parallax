import { useEffect } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { LANGUAGE_STORAGE_KEY, type Language, pick } from "@/lib/i18n";

export function SiteNav({
  language,
  active = "home",
  minimal = false,
  onLanguageChange,
}: {
  language: Language;
  active?: "home" | "analyze";
  /** Wallet route only: show a compact return path and keep the languages. */
  minimal?: boolean;
  onLanguageChange: (language: Language) => void;
}) {
  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  return (
    <nav
      aria-label={pick(language, "Primary navigation", "主导航")}
      className={`relative z-20 flex min-h-[var(--header-h)] items-center gap-6 bg-transparent px-[max(5vw,18px)] sm:gap-11 ${
        // The desktop wallet is pulled up under this bar, so a minimal nav must not
        // swallow clicks; only the return link and language switch are active.
        minimal ? "site-nav-minimal pointer-events-none" : ""
      }`}
    >
      {minimal ? (
        <a
          href="#/"
          className="site-nav-return pointer-events-auto inline-flex min-h-10 items-center rounded-full border border-line-strong bg-ink-elev/90 px-3 text-[13px] font-bold tracking-[0.02em] text-dim no-underline transition-colors hover:border-monad/60 hover:text-monad-dim md:absolute md:left-[max(5vw,18px)] md:top-1/2 md:min-h-8 md:-translate-y-1/2 md:rounded-none md:border-0 md:bg-transparent md:px-0 md:text-[12px] md:tracking-[0.04em]"
        >
          <span className="md:hidden">
            {pick(language, "← Landing", "← 首页")}
          </span>
          <span className="hidden md:inline">
            {pick(language, "← Back to Parallax", "← 返回 Parallax")}
          </span>
        </a>
      ) : (
        <a
          href="#/"
          className="text-[25px] font-extrabold tracking-[-0.07em] text-accent no-underline sm:text-[29px]"
        >
          PARAL<span className="text-white">LAX</span>
        </a>
      )}
      <div className="ml-auto flex items-center gap-4 sm:gap-[30px]">
        {!minimal && (
          <a
            href="#/analyze"
            aria-current={active === "analyze" ? "page" : undefined}
            className={`text-[13px] font-bold uppercase tracking-[0.08em] no-underline transition-colors hover:text-accent sm:text-[15px] ${
              active === "analyze" ? "text-accent" : "text-dim"
            }`}
          >
            {pick(language, "Try demo", "体验 Demo")}
          </a>
        )}
        <LanguageSwitch
          className={`pointer-events-auto ${
            minimal
              ? "site-nav-language-switch"
              : "border-l border-line-strong pl-4 sm:pl-[30px]"
          }`}
          language={language}
          tone={minimal ? "monad" : "accent"}
          onLanguageChange={onLanguageChange}
        />
      </div>
    </nav>
  );
}

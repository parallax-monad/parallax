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
        // The wallet is pulled up under this bar, so a minimal nav must not
        // swallow clicks; only the return link and language switch are active.
        minimal ? "pointer-events-none" : ""
      }`}
    >
      {minimal ? (
        <a
          href="#/"
          className="pointer-events-auto absolute right-[max(4vw,12px)] top-0 inline-flex min-h-7 items-center text-[10px] font-bold tracking-[0.04em] text-dim no-underline transition-colors hover:text-monad-dim md:left-[max(5vw,18px)] md:right-auto md:top-1/2 md:min-h-8 md:-translate-y-1/2 md:text-[12px]"
        >
          {pick(language, "← Back to Parallax", "← 返回 Parallax")}
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
        {/* On the wallet route this switch only exists at widths where the frame
            tucks under the nav. Narrower than that, the wallet header renders
            its own copy, so the two never overlap and never both show. */}
        <LanguageSwitch
          className={`pointer-events-auto ${
            minimal
              ? "hidden md:flex"
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

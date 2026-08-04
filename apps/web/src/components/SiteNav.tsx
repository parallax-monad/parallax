import { useEffect } from "react";
import { LANGUAGE_STORAGE_KEY, type Language, pick } from "@/lib/i18n";

export function SiteNav({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  return (
    <nav
      aria-label={pick(language, "Primary navigation", "主导航")}
      className="relative z-20 flex min-h-[var(--header-h)] items-center gap-6 bg-transparent px-[max(5vw,18px)] sm:gap-11"
    >
      <a
        href="#/"
        className="text-[25px] font-extrabold tracking-[-0.07em] text-accent no-underline sm:text-[29px]"
      >
        PARAL<span className="text-[#0a0a0c]">LAX</span>
      </a>
      <div className="ml-auto flex items-center gap-4 sm:gap-[30px]">
        <div className="flex items-center border-l border-line-strong pl-4 sm:pl-[30px]">
          <button
            type="button"
            onClick={() => onLanguageChange("zh-CN")}
            aria-pressed={language === "zh-CN"}
            aria-label={pick(
              language,
              "Switch to Simplified Chinese",
              "切换为简体中文",
            )}
            className={`px-2 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors hover:text-accent ${
              language === "zh-CN" ? "text-accent" : "text-faint"
            }`}
          >
            简中
          </button>
          <span aria-hidden="true" className="text-line-strong">
            /
          </span>
          <button
            type="button"
            onClick={() => onLanguageChange("en")}
            aria-pressed={language === "en"}
            aria-label={pick(language, "Switch to English", "切换为英文")}
            className={`px-2 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors hover:text-accent ${
              language === "en" ? "text-accent" : "text-faint"
            }`}
          >
            EN
          </button>
        </div>
      </div>
    </nav>
  );
}

import { useEffect } from "react";
import {
  LANGUAGE_STORAGE_KEY,
  pick,
  type Language,
} from "@/lib/i18n";

export function SiteNav({
  active,
  language,
  onLanguageChange,
}: {
  active: string;
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
        PARAL<span className="text-white">LAX</span>
      </a>
      <div className="ml-auto flex items-center gap-4 sm:gap-[30px]">
        <div className="hidden items-center gap-[30px] sm:flex">
          <NavLink href="#/" label={pick(language, "Risk graph", "风险图谱")} current={active === "home"} />
          <NavLink href="#/analyze" label={pick(language, "Analyze", "分析")} current={active === "analyze"} />
        </div>
        <div
          className="flex items-center border-l border-line-strong pl-4 sm:pl-[30px]"
          aria-label={pick(language, "Language selection", "语言选择")}
        >
          <button
            type="button"
            onClick={() => onLanguageChange("zh-CN")}
            aria-pressed={language === "zh-CN"}
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

function NavLink({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={`text-sm font-bold uppercase tracking-[0.08em] no-underline transition-colors hover:text-accent ${
        current ? "text-accent" : "text-dim"
      }`}
    >
      {label}
    </a>
  );
}

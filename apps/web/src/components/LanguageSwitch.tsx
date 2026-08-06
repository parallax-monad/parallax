import { type Language, pick } from "@/lib/i18n";

/**
 * The language pair, shared by the site nav and the wallet header.
 *
 * The wallet renders its own copy at narrow widths, where the nav's copy would
 * collide with the wallet's close button. Keeping one component means the two
 * placements cannot drift apart in labelling or behaviour.
 */
export function LanguageSwitch({
  language,
  tone = "accent",
  className = "",
  onLanguageChange,
}: {
  language: Language;
  /** Violet inside the wallet demo, acid green on the landing page. */
  tone?: "accent" | "monad";
  className?: string;
  onLanguageChange: (language: Language) => void;
}) {
  const optionTone = (selected: boolean) =>
    `px-2 py-2 text-[13px] font-bold uppercase tracking-[0.08em] transition-colors ${
      tone === "monad" ? "hover:text-monad-dim" : "hover:text-accent"
    } ${
      selected
        ? tone === "monad"
          ? "text-monad-dim"
          : "text-accent"
        : "text-dim"
    }`;

  return (
    <div className={`flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => onLanguageChange("zh-CN")}
        aria-pressed={language === "zh-CN"}
        aria-label={pick(
          language,
          "Switch to Simplified Chinese",
          "切换为简体中文",
        )}
        className={optionTone(language === "zh-CN")}
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
        className={optionTone(language === "en")}
      >
        EN
      </button>
    </div>
  );
}

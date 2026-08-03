import { type Language, say } from "@/lib/i18n";

/**
 * Marks the reading order between result cards. Purely decorative, so it is
 * hidden from assistive tech; the cards themselves carry the real sequence.
 * The bounce is suppressed under prefers-reduced-motion via the motion-safe
 * variant, leaving a static arrow.
 */
export function FlowArrow({ language }: { language?: Language }) {
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-1 py-1">
      <span className="h-4 w-px bg-gradient-to-b from-transparent to-accent/60" />
      <svg
        aria-hidden="true"
        className="motion-safe:animate-flow-nudge text-accent"
        fill="none"
        height="18"
        viewBox="0 0 24 24"
        width="18"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 4v14m0 0-6-6m6 6 6-6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
        />
      </svg>
      {language && (
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-dim">
          {say(language, { en: "then", zh: "接着" })}
        </span>
      )}
    </div>
  );
}

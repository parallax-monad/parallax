import { type ReactNode, useEffect, useState } from "react";

/**
 * Fades a card in on mount. Cards mount only once their data exists, so each
 * one appears after the step before it finished rather than on a fixed timeline.
 */
export function Reveal({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    // One frame paints the hidden state first, so the transition actually runs.
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setShown(true), delay);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [delay]);

  return (
    <div
      className={`transition-all duration-500 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

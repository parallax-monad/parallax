import type { ReactElement, ReactNode } from "react";
import type { Verdict } from "@/lib/analyze/types";

/**
 * Verdict and status marks. Each verdict keeps a distinct shape as well as a
 * distinct colour, so the meaning survives for colour-blind users and in
 * greyscale; colour alone is never the only signal.
 */
type MarkProps = { size?: number; className?: string };

function Svg({
  children,
  size,
  className,
}: MarkProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

const STROKE = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2.1,
};

/** PROCEED: circle + tick. */
function ProceedMark({ size = 24, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="m8 12.3 2.7 2.7L16 9.7" {...STROKE} />
    </Svg>
  );
}

/** ADJUST: a dial, matching "change one condition". */
function AdjustMark({ size = 24, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" {...STROKE} />
      <circle cx="16" cy="8" r="2.2" {...STROKE} />
      <circle cx="10" cy="16" r="2.2" {...STROKE} />
    </Svg>
  );
}

/** STOP: octagon + bar, the shape a road sign uses. */
function StopMark({ size = 24, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <path
        d="M8.6 3.5h6.8l5.1 5.1v6.8l-5.1 5.1H8.6l-5.1-5.1V8.6z"
        {...STROKE}
      />
      <path d="M8.5 12h7" {...STROKE} />
    </Svg>
  );
}

/** UNKNOWN: dashed circle + question, never a pass. */
function UnknownMark({ size = 24, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3.4 3" {...STROKE} />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3v1.6" {...STROKE} />
      <path d="M12.8 16.6h.01" {...STROKE} />
    </Svg>
  );
}

export const VERDICT_ICON: Record<Verdict, (props: MarkProps) => ReactElement> =
  {
    PROCEED: ProceedMark,
    ADJUST: AdjustMark,
    STOP: StopMark,
    UNKNOWN: UnknownMark,
  };

export function VerdictIcon({
  verdict,
  size = 24,
  className,
}: MarkProps & { verdict: Verdict }) {
  const Mark = VERDICT_ICON[verdict];
  return <Mark className={className} size={size} />;
}

/** Coverage marks for the checked / not checked / unknown columns. */
export function CheckedMark({ size = 16, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <path d="m4.5 12.5 4.5 4.5L19.5 6.5" {...STROKE} />
    </Svg>
  );
}

export function NotCheckedMark({ size = 16, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.6 3" {...STROKE} />
    </Svg>
  );
}

export function UnknownListMark({ size = 16, className }: MarkProps) {
  return (
    <Svg className={className} size={size}>
      <path d="M12 4.5 21 19.5H3z" {...STROKE} />
      <path d="M12 10v3.4M12 16.4h.01" {...STROKE} />
    </Svg>
  );
}

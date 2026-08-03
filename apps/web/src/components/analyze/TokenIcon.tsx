/**
 * Inline token marks. Drawn as SVG rather than fetched from a CDN so the page
 * stays offline-capable and no third party learns which pair a user checks.
 * Shapes are simplified for legibility at the ~20px size used in the form.
 */
export type TokenIconProps = { symbol: string; size?: number };

function MonMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#6E56F8" height="24" rx="6" width="24" />
      <rect
        fill="none"
        height="12.5"
        rx="4"
        stroke="#FFFFFF"
        strokeWidth="2.6"
        transform="rotate(45 12 12)"
        width="12.5"
        x="5.75"
        y="5.75"
      />
    </svg>
  );
}

function UsdcMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" fill="#2775CA" r="12" />
      <path
        d="M15.5 6.3a7 7 0 0 1 0 11.4M8.5 17.7a7 7 0 0 1 0-11.4"
        fill="none"
        stroke="#FFFFFF"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <path
        d="M12 6.4v11.2"
        fill="none"
        stroke="#FFFFFF"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M13.9 9.6c-.3-.7-1-1.1-1.9-1.1-1.2 0-2 .6-2 1.6 0 .9.6 1.4 2 1.7 1.5.3 2.1.8 2.1 1.8 0 1.1-.9 1.8-2.1 1.8-1 0-1.8-.4-2.1-1.2"
        fill="none"
        stroke="#FFFFFF"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Unknown symbols still get a stable mark, so layout never shifts. */
function FallbackMark({ symbol, size }: { symbol: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-ink-rail font-bold text-dim"
      style={{ height: size, width: size, fontSize: size * 0.38 }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

export function TokenIcon({ symbol, size = 20 }: TokenIconProps) {
  const key = symbol.toUpperCase();

  if (key === "MON" || key === "WMON") return <MonMark size={size} />;
  if (key === "USDC") return <UsdcMark size={size} />;
  return <FallbackMark size={size} symbol={key} />;
}

import type { ReactNode } from "react";

/**
 * Wallet chrome marks. Drawn inline so the app frame stays offline-capable and
 * keeps the same stroke weight as the existing verdict icons.
 */
type IconProps = { size?: number; className?: string };

const STROKE = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.9,
  fill: "none",
};

function Frame({
  children,
  size = 22,
  className,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M8 4v16m0-16L4.5 7.5M8 4l3.5 3.5" {...STROKE} />
      <path d="M16 20V4m0 16 3.5-3.5M16 20l-3.5-3.5" {...STROKE} />
    </Frame>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" {...STROKE} />
    </Frame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M6 6l12 12M18 6 6 18" {...STROKE} />
    </Frame>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="m6 9.5 6 6 6-6" {...STROKE} />
    </Frame>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M4 10.4 12 4l8 6.4V20h-5.6v-5.2H9.6V20H4z" {...STROKE} />
    </Frame>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path
        d="M12 3.2 5.5 5.8v5.6c0 4 2.7 7.3 6.5 9.4 3.8-2.1 6.5-5.4 6.5-9.4V5.8z"
        {...STROKE}
      />
      <path d="m9.2 12.1 2.1 2.1 3.5-4" {...STROKE} />
    </Frame>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M12 7.6V12l3 2" {...STROKE} />
    </Frame>
  );
}

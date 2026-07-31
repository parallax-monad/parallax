export function SiteNav({ active }: { active: string }) {
  return (
    <>
      <nav
        aria-label="Primary navigation"
        className="sticky top-0 z-10 flex min-h-[82px] items-center gap-11 border-b border-line bg-black/90 px-[max(5vw,18px)] backdrop-blur-md"
      >
        <a
          href="#/"
          className="text-[29px] font-extrabold tracking-[-0.07em] text-accent no-underline"
        >
          PARALLAX
        </a>
        <div className="flex items-center gap-[30px]">
          <NavLink href="#/" label="Risk graph" current={active === "home"} />
          <NavLink href="#/analyze" label="Analyze" current={active === "analyze"} />
        </div>
        <span className="ml-auto hidden text-[11px] font-bold uppercase tracking-[0.06em] text-faint sm:inline">
          <i className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-accent shadow-[0_0_10px_#ccff00]" />
          Fixture data layer active
        </span>
      </nav>
    </>
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

interface Props {
  onNavClick?: (targetId: string) => void;
}

export function HeroNav({ onNavClick }: Props) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    if (onNavClick) {
      onNavClick(targetId);
    } else {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  return (
    <header className="w-full h-16 bg-[#06131f]/95 backdrop-blur-md border-b border-[#1b4058] px-6 lg:px-12 flex items-center justify-between z-50 select-none">
      {/* Left: small diamond/cyclone logo icon + "TOOFAN" + subtitle */}
      <a
        href="#top"
        onClick={(e) => handleClick(e, "top")}
        className="flex items-center gap-3 cursor-pointer group"
      >
        <div className="text-cyan-400 group-hover:scale-105 transition-transform">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 12l10 10 10-10L12 2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="text-white font-bold tracking-[0.2em] text-[18px] leading-tight">
            TOOFAN
          </span>
          <span className="text-slate-400 text-[9px] tracking-[0.25em] font-semibold uppercase leading-tight">
            AI FOR A SAFER TOMORROW
          </span>
        </div>
      </a>

      {/* Center nav links, evenly spaced, 14px, gray-300 */}
      <nav className="hidden lg:flex items-center gap-8 text-[14px]">
        {/* Overview: active (cyan text #35cfe3 + cyan underline) */}
        <a
          href="#top"
          onClick={(e) => handleClick(e, "top")}
          className="text-[#35cfe3] font-medium border-b-2 border-[#35cfe3] pb-1 cursor-pointer transition-colors"
        >
          Overview
        </a>
        <a
          href="#genesis"
          onClick={(e) => handleClick(e, "genesis")}
          className="text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          Genesis
        </a>
        <a
          href="#forecast"
          onClick={(e) => handleClick(e, "forecast")}
          className="text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          Forecast
        </a>
        <a
          href="#impact"
          onClick={(e) => handleClick(e, "impact")}
          className="text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          Impact
        </a>
      </nav>

      {/* Right: red filled dot + "LIVE" in red bold text, then vertical divider, then date/time stacked */}
      <div className="flex items-center gap-3.5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
          <span className="text-red-500 font-bold text-[12px] tracking-wider uppercase">
            LIVE
          </span>
        </div>
        <div className="h-6 w-px bg-[#1b4058]" />
        <div className="flex flex-col text-right font-mono text-[12px] leading-tight font-medium text-white">
          <span>11 Sep 2026</span>
          <span className="text-slate-300">12:30 UTC</span>
        </div>
      </div>
    </header>
  );
}

import { useEffect, useState } from "react";
import { Bell, Menu, Search } from "lucide-react";
import { useApp } from "@/state/AppContext";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { cn } from "@/lib/utils";

function useUtcClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  })
    .format(now)
    .toUpperCase()
    .replace(",", " ")
    .concat(" UTC");
}

export function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { unread, markAllRead, system, mode } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const utc = useUtcClock();

  const operational = system?.systemOperational !== false;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <header className="ops-topbar">
        <button
          className="ops-topbar-btn lg:hidden"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
        >
          <Menu size={19} />
        </button>

        {/* Search field */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="hidden h-9 w-[300px] items-center gap-2.5 rounded-lg border border-[#1b4058] bg-[#0d3044]/55 px-3 text-left text-sm text-slate-400 backdrop-blur-md transition-colors hover:border-[#2b5c7e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 lg:flex xl:w-[360px]"
          aria-label="Search city, district, alert (press Cmd+K)"
        >
          <Search size={15} className="shrink-0 text-slate-500" />
          <span className="flex-1 truncate">Search city, district, alert...</span>
          <span className="ops-kbd">⌘K</span>
        </button>

        {/* Compact search icon on small screens */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ops-topbar-btn lg:hidden"
          aria-label="Search (Cmd+K)"
        >
          <Search size={18} />
        </button>

        {/* Status pills */}
        <div className="ml-2 hidden items-center gap-2 md:flex">
          <span className="ops-pill">
            <span className={cn("ops-pill-dot", mode === "live" && "on")} />
            {mode === "live" ? "Live Backend" : "Demo Mode"}
          </span>
          <span className="ops-pill">
            <span className={cn("ops-pill-dot", operational && "on")} />
            {operational ? "All Systems Operational" : "System Degraded"}
          </span>
        </div>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden font-mono text-[11px] tracking-tight text-slate-500 md:block">
            {utc}
          </span>

          <button
            className="ops-topbar-btn relative"
            onClick={() => {
              setNotifOpen(true);
              markAllRead();
            }}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          >
            <Bell size={18} />
            {unread > 0 ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-bad-matte ring-2 ring-[#0a2435]/70" />
            ) : null}
          </button>

          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-[#04232b] select-none"
            style={{
              background: "linear-gradient(135deg, #35cfe3 0%, #4ea8ff 100%)",
            }}
            title="Operator profile"
            aria-hidden="true"
          >
            OP
          </span>
        </div>
      </header>

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
      {searchOpen ? <SearchOverlay onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}
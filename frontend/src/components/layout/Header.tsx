import { useState } from "react";
import { Menu, RotateCw, Search, SlidersHorizontal } from "lucide-react";
import { useApp } from "@/state/AppContext";
import { ModeTag } from "./ModeTag";
import HealthIndicator from "./HealthIndicator";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";
import { SearchOverlay } from "@/components/search/SearchOverlay";

function formatIST(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).format(d);
  return parts.toUpperCase().replace(",", " /") + " IST";
}

export function Header({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { system, mode, setMode, unread, markAllRead } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const stale = system?.dataStale ?? false;
  const activeName = system?.activeCyclone?.name ?? "—";
  const operational = system?.systemOperational ?? true;

  return (
    <>
      <header className="header app-header">
        <button
          className="header-icon-btn header-mobile-btn"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>

        {/* Mobile brand — visible only when sidebar is hidden */}
        <div className="header-brand header-brand--mobile">
          <span className="header-brand-title">TOOFAN</span>
          <span className="header-divider" aria-hidden="true" />
          <span className="header-event">
            <span className="val">{activeName}</span>
          </span>
        </div>

        {/* Desktop: event + spacer */}
        <div className="header-brand header-brand--desktop">
          <span className="header-event">
            <span className="lbl">Active Event</span>
            <span className="val">{activeName}</span>
          </span>
          <span className="header-spacer" />
        </div>

        {/* Right controls */}
        <div className="header-right">
          <ModeTag
            mode={mode}
            onToggle={() => setMode(mode === "demo" ? "live" : "demo")}
          />

          <button
            className="header-icon-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Global search"
            title="Search (press /)"
          >
            <Search size={19} />
          </button>

          <div className="header-clock">
            <span className="lbl">Last Update</span>
            <span className="val">
              {stale ? (
                <span style={{ color: "var(--bad)", fontWeight: 900 }}>STALE</span>
              ) : (
                formatIST(system?.lastUpdated)
              )}
            </span>
          </div>

          <span className="live-dot">
            <span
              className="pulse"
              style={{ background: operational ? (stale ? "var(--warn)" : "var(--ok)") : "var(--bad)", color: "var(--ok)" }}
            />
            {stale ? "PARTIAL" : "OPERATIONAL"}
          </span>

          <div style={{ marginLeft: 12 }}>
            <HealthIndicator />
          </div>

          <button
            className="header-icon-btn"
            onClick={() => window.location.reload()}
            aria-label="Refresh data"
            title="Refresh"
          >
            <RotateCw size={19} />
          </button>

          <button
            className="header-icon-btn"
            onClick={() => {
              setNotifOpen(true);
              markAllRead();
            }}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            title="System announcements"
          >
            <span className="pos">
              <SlidersHorizontal size={19} />
              {unread > 0 ? <span className="badge-dot" aria-hidden="true" /> : null}
            </span>
          </button>
        </div>
      </header>

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
      {searchOpen ? <SearchOverlay onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

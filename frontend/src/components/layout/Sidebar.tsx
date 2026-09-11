import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ToofanLogo } from "../common/ToofanLogo";

interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  key: string;
  section: string;
  defaultOpen: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "/dashboard",
    section: "Command",
    defaultOpen: true,
    items: [{ to: "/dashboard", label: "Command Center" }],
  },
  {
    key: "forecast",
    section: "Forecast",
    defaultOpen: true,
    items: [
      { to: "/track", label: "Track" },
      { to: "/intensity", label: "Intensity & RI" },
      { to: "/hazards", label: "Hazards" },
      { to: "/landslide", label: "Landslide" },
      { to: "/recurvature", label: "Recurvature" },
    ],
  },
  {
    key: "analysis",
    section: "Analysis",
    defaultOpen: true,
    items: [
      { to: "/risk", label: "Risk" },
      { to: "/models", label: "Models" },
      { to: "/performance", label: "Performance" },
      { to: "/historical", label: "Historical" },
    ],
  },
  {
    key: "system",
    section: "System",
    defaultOpen: false,
    items: [
      { to: "/data", label: "Data" },
      { to: "/reports", label: "Reports" },
      { to: "/settings", label: "Settings" },
    ],
  },
];

const STORAGE_KEY = "toofan.nav.collapsed";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: Props) {
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const isOpen = (g: NavGroup) =>
    collapsed.includes(g.key) ? false : g.defaultOpen;

  const toggle = (key: string) =>
    setCollapsed((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  let index = 0;

  return (
    <>
      {open ? (
        <div className="scrim" onClick={onClose} aria-hidden="true" />
      ) : null}
      <aside
        className={`sidebar ${open ? "open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="sidebar-brand">
          <ToofanLogo size={36} />
          <div className="sidebar-title">TOOFAN</div>
          <div className="sidebar-sub">Multi-Hazard Intelligence</div>
          <span className="sidebar-demo">
            <span className="dot" aria-hidden="true" /> DEMO
          </span>
        </div>

        <nav className="sidebar-body">
          {NAV_GROUPS.map((grp) => (
            <div className="nav-group" key={grp.key}>
              <button
                type="button"
                className="nav-group-label"
                onClick={() => toggle(grp.key)}
                aria-expanded={isOpen(grp)}
              >
                <span>{grp.section}</span>
                <span className="nav-group-caret" aria-hidden="true">
                  {isOpen(grp) ? "−" : "+"}
                </span>
              </button>
              {isOpen(grp) ? (
                <ul className="nav-list">
                  {grp.items.map((item) => {
                    index += 1;
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.to === "/dashboard"}
                          onClick={onClose}
                          className={({ isActive }) =>
                            `cutout-tab ${isActive ? "active" : ""}`
                          }
                        >
                          <span className="nav-num">{pad(index)}</span>
                          <span className="nav-label">{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-status">
            <span
              className="sidebar-status-dot"
              aria-hidden="true"
            />
            SYSTEM OPERATIONAL
          </span>
          <span className="sidebar-ver">v1.0.0</span>
        </div>
      </aside>
    </>
  );
}

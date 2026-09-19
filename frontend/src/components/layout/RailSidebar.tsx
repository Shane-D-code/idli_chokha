import { NavLink } from "react-router-dom";
import {
  Clock,
  Cpu,
  Database,
  FileText,
  Home,
  Library,
  Map,
  MapPin,
  Radar,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToofanLogo } from "../common/ToofanLogo";
import type { ReactNode } from "react";

interface RailItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const PRIMARY: RailItem[] = [
  { to: "/dashboard", label: "Overview", icon: Home, end: true },
  { to: "/genesis", label: "Genesis", icon: Sparkles },
  { to: "/forecast", label: "Forecast", icon: Map },
  { to: "/impact", label: "Impact", icon: MapPin },
];

const SYSTEM: RailItem[] = [
  { to: "/live", label: "Live", icon: Radar },
  { to: "/models", label: "Models", icon: Cpu },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/data", label: "Data", icon: Database },
  { to: "/settings", label: "Settings", icon: Settings },
];

function RailLink({ to, label, icon: Icon, end }: RailItem) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        cn(
          "relative flex flex-col items-center gap-1 rounded-md py-2.5 text-[10px] font-semibold leading-none transition-colors",
          isActive
            ? "text-cyan-400 before:absolute before:left-0 before:top-1/2 before:h-9 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-cyan-400"
            : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
        )
      }
    >
      <Icon size={19} strokeWidth={2} />
      <span className="pt-1 tracking-wide">{label}</span>
    </NavLink>
  );
}

function RailGroup({ title, items, children }: { title: string; items: RailItem[]; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {title ? (
        <span className="px-2 pb-1 pt-2 text-[6px] font-bold uppercase tracking-[0.18em] text-slate-600">
          {title}
        </span>
      ) : null}
      {items.map((item) => (
        <RailLink key={item.to + item.label} {...item} />
      ))}
      {children}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RailSidebar({ open, onClose }: Props) {
  return (
    <>
      {open ? <div className="scrim ops-rail-scrim" onClick={onClose} aria-hidden="true" /> : null}
      <aside
        className={cn("ops-rail", open && "open")}
        aria-label="Primary navigation"
      >
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-1.5 pt-4 pb-3">
          <ToofanLogo size={30} />
          <span className="font-black text-[10px] tracking-[0.28em] text-slate-100">
            TOO<span className="text-cyan-400">FAN</span>
          </span>
          <span className="px-2 text-center text-[6px] font-bold uppercase leading-relaxed tracking-[0.18em] text-slate-500">
            Cyclone Intelligence
          </span>
        </div>

        {/* Icon nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-1 pb-3" onClick={onClose}>
          <RailGroup title="Mission" items={PRIMARY} />
          <RailGroup title="System" items={SYSTEM}>
            <NavLink
              to="/reports"
              className="relative mt-1 flex flex-col items-center gap-1 rounded-md py-2 text-[10px] font-semibold leading-none text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
              title="Documentation"
            >
              <Library size={19} strokeWidth={2} />
              <span className="pt-1 tracking-wide">Docs</span>
            </NavLink>
          </RailGroup>
        </nav>

        {/* Foot — online status */}
        <div className="flex items-center justify-center gap-1 border-t border-[#1b4058] py-3">
          <span className="flex items-center gap-1.5 text-[7px] font-bold uppercase tracking-[0.14em] text-slate-600">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Online
          </span>
        </div>
        <div className="flex items-center justify-center pb-3 text-[7px] text-slate-700">
          <Clock size={9} className="mr-1" /> v2.0.0
        </div>
      </aside>
    </>
  );
}

export default RailSidebar;
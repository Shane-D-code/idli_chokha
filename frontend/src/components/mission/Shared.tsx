import { useEffect, useRef, useState } from "react";
import type { Provenance } from "@/types/mission";
import type { HazardSeverity } from "@/types";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export function provenanceTone(p: Provenance): string {
  switch (p) {
    case "LIVE":
      return "live";
    case "HISTORICAL":
      return "hist";
    case "SIMULATED":
    case "DEMO":
      return "demo";
    case "UNAVAILABLE":
      return "unavail";
  }
}

export function ProvenancePill({ label }: { label: Provenance | string }) {
  const tone = provenanceTone(label as Provenance);
  return (
    <span className={`m-badge m-badge--${tone}`}>
      <i className="m-badge__dot" />
      {label}
    </span>
  );
}

export function severityClass(sev?: HazardSeverity | null): string {
  if (!sev) return "";
  return "sev-" + sev.toLowerCase().replace("_", "-");
}

export function RiskPill({ severity }: { severity?: HazardSeverity | null }) {
  if (!severity) return <span className="m-risk m-risk--none">—</span>;
  return <span className={`m-risk ${severity.toLowerCase().replace("_", "-")}`}>{severity.replace(/_/g, " ")}</span>;
}

export function SectionHeader({
  index,
  kicker,
  title,
  subtitle,
}: {
  index: string;
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="m-section__head">
      <div className="m-section__index">
        <span className="m-section__num">{index}</span>
        <span className="m-section__rule" />
      </div>
      <div className="m-section__titlewrap">
        <div className="m-section__kicker">{kicker}</div>
        <h2 className="m-section__title">{title}</h2>
        {subtitle ? <p className="m-section__sub">{subtitle}</p> : null}
      </div>
    </header>
  );
}

/** Animated numeric readout. Freezes under prefers-reduced-motion. */
export function CountUp({ value, decimals = 0, duration = 900 }: { value: number; decimals?: number; duration?: number }) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    const from = display;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * e);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduced]);

  return <>{display.toFixed(decimals)}</>;
}

export function Kpi({ label, value, unit, sub, tone = "default" }: { label: string; value: React.ReactNode; unit?: string; sub?: string; tone?: "default" | "cyan" | "amber" | "red" }) {
  return (
    <div className={`m-kpi m-kpi--${tone}`}>
      <span className="m-kpi__label">{label}</span>
      <span className="m-kpi__value">
        {value}
        {unit ? <span className="m-kpi__unit"> {unit}</span> : null}
      </span>
      {sub ? <span className="m-kpi__sub">{sub}</span> : null}
    </div>
  );
}

export function MissionSkeleton({ rows = 4, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="m-skeleton" aria-busy="true" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="m-skeleton__row" style={{ height }} />
      ))}
    </div>
  );
}

export function utcLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().replace("T", " ")?.slice(0, 16)}Z`;
}

export function istLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
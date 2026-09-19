import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { ProbabilityBand } from "./genesisModel";
import { bandTone, pct, thresholdState } from "./genesisModel";

const TAU = Math.PI * 2;

interface ProbabilityRingProps {
  value: number | null;
  band: ProbabilityBand | null;
  size?: number;
  stroke?: number;
  ariaLabel: string;
}

function ProbabilityRing({ value, band, size = 76, stroke = 5, ariaLabel }: ProbabilityRingProps) {
  const reduced = usePrefersReducedMotion();
  const [anim, setAnim] = useState(reduced || value == null ? 0 : 0);

  useEffect(() => {
    if (value == null) { setAnim(0); return; }
    if (reduced) { setAnim(value); return; }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const duration = 850;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setAnim(from + (value - from) * ease);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  const radius = (size - stroke) / 2;
  const circumference = radius * TAU;
  const fraction = Math.max(0, Math.min(1, anim));
  const offset = circumference * (1 - fraction);

  const toneClass =
    band === "MODERATE" ? "m-g-ring--moderate" :
    band === "HIGH" || band === "EXTREME" ? "m-g-ring--high" :
    "m-g-ring--low";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`m-g-ring ${toneClass}`}
      role="img"
      aria-label={ariaLabel}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--surface-3)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: reduced ? "none" : "stroke-dashoffset 850ms cubic-bezier(.4,0,.2,1)" }}
      />
    </svg>
  );
}

interface GenesisProbabilityCardProps {
  horizonLabel: string;
  hours: string;
  value: number | null;
  threshold: number | null;
  status: ProbabilityBand | null;
}

export function GenesisProbabilityCard({
  horizonLabel,
  hours,
  value,
  threshold,
  status,
}: GenesisProbabilityCardProps) {
  const binaryThreshold = threshold != null ? thresholdState(value, threshold) : "NONE";
  const available = value != null;

  return (
    <div
      className="m-g-panel m-g-panel--prob m-g-prob"
      role="region"
      aria-label={`${horizonLabel} genesis probability: ${pct(value, 1)} percent — ${status ?? "unavailable"}`}
    >
      <div className="m-g-panel__top">
        <span className="m-g-panel__kicker">
          GENESIS · {hours}
        </span>
      </div>

      <div className="m-g-prob__center">
        <ProbabilityRing
          value={value}
          band={status}
          ariaLabel={`${pct(value, 1)} percent over ${horizonLabel}`}
        />
        <div className="m-g-prob__body">
          <span className="m-g-prob__value" aria-label={`${pct(value, 1)} percent`}>
            {pct(value, 1)}<span className="m-g-prob__unit">%</span>
          </span>
          <span className={`m-g-band m-g-band--${status ? bandTone(status) : "none"}`}>
            {status ?? "UNAVAILABLE"}
          </span>
          {available && threshold != null && (
            <span
              className={`m-g-chip ${
                binaryThreshold === "ABOVE" ? "m-g-chip--above" : "m-g-chip--below"
              }`}
            >
              {binaryThreshold === "ABOVE" ? "ABOVE" : "BELOW"} THRESH.
            </span>
          )}
        </div>
      </div>

      <div className="m-g-panel__foot mono muted">
        <span>THRESHOLD {threshold ?? "—"}</span>
      </div>
    </div>
  );
}
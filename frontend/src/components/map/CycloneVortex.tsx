/**
 * CycloneVortex — compact satellite-inspired cyclone renderer.
 *
 * Translates a modelled storm into the visual language of a weather-satellite
 * composite, not a UI marker:
 *   - asymmetric, irregular white/grey cloud mass (NEVER a perfect circle)
 *   - soft grayscale cloud texture built from blurred, nested cloud patches
 *   - a handful of curved spiral rain bands sweeping gently inward
 *   - slightly darker outer cloud field fading toward the storm
 *   - a small, warm-tinted central eye (5–9% of the storm diameter)
 *   - slow internal rotation only (CSS, respects prefers-reduced-motion)
 *
 * The geographic anchor (the MapLibre Marker element) never rotates; only the
 * internal cloud/spiral group spins, so the storm reads motion, not UI.
 *
 * `marker={false}` renders the pure satellite structure used by the forecast
 * theatre (no position ring, no movement arrow).
 */

import { useMemo } from "react";

export interface CycloneVortexProps {
  /** Storm diameter in pixels (default 64). Eye stays small (~8% of size). */
  size?: number;
  /** Movement bearing in degrees (0=N, clockwise). */
  bearing?: number | null;
  /** Whether the vortex is currently selected/active. */
  selected?: boolean;
  /**
   * When false the vortex renders as a pure satellite-storm structure —
   * NO dashed position ring, NO movement arrow. Used by the forecast theatre.
   */
  marker?: boolean;
}

const ACCENT = "229,83,60"; // critical-red movement indicator

/** Irregular closed blob path (midpoint-smoothed) around cx,cy. */
function blobPath(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  wobble: number,
  points = 10,
): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2 + seed * 1.7;
    const rnd =
      seed * 7 * Math.abs(Math.sin(seed * (i + 1) * 13.7) + Math.cos(seed * (i + 1) * 7.3));
    const r = radius * (1 + wobble * (0.5 - (rnd % 1)));
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % pts.length];
    const mx = (p[0] + n[0]) / 2;
    const my = (p[1] + n[1]) / 2;
    d += ` Q ${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  d += " Z";
  return d;
}

/** Curved spiral rain-band path data (inward sweep, organic jitter). */
function spiralBand(
  cx: number,
  cy: number,
  r: number,
  arms: number,
  turns: number,
): string[] {
  const paths: string[] = [];
  const step = 0.05;
  const totalSteps = Math.ceil((turns * 2 * Math.PI) / step);
  for (let arm = 0; arm < arms; arm++) {
    const offset = (arm * 2 * Math.PI) / arms + arm * 0.55;
    let d = "";
    let first = true;
    for (let i = 0; i <= totalSteps; i++) {
      const angle = offset + i * step;
      const progress = i / totalSteps;
      const jitterR = 1 + 0.09 * Math.sin(i * 1.4 + arm * 2.3);
      const radius = r * (1 - progress * 0.82) * jitterR;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      d += first ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      first = false;
    }
    paths.push(d);
  }
  return paths;
}

export function CycloneVortex({
  size = 64,
  bearing: moveBearing,
  selected = false,
  marker = true,
}: CycloneVortexProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;
  const eyeR = Math.max(5, size * 0.12);
  const spiralR = size * 0.46;

  const bands = useMemo(() => spiralBand(cx, cy, spiralR, 5, 1.6), [cx, cy, spiralR]);

  // Asymmetric cloud mass — a handful of overlapping grey blobs centred
  // slightly off the eye, so the storm never reads as a perfect circle.
  const cloudPatches = useMemo(() => {
    const patches: {
      d: string;
      ox: number;
      oy: number;
      fill: string;
      opacity: number;
      blur: number;
    }[] = [];
    const offX = size * 0.06; // storm mass biased east (typical 10–11 AM orbits)
    const offY = -size * 0.03;
    const corners = [
      [-0.62, -0.5, 0.34, "rgba(246,248,250,0.98)", 0.92, 0.07],
      [0.6, -0.42, 0.3, "rgba(238,241,244,0.95)", 0.9, 0.09],
      [0.5, 0.55, 0.36, "rgba(243,245,247,0.94)", 0.92, 0.09],
      [-0.5, 0.58, 0.3, "rgba(249,250,251,0.96)", 0.9, 0.07],
      [-0.72, 0.05, 0.26, "rgba(228,232,236,0.92)", 0.86, 0.1],
      [0.72, 0.08, 0.24, "rgba(240,242,245,0.9)", 0.88, 0.09],
      [0.02, -0.68, 0.28, "rgba(250,251,252,0.96)", 0.92, 0.07],
      [-0.08, 0.7, 0.27, "rgba(246,248,249,0.94)", 0.9, 0.07],
    ];
    corners.forEach(([x, y, r, fill, opacity, blur], i) => {
      patches.push({
        d: blobPath(cx + offX + (x as number) * outerR, cy + offY + (y as number) * outerR, outerR * (r as number), i + 1, 0.5),
        ox: cx + offX + (x as number) * outerR,
        oy: cy + offY + (y as number) * outerR,
        fill: fill as string,
        opacity: opacity as number,
        blur: (blur as number) * size,
      });
    });
    return patches;
  }, [cx, cy, outerR, size]);

  // Slightly darker outer cloud field — the broad circulation canopy.
  const outerField = useMemo(
    () => blobPath(cx, cy, outerR * 0.95, 3, 0.16, 12),
    [cx, cy, outerR],
  );

  const ringR = outerR + 9;

  const blurId = useMemo(() => `cv-blur-${Math.round(size)}`.replace(".", "-"), [size]);

  return (
    <div
      className={`cyclone-vortex-wrap ${selected ? "selected" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="cyclone-vortex-svg"
      >
        <defs>
          <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={Math.max(0.8, size * 0.05)} />
          </filter>
          <filter id={`${blurId}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={Math.max(0.5, size * 0.03)} />
          </filter>
          <radialGradient id={`${blurId}-base`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(240,244,248,0.98)" />
            <stop offset="55%" stopColor="rgba(212,220,228,0.8)" />
            <stop offset="100%" stopColor="rgba(150,162,174,0.28)" />
          </radialGradient>
          <radialGradient id={`${blurId}-eye`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,254,250,0.98)" />
            <stop offset="60%" stopColor="rgba(250,247,240,0.75)" />
            <stop offset="100%" stopColor="rgba(238,235,226,0.25)" />
          </radialGradient>
          <radialGradient id="cv-outer-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(150,160,170,0.42)" />
            <stop offset="70%" stopColor="rgba(120,130,140,0.24)" />
            <stop offset="100%" stopColor="rgba(96,106,116,0.12)" />
          </radialGradient>
          {/* Dark rim — separates the bright cloud mass from the deep ocean */}
          <radialGradient id="cv-rim-grad" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="rgba(5,24,32,0)" />
            <stop offset="82%" stopColor="rgba(6,38,50,0.55)" />
            <stop offset="100%" stopColor="rgba(8,50,64,0.12)" />
          </radialGradient>
        </defs>

        {/* Broad outer circulation canopy — darker, large, blurred
            (also provides the rim that lifts the storm off the basemap) */}
        <g filter={`url(#${blurId}-soft)`}>
          <path d={outerField} fill="url(#cv-rim-grad)" opacity={0.9} />
        </g>

        {/* Main greyscale cloud mass — irregular patches, hard to see edges */}
        <g filter={`url(#${blurId})`}>
          <circle cx={cx} cy={cy} r={outerR * 0.72} fill={`url(#${blurId}-base)`} opacity={0.95} />
          {cloudPatches.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill={p.fill}
              opacity={p.opacity}
            />
          ))}
        </g>

        {/* Inner stratified layers — denser warm-grey core around the eye */}
        <g filter={`url(#${blurId}-soft)`} opacity={0.95}>
          <circle cx={cx} cy={cy} r={outerR * 0.4} fill="rgba(208,212,216,0.6)" />
          <circle cx={cx + size * 0.05} cy={cy - size * 0.02} r={outerR * 0.26} fill="rgba(224,228,230,0.65)" />
        </g>

        {/* Spiral rain bands — the rotation lives here */}
        <g className="cv-spiral-rotate">
          {bands.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={`rgba(238,241,243,${0.34 + (i % 5) * 0.05})`}
              strokeWidth={size * (0.012 + (i % 5) * 0.003)}
              strokeLinecap="round"
              opacity={0.6 - (i % 5) * 0.08}
            />
          ))}
          {/* Faint warm vortex hint just outside the eye */}
          <circle
            cx={cx}
            cy={cy}
            r={eyeR * 2.1}
            fill="none"
            stroke="rgba(240,218,190,0.35)"
            strokeWidth={size * 0.018}
          />
        </g>

        {/* The edge of the eye — tight, bright, small */}
        <circle cx={cx} cy={cy} r={eyeR * 1.5} fill={`url(#${blurId}-eye)`} />
        <circle cx={cx} cy={cy} r={eyeR} fill="rgba(255,254,249,0.96)" />

        {/* Movement indicator — dashed position ring + arrow (map marker mode only) */}
        {marker && (
          <>
            <circle
              cx={cx}
              cy={cy}
              r={ringR}
              fill="none"
              stroke={selected ? `rgba(${ACCENT},0.42)` : `rgba(${ACCENT},0.26)`}
              strokeWidth={1}
              strokeDasharray="2 3"
              className="cv-position-ring"
            />
            {moveBearing != null && (
              <g className="cv-direction" style={{ transform: `rotate(${moveBearing}deg)` }}>
                <line
                  x1={cx}
                  y1={cy - ringR - 3}
                  x2={cx}
                  y2={cy - ringR - size * 0.2}
                  stroke={`rgba(${ACCENT},0.85)`}
                  strokeWidth={size * 0.04}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${cx},${cy - ringR - size * 0.27} ${cx - size * 0.05},${cy - ringR - size * 0.14} ${cx + size * 0.05},${cy - ringR - size * 0.14}`}
                  fill={`rgba(${ACCENT},0.85)`}
                />
              </g>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
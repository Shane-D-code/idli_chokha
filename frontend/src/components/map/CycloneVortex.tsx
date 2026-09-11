/**
 * CycloneVortex — SVG cyclonic storm visualization.
 *
 * Renders a compact rotating atmospheric system that reads like a
 * satellite-observed storm translated into a clean vector form:
 *  - organic, irregular outer cloud accumulation (NOT a perfect circle)
 *  - 4 curved spiral cloud bands sweeping toward the eye
 *  - small, high-contrast central eye
 *  - slow internal rotation (CSS, 12s/rev, respects prefers-reduced-motion)
 *  - thin current-position ring
 *  - movement-direction arrow
 *
 * Only the internal cloud/spiral rotates; the geographical anchor (the map
 * marker element) never rotates. See CycloneMap.tsx for georeferencing.
 */

import { useMemo } from "react";

export interface CycloneVortexProps {
  /** Diameter in pixels (default 52). */
  size?: number;
  /** Movement bearing in degrees (0=N, clockwise). */
  bearing?: number | null;
  /** Whether the vortex is currently selected/active. */
  selected?: boolean;
}

const INK = "196,226,226";        // pale cloud white-cyan (contrasts on deep ocean)
const ACCENT = "232,77,61";       // warm red movement indicator
const CLOUD = "148,200,204";      // muted teal cloud arcs

/** Generate a closed, irregular organic blob path centered near cx,cy. */
function blobPath(
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  wobble: number,
  points = 9,
): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const rnd =
      seed * 7 * Math.abs(Math.sin(seed * (i + 1) * 13.7) + Math.cos(seed * (i + 1) * 7.3));
    const r = radius * (1 + wobble * (0.5 - (rnd % 1)));
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  // Catmull-Rom-ish smoothing via quadratic curves through midpoints.
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

/** Generate curved spiral cloud-band path data (inward sweep), nested. */
function spiralBand(
  cx: number,
  cy: number,
  r: number,
  arms: number,
  turns: number,
  nest = 1,
): string[] {
  const paths: string[] = [];
  const step = 0.05;
  const totalSteps = Math.ceil((turns * 2 * Math.PI) / step);
  for (let nestIdx = 0; nestIdx < nest; nestIdx++) {
    const nestScale = 1 - nestIdx * 0.28;
    for (let arm = 0; arm < arms; arm++) {
      const offset = (arm * 2 * Math.PI) / arms + arm * 0.5 + nestIdx * 0.9;
      let d = "";
      let first = true;
      for (let i = 0; i <= totalSteps; i++) {
        const angle = offset + i * step;
        const progress = i / totalSteps;
        // Slight jitter makes the band feel organic.
        const jitterR = 1 + 0.06 * Math.sin(i * 1.6 + arm * 2.1 + nestIdx * 3.0);
        const radius = r * nestScale * (1 - progress * 0.8) * jitterR;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        d += first
          ? `M ${x.toFixed(1)} ${y.toFixed(1)}`
          : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        first = false;
      }
      paths.push(d);
    }
  }
  return paths;
}

export function CycloneVortex({
  size = 52,
  bearing: moveBearing,
  selected = false,
}: CycloneVortexProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2;
  const eyeR = Math.max(3, size * 0.07);
  const innerR = size * 0.2;
  const spiralR = size * 0.4;

  const bands = useMemo(() => spiralBand(cx, cy, spiralR, 4, 1.9, 2), [cx, cy, spiralR]);

  // Organic outer cloud mass — irregular blobs hugging the circumference.
  const outerBlobs = useMemo(() => {
    const blobs: { d: string; o: number }[] = [];
    const r = outerR * 0.86;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.4;
      const bx = cx + Math.cos(angle) * r;
      const by = cy + Math.sin(angle) * r;
      blobs.push({
        d: blobPath(bx, by, outerR * (0.34 + (i % 3) * 0.04), i + 1, 0.55, 8),
        o: 0.14 + (i % 3) * 0.05,
      });
    }
    return blobs;
  }, [cx, cy, outerR]);

  const ringR = outerR + 9;

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
          <filter id={`cv-soft-${size}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={Math.max(0.6, size * 0.045)} />
          </filter>
        </defs>

        {/* Soft outer circulation — low opacity, blurred cloud field */}
        <g className="cv-cloud-field" filter={`url(#cv-soft-${size})`} opacity={0.8}>
          {outerBlobs.slice(0, 7).map((b, i) => (
            <path
              key={i}
              d={b.d}
              fill={`rgba(${INK},${0.13 + i * 0.03})`}
              opacity={b.o}
            />
          ))}
          <circle
            cx={cx}
            cy={cy}
            r={outerR * 1.0}
            fill={`rgba(${INK},0.08)`}
          />
        </g>

        {/* Crisper leading cloud arcs (warm tinted, subtle) */}
        <g className="cv-cloud-arcs" opacity={0.4}>
          {outerBlobs.slice(3, 8).map((b, i) => (
            <path
              key={i}
              d={b.d}
              fill="none"
              stroke={`rgba(${CLOUD},0.45)`}
              strokeWidth={size * 0.022}
            />
          ))}
        </g>

        {/* Position ring — thin current-position indicator (static) */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke={selected ? `rgba(${ACCENT},0.5)` : `rgba(${ACCENT},0.3)`}
          strokeWidth={1}
          strokeDasharray="2 3"
          className="cv-position-ring"
        />

        {/* Rotating internal vortex */}
        <g className="cv-spiral-rotate">
          {bands.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={`rgba(${INK},${0.42 + i * 0.05})`}
              strokeWidth={size * (0.04 - (i % 4) * 0.005)}
              strokeLinecap="round"
              opacity={0.75 - (i % 4) * 0.12}
            />
          ))}

          {/* Inner vortex ring */}
          <circle
            cx={cx}
            cy={cy}
            r={innerR}
            fill={`rgba(${INK},0.07)`}
            stroke={`rgba(${INK},0.32)`}
            strokeWidth={size * 0.028}
          />
        </g>

        {/* Eye — small, clear, high contrast */}
        <circle
          cx={cx}
          cy={cy}
          r={eyeR}
          fill="rgba(255,253,246,0.97)"
          stroke={`rgba(${INK},0.85)`}
          strokeWidth={size * 0.035}
        />

        {/* Movement indicator */}
        {moveBearing != null && (
          <g className="cv-direction" style={{ transform: `rotate(${moveBearing}deg)` }}>
            <line
              x1={cx}
              y1={cy - ringR - 3}
              x2={cx}
              y2={cy - ringR - size * 0.2}
              stroke={`rgba(${ACCENT},0.9)`}
              strokeWidth={size * 0.045}
              strokeLinecap="round"
            />
            <polygon
              points={`${cx},${cy - ringR - size * 0.27} ${cx - size * 0.055},${cy - ringR - size * 0.15} ${cx + size * 0.055},${cy - ringR - size * 0.15}`}
              fill={`rgba(${ACCENT},0.9)`}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * contourLayer — Procedural atmospheric isoline field for the TOOFAN map.
 *
 * Generates a continuous scalar field from large-scale oscillations,
 * domain-warped domain distortions, and cyclonic structures. Marching-squares
 * extraction produces flowing, organic isolines that resemble scientific
 * atmospheric/oceanographic contour maps.
 *
 * The field features:
 *  - Large-scale atmospheric structures spanning hundreds of km
 *  - Nested contour rings around multiple field centres
 *  - Cyclonic vortex at the active storm position
 *  - Varying density: sparse far away, dense near centres
 *  - Both closed and open flowing contours
 *
 * This is cartographic decoration, NOT real meteorological data.
 */

const CANVAS_W = 2048;
const CANVAS_H = 2200;

/* ── Palette ──────────────────────────────────────────────────────── */

/** Pale desaturated teal — primary contour colour. */
const PRIMARY   = [125, 191, 192];  // #7DBFC0
/** Muted green — secondary contour colour. */
const SECONDARY = [143, 175, 88];   // #8FAF58
/** Olive / chartreuse — accent contours. */
const ACCENT    = [162, 190, 101];  // #A2BE65
/** Lighter aqua — tertiary / fine contours. */
const TERTIARY  = [169, 217, 216];  // #A9D9D8

/* ── Deterministic value noise ────────────────────────────────────── */

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** Bilinearly-interpolated value noise, tiled. */
function vnoise(x: number, y: number, grid: number): number {
  const cx = x * grid;
  const cy = y * grid;
  const x0 = Math.floor(cx) % grid;
  const y0 = Math.floor(cy) % grid;
  const x1 = (x0 + 1) % grid;
  const y1 = (y0 + 1) % grid;
  const tx = cx - Math.floor(cx);
  const ty = cy - Math.floor(cy);
  const n00 = hash2(x0, y0);
  const n10 = hash2(x1, y0);
  const n01 = hash2(x0, y1);
  const n11 = hash2(x1, y1);
  return (
    n00 * (1 - tx) * (1 - ty) +
    n10 * tx * (1 - ty) +
    n01 * (1 - tx) * ty +
    n11 * tx * ty
  );
}

/** Fractal Brownian Motion — low-frequency organic variation. */
function fbm(x: number, y: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += vnoise(x * freq, y * freq, 8) * amp;
    amp *= 0.5;
    freq *= 2.13;
  }
  return value;
}

/* ── Marching-squares isoline extraction ──────────────────────────── */

interface Segment { x0: number; y0: number; x1: number; y1: number; }

/** Estimate the p-th percentile (0..1) of a float array via partial sampling. */
function percentile(arr: Float32Array, p: number): number {
  const n = arr.length;
  // Sample a bounded subset for speed on large canvases.
  const sampleSize = Math.min(n, 12000);
  const step = Math.floor(n / sampleSize) || 1;
  const vals: number[] = [];
  for (let i = 0; i < n; i += step) {
    vals.push(arr[i]);
  }
  if (vals.length === 0) return 0;
  vals.sort((a, b) => a - b);
  const idxPos = Math.min(vals.length - 1, Math.floor((vals.length - 1) * p));
  return vals[idxPos];
}

function extractIsolines(
  sample: (i: number, j: number) => number,
  cols: number,
  rows: number,
  level: number,
): Segment[] {
  const segs: Segment[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const v00 = sample(i, j);
      const v10 = sample(i + 1, j);
      const v01 = sample(i, j + 1);
      const v11 = sample(i + 1, j + 1);

      const cross = (a: number, b: number): number | null => {
        const d = b - a;
        if (d === 0) return null;
        const t = (level - a) / d;
        if (t <= 0 || t >= 1) return null;
        return t;
      };

      const tTop    = cross(v00, v10);
      const tRight  = cross(v10, v11);
      const tBottom = cross(v01, v11);
      const tLeft   = cross(v00, v01);

      const pts: Record<number, [number, number]> = {};
      if (tTop != null)    pts[0] = [i + tTop, j];
      if (tRight != null)  pts[1] = [i + 1, j + tRight];
      if (tBottom != null) pts[2] = [i + tBottom, j + 1];
      if (tLeft != null)   pts[3] = [i, j + tLeft];

      const edgeIds = Object.keys(pts).map(Number);
      if (edgeIds.length === 0) continue;
      if (edgeIds.length === 4) {
        segs.push(
          { x0: pts[0][0], y0: pts[0][1], x1: pts[2][0], y1: pts[2][1] },
          { x0: pts[1][0], y0: pts[1][1], x1: pts[3][0], y1: pts[3][1] },
        );
        continue;
      }
      if (edgeIds.length === 2) {
        const a = pts[edgeIds[0]];
        const b = pts[edgeIds[1]];
        segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
      }
    }
  }
  return segs;
}

/* ── Atmospheric field centres (pre-seeded structures) ────────────── */

interface FieldCentre {
  /** Normalised [0,1] position on the canvas. */
  nx: number;
  ny: number;
  /** Radial extent (normalised). */
  radius: number;
  /** Depth: how much it pushes/pulls the field. */
  depth: number;
  /** Tightness: 0 = broad, 1 = tight rings. */
  tightness: number;
}

/**
 * Fixed atmospheric centres that create persistent large-scale structures.
 * Positioned over the Bay of Bengal, Arabian Sea, and equatorial Indian Ocean.
 */
const FIELD_CENTRES: FieldCentre[] = [
  // Bay of Bengal ridge — broad anticyclone-like structure
  { nx: 0.62, ny: 0.42, radius: 0.28, depth: 0.7, tightness: 0.35 },
  // Arabian Sea circulation
  { nx: 0.28, ny: 0.38, radius: 0.24, depth: 0.55, tightness: 0.4 },
  // Equatorial Indian Ocean trough
  { nx: 0.50, ny: 0.62, radius: 0.32, depth: 0.5, tightness: 0.3 },
  // Southern Indian Ocean structure
  { nx: 0.42, ny: 0.78, radius: 0.22, depth: 0.45, tightness: 0.38 },
  // Western Pacific extension
  { nx: 0.88, ny: 0.48, radius: 0.20, depth: 0.4, tightness: 0.42 },
];

/* ── CanvasSource class ───────────────────────────────────────────── */

export class ContourCanvasSource {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentZoom = -1;
  private lastRenderedZoom = -1;

  private geoWest = 58;
  private geoSouth = -2;
  private geoEast = 108;
  private geoNorth = 40;

  private focalX: number | null = null;
  private focalY: number | null = null;
  private focalStrength = 0;
  private focalDirty = true;

  primaryRGB    = PRIMARY;
  secondaryRGB  = SECONDARY;
  tertiaryRGB   = TERTIARY;
  accentRGB     = ACCENT;
  baseOpacity   = 0.32;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width  = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext("2d")!;
  }

  setBounds(west: number, south: number, east: number, north: number): void {
    this.geoWest = west;
    this.geoSouth = south;
    this.geoEast = east;
    this.geoNorth = north;
  }

  setFocal(lat: number | null, lon: number | null, strength = 1.0): void {
    if (lat == null || lon == null) {
      this.focalX = null;
      this.focalY = null;
      this.focalStrength = 0;
      this.focalDirty = true;
      return;
    }
    const nx = (lon - this.geoWest) / (this.geoEast - this.geoWest);
    const ny = (lat - this.geoSouth) / (this.geoNorth - this.geoSouth);
    this.focalX = Math.max(0, Math.min(1, nx));
    this.focalY = Math.max(0, Math.min(1, ny));
    this.focalStrength = strength;
    this.focalDirty = true;
  }

  refresh(): void {
    this.focalDirty = true;
    this.lastRenderedZoom = -1;
    this.draw();
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  get dimensions() {
    return { width: CANVAS_W, height: CANVAS_H };
  }

  render(zoom: number): void {
    this.currentZoom = zoom;
    if (Math.abs(zoom - this.lastRenderedZoom) < 0.35 && !this.focalDirty) return;
    this.lastRenderedZoom = zoom;
    this.focalDirty = false;
    this.draw();
  }

  private stepForZoom(zoom: number): number {
    return Math.max(5, Math.round(26 - zoom * 2.2));
  }

  /* ── Field evaluation ───────────────────────────────────────────── */

  private buildField(
    w: number,
    h: number,
    step: number,
  ): { field: Float32Array; cols: number; rows: number } {
    const cols = Math.ceil(w / step) + 1;
    const rows = Math.ceil(h / step) + 1;
    const field = new Float32Array(cols * rows);

    // Precompute domain warping for organic flow
    const warpX = new Float32Array(cols * rows);
    const warpY = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const px = i / cols;
        const py = j / rows;
        const idx = j * cols + i;
        warpX[idx] = px + fbm(px * 1.3, py * 1.3) * 0.18;
        warpY[idx] = py + fbm(px * 1.3 + 5.2, py * 1.3 + 5.2) * 0.18;
      }
    }

    const sampleWarp = (cx: number, cy: number) => {
      const ci = Math.max(0, Math.min(cols - 1, Math.round(cx * cols)));
      const cj = Math.max(0, Math.min(rows - 1, Math.round(cy * rows)));
      return { x: warpX[cj * cols + ci], y: warpY[cj * cols + ci] };
    };

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const px = i / cols;
        const py = j / rows;
        const w2 = sampleWarp(px, py);
        let value = 0;

        // ── Large-scale atmospheric oscillations ──
        // These create the BIG SMOOTH SHAPES that dominate the visual field.
        // Each sine/cosine pair forms one large "lobe" of the atmospheric pattern.

        // Monsoon trough — wide E-W band
        value += 0.30 * Math.sin(w2.x * 3.5 + 0.8);
        // ITCZ-like equatorial oscillation
        value += 0.25 * Math.cos(w2.y * 4.2 - 0.3);
        // Bay of Bengal ridge — large NE-SW structure
        value += 0.22 * Math.sin((w2.x + w2.y) * 2.8 + 1.1);
        // Arabian Sea influence
        value += 0.18 * Math.cos((w2.x - w2.y) * 2.2 - 0.7);
        // Southern hemisphere wave
        value += 0.15 * Math.sin(w2.x * 5.0 - w2.y * 2.0 + 2.5);
        // Upper-level outflow pattern
        value += 0.12 * Math.cos(w2.x * 1.8 + w2.y * 3.5 - 1.2);
        // Secondary oscillation for complexity
        value += 0.10 * Math.sin(w2.y * 6.0 + w2.x * 1.5 + 0.4);
        // Broad background variation
        value += 0.08 * Math.cos(w2.x * 2.5 - 2.0);

        // ── Organic noise modulation ──
        // Adds natural irregularity so contours don't look like perfect sine waves.
        value += fbm(w2.x * 2.5 + 0.3, w2.y * 2.5 + 0.9) * 0.30;
        value += fbm(w2.x * 4.8 + 7.0, w2.y * 4.8 + 7.0) * 0.12;

        // ── Pre-seeded atmospheric centres ──
        for (const c of FIELD_CENTRES) {
          const dx = px - c.nx;
          const dy = py - c.ny;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const norm = dist / c.radius;
          if (norm < 2.0) {
            // Wrapping spiral modulation
            const angle = Math.atan2(dy, dx);
            const spiral = Math.sin(angle * 2.5 + norm * 8.0) * 0.3;
            const radial = Math.cos(norm * Math.PI) * 0.7;
            value += c.depth * (radial + spiral) * Math.exp(-norm * norm * 0.8);
          }
        }

        // ── Cyclone focal vortex ──
        if (this.focalX != null && this.focalY != null) {
          const dx = px - this.focalX;
          const dy = py - this.focalY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          // Deep radial well — creates the central low
          const well = -0.65 * this.focalStrength * Math.exp(-dist * dist / 0.015);

          // Spiral bands wrapping inward
          const spiralPhase = angle + dist * 35.0;
          const spiralAmp = 0.28 * this.focalStrength * Math.exp(-dist * dist / 0.04);
          const spiral = spiralAmp * Math.sin(spiralPhase);

          // Concentric ring structure
          const ringFreq = 22.0;
          const ringAmp = 0.18 * this.focalStrength * Math.exp(-dist / 0.18);
          const rings = ringAmp * Math.cos(dist * ringFreq);

          // Tight nested contours near the eye
          const eyeWell = -0.35 * this.focalStrength * Math.exp(-dist * dist / 0.004);

          value += well + spiral + rings + eyeWell;
        }

        field[j * cols + i] = value;
      }
    }

    return { field, cols, rows };
  }

  /* ── Main draw ──────────────────────────────────────────────────── */

  private draw(): void {
    const w = CANVAS_W;
    const h = CANVAS_H;
    const ctx = this.ctx;
    const zoom = this.currentZoom;

    ctx.clearRect(0, 0, w, h);

    const step = this.stepForZoom(zoom);
    const { field, cols, rows } = this.buildField(w, h, step);

    // Normalise the field to a canonical [-1, 1] range so the isoline levels
    // always spread faithfully across the field regardless of the absolute
    // magnitude of the individual components. Use a robust 2nd–98th percentile
    // spread so the deep localised cyclone well does not stretch the whole scale.
    const lo = percentile(field, 0.02);
    const hi = percentile(field, 0.98);
    const spanV = (hi - lo) || 1;
    const sample = (i: number, j: number) => {
      const v = field[j * cols + i];
      return Math.max(-1, Math.min(1, (v - lo) / spanV * 2 - 1));
    };

    // ── Contour levels ──
    // 15 levels spanning the normalised field. Density varies because field
    // gradients are steeper near centres (more lines) and gentler in sparse
    // regions (fewer lines).
    const levels = [
      -0.95, -0.78, -0.61, -0.44, -0.27,
      -0.11,  0.05,  0.19,  0.33,  0.47,
       0.61,  0.75,  0.87,  0.97,  1.04,
    ];

    // Colour and style per level index
    const levelStyle = (idx: number) => {
      const major = idx % 5 === 0;
      const mid   = idx % 5 === 2 || idx % 5 === 3;
      if (major) {
        return {
          color: this.primaryRGB,
          width: 1.4,
          opacity: this.baseOpacity * 1.2,
        };
      }
      if (mid) {
        return {
          color: this.secondaryRGB,
          width: 1.0,
          opacity: this.baseOpacity * 0.95,
        };
      }
      // Minor contours — alternate between tertiary and accent
      const isAccent = idx % 2 === 0;
      return {
        color: isAccent ? this.accentRGB : this.tertiaryRGB,
        width: 0.8,
        opacity: this.baseOpacity * 0.65,
      };
    };

    const edgeFade = 140;

    for (let l = 0; l < levels.length; l++) {
      const level = levels[l];
      const style = levelStyle(l);
      const segs = extractIsolines(sample, cols, rows, level);

      const core: Segment[] = [];
      const fringe: Segment[] = [];

      for (const s of segs) {
        const x0 = s.x0 * step;
        const y0 = s.y0 * step;
        const x1 = s.x1 * step;
        const y1 = s.y1 * step;
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        if (mx < -2 || mx > w + 2 || my < -2 || my > h + 2) continue;
        const dEdge = Math.min(mx, w - mx, my, h - my);
        (dEdge < edgeFade ? fringe : core).push({ x0, y0, x1, y1 });
      }

      // Draw core segments
      if (core.length > 0) {
        ctx.strokeStyle = `rgba(${style.color[0]},${style.color[1]},${style.color[2]},${style.opacity.toFixed(3)})`;
        ctx.lineWidth   = style.width;
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.beginPath();
        for (const s of core) {
          ctx.moveTo(s.x0, s.y0);
          ctx.lineTo(s.x1, s.y1);
        }
        ctx.stroke();
      }

      // Draw fringe segments — fade toward border
      if (fringe.length > 0) {
        ctx.strokeStyle = `rgba(${style.color[0]},${style.color[1]},${style.color[2]},${(style.opacity * 0.3).toFixed(3)})`;
        ctx.lineWidth   = style.width * 0.85;
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.beginPath();
        for (const s of fringe) {
          ctx.moveTo(s.x0, s.y0);
          ctx.lineTo(s.x1, s.y1);
        }
        ctx.stroke();
      }
    }

    // ── Large-scale flowing current lines ──
    this.drawCurrents(ctx, w, h);
  }

  /* ── Large flowing current lines ─────────────────────────────────── */

  private drawCurrents(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // A few long, sweeping curves that span the entire field — reads as
    // large-scale atmospheric / oceanic circulation.
    const currents = [
      { baseY: 0.25, amp: 0.14, freq: 1.8, phase: 0 },
      { baseY: 0.45, amp: 0.10, freq: 2.3, phase: 1.2 },
      { baseY: 0.65, amp: 0.16, freq: 1.5, phase: 2.8 },
      { baseY: 0.82, amp: 0.12, freq: 2.0, phase: 0.7 },
    ];

    for (let c = 0; c < currents.length; c++) {
      const cur = currents[c];
      const col = c % 2 === 0 ? this.primaryRGB : this.secondaryRGB;
      const alpha = this.baseOpacity * 0.35;

      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha.toFixed(3)})`;
      ctx.lineWidth = 0.8;
      ctx.lineCap = "round";
      ctx.beginPath();

      const margin = 80;
      const pts = 300;
      let started = false;

      for (let i = 0; i <= pts; i++) {
        const t = i / pts;
        const px = margin + t * (w - 2 * margin);
        const py = cur.baseY * h
          + Math.sin(t * cur.freq * Math.PI + cur.phase) * h * cur.amp
          + Math.cos(t * cur.freq * 1.7 * Math.PI + cur.phase + 1.5) * h * cur.amp * 0.4
          + (fbm(t * 3.0, c * 1.3) - 0.5) * h * 0.02;

        if (!started) { ctx.moveTo(px, py); started = true; }
        else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
    }
  }
}

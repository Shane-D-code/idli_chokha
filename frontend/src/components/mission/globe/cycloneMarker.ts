// Canvas-generated miniature "satellite photo of a storm" markers for the
// hero globe. Two distinct visual languages:
//
//   'mocha' (TC MOCHA) — a fully-organised system with the anatomy of a real
//   satellite close-up: a small dark, clearly visible eye ringed by a bright,
//   thick eyewall — the brightest, densest part of the whole structure — then
//   3-5 asymmetric spiral rainbands that taper, wobble and break up as they
//   unwind outward, with real negative space between bands so the ocean shows
//   through, and a faint feathered outer envelope instead of a hard disc edge.
//   Every band is stacked from 2-3 semi-transparent cloud layers at slightly
//   different rotation offsets for depth/volume, and the dense core carries a
//   faint warm-cream tint (IR cloud tops are never pure white). The coloured
//   intensity glow (red for TC MOCHA) sits behind the whole structure and
//   reads mainly at the soft outer edges.
//
//   'loose' (Invest 91A / 92B) — weak, still-developing disturbances: loose
//   multi-band spiral cloud arms with scattered convective clumps roughing
//   them up, a soft dense core and NO eye or eyewall ring. Still clearly
//   readable as cyclone spirals at icon size, but visibly subordinate to
//   TC MOCHA. A small `organization` factor (92B > 91A) tightens the wraps
//   and reduces the scatter without approaching MOCHA's definition.
//
// Icons are memoised per variant and the cached bitmap is copied onto a
// fresh canvas per marker position.

const S = 512; // internal resolution (downscaled by CSS to 55-130px)
const cx = S / 2;
const cy = S / 2;

/**
 * Glow disc diameter as a multiple of the icon's CSS diameter. Capped at 1.5x
 * so the halo stays visually proportioned to the core (bigger storms get a
 * bigger — but still bounded — halo) and can never balloon past the storm or
 * bleed down into its label card.
 */
export const CYCLONE_GLOW_SIZE_FACTOR = 1.5;

const cloudMemo = new Map<string, HTMLCanvasElement>();

export interface CycloneSpiralStyle {
  /** 'mocha' = dense, tight spiral with a clear eye; 'loose' = developing invest. */
  variant: "mocha" | "loose";
  /** Primary glow color (hex). */
  glow: string;
  /** Secondary glow color layered behind the primary (hex). */
  glow2?: string;
  /** 0..1 how organised a 'loose' invest looks (ignored for 'mocha'). */
  organization?: number;
}

export interface CycloneIconOptions {
  /** CSS size of the cloud disc in px (unsized to source resolution). */
  sizePx: number;
  /** Slow rotation period in ms. */
  spinMs: number;
}

/** Soft-edged blurred puff of cloud. */
function drawPuff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number
): void {
  const [rr, gg, bb] = hexToRgb(color);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rr},${gg},${bb},${alpha})`);
  g.addColorStop(0.55, `rgba(${rr},${gg},${bb},${alpha * 0.55})`);
  g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Deterministic PRNG so the mocha spiral is stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BandPass {
  /** Rotation offset (radians) from the true spiral angle — gives depth. */
  rot: number;
  /** How much wider than the tapering core this layer is. */
  ws: number;
  /** Base opacity of the layer. */
  alpha: number;
  /** Cloud color: outer haze is dimmer/blue-grey, the arm core is white. */
  color: string;
}

/**
 * Asymmetric, broken spiral rainbands (TC MOCHA). Each arm is a partial
 * logarithmic-spiral strip cut into 2-3 arcs with real gaps between them —
 * like discontinuous satellite rainbands — and every arm gets its own start
 * angle, winding count, thickness, radial reach and opacity. Bands taper and
 * feather out toward their outer ends. Each band is painted as 2-3 stacked
 * semi-transparent layers at slightly different rotation offsets so the
 * system reads like layered volumes of cloud, not a flat spiral stamp.
 */
function drawMochaArms(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const arms = 4;
  // Deliberately uneven arm placement: no two arms share a start angle or a
  // winding count, so bands never line up into mirrored/ring-like wraps.
  const baseAng = [0.18, 2.42, 4.1, 5.68];
  const baseTurns = [1.12, 0.78, 1.38, 0.92];
  const coreColors = ["#ffffff", "#fffaf1", "#ffffff", "#fff4e6"];
  const passes: BandPass[] = [
    { rot: 0.42, ws: 2.2, alpha: 0.14, color: "#cfdcea" },
    { rot: -0.48, ws: 1.3, alpha: 0.32, color: "#e8f0f9" },
    { rot: 0, ws: 0.5, alpha: 0.92, color: coreColors[0] },
  ];
  const cosR = passes.map((p) => Math.cos(p.rot));
  const sinR = passes.map((p) => Math.sin(p.rot));
  const n = 180;

  for (let a = 0; a < arms; a++) {
    const startAng = baseAng[a] + (rand() - 0.5) * 0.55;
    const turns = baseTurns[a] * (0.85 + rand() * 0.3);
    const r0 = S * (0.105 + rand() * 0.045);
    const r1 = S * (0.4 + rand() * 0.09);
    const wIn = S * (0.028 + rand() * 0.02);
    const wOut = S * (0.005 + rand() * 0.007);
    const alphaMul = 0.68 + rand() * 0.4;
    passes[2].color = coreColors[a];

    // Dense polyline of this arm's logarithmic spiral.
    const px = new Array<number>(n + 1);
    const py = new Array<number>(n + 1);
    const a0 = startAng;
    const a1 = startAng + turns * Math.PI * 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ang = a0 + (a1 - a0) * t;
      const r = r0 * Math.pow(r1 / r0, t);
      px[i] = cx + Math.cos(ang) * r;
      py[i] = cy + Math.sin(ang) * r;
    }

    // Cut the band into 2-3 arcs separated by gaps — never a closed ring.
    // Gaps sit anywhere along the arm so negative space reads unevenly.
    const segCount = 2 + Math.floor(rand() * 2);
    const cuts: number[] = [];
    for (let s = 0; s < segCount - 1; s++) cuts.push(0.14 + rand() * 0.5);
    cuts.sort((x, y) => x - y);

    let segStart = 0;
    for (let s = 0; s < segCount; s++) {
      const segEnd = s < segCount - 1 ? cuts[s] : 1;
      const i0 = Math.max(0, Math.floor(segStart * n));
      const i1 = Math.min(n, Math.ceil(segEnd * n));
      for (let i = i0; i <= i1; i++) {
        const t = i / n;
        const w = (wIn + (wOut - wIn) * t) * (0.85 + rand() * 0.3);
        // slight centerline wobble so the band isn't ruler-smooth
        const wobble = (rand() - 0.5) * S * 0.011 * (0.25 + 0.75 * t);
        // Tapered brightness plus a squared falloff past ~55% reach so the
        // outer end feathers to nothing instead of hitting a hard cutoff.
        const tail = t > 0.55 ? Math.max(0, 1 - (t - 0.55) / 0.45) : 1;
        const taper = (1 - 0.5 * t) * tail * tail;
        for (let p = 0; p < passes.length; p++) {
          const pass = passes[p];
          const x = px[i] + wobble;
          const y = py[i] + wobble;
          const rx = cx + (x - cx) * cosR[p] - (y - cy) * sinR[p];
          const ry = cy + (x - cx) * sinR[p] + (y - cy) * cosR[p];
          drawPuff(ctx, rx, ry, w * pass.ws, pass.color, pass.alpha * alphaMul * taper);
        }
      }
      segStart = segEnd + 0.04 + rand() * 0.14;
    }
  }
}

/**
 * Bright, thick, well-defined eyewall hugging the eye — the brightest and
 * densest part of the whole structure. Kept subtly irregular: the ring is
 * radially deformed and thicker on one arc and thinner on the other (a real
 * eyewall is rarely a perfect bullseye) but always reads as a closed dense
 * ring, not a set of separate arcs.
 */
function drawEyewall(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const arcR = S * 0.1;
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * Math.PI * 2;
    // radially deformed: slight two-lobe + three-lobe asymmetry
    const lobe = 1 + 0.055 * Math.sin(2 * ang + 1.25) + 0.032 * Math.sin(3 * ang + 0.6);
    const r = arcR * lobe + (rand() - 0.5) * S * 0.012;
    // thickness and brightness vary around the circle
    const thick = 0.75 + (0.25 * Math.sin(ang - 0.4) + 1) * 0.5;
    const fade = 1 - 0.09 * (1 + Math.sin(ang * 3 + 1.0));
    drawPuff(
      ctx,
      cx + Math.cos(ang) * r,
      cy + Math.sin(ang) * r,
      S * (0.026 + 0.012 * thick),
      "#fffdf6",
      0.9 * fade
    );
  }
}

/** Small dark, clearly visible eye at the very center. */
function drawEye(ctx: CanvasRenderingContext2D): void {
  const eyeR = S * 0.048;
  const eye = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR * 1.7);
  eye.addColorStop(0, "rgba(6,9,16,1)");
  eye.addColorStop(0.55, "rgba(9,13,22,0.95)");
  eye.addColorStop(1, "rgba(10,14,22,0)");
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(cx, cy, eyeR * 1.7, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Very faint, asymmetric outer envelope plus unorganised wisps. Kept well
 * below the bands' opacity so the ocean/background shows through between
 * bands and around the storm; its only job is a gradual, feathered outer
 * edge instead of a hard disc cutoff.
 */
function drawOuterShield(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const blobs = 8;
  for (let i = 0; i < blobs; i++) {
    const ang = i * 0.83 + rand() * 0.55;
    const r = S * (0.28 + rand() * 0.17);
    drawPuff(ctx, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, S * (0.11 + rand() * 0.09), "#e2ebf5", 0.05 + rand() * 0.05);
  }
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const r = S * (0.3 + rand() * 0.19);
    drawPuff(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, S * (0.01 + rand() * 0.012), "#e9f0f9", 0.05 + rand() * 0.09);
  }
}

/**
 * Warm-cream tint restricted to the already-painted cloud pixels so the
 * densest parts read as bright IR cloud tops (which carry a subtle warm/cool
 * variation) rather than flat pure white.
 */
function tintCore(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = "source-atop";
  const cream = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
  cream.addColorStop(0, "rgba(255,239,214,0.3)");
  cream.addColorStop(0.3, "rgba(255,238,212,0.18)");
  cream.addColorStop(0.55, "rgba(250,242,229,0.06)");
  cream.addColorStop(1, "rgba(250,242,229,0)");
  ctx.fillStyle = cream;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "source-over";
}

/** Fully-organised system (TC MOCHA): dark eye, bright eyewall, tight arms. */
function drawMochaStorm(ctx: CanvasRenderingContext2D): void {
  const rand = mulberry32(0x5eedc0de);

  drawOuterShield(ctx, rand);
  drawMochaArms(ctx, rand);
  drawEyewall(ctx, rand);
  tintCore(ctx);
  drawEye(ctx);
}

/**
 * One scattered convective clump — a small cluster of overlapping puffs,
 * elongated along the tangent direction so it holds a faint hint of rotation
 * without forming a crisp band.
 */
function drawConvectiveClump(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirAng: number,
  size: number,
  elongation: number,
  alpha: number,
  color: string
): void {
  const tx = Math.cos(dirAng);
  const ty = Math.sin(dirAng);
  const rx = -Math.sin(dirAng);
  const ry = Math.cos(dirAng);
  const puffs = 3 + Math.floor(Math.random() * 4);
  for (let k = 0; k < puffs; k++) {
    const tk = (Math.random() - 0.5) * 2 * size * elongation;
    const rk = (Math.random() - 0.5) * 2 * size;
    drawPuff(
      ctx,
      x + tx * tk + rx * rk,
      y + ty * tk + ry * rk,
      size * (0.5 + Math.random() * 0.55),
      color,
      alpha * (0.7 + Math.random() * 0.4)
    );
  }
}

/**
 * Weak-but-visible spiral cloud bands for invests. Fewer arms, looser wraps
 * and wider scatter than TC MOCHA's tight, high-contrast system, but the arms
 * still read unmistakably as a cyclone spiral. Each band is stacked from the
 * same faint rotated cloud layers used for depth, and the outer ends feather
 * out. `organization` (92B > 91A) tightens the wraps and reduces the scatter.
 */
function drawLooseBands(ctx: CanvasRenderingContext2D, organization: number): void {
  const arms = 3;
  const turns = 0.6 + organization * 0.5; // 91A: 0.8 · 92B: 0.95 — looser than MOCHA
  const r0 = S * (0.11 + organization * 0.04);
  const r1 = S * 0.42;
  const wIn = S * 0.025;
  const wOut = S * 0.009;
  const wisp = 1 - organization; // weaker → more scatter / wisps
  const passes: BandPass[] = [
    { rot: 0.4, ws: 2.0, alpha: 0.08, color: "#b7c8db" },
    { rot: -0.35, ws: 1.2, alpha: 0.22, color: "#d8e5f2" },
    { rot: 0, ws: 0.6, alpha: 0.4, color: "#f2f7fd" },
  ];
  const cosR = passes.map((p) => Math.cos(p.rot));
  const sinR = passes.map((p) => Math.sin(p.rot));
  const n = 210;

  for (let a = 0; a < arms; a++) {
    const ang0 = (a / arms) * Math.PI * 2 + organization * 0.6;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ang = ang0 + t * turns * Math.PI * 2;
      const r = r0 * Math.pow(r1 / r0, t);
      const scatter = (Math.random() - 0.5) * S * 0.04 * wisp + (Math.random() - 0.5) * S * 0.012;
      xs.push(cx + Math.cos(ang) * r + scatter);
      ys.push(cy + Math.sin(ang) * r + scatter);
    }
    for (let p = 0; p < passes.length; p++) {
      const pass = passes[p];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const w = (wIn + (wOut - wIn) * t) * pass.ws * (1 + 0.3 * wisp);
        const tail = t > 0.55 ? Math.max(0, 1 - (t - 0.55) / 0.45) : 1;
        const x = xs[i];
        const y = ys[i];
        const rx = cx + (x - cx) * cosR[p] - (y - cy) * sinR[p];
        const ry = cy + (x - cx) * sinR[p] + (y - cy) * cosR[p];
        drawPuff(ctx, rx, ry, w, pass.color, pass.alpha * tail);
      }
    }
  }
}

/**
 * Developing invest (Invest 91A / 92B): loose, low-contrast spiral cloud
 * bands with scattered convective clumps roughing them up — no eye, no
 * eyewall ring, no tight organized banding. `organization` (92B slightly
 * higher than 91A) tightens the wraps and reduces the scatter a little
 * without approaching TC MOCHA.
 */
function drawInvestClouds(ctx: CanvasRenderingContext2D, organization: number): void {
  const org = Math.max(0, Math.min(1, organization));

  // Faint outer cloud shield — diffuse, low contrast, subordinate to MOCHA.
  const shield = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.46);
  shield.addColorStop(0, "rgba(232,241,250,0)");
  shield.addColorStop(0.55, "rgba(226,237,246,0.05)");
  shield.addColorStop(1, "rgba(220,231,242,0)");
  ctx.fillStyle = shield;
  ctx.fillRect(0, 0, S, S);

  // Loose spiral cloud arms — the main readable structure. These keep the
  // invest icon legible as a cyclone spiral at icon size while staying
  // visibly weaker and less organised than a mature system.
  drawLooseBands(ctx, org);

  // Soft, slightly denser convective core near the centre — no dark hole
  // and no bright ring.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.13);
  core.addColorStop(0, "rgba(246,251,255,0.5)");
  core.addColorStop(0.45, "rgba(233,243,251,0.26)");
  core.addColorStop(1, "rgba(228,239,249,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * S * 0.05;
    drawPuff(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, S * (0.02 + Math.random() * 0.018), "#f3f8fd", 0.15 + Math.random() * 0.15);
  }

  // Scattered convective clumps, loosely biased toward a weak spiral. More
  // organization → slightly more clumps and tighter rotational alignment.
  const nClumps = 9 + Math.round(org * 6);
  const turns = 0.9 + org * 0.55;
  const angleJitter = (0.5 - org * 0.26) * Math.PI;
  const clumpColors = ["#c9d6e5", "#dce7f3", "#eaf2fb"];
  for (let i = 0; i < nClumps; i++) {
    const rad = S * (0.055 + Math.random() * 0.31);
    const spiralAng = (rad / (S * 0.4)) * turns * Math.PI * 2 + i * 0.83;
    const ang = spiralAng + (Math.random() - 0.5) * 2 * angleJitter;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const size = S * (0.026 + Math.random() * 0.032) * (1 - (rad / S) * 0.3);
    const color = clumpColors[Math.floor(Math.random() * clumpColors.length)];
    drawConvectiveClump(ctx, x, y, ang, size, 1.4 + Math.random() * 1.4, 0.14 + Math.random() * 0.15, color);
  }

  // A couple of faint, short curved arc fragments for the slightly more
  // organised invests — the barest hint of rotation, never full bands.
  const arcs = org > 0.55 ? 2 : 1;
  for (let i = 0; i < arcs; i++) {
    const rad = S * (0.14 + Math.random() * 0.16);
    const a0 = Math.random() * Math.PI * 2;
    const span = Math.PI * (0.3 + Math.random() * 0.25);
    const steps = 14;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const ang = a0 + t * span;
      drawPuff(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, S * (0.014 + Math.random() * 0.008), "#e6eef8", 0.05 + Math.random() * 0.04);
    }
  }

  // Unorganised wisps — overall cloudy, low-contrast feel.
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = S * (0.22 + Math.random() * 0.24);
    const pr = S * (0.014 + Math.random() * 0.016);
    drawPuff(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, pr, "#e6eef9", 0.06 + Math.random() * 0.08);
  }
}

/** Draws the cloud art for a given style onto a transparent canvas. */
function drawCloudSpiral(ctx: CanvasRenderingContext2D, style: CycloneSpiralStyle): void {
  if (style.variant === "mocha") {
    drawMochaStorm(ctx);
  } else {
    drawInvestClouds(ctx, style.organization ?? 0);
  }
}

/** Memoised cloud-spiral bitmap (transparent background, no glow). */
export function getCloudSpiralCanvas(style: CycloneSpiralStyle): HTMLCanvasElement {
  const key = `${style.variant}|${style.glow}|${style.glow2 ?? ""}|${style.organization ?? 0}`;
  const hit = cloudMemo.get(key);
  if (hit) return hit;

  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  drawCloudSpiral(ctx, style);

  cloudMemo.set(key, c);
  return c;
}

/**
 * Builds a fresh marker node per call: a soft colored glow div behind a
 * slowly rotating cloud-spiral canvas. Returns a new element each time so
 * htmlElement accessors never share DOM nodes.
 */
export function getCycloneMarkerElement(
  style: CycloneSpiralStyle,
  opts: CycloneIconOptions
): HTMLDivElement {
  const node = document.createElement("div");
  node.style.position = "relative";
  node.style.width = `${opts.sizePx}px`;
  node.style.height = `${opts.sizePx}px`;
  node.style.display = "block";
  node.style.pointerEvents = "none";

  // Colored intensity glow behind the cloud disc — the color reads mainly at
  // the soft outer edge, peaking just beyond the feathered cloud rim so the
  // halo never washes out the spiral bands or the eye.
  const gz = Math.round(opts.sizePx * CYCLONE_GLOW_SIZE_FACTOR);
  const glow = document.createElement("div");
  glow.style.position = "absolute";
  glow.style.left = "50%";
  glow.style.top = "50%";
  glow.style.width = `${gz}px`;
  glow.style.height = `${gz}px`;
  glow.style.marginLeft = `${-gz / 2}px`;
  glow.style.marginTop = `${-gz / 2}px`;
  glow.style.borderRadius = "50%";
  glow.style.pointerEvents = "none";
  glow.style.filter = "blur(3px)";
  glow.style.opacity = "0.6";
  glow.style.background = `radial-gradient(circle closest-side, ${rgba(style.glow, 0.09)} 0%, ${rgba(
    style.glow,
    0.1
  )} 40%, ${rgba(style.glow, 0.28)} 70%, ${rgba(style.glow, 0)} 82%)`;
  node.appendChild(glow);

  // Cloud spiral canvas (bitmap copied so each marker is an independent node)
  const source = getCloudSpiralCanvas(style);
  const icon = document.createElement("canvas");
  icon.width = source.width;
  icon.height = source.height;
  icon.getContext("2d")!.drawImage(source, 0, 0);
  icon.style.width = `${opts.sizePx}px`;
  icon.style.height = `${opts.sizePx}px`;
  icon.style.display = "block";
  icon.style.position = "relative";
  icon.style.animation = `cyclone-spin ${opts.spinMs}ms linear infinite`;
  icon.style.willChange = "transform";
  node.appendChild(icon);

  return node;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Injects the slow-rotation keyframes used by the spiral icons (idempotent). */
let spinStyleInjected = false;
export function ensureCycloneSpinStyle(): void {
  if (spinStyleInjected) return;
  spinStyleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-cyclone-spin", "true");
  style.textContent = "@keyframes cyclone-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}
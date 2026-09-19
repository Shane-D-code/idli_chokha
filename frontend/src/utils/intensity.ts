// IMD intensity classification for the TOOFAN cyclone track visualization.
// Mirrors the backend scale (src/core/schema.py `msw_to_category` / `CycloneCategory`)
// so the frontend and the model can never disagree on a wind-speed -> colour mapping.
//
// Intensity class is the ONLY driver of track colour. Nothing else (storm name,
// basin, identity, model variant) ever changes the colour of a track.

export type IntensityClassKey = "D" | "DD" | "CS" | "SCS" | "VSCS" | "ESCS" | "SUCS";

export interface IntensityClass {
  key: IntensityClassKey;
  /** Full IMD name, e.g. "Very Severe Cyclonic Storm". */
  label: string;
  /** IMD abbreviation, e.g. "VSCS". */
  shortLabel: string;
  /** Human readable wind range, e.g. "64–89 kt". */
  windRange: string;
  minKt: number;
  maxKt: number; // inclusive upper bound; Infinity for SUCS
  /** Track colour. Chosen to stay legible on dark ocean AND light land. */
  color: string;
}

export const INTENSITY_ORDER: IntensityClassKey[] = [
  "D",
  "DD",
  "CS",
  "SCS",
  "VSCS",
  "ESCS",
  "SUCS",
];

const toClass = (
  key: IntensityClassKey,
  label: string,
  windRange: string,
  minKt: number,
  maxKt: number,
  color: string,
): IntensityClass => ({
  key,
  label,
  shortLabel: key,
  windRange,
  minKt,
  maxKt,
  color,
});

export const INTENSITY_CLASSES: Record<IntensityClassKey, IntensityClass> = {
  D: toClass("D", "Depression", "17–27 kt", 0, 27, "#9FB8CC"),
  DD: toClass("DD", "Deep Depression", "28–33 kt", 28, 33, "#4EC6D6"),
  CS: toClass("CS", "Cyclonic Storm", "34–47 kt", 34, 47, "#F0B429"),
  SCS: toClass("SCS", "Severe Cyclonic Storm", "48–63 kt", 48, 63, "#EE8131"),
  VSCS: toClass("VSCS", "Very Severe Cyclonic Storm", "64–89 kt", 64, 89, "#E5533C"),
  ESCS: toClass("ESCS", "Extremely Severe Cyclonic Storm", "90–119 kt", 90, 119, "#D9303C"),
  SUCS: toClass("SUCS", "Super Cyclonic Storm", "≥120 kt", 120, Infinity, "#B250E8"),
};

/** Ordered list for legend rendering (weakest → strongest). */
export const INTENSITY_CLASS_LIST: IntensityClass[] = INTENSITY_ORDER.map(
  (k) => INTENSITY_CLASSES[k],
);

/**
 * Map a maximum sustained wind (kt) to its IMD grade key.
 * Returns null when the wind value is missing or non-finite —
 * no invented colour is ever assigned to missing data.
 */
export function intensityClassForWind(windKt: number | null | undefined): IntensityClassKey | null {
  if (windKt == null || !Number.isFinite(windKt) || windKt < 0) return null;
  if (windKt < 28) return "D";
  if (windKt <= 33) return "DD";
  if (windKt <= 47) return "CS";
  if (windKt <= 63) return "SCS";
  if (windKt <= 89) return "VSCS";
  if (windKt <= 119) return "ESCS";
  return "SUCS";
}

/** Full intensity class metadata for a wind speed, or null when unknown. */
export function intensityClassInfo(windKt: number | null | undefined): IntensityClass | null {
  const key = intensityClassForWind(windKt);
  return key ? INTENSITY_CLASSES[key] : null;
}

/** Track/point colour for a wind speed, or null when unknown. */
export function intensityColor(windKt: number | null | undefined): string | null {
  const info = intensityClassInfo(windKt);
  return info ? info.color : null;
}

// ── Normalised "development" 0..1 for the cyclone visual shaders ─────────
// Maps IMD sustained-wind categories to a continuous 0..1 organisation
// factor. Weak/invest systems sit near 0, super cyclones near 1. This is the
// ONLY driver of cyclone shader uniforms (eye radius, band count, rotation).
export const INTENSITY01_STOPS: { maxKt: number; value: number }[] = [
  { maxKt: 0, value: 0 }, // no system
  { maxKt: 17, value: 0.1 }, // low pressure area / invest (< 17 kt)
  { maxKt: 27, value: 0.25 }, // Depression (17–27 kt)
  { maxKt: 33, value: 0.35 }, // Deep Depression
  { maxKt: 47, value: 0.5 }, // Cyclonic Storm
  { maxKt: 63, value: 0.62 }, // Severe
  { maxKt: 89, value: 0.78 }, // Very Severe
  { maxKt: 119, value: 0.92 }, // Extremely Severe
  { maxKt: Infinity, value: 1.0 }, // Super Cyclonic Storm
];

export function intensity01ForWind(windKt: number | null | undefined): number {
  if (windKt == null || !Number.isFinite(windKt) || windKt < 0) return 0;
  for (let i = 0; i < INTENSITY01_STOPS.length; i++) {
    const stop = INTENSITY01_STOPS[i];
    if (windKt <= stop.maxKt) {
      const prev = INTENSITY01_STOPS[Math.max(0, i - 1)];
      const loKt = prev.maxKt;
      const hiKt = stop.maxKt;
      const t = hiKt === loKt ? 1 : (windKt - loKt) / (hiKt - loKt);
      return prev.value + (stop.value - prev.value) * Math.min(1, Math.max(0, t));
    }
  }
  return 1;
}

// ── Broadcast colour ramp ─────────────────────────────────────────────────
// Ocean-atmosphere style: pale ice → cyan → amber → orange → red →
// magenta, driven by intensity01 and interpolated in Oklch so the
// transitions stay perceptually even (no muddy browns), unlike RGB lerp.
export interface IntensityRampStop {
  value: number; // intensity01 (0..1)
  color: string; // hex
}

export const INTENSITY_RAMP: IntensityRampStop[] = [
  { value: 0.0, color: "#BFE8FF" },
  { value: 0.25, color: "#7FD8F0" },
  { value: 0.4, color: "#FFD84D" },
  { value: 0.55, color: "#FFA52C" },
  { value: 0.7, color: "#FF6B35" },
  { value: 0.85, color: "#EF3B3B" },
  { value: 1.0, color: "#C4267F" },
];

function hexToSrgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** [L, a, b] Oklab in the 0..1 sRGB gamut. B. Ottosson, 2021. */
function srgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabToSrgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    linearToSrgb(Math.max(0, Math.min(1, +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
    linearToSrgb(Math.max(0, Math.min(1, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
    linearToSrgb(Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))),
  ];
}

function hex(o: [number, number, number]): string {
  const to = (c: number) => Math.round(c * 255).toString(16).padStart(2, "0");
  return `#${to(o[0])}${to(o[1])}${to(o[2])}`;
}

/** Perceptually-even colour for a wind speed, via Oklch interpolation. */
export function intensityRampColor(windKt: number | null | undefined): string {
  const t = intensity01ForWind(windKt);
  const stops = INTENSITY_RAMP;
  if (t <= stops[0].value) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i];
    if (t <= hi.value) {
      const lo = stops[i - 1];
      const f = (t - lo.value) / (hi.value - lo.value);
      const a = srgbToOklab(hexToSrgb(lo.color).map(srgbToLinear) as [number, number, number]);
      const b = srgbToOklab(hexToSrgb(hi.color).map(srgbToLinear) as [number, number, number]);
      const [aL, aC, aH] = oklabToLch(a);
      const [bL, bC, bH] = oklabToLch(b);
      let dh = bH - aH;
      if (dh > Math.PI) dh -= Math.PI * 2;
      else if (dh < -Math.PI) dh += Math.PI * 2;
      const mixed = lchToOklab([
        aL + (bL - aL) * f,
        aC + (bC - aC) * f,
        aH + dh * f,
      ]);
      return hex(oklabToSrgb(mixed));
    }
  }
  return stops[stops.length - 1].color;
}

function oklabToLch([L, a, b]: [number, number, number]): [number, number, number] {
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}

function lchToOklab([L, C, H]: [number, number, number]): [number, number, number] {
  return [L, C * Math.cos(H), C * Math.sin(H)];
}
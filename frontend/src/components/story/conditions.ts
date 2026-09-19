// Favourability → bar encoding for the story's condition rows (section 6).
//
// ENCODING — favourability (recommended by the prompt):
//   The bar answers "how much does this factor favour cyclogenesis".
//   Higher favourability → longer bar AND warmer (threat) tone.
//   Lower  favourability → shorter bar AND cooler (safe) tone.
//   e.g. low vertical wind shear is strongly favourable, so it reads long
//   and red alongside high SST and high moisture — never short-and-green.
//   This is the SINGLE mapping for every row; the direction is fixed here.

const FAV_POSITIVE_HEX = "#4ea8ff"; // low threat  — --sev-low (cool cyan-blue)
const FAV_MID_HEX = "#f0b429"; // moderate threat — --sev-moderate (amber)
const FAV_HIGH_HEX = "#e5533c"; // high threat  — --sev-veryhigh (red)

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

/**
 * Tone for a favourability / probability value. 0 → cyan-blue, .5 → amber,
 * 1 → red. Shared by condition-row fills and metric-card values so the whole
 * story speaks one threat scale.
 */
export function favourabilityTone(favourability: number): string {
  const t = clamp01(favourability);
  if (t < 0.5) return lerpHex(FAV_POSITIVE_HEX, FAV_MID_HEX, t * 2);
  return lerpHex(FAV_MID_HEX, FAV_HIGH_HEX, (t - 0.5) * 2);
}

/** Bar fill width (0..1) for a favourability value — direct, monotonic. */
export function favourabilityFill(favourability: number): number {
  return clamp01(favourability);
}
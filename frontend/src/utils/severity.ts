import type { HazardSeverity } from "@/types";

/** Canonical severity ramp — LOW → EXTREME (matches the --sev-* design tokens). */
export const SEV_ORDER: readonly HazardSeverity[] = [
  "LOW",
  "MODERATE",
  "HIGH",
  "VERY_HIGH",
  "EXTREME",
] as const;

export function sevRank(sev: HazardSeverity | undefined): number {
  if (!sev) return -1;
  const i = SEV_ORDER.indexOf(sev);
  return i < 0 ? -1 : i;
}

export function worstSeverity(
  sevs: (HazardSeverity | undefined)[],
): HazardSeverity | undefined {
  return sevs.reduce<HazardSeverity | undefined>(
    (w, s) => (s && sevRank(s) > sevRank(w) ? s : w),
    undefined,
  );
}
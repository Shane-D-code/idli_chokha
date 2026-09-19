/** District-focused formatting helpers. */
export function distanceText(km: number): string {
  const v = Math.round(km)
  return v >= 1000 ? `${(v / 1000).toFixed(2)}k km` : `${v} km`
}

export function durationText(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 24) return `${Math.round(hours)} h`
  return `${(hours / 24).toFixed(1)} d`
}
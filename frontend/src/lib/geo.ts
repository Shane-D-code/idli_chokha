import type { ConePoint, ForecastPoint } from '../types/forecast'
import type { LatLon } from '../types/common'

/** Great-circle helpers. All angles in degrees unless stated. */

const R = 6371 // km

export function toRad(d: number): number {
  return (d * Math.PI) / 180
}

export function toDeg(r: number): number {
  return (r * 180) / Math.PI
}

/** Haversine distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Initial bearing from a → b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const [lat1, lon1, lat2, lon2] = [toRad(a.lat), toRad(a.lon), toRad(b.lat), toRad(b.lon)]
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Destination point given start, bearing (deg) and distance (km). */
export function destination(from: LatLon, bearing: number, distKm: number): LatLon {
  const dR = distKm / R
  const br = toRad(bearing)
  const lat1 = toRad(from.lat)
  const lon1 = toRad(from.lon)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(br),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 }
}

/** Compass rose 16-wind label from bearing degrees. */
export function compassLabel(bearing: number): string {
  const rose = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const idx = Math.round(((bearing % 360) / 360) * 16) % 16
  return rose[idx]
}

/** Interpolate a great-circle point fraction t (0..1) between a and b. */
export function lerpAngle(a: LatLon, b: LatLon, t: number): LatLon {
  const d = bearingDeg(a, b)
  const dist = distanceKm(a, b) * t
  return destination(a, d, dist)
}

/**
 * Build the forecast corridor (cone) as left & right boundary polylines given
 * the track and per-point cross-track uncertainty. Used the SAME way on the
 * map and the globe.
 */
export function buildForecastCone(track: ForecastPoint[]): { left: LatLon[]; right: LatLon[] }[] {
  const segs: { left: LatLon[]; right: LatLon[] }[] = []
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]
    const b = track[i + 1]
    const br = bearingDeg(a.position, b.position)
    const n = 24
    const leftPts: LatLon[] = []
    const rightPts: LatLon[] = []
    for (let j = 0; j <= n; j++) {
      const t = j / n
      const p = lerpAngle(a.position, b.position, t)
      const u = a.uncertaintyKm + (b.uncertaintyKm - a.uncertaintyKm) * t
      leftPts.push(destination(p, (br + 90 + 360) % 360, u))
      rightPts.push(destination(p, (br - 90 + 360) % 360, u))
    }
    segs.push({ left: leftPts, right: rightPts })
  }
  return segs
}

export function formatLatLon(p: LatLon, digits = 2): string {
  return `${Math.abs(p.lat).toFixed(digits)}°${p.lat >= 0 ? 'N' : 'S'} · ${Math.abs(p.lon).toFixed(digits)}°${p.lon >= 0 ? 'E' : 'W'}`
}

export function formatLat(p: LatLon, digits = 2): string {
  return `${Math.abs(p.lat).toFixed(digits)}°${p.lat >= 0 ? 'N' : 'S'}`
}

export function formatLon(p: LatLon, digits = 2): string {
  return `${Math.abs(p.lon).toFixed(digits)}°${p.lon >= 0 ? 'E' : 'W'}`
}

/** Sampled points along a polyline used for geographic map drawing. */
export function samplePolyline(pts: LatLon[]): LatLon[] {
  return pts
}

export type { ConePoint }
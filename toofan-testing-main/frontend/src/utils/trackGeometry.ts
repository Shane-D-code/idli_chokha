// Track geometry utilities — bearing calculation, position interpolation,
// and compass helpers for the cyclone visualization.

import type { TrackPoint } from "@/types";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** Calculate initial bearing from point A to point B (degrees, 0=N, clockwise). */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * DEG) + 360) % 360;
}

/** Compass direction from bearing degrees. */
export function compassFromBearing(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Linearly interpolate latitude and longitude between two points.
 * `t` is 0..1 where 0 = a, 1 = b.
 */
export function lerpPosition(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

/**
 * Given an array of TrackPoint[] and a fractional index (e.g. 2.5),
 * interpolate the geographic position between the two surrounding points.
 * Clamps to the first/last point at the extremes.
 */
export function interpolatedPosition(points: TrackPoint[], fracIdx: number): { lat: number; lon: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { lat: points[0].latitude, lon: points[0].longitude };

  const clamped = Math.max(0, Math.min(points.length - 1, fracIdx));
  const lo = Math.floor(clamped);
  const hi = Math.min(lo + 1, points.length - 1);
  const t = clamped - lo;

  return lerpPosition(
    { lat: points[lo].latitude, lon: points[lo].longitude },
    { lat: points[hi].latitude, lon: points[hi].longitude },
    t,
  );
}

/**
 * Calculate the bearing from the current point to the next point in the trajectory.
 * Returns null if there's no next point.
 */
export function movementBearing(points: TrackPoint[], idx: number): number | null {
  if (idx < 0 || idx >= points.length) return null;
  const nextIdx = idx + 1;
  if (nextIdx >= points.length) {
    // Use previous point to current if no next point
    const prevIdx = idx - 1;
    if (prevIdx < 0) return null;
    return bearing(
      { lat: points[prevIdx].latitude, lon: points[prevIdx].longitude },
      { lat: points[idx].latitude, lon: points[idx].longitude },
    );
  }
  return bearing(
    { lat: points[idx].latitude, lon: points[idx].longitude },
    { lat: points[nextIdx].latitude, lon: points[nextIdx].longitude },
  );
}

/**
 * Intensity-based cyclone size (px).
 * Returns a diameter based on wind speed.
 */
export function intensitySize(windKt?: number): number {
  if (windKt == null) return 50;
  if (windKt >= 120) return 64;
  if (windKt >= 90) return 56;
  if (windKt >= 64) return 48;
  return 40;
}

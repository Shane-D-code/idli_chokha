// ============================================================
// TOOFAN — Recurvature geometry helpers
// ------------------------------------------------------------
// Pure, deterministic geometry used to build the ILLUSTRATIVE
// reference trajectories (normal vs recurving) and the direction
// arrows that travel along them.
//
// IMPORTANT: These are reference scenarios used to communicate the
// recurvature concept. They are NEVER model predictions and must
// always be labelled as such in the UI. The actual forecast track
// (when supplied by the backend) is kept entirely separate.
// ============================================================

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface LinePoint extends GeoPoint {
  /** Relative heading of this segment (0=N, 90=E), used to rotate arrows. */
  bearing: number;
  /** Fraction along the path 0..1, used to place the recurvature marker. */
  t: number;
  step: number;
}

/** Destination point given start, bearing (deg) and distance (km). */
export function destination(
  start: GeoPoint,
  bearingDeg: number,
  distKm: number
): GeoPoint {
  const R = 6371;
  const lat1 = deg2rad(start.lat);
  const lon1 = deg2rad(start.lon);
  const brng = deg2rad(bearingDeg);
  const ang = distKm / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: rad2deg(lat2), lon: rad2deg(lon2) };
}

/** Great-circle bearing from point a to b, degrees 0..360 (0=N, 90=E). */
export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = deg2rad(a.lat);
  const lat2 = deg2rad(b.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (rad2deg(Math.atan2(y, x)) + 360) % 360;
}

/** Distance in km between two points (Haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = deg2rad(b.lat - a.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Builds the NORMAL / NON-RECURVING reference trajectory: a smooth
 * continuation of the current heading with a gentle, bounded drift
 * that keeps it clearly "non-recurving".
 */
export function buildNormalReference(
  start: GeoPoint,
  headingDeg: number,
  steps = 9,
  stepKm = 42
): LinePoint[] {
  const base = ((headingDeg + 360) % 360);
  // A small, bounded drift so the "straight" path reads as a smooth
  // continuation rather than a perfectly rigid line.
  const drift = (i: number) => Math.sin((i * Math.PI) / (steps - 1)) * 6;
  let p = { ...start };
  const pts: LinePoint[] = [{ ...p, bearing: base, t: 0, step: 0 }];
  for (let i = 1; i < steps; i++) {
    const b = base + drift(i);
    const next = destination(p, b, stepKm);
    pts.push({ ...next, bearing: bearing(p, next), t: i / (steps - 1), step: i });
    p = next;
  }
  return pts;
}

/**
 * Builds the RECURVING reference trajectory: follows approximately
 * the same initial heading, then bends smoothly toward the north /
 * northeast. Returns both the path and the index where the heading
 * change begins (the "recurvature point").
 */
export function buildRecurvingReference(
  start: GeoPoint,
  headingDeg: number,
  steps = 9,
  stepKm = 42,
  /** Target bearing after full recurvature (N/NE). */
  targetBearing = 15
): { path: LinePoint[]; recurvatureIndex: number } {
  const base = ((headingDeg + 360) % 360);
  // Bearing sweep: initial roughly follows base, then rotates to targetBearing.
  // We ramp a fraction `f` over the middle portion of the path.
  const sweepStart = 0.18;
  const sweepEnd = 0.78;
  const bearingAt = (t: number) => {
    if (t < sweepStart) return base;
    if (t > sweepEnd) return targetBearing;
    const f = (t - sweepStart) / (sweepEnd - sweepStart);
    // Smoothstep easing for a gradual, natural curve — no 90° corner.
    const e = f * f * (3 - 2 * f);
    // Rotate in the direction that produces the smaller angular change.
    const delta = normalizeTurn(targetBearing - base);
    return base + delta * e;
  };

  let p = { ...start };
  const pts: LinePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const b = bearingAt(t);
    pts.push({ ...p, bearing: b, t, step: i });
    // The current heading applies to the segment that LEAVES this point.
    if (i < steps - 1) {
      p = destination(p, b, stepKm);
    }
  }

  // Recurvature point = where the bearing begins to diverge from the
  // normal line (first index past sweepStart where bearing != base).
  const recurvatureIndex = pts.findIndex((pt) => Math.abs(pt.bearing - base) > 1);

  return { path: pts, recurvatureIndex: recurvatureIndex >= 0 ? recurvatureIndex : 0 };
}

/** Smallest signed turn (-180..180) between two bearings. */
export function normalizeTurn(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function compassPoint(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(d / 22.5) % 16;
  return dirs[idx];
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}
function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

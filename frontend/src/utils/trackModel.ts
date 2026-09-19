// Canonical cyclone track model.
// ---------------------------------
// Every track renderer (mission globe, ops globe, MapLibre map, legend) reads
// the positioned + validated + split + segmented track from HERE. This is the
// single source of truth that keeps the observed track, forecast track,
// uncertainty cone and intensity colours consistent across the UI.
//
// Honesty rules enforced here:
//  - nothing is ever sorted into a fabricated order — points are sorted by the
//    horizon they were actually issued for;
//  - lat/lon are never swapped (MapLibre uses [lon, lat], we always carry
//    {lat, lon} objects);
//  - uncertainty cone geometry only exists when the model actually supplied
//    `uncertaintyKm` — we never invent sigma;
//  - track colour comes ONLY from IMD wind intensity (utils/intensity.ts).

import type { TrackPoint } from "@/types";
import { intensityClassForWind, intensityColor, type IntensityClassKey } from "./intensity";
import { bearing, haversineKm } from "./trackGeometry";
import * as THREE from "three";
import { EARTH_RADIUS_KM, smoothedFwd, stepAlong, toLatLon, toVec3 } from "@/geo/geo";

/**
 * Input accepted by the normalizer. Timestamps are optional here because
 * some globe/rich track sources carry `string | undefined` timestamps; they
 * are only used for labels and diagnostics, never for ordering.
 */
export type TrackInput = Omit<TrackPoint, "timestamp"> & { timestamp?: string };

/** Anything with a position + horizon → canonical TrackInput (shared contract). */
export function toTrackInput(
  p: {
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
    horizonHours?: number;
    uncertaintyKm?: number;
    isForecast?: boolean;
    windKt?: number;
    timestamp?: string | null;
  },
): TrackInput {
  return {
    timestamp: p.timestamp ?? undefined,
    horizonHours: p.horizonHours ?? NaN,
    latitude: p.latitude ?? p.lat ?? NaN,
    longitude: p.longitude ?? p.lon ?? NaN,
    windKt: p.windKt,
    uncertaintyKm: p.uncertaintyKm,
    isForecast: p.isForecast ?? false,
  };
}

export interface NormalizedTrackPoint {
  timestamp?: string;
  horizonHours: number;
  latitude: number;
  longitude: number;
  windKt?: number;
  uncertaintyKm?: number;
  isForecast: boolean;
  /** Great-circle distance travelled along the track up to this point (km). */
  cumulativeKm: number;
}

/** Getting/shims for geometry helpers that take { lat, lon }. */
const ll = (p: NormalizedTrackPoint): { lat: number; lon: number } => ({
  lat: p.latitude,
  lon: p.longitude,
});

export interface TrackValidation {
  status: "VALID" | "WARN" | "INVALID";
  total: number;
  accepted: number;
  dropped: number; // non-finite / out-of-range
  duplicates: number;
  issues: string[];
}

export interface NormalizedTrack {
  points: NormalizedTrackPoint[];
  validation: TrackValidation;
  /** Points strictly BEFORE the current position (negative horizon). */
  observed: NormalizedTrackPoint[];
  /** The 0-hour position (may be null when the model never supplies one). */
  current: NormalizedTrackPoint | null;
  /** Points strictly AFTER the current position (positive horizon). */
  forecast: NormalizedTrackPoint[];
}

export interface TrackSegment {
  from: NormalizedTrackPoint;
  to: NormalizedTrackPoint;
  /** IMD intensity colour for this segment; null = no wind data (renderer uses its neutral fallback). */
  color: string | null;
  intensity: IntensityClassKey | null;
  isForecast: boolean;
  distanceKm: number;
  bearingDeg: number;
}

export interface UncertaintyCone {
  /** Per-vertex half-widths actually used, km. Never fabricated. */
  radiiKm: number[];
  left: { lat: number; lon: number }[];
  right: { lat: number; lon: number }[];
  /** Closed ring ordered right→left → GeoJSON Polygon.coordinates[0]. */
  ring: [number, number][];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validatePoint(p: TrackInput, issues: string[]): boolean {
  if (!isNum(p.latitude) || !isNum(p.longitude)) {
    issues.push(`point at h=${p.horizonHours} dropped: non-finite position`);
    return false;
  }
  if (p.latitude < -90 || p.latitude > 90) {
    issues.push(`point at h=${p.horizonHours} dropped: latitude ${p.latitude} out of range`);
    return false;
  }
  if (p.longitude < -180 || p.longitude > 180) {
    issues.push(`point at h=${p.horizonHours} dropped: longitude ${p.longitude} out of range`);
    return false;
  }
  if (p.windKt != null) {
    if (!isNum(p.windKt) || p.windKt < 0) {
      issues.push(`point at h=${p.horizonHours} dropped: invalid windKt ${p.windKt}`);
      return false;
    }
  }
  if (p.uncertaintyKm != null) {
    if (!isNum(p.uncertaintyKm) || p.uncertaintyKm < 0) {
      issues.push(`point at h=${p.horizonHours} dropped: invalid uncertaintyKm ${p.uncertaintyKm}`);
      return false;
    }
  }
  if (!isNum(p.horizonHours)) {
    issues.push(`point dropped: missing horizonHours (${p.timestamp ?? "no timestamp"})`);
    return false;
  }
  return true;
}

/**
 * Validate, dedupe and order an arbitrary `TrackPoint[]` into the canonical
 * normalized track. Points are sorted by `horizonHours` ascending (observed
 * history is negative, current 0, forecast positive). Geometry checks catch
 * lat/lon swaps (a point "jumping" more than ~800 km per step is flagged, not
 * silently drawn). Never mutates the input.
 */
export function normalizeTrack(input: TrackInput[]): NormalizedTrack {
  const issues: string[] = [];
  const seen = new Set<string>();
  const accepted: NormalizedTrackPoint[] = [];
  let duplicates = 0;

  for (const raw of input) {
    if (!validatePoint(raw, issues)) continue;

    const dupKey = `${raw.latitude.toFixed(4)}|${raw.longitude.toFixed(4)}|${raw.horizonHours}`;
    if (seen.has(dupKey)) {
      duplicates++;
      continue;
    }
    seen.add(dupKey);
    accepted.push({
      timestamp: raw.timestamp,
      horizonHours: raw.horizonHours,
      latitude: raw.latitude,
      longitude: raw.longitude,
      windKt: raw.windKt,
      uncertaintyKm: raw.uncertaintyKm,
      isForecast: raw.isForecast,
      cumulativeKm: 0,
    });
  }

  accepted.sort((a, b) => a.horizonHours - b.horizonHours);

  // cumulative distance + step sanity
  for (let i = 1; i < accepted.length; i++) {
    const a = accepted[i - 1];
    const b = accepted[i];
    const d = haversineKm(ll(a), ll(b));
    b.cumulativeKm = a.cumulativeKm + d;
    if (d > 800) {
      const dh = b.horizonHours - a.horizonHours;
      const msg = `step h=${a.horizonHours}→h=${b.horizonHours} is ${Math.round(d)} km`
        + (dh > 0 ? ` (~${Math.round((d / (dh || 1)) * 10) / 10} km/h)` : "");
      issues.push(msg);
    }
  }

  const status: TrackValidation["status"] =
    issues.length === 0
      ? "VALID"
      : issues.length <= 2
        ? "WARN"
        : "INVALID";

  const validation: TrackValidation = {
    status,
    total: input.length,
    accepted: accepted.length,
    dropped: input.length - accepted.length - duplicates,
    duplicates,
    issues,
  };

  return { points: accepted, validation, ...splitTrack(accepted) };
}

/** Split a normalized track into observed history / current / forecast. */
export function splitTrack(points: NormalizedTrackPoint[]) {
  const observed: NormalizedTrackPoint[] = [];
  const forecast: NormalizedTrackPoint[] = [];
  let current: NormalizedTrackPoint | null = null;
  for (const p of points) {
    if (p.horizonHours < 0) {
      observed.push(p);
    } else if (p.horizonHours === 0) {
      current = p;
    } else {
      forecast.push(p);
    }
  }
  // current point may be missing entirely — fall back to the last observed
  // position so a track without an explicit 0h point still anchors correctly.
  if (!current && observed.length) {
    current = observed[observed.length - 1];
  }
  return { observed, current, forecast };
}

/**
 * Colour-segmented track geometry. Each consecutive pair becomes one segment
 * coloured by the average IMD intensity of its endpoints (null colour when no
 * wind data is present on either endpoint). One track = one ordered list of
 * segments, so no renderer can ever double-draw or scramble the path.
 */
export function buildTrackSegments(points: NormalizedTrackPoint[]): TrackSegment[] {
  const segments: TrackSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const d = haversineKm(ll(from), ll(to));
    if (d < 1e-6) continue;

    const windAvg =
      from.windKt != null && to.windKt != null
        ? (from.windKt + to.windKt) / 2
        : from.windKt ?? to.windKt;
    const key = windAvg != null ? intensityClassForWind(windAvg) : null;

    segments.push({
      from,
      to,
      color: key != null ? intensityColor(windAvg) : null,
      intensity: key,
      isForecast: to.isForecast,
      distanceKm: d,
      bearingDeg: bearing(ll(from), ll(to)),
    });
  }
  return segments;
}

/**
 * "Forward" uncertainty cone along the forecast (current + forecast points).
 * The half-width at each point is the model-provided sigma — nothing is
 * invented when `uncertaintyKm` is missing. Returns null unless at least 3
 * points carry real uncertainty so an honest, well-formed polygon can be drawn.
 */
export function buildUncertaintyCone(ordered: NormalizedTrackPoint[]): UncertaintyCone | null {
  const pts = ordered.filter((p) => p.uncertaintyKm != null && p.uncertaintyKm >= 0);
  if (pts.length < 3) return null;

  // Geometry maths in 3D unit vectors (see src/geo): the perpendicular comes
  // from a cross product of the smoothed forward tangent with the surface
  // normal, so it cannot flip sign at any bearing/latitude, and each boundary
  // is placed exactly `uncertaintyKm` from the centreline on the sphere.
  const pos = pts.map((p) => toVec3(p.latitude, p.longitude));
  const widths = pts.map((p, i) => {
    const isCurrent = p.horizonHours === 0;
    if (i === 0 && isCurrent) return 0; // cone pinches exactly at the storm
    return Math.max(0, p.uncertaintyKm!) / EARTH_RADIUS_KM;
  });
  for (let i = 1; i < widths.length; i++) {
    if (widths[i] < widths[i - 1]) widths[i] = widths[i - 1]; // never re-narrows
  }

  const left: { lat: number; lon: number }[] = [];
  const right: { lat: number; lon: number }[] = [];
  const radiiKm: number[] = [];

  pts.forEach((p, i) => {
    const center = toVec3(p.latitude, p.longitude);
    const fwd = smoothedFwd(pos, i);
    const rightDir = new THREE.Vector3().crossVectors(fwd, center).normalize();
    const w = widths[i];
    radiiKm.push(w * EARTH_RADIUS_KM);
    left.push(toLatLon(stepAlong(center, rightDir, -w)));
    right.push(toLatLon(stepAlong(center, rightDir, +w)));
  });

  const ring: [number, number][] = [
    ...right.map((p) => [p.lon, p.lat] as [number, number]),
    ...left.slice().reverse().map((p) => [p.lon, p.lat] as [number, number]),
    ...(right.length ? [[right[0].lon, right[0].lat] as [number, number]] : []),
  ];

  return { radiiKm, left, right, ring };
}

/**
 * Dev-only diagnostic line for track health. Mirrors the trace format used by
 * the rest of the UI ("TRACK VALIDATION … Status: …").
 */
export function trackValidationLog(modelLabel: string, track: NormalizedTrack): void {
  if (process.env.NODE_ENV !== "production") {
    const v = track.validation;
    console.info(
      `[trackModel] ${modelLabel} — Status: ${v.status} | accepted ${v.accepted}/${v.total}`
        + ` | dropped ${v.dropped} | duplicates ${v.duplicates}`
        + (v.issues.length ? ` | issues: ${v.issues.join("; ")}` : ""),
    );
  }
}

export type { TrackPoint };
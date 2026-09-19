// Spherical track/cone geometry.
//
// One rule: ALL path and cone maths happens on 3D unit vectors — never in
// lat/lon degrees. Convert once at the boundary with toVec3/toLatLon, then
// operate with the slerp/stepAlong/tangent-frame primitives below. The
// perpendicular comes from a cross product, so it cannot flip sign at any
// latitude and needs no cos(latitude) correction.

import * as THREE from "three";

export const EARTH_RADIUS_KM = 6371;

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

/**
 * Single named constant for the globe texture's longitude origin. react-globe /
 * three-globe place lon on the texture with a +180° offset; keeping that here —
 * in one place — is what makes round-trips exact and fixes any nudged offsets
 * that a per-call-site "texture origin" would otherwise hard-code.
 */
export const LON_ORIGIN_DEG = 180;

// Resampling rule for tracks and cones.
export const SAMPLE_SPACING_DEG = 0.25;
export const MIN_SAMPLES_PER_INTERVAL = 8;

// --- Conversion ---------------------------------------------------------

/** Lat/lon degrees -> unit vector in scene space (Y up), matching the globe
 * texture's longitude origin (LON_ORIGIN_DEG). */
export function toVec3(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (90 - lat) * D2R;
  const lam = (lon + LON_ORIGIN_DEG) * D2R;
  const s = Math.sin(phi);
  return out.set(-s * Math.cos(lam), Math.cos(phi), s * Math.sin(lam));
}

/** Unit vector -> { lat, lon } in degrees. Exact inverse of toVec3. */
export function toLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const y = Math.min(1, Math.max(-1, v.y));
  const lat = R2D * Math.asin(y);
  let lon = R2D * Math.atan2(v.z, -v.x) - LON_ORIGIN_DEG;
  if (lon < -180) lon += 360; // θ adds LON_ORIGIN once; unwrap the principal -180..180 back
  return { lat, lon };
}

/**
 * react-globe / three-globe rotate their earth mesh by -π/2 about Y so their
 * `polar2Cartesian` places lon 0 on +Z, whereas our toVec3 (a plain
 * THREE.SphereGeometry) places lon 0 on +X. The two spaces differ by a fixed
 * RotY(+π/2). This adapter converts one of OUR unit vectors into the lat/lon
 * react-globe rasterises AT THE SAME SURFACE POINT, so degree-space layers
 * (html dots, polygon rings, paths lines) line up with labels placed at raw
 * fix coordinates.
 */
export function toGlobeLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  return toLatLon(new THREE.Vector3(v.z, v.y, -v.x));
}

// --- Great-circle primitives --------------------------------------------

/** Spherical linear interpolation between two unit vectors. */
export function slerpUnit(
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return out.copy(a);
  const s = Math.sin(omega);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * omega) / s)
    .addScaledVector(b, Math.sin(t * omega) / s)
    .normalize();
}

/**
 * Move `deltaRad` along the surface from `p` in tangent direction `t`
 * (t · p ≈ 0). Exact at every latitude — replaces all perpendicular-offset
 * maths and needs no cos(lat) correction.
 */
export function stepAlong(
  p: THREE.Vector3,
  t: THREE.Vector3,
  deltaRad: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out
    .copy(p)
    .multiplyScalar(Math.cos(deltaRad))
    .addScaledVector(t, Math.sin(deltaRad))
    .normalize();
}

/** Unit tangent at `p` heading toward `q` (component of q orthogonal to p). */
export function tangentTo(q: THREE.Vector3, p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(q).addScaledVector(p, -q.dot(p)).normalize();
}

/** Right-hand perpendicular on the sphere, in the tangent plane at `p`. */
export function rightVector(
  fwd: THREE.Vector3,
  p: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.crossVectors(fwd, p).normalize();
}

/**
 * Smoothed forward tangent at index `i`. Interior vertices average the
 * outgoing tangent (toward the next sample) with the reversed incoming tangent
 * (away from the previous sample) so the strip does not jitter at sharp kinks.
 */
export function smoothedFwd(
  pos: THREE.Vector3[],
  i: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const p = pos[i];
  const n = pos.length;
  const outgoing = i < n - 1 ? tangentTo(pos[i + 1], p) : null;
  const incoming = i > 0 ? tangentTo(pos[i - 1], p) : null;

  if (!outgoing) {
    // terminal vertex: incoming points BACKWARD (from p toward prev); the
    // forward heading continues the final leg, so negate it.
    const back = out.copy(incoming as THREE.Vector3);
    return back.negate();
  }
  if (!incoming) return out.copy(outgoing).normalize();

  // incoming points BACKWARD (from p toward prev); flip it to forward.
  const forward = out.copy(outgoing);
  forward.sub(incoming); // outgoing - incoming == outgoing + (-incoming)
  const len = forward.length();
  if (len < 1e-10) return out.copy(outgoing).normalize();
  return out.copy(forward).divideScalar(len);
}

// --- Track resampling ----------------------------------------------------

export interface TrackSample {
  lat: number;
  lon: number;
  windKt?: number | null;
  uncertaintyKm?: number | null;
  horizonHours?: number;
  isForecast: boolean;
}

export interface TrackResampleVertex {
  /** Unit vector on the sphere. */
  pos: THREE.Vector3;
  lat: number;
  lon: number;
  windKt: number | null;
  uncertaintyKm: number | null;
  horizonHours: number;
  isForecast: boolean;
}

function lerp(a: number | null | undefined, b: number | null | undefined, t: number): number | null {
  if (a == null || !Number.isFinite(a)) return b ?? null;
  if (b == null || !Number.isFinite(b)) return a;
  return a + (b - a) * t;
}

/**
 * Resample a sequence of fixes (past + forecast, in time order) along great
 * circles: `ceil(angularSeparation / 0.25°)` samples per fix interval, minimum
 * 8. Wind, uncertainty and lead time are carried along by interpolation so the
 * colour ramp and cone width vary smoothly instead of stepping at fix edges.
 */
export function resampleTrack(samples: TrackSample[]): TrackResampleVertex[] {
  if (samples.length === 0) return [];
  const vecs = samples.map((s) => toVec3(s.lat, s.lon));
  const out: TrackResampleVertex[] = [];

  const interp = (s: TrackSample, e: TrackSample, t: number, pos: THREE.Vector3): TrackResampleVertex => {
    const ll = toLatLon(pos);
    return {
      pos,
      lat: ll.lat,
      lon: ll.lon,
      windKt: lerp(s.windKt, e.windKt, t),
      uncertaintyKm: lerp(s.uncertaintyKm, e.uncertaintyKm, t),
      horizonHours: lerp(s.horizonHours ?? 0, e.horizonHours ?? 0, t) ?? 0,
      isForecast: t === 0 ? s.isForecast : e.isForecast,
    };
  };

  for (let i = 0; i < samples.length - 1; i++) {
    const a = vecs[i];
    const b = vecs[i + 1];
    const arc = a.angleTo(b);
    // min 8 samples per fix interval (spec); a zero-arc pair simply repeats
    // the fix — never a NaN source.
    const n = Math.max(MIN_SAMPLES_PER_INTERVAL, Math.ceil(arc / (SAMPLE_SPACING_DEG * D2R)));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.push(interp(samples[i], samples[i + 1], t, slerpUnit(a, b, t)));
    }
  }
  const last = samples[samples.length - 1];
  out.push(interp(last, last, 1, vecs[vecs.length - 1]));
  return out;
}

// --- Uncertainty cone ----------------------------------------------------

/**
 * Widths (radians) for every resampled vertex. The cone pinches to exactly
 * zero at the current position (start) and is monotonic non-decreasing along
 * the forecast so the corridor can never bowtie or re-narrow.
 */
export function coneWidthsRad(
  verts: TrackResampleVertex[],
  options: { pinchStartKm?: number; monotonic?: boolean } = {},
): number[] {
  const { pinchStartKm, monotonic = true } = options;
  const w = verts.map((v) => {
    const km = v.uncertaintyKm;
    return km != null && Number.isFinite(km) && km >= 0 ? km / EARTH_RADIUS_KM : 0;
  });
  // Pinch only when the caller asks (i.e. the cone starts at the current
  // position); a forecast-only cone keeps its first measured width.
  if (pinchStartKm !== undefined) {
    w[0] = Math.max(0, pinchStartKm) / EARTH_RADIUS_KM;
  }
  if (monotonic) {
    for (let i = 1; i < w.length; i++) {
      if (w[i] < w[i - 1]) w[i] = w[i - 1];
    }
  }
  return w;
}

export interface ConeStrip {
  centers: THREE.Vector3[];
  left: THREE.Vector3[];
  right: THREE.Vector3[];
  fwd: THREE.Vector3[];
  halfWidthRad: number[];
}

/**
 * Left/right boundary vertices for a resampled centreline. `left[i]` sits
 * `halfWidthRad[i]` to the -right side, `right[i]` to the +right side, so the
 * pair is exactly symmetric about the centreline at every sample.
 */
export function buildConeStrip(
  pos: THREE.Vector3[],
  halfWidthRad: number[],
): ConeStrip {
  const n = pos.length;
  const centers: THREE.Vector3[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  const fwd: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const p = pos[i];
    const f = smoothedFwd(pos, i);
    const r = new THREE.Vector3().crossVectors(f, p).normalize();
    const w = halfWidthRad[i];
    centers.push(p);
    fwd.push(f);
    left.push(stepAlong(p, r, -w));
    right.push(stepAlong(p, r, +w));
  }
  return { centers, left, right, fwd, halfWidthRad };
}

/**
 * Far-end cap: sweep `stepAlong(p_last, dir, δ_last)` with `dir` rotated
 * through 180° (from -right to +right) in `arcSteps` steps. A curved cap, not
 * a flat chord. When arcSteps is even, arc[0]/arc[last] coincide exactly with
 * the tube's left/right endpoints.
 */
export function buildConeTipArc(
  strip: ConeStrip,
  arcSteps = 16,
): { center: THREE.Vector3; verts: THREE.Vector3[] } {
  const n = strip.centers.length;
  const p = strip.centers[n - 1];
  const f = strip.fwd[n - 1];
  const r = new THREE.Vector3().crossVectors(f, p).normalize();
  const w = strip.halfWidthRad[n - 1];
  const verts: THREE.Vector3[] = [];
  for (let k = 0; k <= arcSteps; k++) {
    const theta = (k / arcSteps - 0.5) * Math.PI;
    const dir = new THREE.Vector3()
      .copy(f)
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(r, Math.sin(theta));
    verts.push(stepAlong(p, dir, w));
  }
  return { center: p, verts };
}

export interface ConeGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  indices: number[];
  uvT: number;
}

/**
 * Full index/attribute layout for the cone: a triangle-strip ribbon plus a
 * curved cap fan. `radius` is the globe-elevation the cone sits at (cone must
 * render above the cyclone cap and below the track).
 */
export function buildConeGeometry(strip: ConeStrip, radius: number, arcSteps = 16): ConeGeometry {
  const n = strip.centers.length;
  const positions: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const l = strip.left[i];
    const r = strip.right[i];
    positions.push(l.x * radius, l.y * radius, l.z * radius);
    positions.push(r.x * radius, r.y * radius, r.z * radius);
    uvs.push(0, t, 1, t);
  }

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2;
    const r0 = i * 2 + 1;
    const l1 = (i + 1) * 2;
    const r1 = (i + 1) * 2 + 1;
    indices.push(l0, l1, r1, l0, r1, r0);
  }

  const { center, verts } = buildConeTipArc(strip, arcSteps);
  const capCenter = n * 2;
  positions.push(center.x * radius, center.y * radius, center.z * radius);
  uvs.push(0.5, 1);
  for (let k = 0; k < verts.length; k++) {
    const v = verts[k];
    positions.push(v.x * radius, v.y * radius, v.z * radius);
    uvs.push(k / arcSteps, 1);
  }
  for (let k = 0; k < arcSteps; k++) {
    indices.push(capCenter, capCenter + 1 + k, capCenter + 2 + k);
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices,
    uvT: 0,
  };
}

/**
 * Closed boundary polygon for a cone strip: right boundary, the curved tip arc
 * (excluding its endpoints, which coincide with the strip's right/left ends),
 * then the left boundary reversed, then the right start to close. Suitable for
 * three-globe `polygonsData` fill or any 2D ring input.
 */
export function buildConeOutline(strip: ConeStrip, arcSteps = 16): THREE.Vector3[] {
  const n = strip.centers.length;
  const outline: THREE.Vector3[] = [];

  for (let i = 0; i < n; i++) outline.push(strip.right[i].clone());

  const { verts } = buildConeTipArc(strip, arcSteps);
  for (let k = 1; k < verts.length - 1; k++) outline.push(verts[k].clone());

  for (let i = n - 1; i >= 0; i--) outline.push(strip.left[i].clone());

  outline.push(strip.right[0].clone());
  return outline;
}

// --- Terminal arrowhead --------------------------------------------------

export interface Arrowhead {
  /** The terminal fix on the track radius (tether/anchor). */
  pos: THREE.Vector3;
  tip: THREE.Vector3;
  baseL: THREE.Vector3;
  baseR: THREE.Vector3;
}

/**
 * Direction indicator at the terminal forecast vertex, built in the local
 * tangent frame there (never a fixed world offset). Coloured by the caller
 * from the intensity ramp — not UI white.
 * `fwdEnd` is the smoothed tangent at the terminal vertex from the cone strip.
 */
export function arrowheadAt(
  pEnd: THREE.Vector3,
  fwdEnd: THREE.Vector3,
  headLenRad: number,
  headWidRad: number,
  radius: number,
): Arrowhead {
  const r = new THREE.Vector3().crossVectors(fwdEnd, pEnd).normalize();
  const pos = pEnd.clone().multiplyScalar(radius);
  const tip = stepAlong(pEnd, fwdEnd, headLenRad).multiplyScalar(radius);
  const base = stepAlong(pEnd, fwdEnd, -headLenRad * 0.4);
  const baseL = stepAlong(base, r, -headWidRad).multiplyScalar(radius);
  const baseR = stepAlong(base, r, +headWidRad).multiplyScalar(radius);
  return { pos, tip, baseL, baseR };
}
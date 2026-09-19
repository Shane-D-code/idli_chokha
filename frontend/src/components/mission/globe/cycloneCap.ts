// Broadcast-quality cyclone rendering: a spherical cap glued to the planet,
// shaded by a procedural cloud-spiral shader. Replaces the old flat sprite
// markers entirely.
//
// Data-driven everywhere: every uniform is derived from wind speed and
// latitude; no per-storm visual constants.
//
// The "eye" is a genuine clearing (the planet shows through), not a black
// disc. Differential rotation makes the core spin faster than the bands.

import * as THREE from "three";
import { intensity01ForWind } from "@/utils/intensity";

// Legibility choice — storms are deliberately drawn larger than physical
// truth so they read clearly on a dashboard-sized globe.
const VISUAL_EXAGGERATION = 1.6;

export const CYCLONE_CAP_RADIUS = 1.006; // globe radii, sits above the cloud shell

const CAP_RINGS = 48;
const CAP_SEGMENTS = 96;

const U_SEED_MIN = 0.0;
const U_SEED_MAX = 100.0;

/** Deterministic per-storm seed so two storms of equal intensity differ. */
export function cycloneSeed(stormId: string): number {
  let h = 2166136261;
  for (let i = 0; i < stormId.length; i++) {
    h ^= stormId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const f = ((h >>> 0) % 100000) / 100000;
  return U_SEED_MIN + f * (U_SEED_MAX - U_SEED_MIN);
}

/**
 * Spherical-cap disc centred on (lat, lon). Every vertex is projected onto the
 * sphere at `CYCLONE_CAP_RADIUS`; local +Y is the geographic north tangent so
 * the spiral handedness is correct on both hemispheres. UVs stay planar in the
 * tangent frame.
 */
export function buildCycloneCapGeometry(
  lat: number,
  lon: number,
  angularRadiusDeg: number,
): THREE.BufferGeometry {
  const center = new THREE.Vector3();
  const northT = new THREE.Vector3();
  const eastT = new THREE.Vector3();
  setLatLon(center, lat, lon);
  tangentBasis(center, northT, eastT);

  const maxTan = Math.tan((angularRadiusDeg * Math.PI) / 180);
  const verts = new Float32Array(CAP_RINGS * CAP_SEGMENTS * 3);
  const uvs = new Float32Array(CAP_RINGS * CAP_SEGMENTS * 2);
  const idx: number[] = [];

  for (let r = 0; r < CAP_RINGS; r++) {
    // denser near the centre so the eye has resolution
    const tf = r / (CAP_RINGS - 1);
    const radialFrac = Math.pow(tf, 2.2);
    const radius = maxTan * radialFrac;
    for (let s = 0; s < CAP_SEGMENTS; s++) {
      const theta = (s / CAP_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const off = new THREE.Vector3()
        .addScaledVector(eastT, cos * radius)
        .addScaledVector(northT, sin * radius);
      const pos = center.clone().add(off).normalize().multiplyScalar(CYCLONE_CAP_RADIUS);
      const vi = (r * CAP_SEGMENTS + s) * 3;
      verts[vi] = pos.x;
      verts[vi + 1] = pos.y;
      verts[vi + 2] = pos.z;
      const uvi = (r * CAP_SEGMENTS + s) * 2;
      uvs[uvi] = 0.5 + cos * radialFrac * 0.5;
      uvs[uvi + 1] = 0.5 + sin * radialFrac * 0.5;
    }
  }

  for (let r = 0; r < CAP_RINGS - 1; r++) {
    for (let s = 0; s < CAP_SEGMENTS; s++) {
      const sNext = (s + 1) % CAP_SEGMENTS;
      const a = r * CAP_SEGMENTS + s;
      const b = r * CAP_SEGMENTS + sNext;
      const c = (r + 1) * CAP_SEGMENTS + s;
      const d = (r + 1) * CAP_SEGMENTS + sNext;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

function setLatLon(out: THREE.Vector3, lat: number, lon: number): void {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  const s = Math.sin(phi);
  out.set(-s * Math.cos(theta), Math.cos(phi), s * Math.sin(theta));
}

function tangentBasis(center: THREE.Vector3, northT: THREE.Vector3, eastT: THREE.Vector3): void {
  const up = new THREE.Vector3(0, 1, 0);
  northT.copy(up).addScaledVector(center, -center.dot(up)).normalize();
  eastT.crossVectors(northT, center).normalize();
}

export interface CycloneUniforms {
  uTime: number;
  uIntensity: number;
  uEyeRadius: number;
  uSpin: number;
  uSeed: number;
  uOpacity: number;
}

/** All cyclone visual parameters, derived purely from data. */
export function cycloneUniforms(lat: number, windKt: number | null | undefined, seed: number): CycloneUniforms {
  const intensity = intensity01ForWind(windKt);
  const eyeRadius =
    smoothstep(0.55, 0.95, intensity) * 0.09 * (1.0 - 0.35 * intensity);
  return {
    uTime: 0,
    uIntensity: intensity,
    uEyeRadius: eyeRadius,
    uSpin: Math.sign(lat),
    uSeed: seed,
    uOpacity: 1,
  };
}

export function cycloneAngularRadiusDeg(windKt: number | null | undefined): number {
  const intensity = intensity01ForWind(windKt);
  return (3.2 + (6.8 - 3.2) * intensity) * VISUAL_EXAGGERATION;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform float uIntensity;   // 0..1, normalised from sustained wind
  uniform float uEyeRadius;   // 0.0 for disorganised systems, up to ~0.09
  uniform float uSpin;        // +1 northern hemisphere, -1 southern
  uniform float uSeed;        // per-storm, so no two look identical
  uniform float uOpacity;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2  p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float th = atan(p.y, p.x);

    // Differential rotation: the core spins faster than the outer bands.
    float omega = mix(0.8, 2.4, uIntensity);
    float diff  = 1.0 / (0.18 + r);
    float spin  = uSpin * uTime * omega * 0.06 * diff;

    // Logarithmic spiral warp.
    float k    = mix(2.1, 4.6, uIntensity);
    float sTh  = th + spin + k * log(max(r, 0.04));
    float arms = mix(2.0, 5.0, uIntensity);
    float band = 0.5 + 0.5 * sin(sTh * arms);

    // Domain-warped fbm for cloud structure.
    vec2 q = vec2(cos(sTh), sin(sTh)) * r * 3.0 + uSeed * 37.0;
    float clouds = fbm(q * 2.5 + vec2(fbm(q * 1.3), fbm(q * 1.7 + 5.0)));

    float dens = clouds * mix(0.55, 1.0, band);

    // Eye: a genuine clearing — density goes to zero and the planet shows
    // through. Eyewall: a bright ring just outside it.
    float eye = smoothstep(uEyeRadius * 0.55, uEyeRadius * 1.45, r);
    float eyewall =
        smoothstep(uEyeRadius * 0.85, uEyeRadius * 1.35, r) *
        smoothstep(uEyeRadius * 2.70, uEyeRadius * 1.50, r) *
        uIntensity * 1.5;
    dens = dens * eye + eyewall;

    // Feather to nothing at the rim so there is no visible disc edge.
    float env = smoothstep(1.0, 0.52, r) * smoothstep(0.0, 0.10, r);

    float a = clamp(dens * env, 0.0, 1.0);
    a = pow(a, mix(1.7, 1.05, uIntensity));

    // Cool shadowed cloud base to white illuminated tops.
    vec3 col = mix(vec3(0.70, 0.76, 0.86), vec3(1.0), a);

    gl_FragColor = vec4(col, a * uOpacity * mix(0.72, 1.0, uIntensity));
  }
`;

export interface CycloneCap {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  center: THREE.Vector3;
  uniforms: CycloneUniforms;
  /** Updates shader uniforms — call every frame from the render loop. */
  update(dt: number, reducedMotion: boolean): void;
  dispose(): void;
}

export function createCycloneCap(
  lat: number,
  lon: number,
  windKt: number | null | undefined,
  seed: number,
  _opts?: Partial<CycloneUniforms>,
): CycloneCap {
  const uniforms = cycloneUniforms(lat, windKt, seed);
  if (_opts) Object.assign(uniforms, _opts);

  const geo = buildCycloneCapGeometry(lat, lon, cycloneAngularRadiusDeg(windKt));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: uniforms.uTime },
      uIntensity: { value: uniforms.uIntensity },
      uEyeRadius: { value: uniforms.uEyeRadius },
      uSpin: { value: uniforms.uSpin },
      uSeed: { value: uniforms.uSeed },
      uOpacity: { value: uniforms.uOpacity },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, material);

  const center = new THREE.Vector3();
  setLatLon(center, lat, lon);

  let t = 0; // decoupled animation clock, in seconds

  return {
    mesh,
    material,
    center,
    uniforms,
    update(dt: number, reducedMotion: boolean) {
      if (!reducedMotion) t += dt;
      material.uniforms.uTime.value = t;
      material.uniforms.uIntensity.value = uniforms.uIntensity;
      material.uniforms.uEyeRadius.value = uniforms.uEyeRadius;
      material.uniforms.uOpacity.value = uniforms.uOpacity;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
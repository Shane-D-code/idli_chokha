import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { getCloudTextureCanvas } from "./cloudTexture";
import {
  createCycloneCap,
  cycloneSeed,
  type CycloneCap,
} from "./cycloneCap";
import { getOceanMaskCanvas } from "./oceanMask";
import {
  getCurrentMarkerTextureCanvas,
  getDisturbanceTextureCanvas,
  getForecastMarkerTextureCanvas,
  getOpsInvestTextureCanvas,
} from "./cycloneTexture";

import { latLonToVec3 } from "./geo";
import { intensityRampColor } from "@/utils/intensity";
import {
  arrowheadAt,
  buildConeGeometry,
  buildConeStrip,
  coneWidthsRad,
  resampleTrack,
  type TrackSample,
} from "@/geo/geo";
import {
  buildTrackSegments,
  normalizeTrack,
  toTrackInput,
  trackValidationLog,
  type NormalizedTrackPoint,
  type TrackSegment,
} from "@/utils/trackModel";

export interface GlobeStormData {
  lat: number;
  lon: number;
  name?: string | null;
  id?: string | null;
  category?: string | null;
  windKt?: number | null;
  mslpHpa?: number | null;
  basin?: string | null;
  movement?: { direction?: string | null; speedKph?: number | null } | null;
  /** System probability (0..1), rendered in ops-variant callouts. */
  probability24h?: number;
}

export interface GlobeDisturbanceData {
  lat: number;
  lon: number;
  label: string;
  probability24h?: number;
  risk?: string;
}

export interface GlobeTrackPoint {
  lat: number;
  lon: number;
  horizonHours: number;
  uncertaintyKm?: number;
  isForecast: boolean;
  windKt?: number;
  mslpHpa?: number;
  timestamp?: string;
}

export interface GlobeCity {
  name: string;
  lat: number;
  lon: number;
}

export type GlobeSelection =
  | { kind: "storm"; data: GlobeStormData }
  | { kind: "disturbance"; data: GlobeDisturbanceData }
  | { kind: "forecast"; hours: number; point: GlobeTrackPoint }
  | null;

/** Normalized track point → the ops-globe's own track point shape. */
function toGlobeTrackPoint(p: NormalizedTrackPoint): GlobeTrackPoint {
  return {
    lat: p.latitude,
    lon: p.longitude,
    horizonHours: p.horizonHours,
    uncertaintyKm: p.uncertaintyKm,
    isForecast: p.isForecast,
    windKt: p.windKt,
    timestamp: p.timestamp,
  };
}

function tsMillis(p: NormalizedTrackPoint): number | null {
  if (p.timestamp == null) return null;
  const t = Date.parse(p.timestamp);
  return Number.isFinite(t) ? t : null;
}

function latestTimestamp(points: NormalizedTrackPoint[]): number | null {
  let max: number | null = null;
  for (const p of points) {
    const t = tsMillis(p);
    if (t != null && (max == null || t > max)) max = t;
  }
  return max;
}

/** Spherical linear interpolation between two unit vectors, in place. */
function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const omega = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  if (omega < 1e-6) return out.copy(a);
  const sinOmega = Math.sin(omega);
  const ka = Math.sin((1 - t) * omega) / sinOmega;
  const kb = Math.sin(t * omega) / sinOmega;
  return out.set(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb).normalize();
}

let dotTexture: THREE.Texture | null = null;
/** Shared soft round dot for dotted tracks (rounder than raw GL points). */
function roundDotTexture(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

const CONE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    float vRim   = abs(vUv.x - 0.5) * 2.0;           // 0 centreline → 1 edge
    float rim    = 1.0 - smoothstep(0.35, 1.0, vRim); // feathered edges
    float trail  = smoothstep(0.0, 0.15, vUv.y);      // merge into the storm
    float tip    = 1.0 - 0.55 * smoothstep(0.9, 1.0, vUv.y); // feather the tip
    float alpha  = uOpacity * rim * (0.3 + 0.7 * trail) * tip;
    vec3  col    = uColor * (1.0 + 0.25 * (1.0 - vRim)); // subtle centreline glow
    gl_FragColor = vec4(col, alpha);
  }
`;

// ── Final broadcast grade ─────────────────────────────────────────────────
// Applied after the scene pass: subtle vignette that seats the globe in the
// dashboard, a tiny radial chromatic fringe (cinema lenses, not a 90s anaglyph)
// and a gentle tone grade — blue shadow lift + warm highlight bias.
const POST_FX = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0016 },
    uVignette: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uAberration;
    uniform float uVignette;

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float dist = length(d) * 1.41421;

      // vignette — stronger toward the screen corners, keeps centre clean
      float vig = 1.0 - uVignette * smoothstep(0.25, 1.0, dist);

      // radial chromatic fringe, tiny
      vec2 dir = d / (dist * 1.41421 + 1e-4);
      float ca = uAberration * dist;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca * 1.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca * 1.2).b;

      // gentle tone grade — soft blue shadow lift, warm highlights
      vec3 grade = pow(col, vec3(1.035));
      col = mix(col, grade, 0.55);
      col += vec3(0.006, 0.010, 0.020) * (1.0 - col) * 0.8;

      // film grain, barely-there so dithering hides banding
      float grain = fract(sin(dot(uv * uResolution, vec2(12.9898, 78.233))) * 43758.5453);
      col *= 1.0 + (grain - 0.5) * 0.022;

      col *= vig;

      gl_FragColor = vec4(col, texture2D(tDiffuse, uv).a);
    }
  `,
};

export interface GlobeFocus {
  lat: number;
  lon: number;
  /** Camera distance in globe radii. */
  distance?: number;
}

export type GlobeLayerKind = "satellite" | "track" | "cone" | "cities";

/** Tracks: how far back (hours) the solid "recent lead" extends. */
const RECENT_LEAD_HOURS = 24;
/** Older history drawn as small white dots at this world-unit size. */
const OBS_DOT_SIZE = 0.022;
/** Forecast/ramp dots at this world-unit size. */
const FC_DOT_SIZE = 0.028;
/** Along-track spacing between dots, in radians of great-circle arc. */
const TRACK_DOT_STEP = 0.02;

// Globe-elevation stacking (all on a unit-sphere scene): cloud shell < storm
// cap < uncertainty cone < track < markers. renderOrder mirrors the same
// ladder so transparent layers never z-fight: cap = 10, cone = 11, track = 12,
// markers = 13.
const CONE_RADIUS = 1.008;
const TRACK_RADIUS = 1.01;
const MARKER_RADIUS = 1.012;
const CONE_RENDER_ORDER = 11;
const TRACK_RENDER_ORDER = 12;
const MARKER_RENDER_ORDER = 13;

interface GlobeOptions {
  container: HTMLElement;
  reducedMotion?: boolean;
  focus?: GlobeFocus;
  onSelect?: (sel: GlobeSelection) => void;
  /** "mission" = cinematic landing (default), "ops" = dashboard hero. */
  variant?: "mission" | "ops";
  /** Optional accent hex used to tint atmosphere + track in ops variant. */
  accent?: string;
}

/** One projected HTML label tethered to a world position. */
interface SceneLabel {
  key: string;
  priority: number;
  world: THREE.Vector3;
  el: HTMLDivElement;
  align: string; // trailing translate cue (e.g. "translate(10px,-50%)")
  size: { w: number; h: number };
  shown: boolean;
}

const DEFAULT_DISTANCE = 2.55;

const MISSION_ATMO: [number, number, number] = [0.32, 0.62, 1.0];
const OPS_ATMO: [number, number, number] = [0.21, 0.81, 0.89]; // #35cfe3

// ── NASA Blue Marble texture URLs (8K primary, 4K fallback) ────────────
const BLUE_MARBLE_URL =
  "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const BLUE_MARBLE_FALLBACK_URL =
  "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";

/** Safe texture load with 4K fallback when 8K exceeds GPU limits. */
function loadTexture(url: string, fallbackUrl?: string): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        const maxSize = glMaxTextureSize();
        if (maxSize && (tex.image?.width ?? 0) > maxSize && fallbackUrl) {
          loader.load(fallbackUrl, resolve, undefined, () => resolve(makeFallbackCanvas()));
        } else {
          resolve(tex);
        }
      },
      undefined,
      () => {
        if (fallbackUrl && fallbackUrl !== url) {
          loader.load(fallbackUrl, resolve, undefined, () => resolve(makeFallbackCanvas()));
        } else {
          resolve(makeFallbackCanvas());
        }
      },
    );
  });
}

function glMaxTextureSize(): number | null {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") ?? c.getContext("webgl2");
    if (!gl) return null;
    return gl.getParameter(gl.MAX_TEXTURE_SIZE);
  } catch {
    return null;
  }
}

function makeFallbackCanvas(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, "#06131f");
  g.addColorStop(0.45, "#0d3044");
  g.addColorStop(0.55, "#0d3044");
  g.addColorStop(1, "#06131f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  return new THREE.CanvasTexture(c);
}

export class GlobeScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private cloudMesh: THREE.Mesh | null = null;
  private pulseMat: THREE.MeshBasicMaterial | null = null;
  private pulseTime = 0;
  private starField: THREE.Points | null = null;
  private labelLayer: HTMLDivElement;
  private labels: SceneLabel[] = [];
  private composer: EffectComposer;


  private satGroup = new THREE.Group();
  private trackGroup = new THREE.Group();
  private cityGroup = new THREE.Group();
  private coneMesh: THREE.Mesh | null = null;
  private stormCaps: CycloneCap[] = [];

  private pickables: THREE.Object3D[] = [];
  private pickHandlers = new Map<THREE.Object3D, () => GlobeSelection>();

  private raf = 0;
  private lastTime = 0;
  private disposed = false;
  private reducedMotion: boolean;
  private paused = false;
  private observer: ResizeObserver | null = null;
  private disposables: { dispose(): void }[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private userActive = false;
  private pulse: THREE.Mesh | null = null;
  private variant: "mission" | "ops" = "mission";

  constructor(private readonly opts: GlobeOptions) {
    this.reducedMotion = opts.reducedMotion ?? false;
    this.variant = opts.variant ?? "mission";
    const container = opts.container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    // HTML label layer — browsers render text crisper than canvas sprites
    // and it gives us true collision resolution between labels.
    this.labelLayer = document.createElement("div");
    this.labelLayer.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3;"
      + "font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 60);

    this.buildEarth();
    this.buildLighting();
    this.buildAtmosphere();
    this.buildClouds();
    this.buildStars();
    this.scene.add(this.satGroup, this.trackGroup, this.cityGroup);

    // Broadcast grade pipeline: scene → vignette + chromatic + tone grade.
    this.composer = new EffectComposer(this.renderer);
    // Render the scene pass into sRGB targets so the FX pass reads display
    // values and writes them out unchanged (custom shaders skip auto-encode).
    this.composer.renderTarget1.texture.colorSpace = THREE.SRGBColorSpace;
    this.composer.renderTarget2.texture.colorSpace = THREE.SRGBColorSpace;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const post = new ShaderPass(POST_FX);
    post.uniforms.uResolution.value.set(
      Math.max(1, Math.floor(this.renderer.domElement.clientWidth)),
      Math.max(1, Math.floor(this.renderer.domElement.clientHeight)),
    );
    this.composer.addPass(post);

    const focus = opts.focus ?? { lat: 16, lon: 84 };
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.75;
    this.controls.maxDistance = 9;
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.autoRotateSpeed = 4;
    this.focus(focus.lat, focus.lon, focus.distance ?? DEFAULT_DISTANCE, false);

    // Auto-rotate is cancelled on first user interaction and never resumes.
    this.controls.addEventListener("start", this.onUserStart);
    this.controls.addEventListener("end", this.onUserEnd);

    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);

    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKey);

    // TEMP-DIAG — remove after diagnosis: exposes renderer, scene, camera and
    // a latent vector→screen-px projector so the probe can locate objects.
    this.renderer.debug.onShaderError = (_gl, _program, vs, fs) => {
      console.error("[SHADER-ERROR] vertex:", vs);
      console.error("[SHADER-ERROR] fragment:", fs);
    };
    (window as unknown as { __TOOFAN_SCENE_HOOK__: unknown }).__TOOFAN_SCENE_HOOK__ = (cb: (api: {
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      canvasOffset: () => { x: number; y: number };
      project: (world: THREE.Vector3) => { x: number; y: number } | null;
    }) => void) => cb({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      canvasOffset: () => {
        const rc = this.renderer.domElement.getBoundingClientRect();
        return { x: rc.left, y: rc.top };
      },
      project: (world: THREE.Vector3) => {
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        if (!size.x || !size.y) return null;
        const ndc = world.clone().project(this.camera);
        if (ndc.z > 1) return null;
        const rc = this.renderer.domElement.getBoundingClientRect();
        return {
          x: rc.left + (ndc.x * 0.5 + 0.5) * size.x,
          y: rc.top + (-ndc.y * 0.5 + 0.5) * size.y,
        };
      },
    });

    this.raf = requestAnimationFrame(this.tick);
  }

  // ----------------------------------------------------------
  // Scene builders
  // ----------------------------------------------------------

  /** Load Blue Marble with 4K fallback; procedural canvas on network error. */
  private async buildEarth(): Promise<void> {
    const tex = await loadTexture(BLUE_MARBLE_URL, BLUE_MARBLE_FALLBACK_URL);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const img = tex.image as { width?: number } | undefined;
    if (img?.width) {
      tex.anisotropy = aniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
    }
    this.disposables.push(tex);

    // Land/ocean roughness mask — ocean gets a specular lobe, land does not.
    const roughnessTex = new THREE.CanvasTexture(getOceanMaskCanvas());
    roughnessTex.colorSpace = THREE.NoColorSpace;
    roughnessTex.generateMipmaps = true;
    this.disposables.push(roughnessTex);

    const geo = new THREE.SphereGeometry(1, 96, 96);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughnessMap: roughnessTex,
      roughness: 0.9,
      metalness: 0,
      emissive: new THREE.Color(0x061220),
      emissiveIntensity: 0.08,
    });
    this.disposables.push(geo);
    this.disposables.push(mat);
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private buildLighting(): void {
    // Hemisphere fill — warm sky + cool ground, so the night side is readable
    // rather than pitch black.
    this.scene.add(new THREE.HemisphereLight(0x8fb4d8, 0x1a2e40, 0.65));

    // Key sun light — warm directional, positioned for a lit terminator
    // across the Indian Ocean basin.
    const key = new THREE.DirectionalLight(0xfff3e0, 1.35);
    key.position.set(5, 3.5, 4);
    this.scene.add(key);

    // Subtle fill from the opposite side to keep the dark limb from going
    // completely black.
    const fill = new THREE.DirectionalLight(0x4a6e8c, 0.35);
    fill.position.set(-4, -1.5, -3);
    this.scene.add(fill);
  }

  private buildAtmosphere(): void {
    const base = this.variant === "ops" ? OPS_ATMO : MISSION_ATMO;
    const col = `vec3(${base[0].toFixed(2)}, ${base[1].toFixed(2)}, ${base[2].toFixed(2)})`;

    // ── Inner atmosphere — Fresnel rim glow (FrontSide, additive) ────────
    const innerMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        uniform vec3 uSunDir;
        void main() {
          float fres = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 3.0);
          float sun = clamp(dot(vWorldNormal, uSunDir), 0.0, 1.0);
          float glow = fres * 0.9 * (0.25 + 0.75 * sun);
          gl_FragColor = vec4(${col}, glow);
        }
      `,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(5, 3.5, 4).normalize() },
      },
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
    });
    const innerGeo = new THREE.SphereGeometry(1.005, 64, 64);
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.disposables.push(innerGeo, innerMat);
    this.scene.add(innerMesh);

    // ── Outer glow — wide soft halo (BackSide, additive) ─────────────────
    // BackSide far-hemisphere normals point away from the camera (dot ≈ -1),
    // so intensity = pow(0.7 − dot, 2) peaks near the limb and fades out to the
    // shell silhouette, and the opaque Earth occludes the white-hot centre.
    const outerMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        uniform vec3 uSunDir;
        void main() {
          float fres = pow(0.7 - dot(vNormal, vViewDir), 2.0);
          float sun = clamp(dot(vWorldNormal, uSunDir), 0.0, 1.0);
          float glow = fres * 0.35 * (0.25 + 0.75 * sun);
          gl_FragColor = vec4(${col}, glow);
        }
      `,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(5, 3.5, 4).normalize() },
      },
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const outerGeo = new THREE.SphereGeometry(1.15, 48, 48);
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    this.disposables.push(outerGeo, outerMat);
    this.scene.add(outerMesh);
  }

  private buildClouds(): void {
    const tex = new THREE.CanvasTexture(getCloudTextureCanvas());
    tex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(tex);
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    // Cloud shell sits just above the earth but below the cyclone caps so
    // storms read crisp instead of being washed out by a global haze.
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.003, 48, 48), mat);
    this.disposables.push(this.cloudMesh.geometry as THREE.BufferGeometry);
    this.disposables.push(mat);
    this.satGroup.add(this.cloudMesh);
  }

  private buildStars(): void {
    const count = 320;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(
        10 + Math.random() * 10,
        Math.acos(2 * Math.random() - 1),
        Math.random() * Math.PI * 2
      );
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x93a9be,
      size: 0.016,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.starField = new THREE.Points(geo, mat);
    this.disposables.push(geo);
    this.disposables.push(mat);
    this.scene.add(this.starField);
  }

  // ----------------------------------------------------------
  // Storm layer
  // ----------------------------------------------------------
  setStorm(storm: GlobeStormData | null): void {
    this.clearGroup(this.satGroup, (child) => child !== this.cloudMesh);
    this.stormCaps = [];
    this.pulse = null;
    this.pulseMat = null;
    if (!storm) return;

    // Broadcast-quality cyclone: a spherical cloud cap with a procedural
    // spiral shader, glued to the planet at the storm's track location.
    const seed = cycloneSeed(storm.id ?? `${storm.lat},${storm.lon}`);
    const cap = createCycloneCap(storm.lat, storm.lon, storm.windKt, seed);
    cap.mesh.renderOrder = 10;
    cap.mesh.userData.layer = "sat-storm";
    cap.mesh.userData.stormCenter = cap.center.clone();
    this.pickables.push(cap.mesh);
    this.pickHandlers.set(cap.mesh, () => ({ kind: "storm", data: storm }));
    this.satGroup.add(cap.mesh);
    this.stormCaps.push(cap);

    // HTML status badge tethered above the storm, accent = intensity ramp.
    if (storm.name || storm.category) {
      const dir = latLonToVec3(storm.lat, storm.lon);
      const accent = intensityRampColor(storm.windKt);
      const pct = storm.probability24h != null ? Math.round(storm.probability24h * 100) : null;
      const title = this.variant === "ops"
        ? `CYCLONE ${storm.name ?? "UNNAMED"}${pct != null ? `  ·  ${pct}%` : ""}`
        : `TC ${storm.name ?? "UNNAMED"}`;
      const meta = this.variant === "ops"
        ? `${storm.category ?? "CYCLONE"}`
          + (storm.windKt != null ? ` · ${storm.windKt} kt` : "")
          + (storm.mslpHpa != null ? ` · ${Math.round(storm.mslpHpa)} hPa` : "")
        : `${storm.category ?? "CYCLONE"}  ·  ${storm.windKt ?? "—"} KT  ·  ${storm.mslpHpa ?? "—"} HPA`;
      this.addSceneLabel(
        "storm:main",
        dir,
        `<div style="display:flex;align-items:center;gap:8px;background:rgba(8,16,26,0.78);`
          + `border:1px solid rgba(148,163,184,0.4);border-left:3px solid ${accent};`
          + `border-radius:8px;padding:5px 9px;backdrop-filter:blur(8px);`
          + `box-shadow:0 6px 18px rgba(0,0,0,0.45);">`
          + `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;`
          + `background:${accent};box-shadow:0 0 10px ${accent};"></span>`
          + `<div><div style="font-size:11px;font-weight:800;letter-spacing:0.03em;`
          + `line-height:1.3;">${title}</div>`
          + `<div style="font-size:10px;font-weight:500;opacity:0.85;line-height:1.3;">${meta}</div>`
          + `</div></div>`,
        200,
      );
    }

    // position ring + breathing pulse on the surface
    const v = latLonToVec3(storm.lat, storm.lon).multiplyScalar(1.004);
    this.addRing(this.satGroup, v, 0.032, 0.038, 0xeaeff2, 0.6);

    if (!this.reducedMotion) {
      const pulseGeo = new THREE.RingGeometry(0.034, 0.038, 48);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: this.variant === "ops" ? 0x22d3ee : 0xffc47a,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const pulse = new THREE.Mesh(pulseGeo, pulseMat);
      pulse.position.copy(v);
      pulse.lookAt(v.clone().multiplyScalar(2));
      this.disposables.push(pulseGeo);
      this.disposables.push(pulseMat);
      this.satGroup.add(pulse);
      this.pulse = pulse;
      this.pulseMat = pulseMat;
    }
  }

  setDisturbances(list: GlobeDisturbanceData[]): void {
    this.removeSceneLabels("invest:");
    for (const child of [...this.satGroup.children]) {
      if (child === this.cloudMesh) continue;
      if (child.userData.layer !== "sat-disturb") continue;
      this.satGroup.remove(child);
      this.disposeObject(child);
    }
    for (const d of list) {
      const dir = latLonToVec3(d.lat, d.lon);
      this.addSprite(
        this.satGroup,
        this.variant === "ops" ? getOpsInvestTextureCanvas() : getDisturbanceTextureCanvas(),
        dir.clone().multiplyScalar(1.014),
        this.variant === "ops" ? 0.1 : 0.13,
        undefined,
        () => ({ kind: "disturbance", data: d })
      ).userData.layer = "sat-disturb";

      const label = `${d.label.toUpperCase()} · ${Math.round((d.probability24h ?? 0) * 100)}%`;
      this.addSceneLabel(
        `invest:${d.lat}:${d.lon}`,
        dir,
        `<span style="background:rgba(8,16,26,0.72);border:1px solid`
          + ` ${this.variant === "ops" ? "rgba(83,200,229,0.45)" : "rgba(251,191,36,0.5)"};`
          + ` border-radius:999px;padding:2px 8px;font-size:9.5px;font-weight:700;`
          + `color:${this.variant === "ops" ? "#7fe0f0" : "#fde68a"};`
          + `letter-spacing:0.04em;">${label}</span>`,
        60,
      );
    }
  }

  // ----------------------------------------------------------
  // Track / forecast / cone layers
  // ----------------------------------------------------------
  setTrack(points: GlobeTrackPoint[]): void {
    this.clearGroup(this.trackGroup);
    this.removeSceneLabels("h:");
    this.coneMesh = null;
    if (!points.length) return;

    // Canonical pipeline: validate/sort/split/segment via trackModel so the
    // ops globe and the mission hero draw the SAME track, colours and cone.
    const track = normalizeTrack(points.map(toTrackInput));
    trackValidationLog(this.variant === "ops" ? "OpsGlobe" : "MissionGlobe", track);

    const OBS_DOT = "#cbdce9";
    const FC_NEUTRAL = this.variant === "ops" ? "#35cfe3" : "#ffc47a";

    // ── Observed history ─────────────────────────────────────────────────
    // Recent lead (last ~24 h before the current position): SOLID, ramp
    // coloured with a per-vertex gradient so the freshest end reads hottest.
    // Everything older: small white dots (far fewer stereoscopic cues).
    const obsPts = track.current ? [...track.observed, track.current] : track.observed;

    const anchorTs = latestTimestamp(obsPts);
    const leadCut =
      anchorTs != null ? anchorTs - RECENT_LEAD_HOURS * 3.6e6 : null;
    const isLead = leadCut == null
      ? (_: NormalizedTrackPoint, i: number) => i >= obsPts.length - 2
      : (p: NormalizedTrackPoint) => tsMillis(p) != null && tsMillis(p)! >= leadCut;

    for (const seg of buildTrackSegments(obsPts.filter((p) => isLead(p, -1)))) {
      const from = intensityRampColor(seg.from.windKt);
      const to = intensityRampColor(seg.to.windKt);
      this.trackGroup.add(this.buildSegmentLine(seg, TRACK_RADIUS, [from, to], false));
    }
    const older = obsPts.filter((p) => !isLead(p, -1));
    if (older.length > 1) {
      this.trackGroup.add(this.buildTrackDots(older, TRACK_RADIUS, TRACK_DOT_STEP, () => OBS_DOT, OBS_DOT_SIZE));
    }

    // Current position anchor (neutral white ring).
    if (track.current) {
      const v = latLonToVec3(track.current.latitude, track.current.longitude).multiplyScalar(MARKER_RADIUS);
      this.addSprite(this.trackGroup, getCurrentMarkerTextureCanvas(), v, 0.05);
    }

    if (track.forecast.length) {
      const fcPts = track.current ? [track.current, ...track.forecast] : track.forecast;

      // Forecast: dotted, ramp coloured, at the marker radius.
      this.buildTrackDots(fcPts, MARKER_RADIUS, TRACK_DOT_STEP, (p) => intensityRampColor(p.windKt), FC_DOT_SIZE);

      // Uncertainty cone: only the model-supplied sigma, never invented.
      this.coneMesh = this.buildForecastCone(fcPts, this.variant === "ops" ? 0x4ea8ff : 0xffb257);

      for (const p of track.forecast) {
        const color = intensityRampColor(p.windKt) ?? FC_NEUTRAL;
        this.addSprite(
          this.trackGroup,
          getForecastMarkerTextureCanvas(this.hexToRgbStr(color)),
          latLonToVec3(p.latitude, p.longitude).multiplyScalar(MARKER_RADIUS),
          this.variant === "ops" ? 0.028 : 0.03,
          undefined,
          () => ({ kind: "forecast", hours: p.horizonHours, point: toGlobeTrackPoint(p) })
        );

        if (p.horizonHours % 6 === 0) {
          const dir = latLonToVec3(p.latitude, p.longitude);
          const color = this.variant === "ops" ? "#53e6f2" : "#ffd9a0";
          this.addSceneLabel(
            `h:${p.horizonHours}`,
            dir,
            `<span style="background:rgba(8,16,26,0.66);border:1px solid rgba(148,163,184,0.3);`
              + `border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;`
              + `color:${color};">+${p.horizonHours}h</span>`,
            50,
            "translate(12px, -50%)",
          );
        }
      }
    }

    this.setLayer("track", true);
    this.setLayer("cone", true);
  }

  /** One solid/dashed line segment; a 2-tuple colours from→to for a gradient. */
  private buildSegmentLine(
    seg: TrackSegment,
    radius: number,
    color: string | [string, string],
    dashed: boolean,
  ): THREE.Line {
    const a = latLonToVec3(seg.from.latitude, seg.from.longitude).multiplyScalar(radius);
    const b = latLonToVec3(seg.to.latitude, seg.to.longitude).multiplyScalar(radius);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), 3),
    );
    const gradient = Array.isArray(color);

    if (dashed) {
      const mat = new THREE.LineDashedMaterial({
        color: new THREE.Color(gradient ? color[1] : color),
        dashSize: 0.022,
        gapSize: 0.018,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      line.renderOrder = TRACK_RENDER_ORDER;
      this.disposables.push(geo);
      this.disposables.push(mat);
      return line;
    }

    const c0 = new THREE.Color(gradient ? color[0] : color);
    const c1 = new THREE.Color(gradient ? color[1] : color);
    if (gradient) {
      geo.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array([c0.r, c0.g, c0.b, c1.r, c1.g, c1.b]), 3),
      );
    }
const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(gradient ? 0xffffff : c0),
      vertexColors: gradient,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.disposables.push(mat);
    const line = new THREE.Line(geo, mat);
    line.renderOrder = TRACK_RENDER_ORDER;
    this.disposables.push(geo);
    return line;
  }

  /**
   * Dotted track: small round points resampled along the great-circle arcs of
   * `points`, each tinted by `colorFn`. Single draw call, low triangle count,
   * the same look as broadcast cyclone graphics (JTWC/NASA worldview).
   */
  private buildTrackDots(
    points: NormalizedTrackPoint[],
    radius: number,
    stepRad: number,
    colorFn: (p: NormalizedTrackPoint) => string,
    size: number,
  ): THREE.Points {
    const positions: number[] = [];
    const colors: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < points.length - 1; i++) {
      const a = latLonToVec3(points[i].latitude, points[i].longitude);
      const b = latLonToVec3(points[i + 1].latitude, points[i + 1].longitude);
      const arc = a.angleTo(b);
      const steps = Math.max(1, Math.round(arc / stepRad));
      for (let s = 0; s < steps; s++) {
        slerpUnit(a, b, s / steps, v);
        positions.push(v.x * radius, v.y * radius, v.z * radius);
        const c = new THREE.Color(colorFn(points[i + (s === steps - 1 ? 1 : 0)]));
        colors.push(c.r, c.g, c.b);
      }
    }
    // Endpoint dot so a 1-step tail isn't lost
    const last = points[points.length - 1];
    if (points.length) {
      const lv = latLonToVec3(last.latitude, last.longitude).multiplyScalar(radius);
      positions.push(lv.x, lv.y, lv.z);
      const c = new THREE.Color(colorFn(last));
      colors.push(c.r, c.g, c.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    const mat = new THREE.PointsMaterial({
      map: roundDotTexture(),
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const pointsObj = new THREE.Points(geo, mat);
    pointsObj.userData.layer = "track-dots";
    pointsObj.renderOrder = TRACK_RENDER_ORDER;
    this.disposables.push(geo);
    this.disposables.push(mat);
    this.trackGroup.add(pointsObj);
    return pointsObj;
  }

  /**
   * Broadcast uncertainty cone: a dense, smooth ribbon resampled along the
   * forecast track. Width follows ONLY the model-supplied `uncertaintyKm`
   * (never invented); it pinches to exactly zero at the current position and
   * is monotonic non-decreasing toward the tip (see src/geo — all maths on
   * unit vectors, so the perpendicular can never flip at any latitude). A
   * ramped terminal arrowhead marks the forecast destination.
   */
  private buildForecastCone(
    forecastPts: NormalizedTrackPoint[],
    color: number,
  ): THREE.Mesh | null {
    const withU = forecastPts.filter((p) => p.uncertaintyKm != null && p.uncertaintyKm >= 0);
    if (withU.length < 2) return null;

    const resolvesToCurrent = withU[0].horizonHours === 0;
    const resampled = resampleTrack(
      withU.map((p, i) => ({
        lat: p.latitude,
        lon: p.longitude,
        windKt: p.windKt,
        uncertaintyKm: p.uncertaintyKm,
        horizonHours: Number(p.horizonHours ?? 0),
        isForecast: i > 0,
      })) as TrackSample[],
    );

    const widths = coneWidthsRad(resampled, {
      pinchStartKm: resolvesToCurrent ? 0 : undefined,
      monotonic: true,
    });
    const strip = buildConeStrip(
      resampled.map((v) => v.pos),
      widths,
    );
    const geom = buildConeGeometry(strip, CONE_RADIUS, 16);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(geom.positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(geom.uvs, 2));
    geo.setIndex(geom.indices);

    const mat = new THREE.ShaderMaterial({
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0.14 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "forecast-cone";
    mesh.renderOrder = CONE_RENDER_ORDER;
    this.disposables.push(geo);
    this.disposables.push(mat);
    this.trackGroup.add(mesh);

    // Terminal direction arrow, in the local tangent frame, coloured by the
    // intensity ramp at the destination (never UI white).
    const last = withU[withU.length - 1];
    const tip = strip.centers[strip.centers.length - 1];
    const endW = strip.halfWidthRad[strip.halfWidthRad.length - 1];
    const headLenRad = Math.max(0.012, endW * 1.4);
    const headWidRad = headLenRad * 0.55;
    const ah = arrowheadAt(tip, strip.fwd[strip.fwd.length - 1], headLenRad, headWidRad, CONE_RADIUS);
    const tipColor = new THREE.Color(intensityRampColor(last.windKt) ?? "#ffffff");
    const ahGeo = new THREE.BufferGeometry();
    ahGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          ah.tip.x, ah.tip.y, ah.tip.z,
          ah.baseL.x, ah.baseL.y, ah.baseL.z,
          ah.baseR.x, ah.baseR.y, ah.baseR.z,
        ]),
        3,
      ),
    );
    const ahMat = new THREE.MeshBasicMaterial({
      color: tipColor,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const arrow = new THREE.Mesh(ahGeo, ahMat);
    arrow.name = "forecast-arrowhead";
    arrow.renderOrder = TRACK_RENDER_ORDER;
    this.disposables.push(ahGeo);
    this.disposables.push(ahMat);
    this.trackGroup.add(arrow);

    return mesh;
  }

  private hexToRgbStr(hex: string): string {
    const n = parseInt(hex.replace("#", ""), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  // ----------------------------------------------------------
  // City labels
  // ----------------------------------------------------------
  setCities(list: GlobeCity[]): void {
    this.clearGroup(this.cityGroup);
    this.removeSceneLabels("city:");
    for (const c of list) {
      const dir = latLonToVec3(c.lat, c.lon);
      this.addSceneLabel(
        `city:${c.name}`,
        dir,
        `<span style="background:rgba(8,16,26,0.55);border:1px solid rgba(148,163,184,0.22);`
          + `border-radius:5px;padding:1px 6px;font-size:9.5px;font-weight:600;"
          + "color:#cbd5e1;opacity:0.92;">${c.name}</span>`,
        30,
      );
    }
  }

  private addSceneLabel(
    key: string,
    world: THREE.Vector3,
    html: string,
    priority: number,
    align = "translate(-50%, -120%)",
  ): void {
    this.removeSceneLabels(key);
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:0;top:0;opacity:1;transition:opacity .12s ease;"
      + "white-space:nowrap;z-index:1;"
      + "color:#eaf2f9;text-shadow:0 1px 2px rgba(0,0,0,.6);";
    el.innerHTML = html;
    this.labelLayer.appendChild(el);
    const rect = el.getBoundingClientRect();
    this.labels.push({
      key,
      priority,
      world: world.clone(),
      el,
      align,
      size: { w: rect.width || 80, h: rect.height || 20 },
      shown: false,
    });
  }

  private removeSceneLabels(keyPrefix: string): void {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      if (this.labels[i].key.startsWith(keyPrefix)) {
        this.labels[i].el.remove();
        this.labels.splice(i, 1);
      }
    }
  }

  /** Project every label, hide far-side entries and resolve overlaps. */
  private repositionLabels(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    if (!size.x || !size.y) return;
    const projected = new THREE.Vector3();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...this.labels].sort((a, b) => b.priority - a.priority);

    for (const l of ordered) {
      // far hemisphere → skip entirely (no projection needed)
      if (l.world.dot(this.camera.position) <= 0) {
        if (l.shown) { l.el.style.opacity = "0"; l.shown = false; }
        continue;
      }
      projected.copy(l.world).project(this.camera);
      if (projected.z > 1) {
        if (l.shown) { l.el.style.opacity = "0"; l.shown = false; }
        continue;
      }
      const x = (projected.x * 0.5 + 0.5) * size.x;
      const y = (-projected.y * 0.5 + 0.5) * size.y;

      if (!l.size.w) l.size = { w: l.el.offsetWidth || 80, h: l.el.offsetHeight || 20 };
      const bw = l.size.w + 10;
      const bh = l.size.h + 6;

      let collide = false;
      for (const p of placed) {
        if (Math.abs(p.x - x) < (p.w + bw) / 2 && Math.abs(p.y - y) < (p.h + bh) / 2) {
          collide = true;
          break;
        }
      }
      if (collide) {
        if (l.shown) { l.el.style.opacity = "0"; l.shown = false; }
        continue;
      }

      placed.push({ x, y, w: bw, h: bh });
      l.el.style.opacity = "1";
      l.el.style.transform = `translate(${x}px, ${y}px) ${l.align}`;
      l.shown = true;
    }
  }

  // ----------------------------------------------------------
  // Shared builders
  // ----------------------------------------------------------
  private addSprite(
    group: THREE.Group,
    canvas: HTMLCanvasElement,
    position: THREE.Vector3,
    width: number,
    height?: number,
    pick?: () => GlobeSelection
  ): THREE.Sprite {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    const h = height ?? width;
    sprite.scale.set(width, h, 1);
    sprite.renderOrder = MARKER_RENDER_ORDER;
    if (pick) {
      this.pickables.push(sprite);
      this.pickHandlers.set(sprite, pick);
    }
    this.disposables.push(tex);
    this.disposables.push(mat);
    group.add(sprite);
    return sprite;
  }

  private addRing(
    group: THREE.Group,
    position: THREE.Vector3,
    inner: number,
    outer: number,
    color: number,
    opacity: number
  ): THREE.Mesh {
    const geo = new THREE.RingGeometry(inner, outer, 48);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(position);
    ring.lookAt(position.clone().multiplyScalar(2));
    this.disposables.push(geo);
    this.disposables.push(mat);
    group.add(ring);
    return ring;
  }

  private clearGroup(group: THREE.Group, keep?: (child: THREE.Object3D) => boolean): void {
    for (const child of [...group.children]) {
      if (keep && keep(child)) continue;
      group.remove(child);
      this.disposeObject(child);
      this.pickHandlers.delete(child);
    }
    this.pickables = this.pickables.filter((p) => group.getObjectById(p.id) !== p);
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const anyChild = child as unknown as {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (anyChild.geometry) anyChild.geometry.dispose();
      const mats = Array.isArray(anyChild.material)
        ? anyChild.material
        : anyChild.material
          ? [anyChild.material]
          : [];
      for (const m of mats) {
        const map = (m as THREE.SpriteMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    });
  }

  // ----------------------------------------------------------
  // Layer visibility
  // ----------------------------------------------------------
  setLayer(kind: GlobeLayerKind, visible: boolean): void {
    if (kind === "satellite") {
      this.satGroup.visible = visible;
      return;
    }
    if (kind === "cities") {
      this.cityGroup.visible = visible;
      return;
    }
    if (kind === "cone") {
      if (this.coneMesh) this.coneMesh.visible = visible;
      return;
    }
    // track: everything in trackGroup except the cone
    for (const child of this.trackGroup.children) {
      if (child === this.coneMesh) continue;
      child.visible = visible;
    }
  }

  // ----------------------------------------------------------
  // Public control
  // ----------------------------------------------------------
  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on && !this.reducedMotion && !this.userActive;
  }

  /**
   * Pause/resume the render loop. When the canvas is fully covered by the
   * story the loop stops scheduling frames; on exposure it resumes. Verified
   * with the frame counter, not assumed.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
    } else {
      this.lastTime = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private onUserStart = (): void => {
    this.userActive = true;
    this.controls.autoRotate = false;
    this.clearSelection();
  };

  private onUserEnd = (): void => {
    // Auto-rotate is intentionally NOT resumed after user interaction.
  };

  focus(lat: number, lon: number, distance = DEFAULT_DISTANCE, animate = true, durationMs = 900): void {
    const dir = latLonToVec3(lat, lon);
    const target = dir.clone().multiplyScalar(0.92);
    const pos = dir.clone().multiplyScalar(distance);
    const start = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = animate ? durationMs : 0;

    if (duration === 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    const t0 = performance.now();
    const step = (now: number) => {
      if (this.disposed) return;
      const t = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(start, pos, e);
      this.controls.target.lerpVectors(startTarget, target, e);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ----------------------------------------------------------
  // Selection
  // ----------------------------------------------------------
  private onPointerMove = (e: PointerEvent): void => {
    const hit = this.pick(e);
    this.renderer.domElement.style.cursor = hit ? "pointer" : "";
  };

  private onPointerDown = (e: PointerEvent): void => {
    const hit = this.pick(e);
    if (hit === null) {
      this.clearSelection();
      return;
    }
    const handler = this.pickHandlers.get(hit);
    if (handler) this.opts.onSelect?.(handler());
  };

  private pick(e: PointerEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    if (!hits.length) return null;

    // never pick a marker on the far side of the planet
    const ray = this.raycaster.ray;
    const oc = ray.origin;
    const b = oc.dot(ray.direction);
    const c2 = oc.lengthSq() - 1;
    const disc = b * b - c2;
    const near = disc > 0 ? -b - Math.sqrt(disc) : Infinity;
    const hit = hits[0];
    if (near === Infinity || hit.distance > near + 0.025) return null;
    return hit.object;
  }

  private clearSelection(): void {
    this.opts.onSelect?.(null);
  }

  // ----------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------
  private resize(): void {
    const container = this.opts.container;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const post = this.composer.passes[this.composer.passes.length - 1] as ShaderPass;
    if (post?.uniforms?.uResolution) {
      post.uniforms.uResolution.value.set(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.clearSelection();
  };

  private tick = (now: number): void => {
    if (this.disposed) return;
    // DEV-only frame counter so the render-loop pause can be verified from
    // the page (frame count freezes while the globe is covered).
    if (import.meta.env.DEV) {
      const w = window as unknown as { __globeFrames?: number };
      w.__globeFrames = (w.__globeFrames ?? 0) + 1;
    }
    if (this.paused) {
      // Suspended while the canvas is covered: keep the current frame on
      // screen and do NOT schedule more work. setPaused(false) restarts.
      this.lastTime = now;
      return;
    }
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0.016;
    this.lastTime = now;

    if (this.cloudMesh && !this.reducedMotion) this.cloudMesh.rotation.y -= dt * 0.0012;

    // Crown each storm cap onto the planet surface when it is on the near
    // hemisphere for the camera; skip shader work entirely on the far side.
    for (const cap of this.stormCaps) {
      cap.update(dt, this.reducedMotion);
      const visible = cap.center.dot(this.camera.position) > 0;
      cap.mesh.visible = visible;
    }

    if (this.pulse && this.pulseMat) {
      this.pulseTime += dt;
      const t = this.pulseTime % 1.4;
      const s = 0.75 + (t / 1.4) * 0.9;
      this.pulse.scale.setScalar(s);
      this.pulseMat.opacity = 0.32 * (1 - t / 1.4);
    }

    if (this.starField) this.starField.rotation.y += dt * 0.0007;

    this.repositionLabels();

    this.controls.update();
    this.composer.render();
    this.raf = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.observer?.disconnect();
    this.controls.removeEventListener("start", this.onUserStart);
    this.controls.removeEventListener("end", this.onUserEnd);
    this.controls.dispose();
    this.clearGroup(this.satGroup);
    this.clearGroup(this.trackGroup);
    this.clearGroup(this.cityGroup);
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.labelLayer.remove();
    for (const d of this.disposables) d.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
  }
}

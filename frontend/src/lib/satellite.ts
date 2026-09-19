import { fbm2D } from './seeded'
import type { SatelliteBand } from '../types/satellite'

/* ============================================================
   Procedural satellite-field renderer.

   Produces a deterministic, meteorologically-structured RGBA
   frame for each product (IR / visible / water-vapor / radar).
   The cyclone is NOT drawn as concentric circles or a spiral
   icon — every field is computed pixel-by-pixel from seeded
   fractal noise, elapsed time (slow evolution) and the storm's
   REAL geographic centre, expressed in image coordinates.

   The layer stack (outer cloud shield → spiral bands → central
   dense overcast → eyewall → eye) is the standard anatomy of a
   mature tropical cyclone. Brightness is a simulated brightness
   temperature (°C); the demo NEVER claims to be real imagery.
   ============================================================ */

export interface SatRenderOptions {
  seed: number
  band: SatelliteBand
  w: number
  h: number
  /** Storm centre in image pixels — derived from real lat/lon + bounds. */
  cx: number
  cy: number
  /** Eye/core radius in image pixels (≈ RMW scaled by the bounds). */
  eyeR: number
  /** Elongation direction of the outer shield, degrees. */
  elongAxis?: number
  /** Enhanced (colourized) IR palette. Ignored for other bands. */
  enhanced?: boolean
  /** Seconds since scenario start — drives slow deterministic evolution. */
  t?: number
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/* ---------------- IR palettes: cold = bright ---------------- */

const IR_GRAY: [number, number, number, number][] = [
  [0.0, 16, 18, 22],
  [0.35, 74, 80, 88],
  [0.6, 140, 146, 152],
  [0.8, 204, 208, 210],
  [1.0, 250, 250, 250],
]

/* Restrained "meteorological enhancement": steel → indigo → muted rose. */
const IR_ENHANCED: [number, number, number, number][] = [
  [0.0, 16, 18, 22],
  [0.35, 62, 68, 74],
  [0.55, 105, 118, 128],
  [0.68, 78, 96, 128],
  [0.78, 98, 108, 150],
  [0.86, 160, 120, 132],
  [0.94, 206, 198, 188],
  [1.0, 244, 242, 238],
]

const WATER_STOPS: [number, number, number, number][] = [
  [0.0, 4, 7, 10],
  [0.35, 10, 18, 24],
  [0.6, 40, 72, 82],
  [0.85, 108, 160, 168],
  [1.0, 176, 216, 220],
]

const RADAR_STOPS: [number, number, number, number][] = [
  [0.0, 4, 6, 8],
  [0.25, 16, 38, 28],
  [0.45, 38, 92, 36],
  [0.62, 130, 150, 44],
  [0.78, 210, 160, 44],
  [0.9, 220, 84, 48],
  [1.0, 214, 48, 44],
]

function sampleStops(stops: number[][], x: number): number[] {
  const t = clamp(x, 0, 1)
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1]
      const b = stops[i]
      const f = (t - a[0]) / (b[0] - a[0])
      return [
        Math.round(lerp(a[1], b[1], f)),
        Math.round(lerp(a[2], b[2], f)),
        Math.round(lerp(a[3], b[3], f)),
      ]
    }
  }
  const last = stops[stops.length - 1]
  return [Math.round(last[1]), Math.round(last[2]), Math.round(last[3])]
}

export function renderSatelliteRGBA(opts: SatRenderOptions): Uint8ClampedArray {
  const {
    seed,
    band,
    w,
    h,
    cx,
    cy,
    eyeR,
    elongAxis = 0,
    enhanced = false,
    t = 0,
  } = opts

  const out = new Uint8ClampedArray(w * h * 4)
  const R = Math.max(4, eyeR)

  // Deterministic noise fields at three scales.
  const nLarge = fbm2D(seed + 1, 4)
  const nMid = fbm2D(seed + 7, 3)
  const nFine = fbm2D(seed + 13, 2)
  const nWedge = fbm2D(seed + 21, 3)

  // Slowly-evolving drift, deterministic. Clouds advect very gently;
  // the eye never "spins" — nothing rotates like a loader.
  const drift = (t * 0.9) % 512
  const axis = (elongAxis * Math.PI) / 180
  const cosA = Math.cos(axis)
  const sinA = Math.sin(axis)

  // Eyewall asymmetry — stronger quadrant + 2-3 convective towers.
  const strongAng = (seed % 360) * (Math.PI / 180)
  let towers: { a: number; r: number; s: number }[] = []
  for (let k = 0; k < 3; k++) {
    towers.push({
      a: strongAng + (k - 1) * 0.55,
      r: 0.9 + ((seed >> k) & 1) * 0.25,
      s: 1 + ((seed >> (k + 2)) & 3) * 0.22,
    })
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dy = y - cy
      const r = Math.sqrt(dx * dx + dy * dy)
      const u = dx / R
      const v = dy / R
      const ru = r / R
      const th = Math.atan2(dy, dx)

      // ----- irregular outer shield (elongated ellipse + wobble) -----
      const rotatedLat = u * cosA + v * sinA
      const rotatedLong = -u * sinA + v * cosA
      const elong = 1.6
      const dd = Math.sqrt((rotatedLat / elong) ** 2 + rotatedLong ** 2)
      const swell = nLarge(x * 0.011, y * 0.011)
      const shieldR = 8.6 * (0.82 + swell * 0.36)
      const shield = smooth(shieldR * 1.18, shieldR * 0.55, dd) * (0.45 + 0.55 * nMid(x * 0.03, y * 0.03))

      // ----- logarithmic spiral rainbands -----
      let bands = 0
      for (let arm = 0; arm < 5; arm++) {
        const phase = (arm / 5) * 2 * Math.PI + (seed % 19) * 0.05
        const tight = 0.85 + (arm % 3) * 0.28
        const centerAng = phase + tight * Math.log(Math.max(ru, 0.22) * 1.05)
        const dw = Math.abs(wrap(th - centerAng))
        const sig = 0.1 + 0.075 * clamp(ru, 0, 6)
        const g = Math.exp(-(dw * dw) / (2 * sig * sig))
        const radEnv = Math.exp(-((ru - 3.4) * (ru - 3.4)) / (2 * 2.6 * 2.6))
        const fadeIn = smooth(0.45, 0.95, ru)
        const fadeOut = smooth(8.2, 5.4, ru)
        const tear = 0.4 + 0.6 * nMid(x * 0.05 + arm, y * 0.05)
        bands = Math.max(bands, g * radEnv * fadeIn * fadeOut * tear)
      }

      // ----- central dense overcast (CDO) -----
      const coreNoise = 0.55 + 0.45 * nMid(x * 0.045, y * 0.045)
      const core = (1 - smooth(0.5, 2.35, ru)) * coreNoise
      // CDO elongated toward the same axis, offset from true centre
      const cdLon = (u * cosA + v * sinA) * 0.5 + ru * 0.15
      const coreAsym = smooth(-1.5, 1.2, cdLon)
      const coreF = core * (0.55 + 0.45 * coreAsym)

      // ----- eyewall: uneven thickness ring with towers & a gap -----
      const ewR = 0.82 + 0.28 * nLarge(x * 0.05 + 9, y * 0.05 + 3)
      const ewThick = 0.16 + 0.12 * nMid(x * 0.09, y * 0.09)
      let ew = Math.exp(-((ru - ewR) * (ru - ewR)) / (2 * ewThick * ewThick))
      // stronger on one flank, weaker on the other
      const flank = 0.5 + 0.5 * Math.cos(th - strongAng)
      ew *= 0.35 + 0.65 * flank
      // convective towers — very cold, tight cells on the ring
      for (const tk of towers) {
        const ta = Math.atan2(Math.sin(th - tk.a) * 1.0, Math.cos(th - tk.a))
        const tAng = Math.exp(-(ta * ta) / (2 * 0.34 * 0.34))
        const tRad = Math.exp(-((ru - tk.r) * (ru - tk.r)) / (2 * 0.18 * 0.18))
        ew += 0.9 * tAng * tRad * tk.s * (0.6 + 0.4 * nFine(x * 0.11, y * 0.11))
      }
      // one broken sector (natural eyewall gap)
      const gapAng = strongAng + 2.4
      const gap = 1 - 0.55 * Math.exp(-(Math.abs(wrap(th - gapAng)) ** 2) / (2 * 0.28 * 0.28))
      ew *= gap

      // ----- eye: irregular warm hole, not a black dot -----
      // radius wobbles with azimuth so the boundary is never a circle
      const eyeAng = nMid(Math.cos(th) * 1.3 + 5, Math.sin(th) * 1.3 + 11)
      const eyeWob = 0.62 + 0.42 * eyeAng
      // slow 2-D undulation keeps the outline ragged, no seams
      const eyeMorph = 0.2 * nLarge(x * 0.02 + 2, y * 0.02 + 8)
      const eyeG = Math.exp(-(ru * ru) / (2 * (eyeWob + eyeMorph) * (eyeWob + eyeMorph)))
      const eyeOff = 1 - 0.35 * nLarge(x * 0.09 + 5, y * 0.09 + 13) // wispy cloud intrusions
      const eye = eyeG * eyeOff
      const eyeHole = 1 - smooth(0.3, 0.85, eyeG)

      // ----- detached outer band puffs -----
      let puffs = 0
      for (let p = 0; p < 4; p++) {
        const pa = (seed % 11) * 0.3 + p * 1.7
        const pr = 4.6 + ((seed >> p) & 3) * 1.1
        const gx = Math.cos(pa) * pr * Math.cos(axis) - Math.sin(pa) * pr * 1.3
        const gy = Math.cos(pa) * pr * sinA + Math.sin(pa) * pr
        const pg = Math.exp(-(((u - gx) ** 2 + (v - gy) ** 2) / (2 * 1.6 * 1.6)))
        puffs = Math.max(puffs, pg * (0.3 + 0.7 * nMid(x * 0.04, y * 0.04)))
      }

      // ----- compose simulated brightness temperature (°C) -----
      let T = 28 + (nLarge(x * 0.008 + drift * 0.01, y * 0.008) - 0.5) * 2.4 // warm ocean
      T -= 16 * shield                // thin high cloud
      T -= 30 * bands                 // cold rainband overcast
      T -= 16 * puffs
      T -= 48 * coreF                 // deep convection
      T -= 62 * ew                    // very cold eyewall
      T += 48 * eye                   // reliably warm, ragged eye
      T += (nFine(x * 0.18 + drift * 0.02, y * 0.18) - 0.5) * 3.5 // cloud-top texture
      T += (nWedge(x * 0.035, y * 0.035) - 0.5) * 2.5

      const cold = clamp((30 - T) / 100, 0, 1) // ≈30°C black → ≈-70°C white

      let cr: number
      let cg: number
      let cb: number

      if (band === 'visible') {
        // natural visible band: blue sea, white clouds, daylight side-lighting
        const oceanTone = lerp(0.32 + 0.1 * nLarge(x * 0.006, y * 0.006), 0.62, smooth(0, h, y) * 0.12)
        let clouds = clamp(shield * 0.75 + bands * 1.05 + puffs * 0.7 + coreF * 1.1 + ew * 1.15, 0, 1)
        // the eye is an open, clear hole in the overcast — ragged, not a disc
        clouds *= 0.28 + 0.72 * eyeHole
        const sun = 0.78 + 0.22 * smooth(-1.8, 1.6, (dx * cosA + dy * sinA) / (eyeR * 5))
        const cld = Math.pow(clamp(clouds, 0, 1), 1.08) * sun
        const ocean = [18, 46, 86]
        const shallow = [52, 110, 150]
        const bright = [250, 251, 250]
        const blendC = lerp(1, 0, cld)
        cr = lerp(ocean[0], shallow[0], oceanTone) * blendC + bright[0] * cld
        cg = lerp(ocean[1], shallow[1], oceanTone) * blendC + bright[1] * cld
        cb = lerp(ocean[2], shallow[2], oceanTone) * blendC + bright[2] * cld
        cr = clamp(cr, 0, 255)
        cg = clamp(cg, 0, 255)
        cb = clamp(cb, 0, 255)
      } else if (band === 'wv') {
        // upper-tropospheric moisture: dark field, dry slots, teal moist air
        const moist = clamp(shield * 0.8 + bands * 1.0 + coreF * 1.2 + ew * 1.4 + puffs * 0.5, 0, 1)
        const dry = smooth(-1.4, 2.1, (rotatedLat * 0.9 - rotatedLong) * 0.6)
        const m = clamp(moist * (0.45 + 0.55 * dry), 0, 1)
        const [dr, dg, db] = sampleStops(WATER_STOPS, m)
        cr = dr
        cg = dg
        cb = db
      } else if (band === 'radar') {
        // reflectivity-like field — strongest at eyewall & inner bands,
        // quiet inside the ragged eye
        const refl = clamp(spdFull(ew) * 1.6 + bands * 0.95 + coreF * 1.05 + shield * 0.22, 0, 1) * eyeHole
        const [rr, rg, rb] = sampleStops(RADAR_STOPS, refl)
        cr = rr
        cg = rg
        cb = rb
      } else {
        // thermal IR: grayscale or restrained enhanced palette
        if (enhanced) {
          const [rr, rg, rb] = sampleStops(IR_ENHANCED, cold)
          cr = rr
          cg = rg
          cb = rb
        } else {
          const v = Math.pow(cold, 0.9)
          cr = IR_GRAY[0][1] + v * (IR_GRAY[IR_GRAY.length - 1][1] - IR_GRAY[0][1])
          cg = cr
          cb = cr
        }
      }

      // ----- subtle deterministic sensor noise (never a grid) -----
      const nz = nFine(x * 0.6, y * 0.6)
      const jitter = (nz - 0.5) * 7
      cr = clamp(cr + jitter, 0, 255)
      cg = clamp(cg + jitter, 0, 255)
      cb = clamp(cb + jitter, 0, 255)

      const idx = (y * w + x) * 4
      out[idx] = cr
      out[idx + 1] = cg
      out[idx + 2] = cb
      out[idx + 3] = 255
    }
  }

  return out
}

/* Near-eyewall peak helper — used by radar so the strongest echoes sit on
   the eyewall rather than uniformly inside it. */
function spdFull(ew: number): number {
  // clamp to [0,1], squash away small values so echoes are "defined"
  const v = clamp(ew, 0, 1)
  return v < 0.28 ? 0 : Math.pow(v, 0.85)
}
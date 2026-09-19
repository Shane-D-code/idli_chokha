import { fbm2D } from './seeded'
import type { Rng } from './seeded'

/**
 * Procedural tropical-cyclone renderer used by BOTH the globe (canvas) and the
 * map (overlay canvas). Slow, layered, satellite-like: outer cloud shield →
 * spiral bands → dense overcast core → eyewall → eye. Fully seeded/deterministic.
 */

export interface CycloneDrawOptions {
  /** Wind kt — controls size/density of the eye and core. */
  windKt: number
  seed: number
  /** Cartoon-glow off in the light theme; draw at modest saturation. */
  intensity?: number
  /** Show visible eye (false during weak stages). */
  showEye?: boolean
}

const PALETTE = {
  white: '255,255,255',
  warmWhite: '252,250,248',
  grey: '226,232,238',
  coolGrey: '203,214,226',
  core: '238,244,248',
  band: '216,226,236',
}

function hsla(rgb: string, a: number): string {
  return `rgba(${rgb},${a})`
}

/** Central function — draws a full cyclone at (x, y) with radius r (px). */
export function drawCyclone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
  opts: CycloneDrawOptions,
): void {
  if (r <= 0) return
  const wind = opts.windKt
  const eyeVisible = opts.showEye ?? wind >= 64
  const noise = fbm2D(opts.seed, 4)

  // --- Outer circulation (faint broad disc) ---
  const outer = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 1.55)
  outer.addColorStop(0, hsla(PALETTE.grey, 0.05))
  outer.addColorStop(0.55, hsla(PALETTE.grey, 0.035))
  outer.addColorStop(1, hsla(PALETTE.grey, 0))
  ctx.fillStyle = outer
  ctx.beginPath()
  ctx.arc(x, y, r * 1.55, 0, Math.PI * 2)
  ctx.fill()

  // --- Outer cloud shield (irregular blob, asymmetric) ---
  ctx.save()
  ctx.beginPath()
  const clouds = 128
  for (let i = 0; i <= clouds; i++) {
    const a = (i / clouds) * Math.PI * 2
    const wob =
      1 +
      (noise(Math.cos(a) * 2.2 + 3.1, Math.sin(a) * 2.2 + 1.7) - 0.5) * 0.42
    const asym = 1 + Math.cos(a - 0.9) * 0.18
    const rr = r * wob * asym
    const px = x + Math.cos(a) * rr
    const py = y + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  const shield = ctx.createRadialGradient(x, y, r * 0.25, x, y, r * 1.15)
  shield.addColorStop(0, hsla(PALETTE.core, 0.9))
  shield.addColorStop(0.42, hsla(PALETTE.warmWhite, 0.72))
  shield.addColorStop(0.75, hsla(PALETTE.grey, 0.5))
  shield.addColorStop(1, hsla(PALETTE.grey, 0.08))
  ctx.fillStyle = shield
  ctx.fill()
  ctx.restore()

  // --- Spiral bands (multiple curved arms, torn/slowed) ---
  for (let arm = 0; arm < 6; arm++) {
    ctx.save()
    const armOffset = (arm / 6) * Math.PI * 2
    const innerR = r * (0.28 + arm * 0.045)
    const outerR = r * (1.05 + (arm % 3) * 0.1)
    const points: [number, number][] = []
    const steps = 240
    for (let i = 0; i <= steps; i++) {
      const f = i / steps
      const arc = f * Math.PI * 2 * (2.6 - arm * 0.18)
      const rad = innerR + (outerR - innerR) * (f + 0.06 * Math.sin(f * 6 + arm))
      const n =
        noise(Math.cos(arc + arm) * 3.0 + arm * 7, Math.sin(arc + arm) * 3.0 + i * 0.02) -
        0.5
      const rr = rad * (1 + n * 0.34)
      const px = x + Math.cos(arc + armOffset + t * 0.012 * (arm % 2 === 0 ? 1 : -1)) * rr
      const py = y + Math.sin(arc + armOffset + t * 0.012 * (arm % 2 === 0 ? 1 : -1)) * rr
      points.push([px, py])
    }
    ctx.beginPath()
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i]
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    const alpha = 0.16 + (arm % 3) * 0.04
    ctx.strokeStyle = hsla(PALETTE.band, alpha)
    ctx.lineWidth = r * (0.14 + (arm % 3) * 0.05)
    ctx.lineCap = 'round'
    ctx.stroke()
    // soft fill
    ctx.strokeStyle = hsla(PALETTE.grey, alpha * 0.5)
    ctx.lineWidth = r * (0.34 + (arm % 2) * 0.08)
    ctx.stroke()
    ctx.restore()
  }

  // --- Dense inner core (overcast) ---
  const coreR = r * (0.42 + Math.max(0, wind - 60) * 0.002)
  const core = ctx.createRadialGradient(x, y, coreR * 0.1, x, y, coreR)
  core.addColorStop(0, hsla(PALETTE.core, 0.98))
  core.addColorStop(0.65, hsla(PALETTE.warmWhite, 0.94))
  core.addColorStop(1, hsla(PALETTE.grey, 0.85))
  ctx.fillStyle = core
  ctx.beginPath()
  const corePts = 96
  for (let i = 0; i <= corePts; i++) {
    const a = (i / corePts) * Math.PI * 2
    const n = noise(Math.cos(a) * 1.6 + 9, Math.sin(a) * 1.6 + 4) - 0.5
    const rr = coreR * (1 + n * 0.16)
    const px = x + Math.cos(a) * rr
    const py = y + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()

  // --- Eyewall ---
  const ew = ctx.createRadialGradient(x, y, coreR * 0.5, x, y, coreR * 0.92)
  ew.addColorStop(0, 'rgba(214,226,236,0)')
  ew.addColorStop(0.62, hsla(PALETTE.band, 0.5))
  ew.addColorStop(0.8, hsla(PALETTE.core, 0.85))
  ew.addColorStop(1, hsla(PALETTE.coolGrey, 0.9))
  ctx.fillStyle = ew
  ctx.beginPath()
  ctx.arc(x, y, coreR * 0.92, 0, Math.PI * 2)
  ctx.fill()

  // --- Eye (visible at strong intensity) ---
  if (eyeVisible) {
    const eyeR = r * (0.09 + Math.min(1, (wind - 64) / 60) * 0.09) * (0.8 + 0.2 * noise(5.5, 2.2))
    const eye = ctx.createRadialGradient(x, y, eyeR * 0.2, x, y, eyeR * 1.15)
    eye.addColorStop(0, 'rgba(9,30,58,0.16)')
    eye.addColorStop(0.55, 'rgba(9,30,58,0.07)')
    eye.addColorStop(1, 'rgba(9,30,58,0)')
    ctx.fillStyle = eye
    ctx.beginPath()
    ctx.arc(x, y, eyeR * 1.15, 0, Math.PI * 2)
    ctx.fill()
    const eyeFill = ctx.createRadialGradient(x, y, 0, x, y, eyeR)
    eyeFill.addColorStop(0, 'rgba(16,42,67,0.55)')
    eyeFill.addColorStop(0.7, 'rgba(16,42,67,0.28)')
    eyeFill.addColorStop(1, 'rgba(16,42,67,0)')
    ctx.fillStyle = eyeFill
    ctx.beginPath()
    ctx.arc(x, y, eyeR, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // faint depression for a forming system
    ctx.fillStyle = 'rgba(16,42,67,0.18)'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.14, 0, Math.PI * 2)
    ctx.fill()
  }

  // --- Inner swirling texture strokes for motion feel ---
  ctx.save()
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    const a0 = (i / 6) * Math.PI * 2 + t * 0.002
    const a1 = a0 + Math.PI * 0.5
    ctx.arc(x, y, coreR * 0.62, a0, a1)
    ctx.strokeStyle = hsla(PALETTE.coolGrey, 0.12)
    ctx.lineWidth = r * 0.05
    ctx.stroke()
  }
  ctx.restore()
}

/** Deterministic irregular cloud blotches used around the core. */
export function drawNoiseField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  t: number,
  color: string,
  alpha: number,
): void {
  const noise = fbm2D(seed, 3)
  ctx.save()
  ctx.globalAlpha = alpha
  const step = 26
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const n = noise(x * 0.012 + t * 0.002, y * 0.012)
      if (n < 0.62) continue
      const rr = (n - 0.62) * 46
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x + (noise(x * 0.05, y * 0.05) - 0.5) * 8, y, rr, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Satellite frame generator — deterministic per band. */
export function satelliteFrame(
  seed: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
  coreR: number,
): Uint8ClampedArray {
  const noise = fbm2D(seed, 4)
  const out = new Uint8ClampedArray(w * h * 4)
  const ny = valueSinGrid(seed)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / coreR
      const dy = (y - cy) / coreR
      const dist = Math.sqrt(dx * dx + dy * dy)
      const n = noise(x * 0.02, y * 0.02) * 0.5 + ny(x, y) * 0.5
      const band = Math.max(0, Math.cos(dist * 1.9 - 0.4)) * (1 - Math.exp(-dist * 0.12))
      const core = Math.max(0, 1 - dist / 3.2)
      const eye = Math.exp(-dist * dist * 3)
      const val = n * 0.55 + band * 0.6 + core * 0.35 + (1 - eye) * 0.1
      const idx = (y * w + x) * 4
      const v = Math.round(Math.max(0, Math.min(1, val)) * 255)
      out[idx] = v
      out[idx + 1] = v
      out[idx + 2] = v
      out[idx + 3] = 255
    }
  }
  return out
}

function valueSinGrid(seed: number) {
  const rng = (() => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
  })()
  const sx = Array.from({ length: 16 }, () => rng())
  const sy = Array.from({ length: 16 }, () => rng())
  return (x: number, y: number): number => {
    return (sx[Math.round(x) % 16] + sy[Math.round(y) % 16]) / 2
  }
}

export type { Rng }
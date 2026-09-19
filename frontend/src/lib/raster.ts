import { fbm2D } from './seeded'
import { drawCyclone } from './viz'
import type { RegionProjection } from '../components/map/projection'

export interface RasterRequest {
  type: 'satellite' | 'wind' | 'rainfall'
  seed: number
  proj: RegionProjection
  /** Current view window in projection units. */
  px: number
  py: number
  pw: number
  ph: number
  /** Cyclone screen position (may be off-view). */
  cycloneScreen?: { x: number; y: number } | null
  windKt?: number
  rainfallPoints?: { lat: number; lon: number; mm: number }[]
}

/**
 * Paint semi-transparent raster overlays (satellite / wind streamlines /
 * rainfall cells) onto a pixel canvas. All procedural output is seeded so the
 * same demo renders identically every time.
 */
export function drawRaster(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  req: RasterRequest,
): void {
  ctx.clearRect(0, 0, w, h)
  const { proj, px, py, pw } = req
  const scale = w / pw
  void req.ph

  const sx = (x: number) => (proj.xOf(x) - px) * scale
  const sy = (y: number) => (proj.yOf(y) - py) * scale

  if (req.type === 'satellite') {
    drawSatellite(ctx, w, h, req, sx, sy, scale)
  } else if (req.type === 'rainfall') {
    drawRainfall(ctx, sx, sy, req, scale)
  } else {
    drawWind(ctx, sx, sy, req)
  }
}

function shade(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, base: number) {
  const noise = fbm2D(seed, 4)
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise(x * 0.02 + seed, y * 0.02) * 0.5 + (x / w) * 0.5
      const v = Math.round(base + (n - 0.5) * 70)
      const i = (y * w + x) * 4
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function drawSatellite(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  req: RasterRequest,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  shade(ctx, w, h, req.seed, 96)
  // cyclone core
  const c = req.cycloneScreen
  if (c) {
    const r = Math.max(26, 84 * scale)
    drawCyclone(ctx, c.x, c.y, r, req.seed * 1.3, { windKt: req.windKt ?? 92, seed: req.seed })
  }
  void sx
  void sy
}

function drawRainfall(
  ctx: CanvasRenderingContext2D,
  sx: (x: number) => number,
  sy: (y: number) => number,
  req: RasterRequest,
  scale: number,
) {
  const pts = req.rainfallPoints ?? []
  const noise = fbm2D(req.seed, 3)
  for (const p of pts) {
    const px = sx(p.lon)
    const py = sy(p.lat)
    if (px < -80 || px > ctx.canvas.width + 80 || py < -80 || py > ctx.canvas.height + 80) continue
    const r = (14 + p.mm * 0.18) * scale
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    const alpha = Math.max(0.12, Math.min(0.5, p.mm / 260))
    g.addColorStop(0, `rgba(24,116,174,${alpha})`)
    g.addColorStop(1, 'rgba(24,116,174,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
    // sub cell texture
    ctx.save()
    ctx.beginPath()
    ctx.arc(px, py, r * 0.5, 0, Math.PI * 2)
    ctx.clip()
    for (let i = 0; i < 14; i++) {
      const a = noise(i, req.seed) * Math.PI * 2
      const rr = Math.hypot(noise(i * 2, 7) - 0.5, noise(i * 3, 2) - 0.5) * r * 0.8
      ctx.fillStyle = `rgba(10,92,148,${0.06 + noise(i, 3) * 0.12})`
      ctx.beginPath()
      ctx.arc(px + Math.cos(a) * rr * 0.6, py + Math.sin(a) * rr * 0.6, r * 0.16 * (1 + noise(i, 4)), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

function drawWind(
  ctx: CanvasRenderingContext2D,
  sx: (x: number) => number,
  sy: (y: number) => number,
  req: RasterRequest,
) {
  const noise = fbm2D(req.seed, 3)
  const c = req.cycloneScreen
  const nStreams = 26
  ctx.strokeStyle = 'rgba(8,126,164,0.4)'
  ctx.lineWidth = 1
  for (let i = 0; i < nStreams; i++) {
    const x0 = (i / nStreams) * ctx.canvas.width + noise(i, 1) * 20
    const y0 = noise(i, 2) * ctx.canvas.height
    let x = x0
    let y = y0
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 26; s++) {
      // spin around cyclone if visible
      let a = noise(x * 0.004, y * 0.004 + i) * Math.PI * 2
      if (c) {
        const dx = x - c.x
        const dy = y - c.y
        const d = Math.hypot(dx, dy) || 1
        if (d < 320) {
          const swirl = ((Math.atan2(dy, dx) + (s > 0 ? 0.15 : 0) + Math.PI) % (Math.PI * 2))
          a = swirl * 0.2 + (Math.PI / 2) * Math.min(3, 120 / d)
        }
      }
      x += Math.sin(a) * 7
      y += Math.cos(a) * 7
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  void sx
  void sy
}
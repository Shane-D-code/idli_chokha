import { useEffect, useRef, useState } from 'react'
import { geoOrthographic, geoPath, geoGraticule10 } from 'd3'
import { globeLand } from '../../lib/geoData'
import { buildForecastCone } from '../../lib/geo'
import { drawCyclone } from '../../lib/viz'
import { fbm2D } from '../../lib/seeded'
import { useApp, appActions } from '../../state/store'
import { useCyclone, useForecastTrack, useObserved } from '../../hooks/index'
import { getIntensityColor, intensityColorOf } from '../../lib/ua'
import type { LatLon } from '../../types/common'

/**
 * Satellite-style orthographic Earth. Projection centres the Indian Ocean
 * (Bay of Bengal framing); the active cyclone is drawn as a procedural
 * satellite-like storm AT its real geographic coordinate on the globe's
 * surface, beneath drifting seeded cloud cover.
 */
export function EarthGlobe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const autoRotate = useApp((s) => s.autoRotate)
  const [rotation, setRotation] = useState({ x: 84, y: 14 })
  const [rad, setRad] = useState(200)
  const frameRef = useRef(0)

  const cyclone = useCyclone()
  const track = useForecastTrack()
  const observed = useObserved()

  // d3 projection, kept in a ref so the draw loop reuses the same object
  const projRef = useRef<any>(null)
  const pathRef = useRef<any>(null)
  if (!projRef.current) {
    projRef.current = geoOrthographic().rotate([-84, -14]).scale(200).translate([0, 0]).clipAngle(92)
    pathRef.current = geoPath(projRef.current)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const cv: HTMLCanvasElement = canvas
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cloud = fbm2D(19, 4)
    let raf = 0

    const draw = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const proj = projRef.current
      const path = pathRef.current
      proj.rotate([-rotation.x, -rotation.y]).scale(rad)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const W = canvas.width / dpr
      const H = canvas.height / dpr
      ctx.clearRect(0, 0, W, H)
      const cx = W / 2
      const cy = H / 2
      const t = frameRef.current

      // ---- clip all surface painting to the disc ----
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.clip()

      // ocean — deep open-water blue with equatorial warmth
      const g = ctx.createRadialGradient(cx - rad * 0.12, cy - rad * 0.14, rad * 0.1, cx, cy, rad * 1.05)
      g.addColorStop(0, '#3f80ad')
      g.addColorStop(0.52, '#3b76a2')
      g.addColorStop(0.78, '#5591b6')
      g.addColorStop(1, '#75a9c4')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fill()

      // graticule
      ctx.beginPath()
      path(geoGraticule10())
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // land — natural sage/earth tones, softer toward the coast
      ctx.beginPath()
      path(globeLand)
      const landG = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad)
      landG.addColorStop(0, '#cdd9b6')
      landG.addColorStop(0.6, '#c6d2ab')
      landG.addColorStop(1, '#b7c39c')
      ctx.fillStyle = landG
      ctx.fill()
      ctx.strokeStyle = 'rgba(90,104,70,0.35)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // ---- drifting seeded cloud cover (satellite look, has motion) ----
      ctx.globalAlpha = 0.5
      for (let lat = -58; lat <= 58; lat += 4.5) {
        for (let lon = -180; lon < 180; lon += 4.5) {
          const n = cloud(lon * 0.045 + t * 0.0031, lat * 0.05)
          if (n < 0.64) continue
          const p = proj([lon, lat])
          if (!p) continue
          const wisp = (n - 0.64) * 46
          const px = cx + p[0]
          const py = cy + p[1]
          const soft = ctx.createRadialGradient(px, py, 0, px, py, wisp)
          soft.addColorStop(0, 'rgba(255,255,255,0.72)')
          soft.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = soft
          ctx.beginPath()
          ctx.arc(px, py, wisp, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      // ---- observed track ----
      plot(observed.map((o) => o.position), 'rgba(255,250,240,0.65)', 1.3, 'rgba(255,250,240,0.45)', [2, 3])
      // forecast track (from current position)
      const color = track.length ? intensityColorOf(track[0].windKt) : '#8fa3b5'
      plot([cyclone.position, ...track.map((tp) => tp.position)], color, 2, color, [7, 4])

      // cone corridor
      const cone = buildForecastCone(track)
      ctx.beginPath()
      for (const seg of cone) {
        path({
          type: 'MultiLineString',
          coordinates: [
            seg.left.map((p) => [p.lon, p.lat]),
            seg.right.map((p) => [p.lon, p.lat]),
          ],
        })
      }
      ctx.strokeStyle = 'rgba(47,146,184,0.55)'
      ctx.lineWidth = 1.1
      ctx.stroke()

      // forecast points
      for (const p of track) {
        const pw = proj([p.position.lon, p.position.lat])
        if (!pw) continue
        ctx.beginPath()
        ctx.arc(cx + pw[0], cy + pw[1], p.hours === 0 ? 4 : 3, 0, Math.PI * 2)
        ctx.fillStyle = intensityColorOf(p.windKt)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,253,249,0.95)'
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      // ---- cyclone storm system drawn AT its geographic position ----
      const m = proj([cyclone.position.lon, cyclone.position.lat])
      if (m) {
        const [mx, my] = m
        const stormR = rad * 0.3
        drawCyclone(ctx, cx + mx, cy + my, stormR, t, { windKt: cyclone.windKt, seed: 7 + cyclone.windKt })
        // small reference pulse
        const col = getIntensityColor(cyclone.windKt)
        ctx.beginPath()
        ctx.arc(cx + mx, cy + my, stormR * 0.16 * (1 + 0.08 * Math.sin(t * 0.05)), 0, Math.PI * 2)
        ctx.strokeStyle = hexToRgba(col, 0.85)
        ctx.lineWidth = 1.4
        ctx.stroke()
      }

      ctx.restore()

      // ---- atmosphere rim ----
      const rim = ctx.createRadialGradient(cx, cy, rad * 0.94, cx, cy, rad * 1.06)
      rim.addColorStop(0, 'rgba(140,190,225,0)')
      rim.addColorStop(0.7, 'rgba(150,205,235,0.4)')
      rim.addColorStop(1, 'rgba(150,205,235,0)')
      ctx.fillStyle = rim
      ctx.beginPath()
      ctx.arc(cx, cy, rad * 1.06, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(150,205,235,0.55)'
      ctx.lineWidth = 1.4
      ctx.stroke()

      if (autoRotate && !reduce) {
        frameRef.current += 1
        raf = requestAnimationFrame(draw)
      }
    }

    function plot(pts: LatLon[], stroke: string, width: number, dashStroke: string, dash: number[]) {
      const ctx = cv.getContext('2d')
      if (!ctx) return
      const proj = projRef.current
      const W = cv.width / dpr
      const H = cv.height / dpr
      const cx = W / 2
      const cy = H / 2
      ctx.beginPath()
      let started = false
      for (const p of pts) {
        const pr = proj([p.lon, p.lat])
        if (!pr) {
          started = false
          continue
        }
        if (!started) {
          ctx.moveTo(cx + pr[0], cy + pr[1])
          started = true
        } else {
          ctx.lineTo(cx + pr[0], cy + pr[1])
        }
      }
      if (dash && dash.length) ctx.setLineDash(dash)
      ctx.strokeStyle = dashStroke || stroke
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.setLineDash([])
    }

    draw()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, rad, autoRotate, cyclone.position.lat, cyclone.position.lon, cyclone.windKt, track, observed])

  const drag = useRef<{ x: number; y: number; rotX: number; rotY: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    appActions.setAutoRotate(false)
    drag.current = { x: e.clientX, y: e.clientY, rotX: rotation.x, rotY: rotation.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setRotation({
      x: drag.current.rotX - (e.clientX - drag.current.x) * 0.35,
      y: Math.max(-50, Math.min(50, drag.current.rotY + (e.clientY - drag.current.y) * 0.3)),
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const reset = () => {
    appActions.setAutoRotate(true)
    setRotation({ x: 84, y: 14 })
    setRad(200)
  }
  const centerOnStorm = () => {
    setRotation({ x: cyclone.position.lon, y: cyclone.position.lat })
    setRad(230)
  }

  return (
    <div ref={wrapRef} className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[radial-gradient(120%_120%_at_50%_30%,#cddae4_0%,#b9cbda_45%,#9db6c9_100%)]">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={(e) => {
          e.preventDefault()
          setRad((r) => Math.max(110, Math.min(340, r - Math.sign(e.deltaY) * 14)))
        }}
      />
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-ink-200/60 bg-cloud/85 px-2.5 py-1 font-mono text-[0.58rem] font-semibold uppercase tracking-widest text-ink-600 backdrop-blur">
        <span className={`h-1.5 w-1.5 rounded-full ${autoRotate ? 'animate-pulse bg-safe-500' : 'bg-ink-300'}`} />
        {autoRotate ? 'Auto-rotate' : 'Manual'}
      </div>
      <button
        onClick={reset}
        className="absolute right-3 top-3 rounded-lg border border-ink-200/70 bg-cloud/90 px-2.5 py-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-ink-600 shadow-soft backdrop-blur transition hover:text-brand-600"
      >
        Reset view
      </button>
      <button
        onClick={centerOnStorm}
        className="absolute right-16 top-3 rounded-lg border border-ink-200/70 bg-cloud/90 px-2.5 py-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-ink-600 shadow-soft backdrop-blur transition hover:text-brand-600"
      >
        Centre storm
      </button>
      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[0.56rem] text-ink-500/90">
        DRAG TO ROTATE · SCROLL TO ZOOM
      </div>
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}
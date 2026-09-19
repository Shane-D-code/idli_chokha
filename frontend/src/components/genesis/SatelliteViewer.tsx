import { useEffect, useRef, useState } from 'react'
import { useSatellite, useCyclone } from '../../hooks'
import { renderSatelliteRGBA } from '../../lib/satellite'
import { ArtifactFrame } from '../ui/editorial'
import { formatLatLon } from '../../lib/geo'
import type { SatelliteObservation } from '../../types/satellite'
import type { LatLon } from '../../types/common'

/* ============================================================
   Satellite Observation viewer.

   Professional-meteorology presentation of the storm's cloud
   field. The canton geometry is derived at render time from the
   SAME canonical storm position used by the globe, map and
   details — never hardcoded. Band tabs switch real render
   passes; the geographic overlay (graticule + Bay of Bengal
   label) stays at ~1% prominence so the imagery dominates.

   Performance: the expensive per-pixel band field is rendered
   once into an offscreen base canvas on band/seed change. The
   slow cloud evolution is then a cheap drifting noise composite
   driven by the RAF loop, so the page never churns 100% CPU.

   Honesty: every frame here is procedural and explicitly marked
   SIMULATED. When a real observation is connected (imageUrl
   set), the same frame/overlay renders the actual raster —
   the UI does not need rewriting.
   ============================================================ */

const BAND_LABEL: Record<string, string> = {
  ir: 'Thermal IR · Cloud Top Temp',
  visible: 'Visible · Reflectance',
  wv: 'Water Vapor · 6.2 µm',
  radar: 'Radar · Reflectivity',
}

const FRAME_W = 680
const FRAME_H = 560
const DRIFT_W = 170
const DRIFT_H = 140

export function SatelliteViewer() {
  const satellite = useSatellite()
  const cyclone = useCyclone()
  const [band, setBand] = useState('ir')
  const [enhanced, setEnhanced] = useState(false)
  const [animate, setAnimate] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const driftRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const active = satellite.find((s) => s.band === band) ?? satellite[0]

  /* ---- build the static band field (heavy, runs on change only) ---- */
  useEffect(() => {
    const base = baseRef.current
    if (!base) return
    const bctx = base.getContext('2d')
    if (!bctx) return

    const obs = satellite.find((s) => s.band === band)
    if (!obs) return
    base.width = FRAME_W
    base.height = FRAME_H
    bctx.clearRect(0, 0, FRAME_W, FRAME_H)

    const b = obs.bounds
    const cx = ((cyclone.position.lon - b.west) / (b.east - b.west)) * FRAME_W
    const cy = ((b.north - cyclone.position.lat) / (b.north - b.south)) * FRAME_H
    const pxPerKm = FRAME_H / (b.north - b.south) / 111.32
    const eyeR = cyclone.rmwKm * pxPerKm

    if (obs.imageUrl) {
      const img = new Image()
      img.onload = () => {
        bctx.clearRect(0, 0, FRAME_W, FRAME_H)
        bctx.drawImage(img, 0, 0, FRAME_W, FRAME_H)
      }
      img.src = obs.imageUrl
      return
    }

    const data = renderSatelliteRGBA({
      seed: obs.seed,
      band: obs.band,
      w: FRAME_W,
      h: FRAME_H,
      cx,
      cy,
      eyeR,
      elongAxis: cyclone.bearingDeg,
      enhanced: obs.band === 'ir' && enhanced,
    })
    const imgData = bctx.createImageData(FRAME_W, FRAME_H)
    imgData.data.set(data)
    bctx.putImageData(imgData, 0, 0)
  }, [satellite, band, enhanced, cyclone.position, cyclone.rmwKm, cyclone.bearingDeg])

  /* ---- compose frame: base + drifting cloud evolution + geo overlay ---- */
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let raf = 0
    let last = -1

    const tick = (now: number) => {
      const canvas = canvasRef.current
      const base = baseRef.current
      if (canvas && base && base.width > 0) {
        const ctx = canvas.getContext('2d')
        if (ctx && now - last > 90) {
          last = now
          const t = (now - start) / 1000
          ctx.clearRect(0, 0, FRAME_W, FRAME_H)
          ctx.drawImage(base, 0, 0)

          // slow, deterministic cloud advection — nothing spins
          if (!reduced && animate && !active?.imageUrl) {
            const d = driftRef.current
            if (d && ctx) {
              driftNoise(d, (t * 0.3) % 512, t)
              ctx.globalAlpha = 0.06
              ctx.drawImage(d, 0, 0, FRAME_W, FRAME_H)
              ctx.globalAlpha = 1
            }
          }

          const obs = satellite.find((s) => s.band === band)
          if (obs) {
            const b = obs.bounds
            const cx = ((cyclone.position.lon - b.west) / (b.east - b.west)) * FRAME_W
            const cy = ((b.north - cyclone.position.lat) / (b.north - b.south)) * FRAME_H
            drawGeo(ctx, b, cx, cy, obs, cyclone.position)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [satellite, band, animate, active?.imageUrl, cyclone.position])

  const toggleFullscreen = () => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen()
    }
  }

  if (!active) {
    return (
      <div ref={wrapRef}>
        <p className="typed text-ink-500">Satellite Observation</p>
        <div className="mt-3 rounded-xl border border-dashed border-ink-200 bg-cloud/60 p-5">
          <p className="font-mono text-[0.62rem] font-bold uppercase tracking-wider text-ink-500">
            NOT CONNECTED — NO FRAME IN THIS RUN
          </p>
          <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-500">
            The satellite provider is not configured in this deployment, so no observation frame is available. Genesis
            results above are unaffected.
          </p>
          <p className="mt-2 font-mono text-[0.58rem] text-ink-400">SOURCE INSAT-3D · OFFLINE</p>
        </div>
      </div>
    )
  }

  const statusLabel = active.status === 'live' ? 'LIVE' : 'SIMULATED'

  return (
    <div ref={wrapRef}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="typed text-ink-500">Satellite Observation</p>
        <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.18em] text-haze-700">
          {statusLabel}
        </span>
      </div>

      <div className="mt-2 flex gap-5 overflow-x-auto border-b border-ink-200 pb-0">
        {satellite.map((s) => (
          <button
            key={s.band}
            onClick={() => setBand(s.band)}
            className={`whitespace-nowrap border-b-2 pb-2 font-mono text-[0.62rem] font-semibold uppercase tracking-wider transition ${
              band === s.band ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-400 hover:text-ink-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <ArtifactFrame className="mt-3">
        <div className="bg-[#05080c]">
          <canvas
            ref={canvasRef}
            className="block w-full"
            style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}`, imageRendering: 'auto' }}
          />
          <canvas ref={baseRef} className="hidden" />
          <canvas ref={driftRef} className="hidden" />
        </div>

        <div className="flex items-center justify-between border-t border-ink-200/70 bg-cloud/40 px-3 py-2">
          <div className="flex items-center gap-3 font-mono text-[0.56rem] text-ink-400">
            <button
              onClick={() => setAnimate((a) => !a)}
              className={`font-semibold uppercase tracking-wider transition ${animate ? 'text-brand-600' : 'text-ink-300 hover:text-ink-600'}`}
            >
              Auto {animate ? '· on' : '· off'}
            </button>
            <span className="hidden whitespace-nowrap sm:inline">FRAME 01 / 01</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[0.56rem] text-ink-400">
            {active.band === 'ir' && (
              <button
                onClick={() => setEnhanced((e) => !e)}
                className={`uppercase tracking-wider transition ${enhanced ? 'text-brand-600' : 'text-ink-300 hover:text-ink-600'}`}
              >
                Enhanced IR {enhanced ? '· on' : '· off'}
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="whitespace-nowrap uppercase tracking-wider text-ink-300 transition hover:text-ink-600"
            >
              Fullscreen
            </button>
          </div>
        </div>
      </ArtifactFrame>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[0.58rem] text-ink-400">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold uppercase tracking-wider text-ink-600">{BAND_LABEL[active.band]}</span>
          <span>· {statusLabel}</span>
          <span className="text-ink-300">SOURCE {active.source.toUpperCase()}</span>
        </span>
        <span className="uppercase tracking-wider">VALID {formatValid(active.capturedAt)}</span>
      </div>

      <p className="mt-2 font-serif text-[0.86rem] italic leading-snug text-ink-500">{active.notes}</p>
    </div>
  )
}

/* Low-res drifting grain for the slow cloud evolution (cheap, deterministic). */
function driftNoise(canvas: HTMLCanvasElement, seed: number, t: number) {
  const w = canvas.width || DRIFT_W
  const h = canvas.height || DRIFT_H
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const out = ctx.createImageData(w, h)
  const n = (x: number, y: number) => {
    const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
    return v - Math.floor(v)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      const g = n(u * 6 + t * 0.02, v * 6 + t * 0.013) * 0.6 + n(u * 14 + t * 0.011, v * 14) * 0.4
      const idx = (y * w + x) * 4
      const c = g * 255
      out.data[idx] = c
      out.data[idx + 1] = c
      out.data[idx + 2] = c
      out.data[idx + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
}

/* Subtle geographic overlay — graticule + basin label at ~1% prominence. */
function drawGeo(
  ctx: CanvasRenderingContext2D,
  b: SatelliteObservation['bounds'],
  cx: number,
  cy: number,
  obs: SatelliteObservation,
  center: LatLon,
) {
  const dark = obs.band === 'visible'
  const lineColor = dark ? 'rgba(20,32,44,0.14)' : 'rgba(255,255,255,0.16)'
  const textColor = dark ? 'rgba(20,32,44,0.5)' : 'rgba(235,240,244,0.42)'

  ctx.save()
  ctx.strokeStyle = lineColor
  ctx.fillStyle = textColor
  ctx.font = '9px ui-monospace, "IBM Plex Mono", monospace'
  ctx.lineWidth = 1

  for (let lon = Math.ceil(b.west); lon <= Math.floor(b.east); lon += 2) {
    const x = ((lon - b.west) / (b.east - b.west)) * FRAME_W
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, FRAME_H)
    ctx.stroke()
    ctx.fillText(`${Math.abs(lon)}°E`, x + 2, 11)
  }
  for (let lat = Math.floor(b.north); lat >= Math.ceil(b.south); lat -= 2) {
    const y = ((b.north - lat) / (b.north - b.south)) * FRAME_H
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(FRAME_W, y)
    ctx.stroke()
    ctx.fillText(`${Math.abs(lat)}°N`, 2, y - 3)
  }

  const seaX = ((88 - b.west) / (b.east - b.west)) * FRAME_W
  const seaY = ((b.north - 14) / (b.north - b.south)) * FRAME_H
  ctx.fillStyle = dark ? 'rgba(20,32,44,0.34)' : 'rgba(235,240,244,0.30)'
  ctx.font = 'italic 13px Georgia, serif'
  ctx.fillText('BAY OF BENGAL', seaX, seaY)

  // storm centre crosshair
  ctx.strokeStyle = dark ? 'rgba(20,32,44,0.55)' : 'rgba(255,208,150,0.75)'
  ctx.lineWidth = 1.2
  const a = 7
  ctx.beginPath()
  ctx.moveTo(cx - a, cy)
  ctx.lineTo(cx - 3, cy)
  ctx.moveTo(cx + 3, cy)
  ctx.lineTo(cx + a, cy)
  ctx.moveTo(cx, cy - a)
  ctx.lineTo(cx, cy - 3)
  ctx.moveTo(cx, cy + 3)
  ctx.lineTo(cx, cy + a)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = dark ? 'rgba(20,32,44,0.55)' : 'rgba(255,208,150,0.8)'
  ctx.font = '9px ui-monospace, "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.fillText(formatLatLon(center), cx, cy - 14)
  ctx.restore()
}

function formatValid(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
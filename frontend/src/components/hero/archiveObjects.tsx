import { useEffect, useRef } from 'react'
import { satelliteFrame } from '../../lib/viz'
import { useCyclone, useForecastTrack } from '../../hooks/index'
import { hoursLabel } from '../../lib/format'
import { intensityColorOf } from '../../lib/ua'

/** Tiny "printed photograph" satellite thumbnail used as a collage object. */
export function MiniSatelliteThumb({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const w = 180
    const h = 108
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(w, h)
    img.data.set(satelliteFrame(41, w, h, w / 2, h / 2, 58))
    ctx.putImageData(img, 0, 0)
  }, [])
  return (
    <div className={`paper overflow-hidden rounded-lg ${className}`}>
      <canvas ref={ref} className="block w-full opacity-95" style={{ aspectRatio: '180 / 108' }} />
      <div className="flex items-center justify-between border-t border-ink-100 px-2 py-1">
        <span className="typed text-[0.5rem] text-ink-500">Satellite obs.</span>
      </div>
    </div>
  )
}

/** Tiny forecast track preview — lon/lat mini plot drawn as a dashed pencil line. */
export function MiniTrackPreview({ className = '' }: { className?: string }) {
  const t = useForecastTrack()
  const c = useCyclone()
  const pts = [c.position, ...t.map((p) => p.position)]
  const lons = pts.map((p) => p.lon)
  const lats = pts.map((p) => p.lat)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const W = 150
  const H = 72
  const pad = 14
  const x = (lon: number) => pad + ((lon - minLon) / (maxLon - minLon || 1)) * (W - pad * 2)
  const y = (lat: number) => H - pad - ((lat - minLat) / (maxLat - minLat || 1)) * (H - pad * 2)

  const line = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`)
    .join(' ')

  return (
    <div className={`paper rounded-lg px-2.5 py-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="typed text-[0.5rem] text-ink-500">Forecast track</span>
        <span className="font-mono text-[0.5rem] text-ink-400">+{t.length ? t[t.length - 1].hours : 0}H</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block w-full" style={{ height: 64 }}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#CFC9C0" strokeWidth={0.5} />
        <path d={line} fill="none" stroke="#2F92B8" strokeWidth={1.6} strokeLinecap="round" />
        <path d={line} fill="none" stroke="#2F92B8" strokeWidth={3} strokeDasharray="1 5" strokeLinecap="round" opacity={0.6} />
        {t.map((p) => (
          <circle key={p.id} cx={x(p.position.lon)} cy={y(p.position.lat)} r={2.4} fill={intensityColorOf(p.windKt)} stroke="#FFFDF9" strokeWidth={0.8} />
        ))}
        {t.length ? [0, t[t.length - 1].hours].map((h, i) => {
          const p = h === 0 ? c : t[t.length - 1]
          return (
            <g key={i}>
              <text x={x(p.position.lon)} y={y(p.position.lat) - 4} fontSize={5.5} textAnchor="middle" fill="#857E74" fontFamily="var(--font-mono)">
                {hoursLabel(h)}
              </text>
            </g>
          )
        }) : null}
      </svg>
    </div>
  )
}

/** Washi-tape style corner label for a photographic object. */
export function TapeLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`tape-chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[0.52rem] font-semibold uppercase tracking-widest text-ink-600 ${className}`}>
      {children}
    </span>
  )
}
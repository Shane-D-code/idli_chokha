import { useMemo } from 'react'
import { regionProjection } from '../map/projection'
import { Geography } from '../map/Geography'
import { PlacesLayer } from '../map/PlacesLayer'
import { useCyclone } from '../../hooks/index'
import type { HazardLayer, HazardRegion } from '../../types/hazard'

const LAYER_STYLE: Record<HazardLayer, { label: string; base: string; icon: string }> = {
  rainfall: { label: 'Rainfall', base: '#c8102e', icon: '🌧' },
  flood: { label: 'Flood', base: '#0d88c9', icon: '🌊' },
  landslide: { label: 'Landslide', base: '#8a5a2b', icon: '⛰' },
  surge: { label: 'Storm Surge', base: '#1f6f8b', icon: '🌊' },
  wind: { label: 'Wind', base: '#e2a21c', icon: '💨' },
}

function intensityColor(base: string, intensity: number): string {
  const alpha = 0.1 + (intensity / 100) * 0.38
  return hexA(base, alpha)
}

function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function HazardMap({ regions, layer }: { regions: HazardRegion[]; layer: HazardLayer }) {
  const proj = useMemo(() => regionProjection(1), [])
  const cyclone = useCyclone()
  const style = LAYER_STYLE[layer]
  const maxI = Math.max(1, ...regions.map((r) => r.intensity))

  const legend = [
    { key: 'severe', color: '#e84c4c', label: 'Severe · 80+', a: 0.16 + 0.55 },
    { key: 'high', color: '#e8892f', label: 'High · 60–79', a: 0.16 + 0.5 },
    { key: 'moderate', color: '#f2a93b', label: 'Moderate · 40–59', a: 0.16 + 0.35 },
    { key: 'low', color: '#39a96b', label: 'Low · <40', a: 0.16 + 0.2 },
  ]

  const cycloneX = proj.xOf(cyclone.position.lon)
  const cycloneY = proj.yOf(cyclone.position.lat)

  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-200 bg-mist shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span style={{ color: style.base }} className="text-base">{style.icon}</span>
          <p className="typed text-[0.56rem] text-ink-400">{style.label} Risk Map</p>
        </div>
        {regions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {legend.map((l) => (
              <span key={l.key} className="flex items-center gap-1.5 font-mono text-[0.58rem] text-ink-400">
                <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-ink-400">NOT AVAILABLE IN THIS RUN</span>
        )}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${proj.width} ${proj.height}`} className="block w-full" style={{ maxHeight: 520 }} preserveAspectRatio="xMidYMid meet">
          <Geography proj={proj} showStates={false} />
          <PlacesLayer proj={proj} zoom={1.05} mode="map" />

          {/* dynamic intensity cells */}
          {regions.map((r, i) => {
            const x = proj.xOf(r.position.lon)
            const y = proj.yOf(r.position.lat)
            const rad = 8 + (r.intensity / maxI) * 16
            return (
              <g key={i} opacity={0.95}>
                <circle cx={x} cy={y} r={rad} fill={intensityColor(style.base, r.intensity)} />
                <circle cx={x} cy={y} r={Math.max(2.5, rad * 0.24)} fill={hexA(style.base, 0.42)} stroke="#fff" strokeWidth={1} />
                {r.label ? (
                  <text x={x} y={y - rad - 6} fontSize={9} fill="#29465b" textAnchor="middle" fontFamily="var(--font-sans)" style={{ paintOrder: 'stroke' }} stroke="#f5fafd" strokeWidth={3}>
                    {r.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* cyclone marker reference — real projected position, not decorative */}
          <circle cx={cycloneX} cy={cycloneY} r={7} fill={style.base} opacity={0.18} />
          <circle cx={cycloneX} cy={cycloneY} r={3.4} fill={style.base} stroke="#fff" strokeWidth={1.4} />
        </svg>
      </div>

      <p className="border-t border-ink-100 px-4 py-2 font-mono text-[0.58rem] text-ink-400">
        {regions.length === 0
          ? `${style.label.toUpperCase()} hazard layer NOT AVAILABLE in this run — the pipeline returned no regions for this variable.`
          : 'Probabilistic hazard regions are illustrative model output. Actual risk requires agency-graded guidance.'}
      </p>
    </div>
  )
}
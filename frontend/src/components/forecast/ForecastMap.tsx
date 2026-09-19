import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Earth, LocateFixed, Maximize2, Layers, ZoomIn, ZoomOut, X } from 'lucide-react'
import { regionProjection } from '../map/projection'
import { Geography } from '../map/Geography'
import { PlacesLayer } from '../map/PlacesLayer'
import { multipolygonPath } from '../map/geometryPath'
import { buildForecastCone } from '../../lib/geo'
import { getIntensityColor, intensityColorOf } from '../../lib/ua'
import { drawRaster } from '../../lib/raster'
import { regionDistricts } from '../../lib/geoData'
import { appActions, useApp, ALL_LAYERS } from '../../state/store'
import { useCyclone, useForecastTrack, useHazardRegions, useObserved } from '../../hooks/index'
import { formatFullUtc, hoursLabel } from '../../lib/format'
import type { RiskLevel } from '../../types/common'

const RISK_FILL: Record<RiskLevel, string> = {
  low: 'rgba(57,169,107,0.28)',
  moderate: 'rgba(242,169,59,0.42)',
  high: 'rgba(232,137,47,0.55)',
  severe: 'rgba(232,76,76,0.62)',
}

/** Aliases mapping census 2011 polygon names to demo district site ids. */
const GEO_ALIASES: Record<string, string> = {
  Baleshwar: 'balasore',
  'South 24 Parganas': 'south24',
  'North 24 Parganas': 'north24',
  Jagatsinghapur: 'jagatsinghpur',
  'North & Middle Andaman': 'nma',
  Nagappattinam: 'nagapattinam',
  'East Godavari': 'eastgodavari',
  'West Godavari': 'westgodavari',
  Visakhapatnam: 'visakhapatnam',
  Srikakulam: 'srikakulam',
  Vizianagaram: 'vizianagaram',
  Puri: 'puri',
  Ganjam: 'ganjam',
  Khordha: 'khordha',
  Cuttack: 'cuttack',
  'Purba Medinipur': 'purba-medinipur',
  Medinipur: 'purba-medinipur',
  Kolkata: 'kolkata',
  Gajapati: 'gajapati',
  Mayurbhanj: 'mayurbhanj',
  Kendujhar: 'keonjhar',
  Jajapur: 'jajapur',
  Kendrapara: 'kendrapara',
  Bhadrak: 'bhadrak',
  Balasore: 'balasore',
}

export function ForecastMap() {
  const proj = useMemo(() => regionProjection(1), [])
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [zoom, setZoom] = useState(1.05)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showLayers, setShowLayers] = useState(false)
  const dragging = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  const cyclone = useCyclone()
  const track = useForecastTrack()
  const observed = useObserved()
  const hazardRegions = useHazardRegions()
  const activeLayer = useApp((s) => s.activeLayer)
  const selectedId = useApp((s) => s.selectedForecastId)
  const playback = useApp((s) => s.playback)
  const districts = useApp((s) => s.data.districts.districts)

  const viewW = proj.width / zoom
  const viewH = proj.height / zoom
  const clampedPan = { x: Math.min(proj.width - viewW, Math.max(0, pan.x)), y: Math.min(proj.height - viewH, Math.max(0, pan.y)) }

  const marker = { x: proj.xOf(cyclone.position.lon), y: proj.yOf(cyclone.position.lat) }

  const cone = useMemo(() => buildForecastCone(track), [track])

  const fitTrack = useCallback(() => {
    const pts = [...observed.map((o) => o.position), ...track.map((t) => t.position)]
    let minLon = Infinity
    let maxLon = -Infinity
    let minLat = Infinity
    let maxLat = -Infinity
    for (const p of pts) {
      minLon = Math.min(minLon, p.lon)
      maxLon = Math.max(maxLon, p.lon)
      minLat = Math.min(minLat, p.lat)
      maxLat = Math.max(maxLat, p.lat)
    }
    const pad = 2.5
    minLon -= pad
    maxLon += pad
    minLat -= pad
    maxLat += pad
    const pxW = (maxLon - minLon) * proj.pxPerDeg
    const pxH = proj.yOf(minLat) - proj.yOf(maxLat)
    const fit = Math.min((proj.width * 0.92) / pxW, (proj.height * 0.92) / pxH)
    const z = Math.max(1.05, Math.min(5.5, fit))
    const cx = proj.xOf((minLon + maxLon) / 2)
    const cy = (proj.yOf(minLat) + proj.yOf(maxLat)) / 2
    setZoom(z)
    setPan({
      x: cx - (proj.width / z) / 2,
      y: cy - (proj.height / z) / 2,
    })
  }, [observed, track, proj])

  const centerOnCyclone = useCallback(() => {
    const nz = zoom < 1.9 ? 1.9 : zoom
    const nvw = proj.width / nz
    const nh = proj.height / nz
    setZoom(nz)
    setPan({
      x: Math.min(proj.width - nvw, Math.max(0, marker.x - nvw / 2)),
      y: Math.min(proj.height - nh, Math.max(0, marker.y - nh / 2)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker.x, marker.y, proj, zoom])

  // ---- pointer pan / zoom ----
  const onPointerDown = (e: React.PointerEvent) => {
    const svg = wrapRef.current?.querySelector('svg')
    if (!svg || e.button !== 0) return
    dragging.current = { sx: e.clientX, sy: e.clientY, px: clampedPan.x, py: clampedPan.y }
    svg.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const sx = e.clientX - dragging.current.sx
    const sy = e.clientY - dragging.current.sy
    const vw = proj.width / zoom
    const vh = proj.height / zoom
    const scale = vw / wrapRef.current!.clientWidth
    setPan({
      x: Math.min(proj.width - vw, Math.max(0, dragging.current.px - sx * scale)),
      y: Math.min(proj.height - vh, Math.max(0, dragging.current.py - sy * scale)),
    })
  }
  const onPointerUp = () => {
    dragging.current = null
  }
  const zoomBy = (d: number) => {
    setZoom((z) => Math.max(1.05, Math.min(6, z + d)))
  }

  // ---- raster overlays (satellite / wind / rainfall) ----
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const vw = proj.width / zoom
    const vh = proj.height / zoom
    const csc = cw / vw
    const isRaster =
      activeLayer === 'satellite' || activeLayer === 'wind' || activeLayer === 'rainfall'
    if (!isRaster) {
      ctx.clearRect(0, 0, cw, ch)
      return
    }
    const seedMap: Record<string, number> = { satellite: 41, wind: 19, rainfall: 7 }
    const rainfallPoints = hazardRegions
      .filter((r) => r.type === 'rainfall')
      .map((r) => ({ lat: r.position.lat, lon: r.position.lon, mm: r.intensity }))
    drawRaster(ctx, cw, ch, {
      type: activeLayer === 'satellite' ? 'satellite' : activeLayer === 'wind' ? 'wind' : 'rainfall',
      seed: seedMap[activeLayer],
      proj,
      px: clampedPan.x,
      py: clampedPan.y,
      pw: vw,
      ph: vh,
      cycloneScreen:
        marker.x > clampedPan.x && marker.x < clampedPan.x + vw && marker.y > clampedPan.y && marker.y < clampedPan.y + vh
          ? { x: (marker.x - clampedPan.x) * csc, y: (marker.y - clampedPan.y) * csc }
          : null,
      windKt: cyclone.windKt,
      rainfallPoints,
    })
  }, [activeLayer, zoom, clampedPan.x, clampedPan.y, proj, marker.x, marker.y, cyclone.windKt, hazardRegions])

  // ---- selected forecast point marker ----
  const selected = track.find((t) => t.id === selectedId) ?? null

  const activeLabel = ALL_LAYERS.find((l) => l.id === activeLayer)?.label ?? ''
  const riskByGeo: (name: string) => string = (name) => {
    const id = GEO_ALIASES[name] ?? name.toLowerCase()
    const d = districts.find((x) => x.id === id)
    if (!d) return 'transparent'
    return RISK_FILL[d.riskLevel]
  }

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-xl border border-ink-200 bg-mist shadow-soft">
      <svg
        className="block h-[420px] w-full cursor-grab active:cursor-grabbing sm:h-[500px] lg:h-[560px]"
        viewBox={`${clampedPan.x} ${clampedPan.y} ${viewW} ${viewH}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => {
          e.preventDefault()
          const rect = wrapRef.current!.getBoundingClientRect()
          const mx = ((e.clientX - rect.left) / rect.width) * viewW + clampedPan.x
          const my = ((e.clientY - rect.top) / rect.height) * viewH + clampedPan.y
          const nz = Math.max(1.05, Math.min(6, zoom - Math.sign(e.deltaY) * 0.25))
          const nvw = proj.width / nz
          const nh = proj.height / nz
          setZoom(nz)
          setPan({ x: Math.min(proj.width - nvw, Math.max(0, mx - ((mx - clampedPan.x) / viewW) * nvw)), y: Math.min(proj.height - nh, Math.max(0, my - ((my - clampedPan.y) / viewH) * nh)) })
        }}
      >
        <Geography
          proj={proj}
          showStates
          showDistricts={activeLayer === 'districtRisk'}
          districtFill={activeLayer === 'districtRisk' ? riskByGeo : undefined}
        />

        {/* ---- Forecast cone ribbon ---- */}
        {activeLayer !== 'districtRisk' && (
          <g pointerEvents="none" opacity={0.9}>
            {cone.map((seg, i) => {
              const d =
                seg.left.map((p, j) => `${j === 0 ? 'M' : 'L'}${proj.xOf(p.lon)},${proj.yOf(p.lat)}`).join(' ') +
                ' ' +
                seg.right.slice().reverse().map((p, j) => `${j === 0 ? 'L' : 'L'}${proj.xOf(p.lon)},${proj.yOf(p.lat)}`).join(' ') +
                ' Z'
              return <path key={i} d={d} fill="rgba(47,146,184,0.13)" stroke="rgba(25,121,159,0.5)" strokeWidth={0.8} strokeDasharray="3 3" />
            })}
          </g>
        )}

        {/* ---- Observed track ---- */}
        <g pointerEvents="none">
          <path
            d={observed.map((o, i) => (i === 0 ? 'M' : 'L') + proj.xOf(o.position.lon) + ',' + proj.yOf(o.position.lat)).join(' ')}
            fill="none"
            stroke="#61788A"
            strokeWidth={1.6}
            strokeDasharray="4 3"
            opacity={0.6}
          />
          {observed.map((o, i) => (
            <circle key={i} cx={proj.xOf(o.position.lon)} cy={proj.yOf(o.position.lat)} r={2.6} fill="#61788A" opacity={0.7} />
          ))}
          <circle cx={marker.x} cy={marker.y} r={10} fill={getIntensityColor(cyclone.windKt)} opacity={0.25} />
          <circle cx={marker.x} cy={marker.y} r={4.6} fill={getIntensityColor(cyclone.windKt)} stroke="#FFFFFF" strokeWidth={1.6} />

          {/* ---- Playback playhead marker — animates along the track ---- */}
          {playback ? (
            <g>
              <circle cx={proj.xOf(playback.lon)} cy={proj.yOf(playback.lat)} r={13} fill={getIntensityColor(playback.windKt)} opacity={0.18} />
              <circle cx={proj.xOf(playback.lon)} cy={proj.yOf(playback.lat)} r={4.6} fill="#FFFFFF" stroke={getIntensityColor(playback.windKt)} strokeWidth={2} />
              <text
                x={proj.xOf(playback.lon)}
                y={proj.yOf(playback.lat) - 12}
                fontSize={9}
                fontFamily="var(--font-mono)"
                fontWeight={700}
                fill={getIntensityColor(playback.windKt)}
                textAnchor="middle"
                style={{ paintOrder: 'stroke' }}
                stroke="rgba(245,250,253,0.94)"
                strokeWidth={3}
              >
                {hoursLabel(playback.hours)}
              </text>
            </g>
          ) : null}
        </g>

        {/* ---- Forecast track + points ---- */}
        {activeLayer !== 'districtRisk' && (
          <g>
            <path
              d={track.map((p, i) => (i === 0 ? 'M' : 'L') + proj.xOf(p.position.lon) + ',' + proj.yOf(p.position.lat)).join(' ')}
              fill="none"
              stroke={intensityColorOf(track[0].windKt)}
              strokeWidth={2.2}
              strokeLinecap="round"
              opacity={0.85}
            />
            {track.map((p) => {
              const x = proj.xOf(p.position.lon)
              const y = proj.yOf(p.position.lat)
              const isSel = selected && selected.id === p.id
              return (
                <g key={p.id} className="cursor-pointer" onClick={() => appActions.selectForecast(isSel ? null : p.id)}>
                  <circle cx={x} cy={y} r={p.hours === 0 ? 8 : 5.5} fill="transparent" style={{ pointerEvents: 'all' }} />
                  <circle cx={x} cy={y} r={p.hours === 0 ? 4 : 4.2} fill={isSel ? '#102A43' : intensityColorOf(p.windKt)} stroke="#FFFFFF" strokeWidth={1.6} />
                  <text x={x} y={y - 9} fontSize={9.5} fontFamily="var(--font-mono)" fontWeight={700} fill="#102A43" textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke="rgba(245,250,253,0.92)" strokeWidth={3}>
                    {hoursLabel(p.hours)}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* ---- District risk clickable fill ---- */}
        {activeLayer === 'districtRisk' &&
          regionDistricts.features.map((f, i) => {
            const id = GEO_ALIASES[f.properties.name] ?? f.properties.name.toLowerCase()
            const risk = districts.find((x) => x.id === id)
            return (
              <path
                key={`dr${i}`}
                d={multipolygonPath(proj, f.geometry)}
                fill={risk ? RISK_FILL[risk.riskLevel] : 'transparent'}
                stroke={risk ? 'rgba(255,255,255,0.9)' : '#9d8b6a'}
                strokeWidth={0.6}
                className={risk ? 'cursor-pointer' : ''}
                onClick={() => risk && appActions.selectDistrict(risk.id)}
              >
                {risk ? <title>{f.properties.name}</title> : null}
              </path>
            )
          })}

        <PlacesLayer proj={proj} zoom={zoom} mode="map" />
      </svg>

      {/* raster canvas overlay */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ width: '100%', height: '100%' }} />

      {/* ---- Floating controls ---- */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5">
        <ControlBtn title="Zoom in" onClick={() => zoomBy(0.3)}>
          <ZoomIn className="h-4 w-4" />
        </ControlBtn>
        <ControlBtn title="Zoom out" onClick={() => zoomBy(-0.3)}>
          <ZoomOut className="h-4 w-4" />
        </ControlBtn>
        <ControlBtn title="Centre on cyclone" onClick={centerOnCyclone}>
          <LocateFixed className="h-4 w-4" />
        </ControlBtn>
        <ControlBtn title="Fit forecast track" onClick={fitTrack}>
          <Maximize2 className="h-4 w-4" />
        </ControlBtn>
      </div>

      <div className="absolute right-3 top-3">
        <ControlBtn title="Layers" onClick={() => setShowLayers((s) => !s)}>
          <Layers className="h-4 w-4" />
          <span className="font-mono text-[0.6rem] font-semibold">{activeLayer === 'pressure' ? 'PRESSURE' : activeLabel}</span>
        </ControlBtn>
        {showLayers ? (
          <div className="mt-2 w-48 rounded-xl border border-ink-200 bg-cloud p-1.5 shadow-pop">
            <div className="px-2 pb-1 pt-1 font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-ink-400">Layers</div>
            {ALL_LAYERS.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  appActions.setActiveLayer(l.id)
                  setShowLayers(false)
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[0.8rem] ${activeLayer === l.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-600 hover:bg-sky'}`}
              >
                {l.label}
                {l.id === 'pressure' ? <span className="font-mono text-[0.58rem] text-ink-300">UNAVAILABLE</span> : null}
                {activeLayer === l.id ? <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Layer indicator */}
      {activeLayer === 'pressure' ? (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-warn-500/30 bg-warn-100 px-3 py-1.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-haze-700">
          <X className="h-3.5 w-3.5" /> Pressure layer not available in this run
        </div>
      ) : null}

      {/* Selected forecast point chip */}
      {selected ? (
        <div className="absolute bottom-3 right-3 flex min-w-[180px] flex-col gap-1 rounded-xl border border-ink-200 bg-cloud/95 px-3.5 py-2.5 shadow-pop backdrop-blur">
          <div className="flex items-center justify-between gap-6">
            <span className="typed text-[0.6rem] text-brand-600">
              FORECAST {hoursLabel(selected.hours)}
            </span>
            <button onClick={() => appActions.selectForecast(null)} className="text-ink-300 hover:text-ink-500">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="font-mono text-[0.7rem] font-semibold text-ink-800">VALID {formatFullUtc(selected.validAt)}</div>
          <div className="font-mono text-[0.72rem] text-ink-600">
            LAT {Math.abs(selected.position.lat).toFixed(2)}°{selected.position.lat >= 0 ? 'N' : 'S'} · LON {Math.abs(selected.position.lon).toFixed(2)}°{selected.position.lon >= 0 ? 'E' : 'W'}
          </div>
          <div className="font-mono text-[0.72rem] text-ink-600">
            INTENSITY {selected.windKt != null ? `${selected.windKt} kt` : 'N/A'} · PRESSURE {selected.pressureHpa != null ? `${selected.pressureHpa} hPa` : 'N/A'}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: intensityColorOf(selected.windKt) }} />
            <span className="font-mono text-[0.68rem] text-ink-400">
              UNCERTAINTY ±{Math.round(selected.uncertaintyKm)} km · MOVING {selected.movement} · {selected.category ?? 'N/A'}
            </span>
          </div>
        </div>
      ) : null}

      {/* Legend: intensity colours */}
      <div className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-3 rounded-lg border border-ink-200 bg-cloud/90 px-3 py-1.5 backdrop-blur lg:flex">
        <Earth className="h-3.5 w-3.5 text-ink-300" />
        {SAMPLE_LEGEND.map((c) => (
          <span key={c.abbr} className="flex items-center gap-1 font-mono text-[0.6rem] font-semibold text-ink-400">
            <span className="h-2 w-2 rounded-full" style={{ background: getIntensityColor(c.windKt) }} />
            {c.abbr}
          </span>
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 bottom-3 hidden items-center gap-2 font-mono text-[0.6rem] text-ink-300 sm:flex">
        <span>ZOOM {zoom.toFixed(2)}×</span>
      </div>
    </div>
  )
}

// color ramp sampling for the intensity legend (single source: ua.ts)
const SAMPLE_LEGEND = [
  { abbr: 'DD', windKt: 30 },
  { abbr: 'CS', windKt: 40 },
  { abbr: 'SCS', windKt: 55 },
  { abbr: 'VSCS', windKt: 75 },
  { abbr: 'ESCS', windKt: 95 },
  { abbr: 'SuCS', windKt: 125 },
]

function ControlBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-cloud/90 text-ink-600 shadow-soft backdrop-blur transition hover:bg-sky hover:text-brand-600"
    >
      {children}
    </button>
  )
}
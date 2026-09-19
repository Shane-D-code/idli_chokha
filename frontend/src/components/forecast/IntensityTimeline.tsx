import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { useLifecycle, useForecastTrack } from '../../hooks/index'
import { appActions } from '../../state/store'
import { getIntensityColor, getIntensityTint } from '../../lib/ua'
import { hoursLabel } from '../../lib/format'
import { lerpAngle } from '../../lib/geo'
import type { LatLon } from '../../types/common'

/** Continuous open timeline — dots on a thin line, values above, NOW
 *  highlighted. Doubles as the forecast playback scrubber: PLAY steps
 *  every 2 hours and broadcasts the interpolated track point so the map
 *  marker (and intensity charts playhead) follow the storm moving. */
export function IntensityTimeline() {
  const lifecycle = useLifecycle()
  const track = useForecastTrack()

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [armed, setArmed] = useState(false)
  const idxRef = useRef(0)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  const positionAtHours = useCallback(
    (hours: number): LatLon => {
      if (track.length === 0) return { lat: 0, lon: 0 }
      if (track.length === 1) return track[0].position
      const first = track[0]
      const last = track[track.length - 1]
      const h = Math.max(first.hours, Math.min(last.hours, hours))
      for (let i = 0; i < track.length - 1; i++) {
        const a = track[i]
        const b = track[i + 1]
        if (h >= a.hours && h <= b.hours) {
          const t = b.hours === a.hours ? 0 : (h - a.hours) / (b.hours - a.hours)
          return lerpAngle(a.position, b.position, t)
        }
      }
      return last.position
    },
    [track],
  )

  const stepPlayback = useCallback(
    (i: number) => {
      const p = lifecycle[i]
      if (!p) return
      const pos = positionAtHours(p.hours)
      appActions.setPlayback({
        hours: p.hours,
        lat: pos.lat,
        lon: pos.lon,
        windKt: p.windKt,
        pressureHpa: p.pressureHpa,
      })
    },
    [lifecycle, positionAtHours],
  )

  const emitAt = useCallback(
    (i: number) => {
      idxRef.current = i
      setIdx(i)
      setArmed(true)
      stepPlayback(i)
    },
    [stepPlayback],
  )

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      if (document.hidden) return
      emitAt((idxRef.current + 1) % lifecycle.length)
    }, 480)
    return () => clearInterval(id)
  }, [playing, lifecycle.length, emitAt])

  useEffect(() => {
    if (playing) activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [idx, playing])

  useEffect(() => () => appActions.setPlayback(null), [])

  if (lifecycle.length < 2) {
    return (
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="typed text-brand-600">Intensity Timeline</p>
          <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-haze-700">NOT AVAILABLE</span>
        </div>
        <p className="mt-3 border-l-2 border-warn-500/40 pl-3 text-[0.78rem] leading-relaxed text-ink-500">
          This run produces a position-only track — no 2-hourly intensity series was returned. Only the now-observed
          {lifecycle[0] && lifecycle[0].windKt !== undefined ? ` ${lifecycle[0].windKt} kt` : ' state'} is known.
        </p>
      </div>
    )
  }

  const active = lifecycle[idx]
  const activeColor = getIntensityColor(active.windKt)

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="typed text-brand-600">Intensity Timeline · NOW → +24H</p>
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-[0.72rem] font-bold transition ${armed ? '' : 'opacity-0'}`}
            style={{ color: activeColor }}
          >
            {hoursLabel(active.hours)} · {active.windKt} kt · {active.pressureHpa} hPa
          </span>
          <button
            onClick={() => {
              if (!armed) emitAt(0)
              setPlaying((p) => !p)
            }}
            aria-label={playing ? 'Pause timeline playback' : 'Play timeline playback'}
            title={playing ? 'Pause playback' : 'Play playback'}
            className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-cloud/90 px-3 py-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-ink-600 shadow-soft transition hover:bg-sky hover:text-brand-600"
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <span className="hidden font-mono text-[0.56rem] text-ink-300 sm:inline">2-HOURLY</span>
        </div>
      </div>
      <div className="relative mt-5">
        <div aria-hidden className="absolute left-3 right-3 top-[28px] h-px bg-ink-200" />
        <div className="no-scrollbar relative flex items-start gap-1.5 overflow-x-auto pb-2">
          {lifecycle.map((p, i) => {
            const color = getIntensityColor(p.windKt)
            const isNow = i === 0
            const isActive = i === idx
            return (
              <button
                key={p.hours}
                ref={isActive ? activeRef : null}
                onClick={() => emitAt(i)}
                aria-label={`Jump to ${hoursLabel(p.hours)} · ${p.windKt} kt`}
                title={`${hoursLabel(p.hours)} · ${p.windKt} kt`}
                className="relative flex min-w-[54px] flex-1 flex-col items-center rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <span className="font-mono text-[0.74rem] font-bold" style={{ color }}>
                  {p.windKt} <span className="text-[0.5rem] font-normal text-ink-400">kt</span>
                </span>
                <span
                  className={`z-10 mt-1.5 h-3.5 w-3.5 rounded-full border-2 transition-all duration-200 ${isNow ? 'ring-2 ring-offset-1' : ''} ${isActive && i !== 0 ? 'scale-125' : ''}`}
                  style={
                    isNow
                      ? { background: color, borderColor: color, ['--tw-ring-color' as string]: `${color}55` }
                      : isActive
                        ? { background: color, borderColor: '#FFFFFF', boxShadow: `0 0 0 3px ${color}44` }
                        : { background: getIntensityTint(p.windKt), borderColor: color }
                  }
                />
                <span className={`mt-1.5 font-mono text-[0.58rem] ${isNow || isActive ? 'font-bold text-ink-800' : 'text-ink-500'}`}>
                  {hoursLabel(p.hours)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="font-mono text-[0.56rem] uppercase tracking-wider text-ink-400">
          {playing ? 'Playback · 2-hourly steps along the forecast path' : 'Play or click any dot to trace the storm along the track'}
        </p>
      </div>
    </div>
  )
}
import { useCyclone, useForecast } from '../../hooks/index'
import { getCycloneAbbr, getIntensityColor } from '../../lib/ua'
import { formatLatLon } from '../../lib/geo'
import { formatFullUtc } from '../../lib/format'
import { TrendArrow } from './TrendArrow'

/* Hero-right narrow STORM TELEMETRY rail — compact ruled readout (no card),
   kept visually distinct from the main information column. */

export function CycloneIntelligencePanel() {
  const c = useCyclone()
  const f = useForecast()
  const projected = f.lifecycle.length > 1 ? f.lifecycle[f.lifecycle.length - 1] : null

  const telemetry = [
    { label: 'Current max wind', value: `${c.windKt} kt`, note: `${Math.round(c.windKt * 1.852)} km/h` },
    { label: 'Forecast intensity', value: projected ? `${projected.windKt} kt` : 'N/A', note: projected ? `projected +${projected.hours}H` : 'not produced in this run' },
    { label: 'Movement', value: `${c.movement} · ${c.movementKph} km/h`, note: `bearing ${c.bearingDeg}°` },
    { label: 'Radius of max winds', value: c.rmwKm > 0 ? `${c.rmwKm} km` : 'N/R', note: c.rmwKm > 0 ? 'RMW' : 'not reported' },
    { label: 'Track uncertainty', value: c.uncertaintyKm > 0 ? `±${c.uncertaintyKm} km` : 'N/R', note: c.uncertaintyKm > 0 ? 'degraded bound' : 'not reported' },
    { label: 'Position', value: formatLatLon(c.position), note: c.basin.toLowerCase() },
    { label: 'Valid', value: formatFullUtc(c.validAt), note: 'analysis time' },
  ]

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="typed text-brand-600">Storm Telemetry</p>
        <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-widest" style={{ color: getIntensityColor(c.windKt) }}>
          {getCycloneAbbr(c.windKt)}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-y border-ink-100 py-3">
        <span className="typed text-ink-400">Heading</span>
        <TrendArrow bearingDeg={c.bearingDeg} size={44} />
      </div>

      <div className="mt-2 overflow-hidden">
        {telemetry.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 border-b border-ink-100 py-2.5">
            <span className="typed text-ink-400">{r.label}</span>
            <span className="font-mono text-[0.88rem] font-semibold text-ink-800">{r.value}</span>
            <span className="font-mono text-[0.52rem] text-ink-400">{r.note}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
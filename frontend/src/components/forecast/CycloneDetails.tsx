import { useCyclone, useForecast } from '../../hooks/index'
import { getCycloneAbbr, getCycloneLabel, getIntensityColor } from '../../lib/ua'
import { formatLatLon } from '../../lib/geo'
import { useApp } from '../../state/store'

/* Open current-conditions block — typed label + ruled detail rows, no card. */
export function CycloneDetails() {
  const c = useCyclone()
  const forecast = useForecast()
  const demoMode = useApp((s) => s.demoMode)
  const probe = forecast.track.slice(0, 4)

  const rows = [
    { label: 'Max wind', value: `${c.windKt} kt`, note: `${Math.round(c.windKt * 1.852)} km/h` },
    { label: 'Min sea-level pressure', value: `${c.pressureHpa} hPa`, note: 'central minimum' },
    { label: 'Position', value: formatLatLon(c.position), note: c.basin.toLowerCase() },
    { label: 'Movement', value: `${c.movement} · ${c.movementKph} km/h`, note: 'general motion' },
    { label: 'Radius of max winds', value: c.rmwKm > 0 ? `${c.rmwKm} km` : 'N/R', note: c.rmwKm > 0 ? 'RMW' : 'not reported' },
    { label: 'Track uncertainty', value: c.uncertaintyKm > 0 ? `±${c.uncertaintyKm} km` : 'N/R', note: c.uncertaintyKm > 0 ? 'degraded bound' : 'not reported' },
  ]

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="typed text-brand-600">Current Conditions</p>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <h3 className="display text-3xl font-normal tracking-tight text-ink-900">{c.name}</h3>
        <span className="font-mono text-[0.72rem] font-bold uppercase tracking-wider" style={{ color: getIntensityColor(c.windKt) }}>
          {getCycloneAbbr(c.windKt)}
        </span>
      </div>
      <p className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-400">{getCycloneLabel(c.windKt)}</p>

      <dl className="mt-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-ink-100 py-2 last:border-0">
            <dt className="typed text-ink-400">{r.label}</dt>
            <dd className="text-right">
              <span className="font-mono text-[0.85rem] font-semibold text-ink-800">{r.value}</span>
              {r.note ? <span className="ml-1.5 font-mono text-[0.54rem] text-ink-400">{r.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-500">
        {demoMode
          ? 'The 72-hour model forecast projects the storm NNE toward Odisha–West Bengal, with landfall near the Sundarbans about +41H and steady decay after crossing the coast.'
          : 'Live run: wind, pressure and position are the current observed state; the trajectory carries no per-point intensity forecast. Track uncertainty is a degraded bound.'}{' '}
        {probe.length} examined track positions.
      </p>
    </div>
  )
}
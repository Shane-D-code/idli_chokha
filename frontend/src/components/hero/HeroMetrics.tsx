import { useCyclone } from '../../hooks/index'
import { useForecast } from '../../hooks/index'
import { getIntensityColor } from '../../lib/ua'
import { StatusDot } from '../ui/editorial'

/** Hero-bottom open archive strip — typography and rules, no card. */
export function HeroMetrics() {
  const c = useCyclone()
  const forecast = useForecast()
  const maxUnc = Math.round(forecast.provenance.maxUncertaintyKm)

  const metrics = [
    { num: '01', label: 'Active System', value: '1', unit: 'storm', color: getIntensityColor(c.windKt) },
    { num: '02', label: 'Current Wind', value: `${c.windKt}`, unit: 'kt', color: getIntensityColor(c.windKt) },
    { num: '03', label: 'Central Pressure', value: `${c.pressureHpa}`, unit: 'hPa', color: '#19799F' },
    { num: '04', label: 'Forecast Horizon', value: `+${forecast.provenance.horizonHours}`, unit: 'h', color: '#19799F' },
    { num: '05', label: 'Max Uncertainty', value: `±${maxUnc}`, unit: 'km', color: '#D9973F', warn: true },
  ]

  return (
    <div className="grid grid-cols-2 divide-x divide-ink-100 border-y border-ink-100 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => (
        <div key={m.num} className="flex flex-col gap-1 px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.55rem] font-semibold text-ink-400">{m.num}</span>
            <StatusDot color={m.color} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-ink-900">{m.value}</span>
            <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-400">{m.unit}</span>
          </div>
          <span className="typed text-[0.52rem] text-ink-400">{m.label}</span>
        </div>
      ))}
    </div>
  )
}
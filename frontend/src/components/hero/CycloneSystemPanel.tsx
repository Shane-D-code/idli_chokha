import { useCyclone } from '../../hooks/index'
import { getCycloneAbbr, getCycloneLabel, getIntensityColor } from '../../lib/ua'
import { formatLatLon } from '../../lib/geo'
import { formatFullUtc } from '../../lib/format'
import { RiskBadge } from '../ui/primitives'
import { Rule } from '../ui/editorial'

/* Hero-right open information surface — one continuous editorial column
   broken into four groups by whitespace, typography and thin rules. */

function Metric({
  label,
  value,
  unit,
  note,
  valueClass = 'text-4xl',
}: {
  label: string
  value: string
  unit?: string
  note?: string
  valueClass?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="typed text-ink-400">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono font-bold leading-none tracking-tight text-ink-900 ${valueClass}`}>{value}</span>
        {unit ? <span className="font-mono text-sm text-ink-400">{unit}</span> : null}
      </div>
      {note ? <span className="font-mono text-[0.6rem] text-ink-400">{note}</span> : null}
    </div>
  )
}

export function CycloneSystemPanel() {
  const c = useCyclone()
  const accent = getIntensityColor(c.windKt)

  return (
    <div className="flex flex-col">
      {/* ---- GROUP 1 · CYCLONE IDENTITY ---- */}
      <p className="typed text-brand-600">Current Cyclone</p>
      <h3 className="display mt-3 text-6xl font-normal leading-[0.95] tracking-tight text-ink-900">{c.name}</h3>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[0.9rem] font-semibold uppercase tracking-widest text-ink-800">
          {getCycloneLabel(c.windKt)} · {getCycloneAbbr(c.windKt)}
        </span>
        <RiskBadge level={c.riskLevel.toLowerCase() as 'low' | 'moderate' | 'high' | 'severe'} />
      </div>
      <p className="mt-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{c.basin}</p>

      <Rule className="my-6" />

      {/* ---- GROUP 2 · CORE METEOROLOGICAL STATE ---- */}
      <p className="typed text-ink-400">Core Intensity</p>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5">
        <Metric label="Maximum wind" value={`${c.windKt}`} unit="kt" note={`${Math.round(c.windKt * 1.852)} km/h`} />
        <Metric label="Central pressure" value={`${c.pressureHpa}`} unit="hPa" note="central minimum" />
      </div>

      <Rule className="my-6" />

      {/* ---- GROUP 3 · LOCATION & MOVEMENT ---- */}
      <p className="typed text-ink-400">Location &amp; Movement</p>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5">
        <Metric label="Position" value={formatLatLon(c.position)} note="Bay of Bengal" valueClass="text-[1.05rem]" />
        <Metric
          label="Movement"
          value={`${c.movement} · ${c.movementKph}`}
          unit="km/h"
          note={`Bearing ${c.bearingDeg}°`}
          valueClass="text-[1.05rem]"
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-ink-100 pt-4">
        <Metric label="Radius of max winds" value={c.rmwKm > 0 ? `${c.rmwKm}` : 'N/R'} unit={c.rmwKm > 0 ? 'km' : undefined} note={c.rmwKm > 0 ? 'RMW' : 'not reported'} valueClass="text-2xl" />
        <Metric label="Track uncertainty" value={c.uncertaintyKm > 0 ? `±${c.uncertaintyKm}` : 'N/R'} unit={c.uncertaintyKm > 0 ? 'km' : undefined} note={c.uncertaintyKm > 0 ? 'current estimate' : 'not reported'} valueClass="text-2xl" />
      </div>

      <Rule className="my-6" />

      {/* ---- GROUP 4 · VALIDATION / STATUS ---- */}
      <p className="typed text-ink-400">Valid</p>
      <p className="mt-1 font-mono text-[0.86rem] font-semibold text-ink-800">{formatFullUtc(c.validAt)}</p>

      <div className="mt-4 flex items-end justify-between gap-4 border-t border-ink-100 pt-4">
        <div className="flex flex-col gap-1">
          <span className="typed text-ink-400">Composite risk</span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-bold leading-none tracking-tight text-ink-900">{c.riskScore}</span>
            <span className="font-mono text-[0.6rem] text-ink-400">/100</span>
            <span className="font-mono text-[0.78rem] font-semibold uppercase tracking-wider" style={{ color: accent }}>
              {c.riskLevel}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
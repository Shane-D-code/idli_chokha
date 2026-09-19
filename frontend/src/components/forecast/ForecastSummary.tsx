import { useCyclone, useForecast, useGenesis } from '../../hooks/index'
import { compassLabel } from '../../lib/geo'
import { useApp } from '../../state/store'
import { OpenMetric } from '../ui/editorial'

export function ForecastSummary() {
  const c = useCyclone()
  const f = useForecast()
  const g = useGenesis()
  const demoMode = useApp((s) => s.demoMode)
  const maxUnc = Math.max(...f.track.map((t) => t.uncertaintyKm), 0)
  const lastHour = f.track.length ? f.track[f.track.length - 1].hours : 0
  const hasIntensity = f.lifecycle.length > 1
  const genesisProb = g.predictions[0]?.probability ?? 0

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="typed text-brand-600">Forecast Summary</p>
        <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-ink-400">
          {f.provenance.status}
        </span>
      </div>

      {/* CURRENT — observed state only */}
      <div className="mt-2 grid grid-cols-2 divide-x divide-ink-100 border-y border-ink-100 lg:grid-cols-4">
        <OpenMetric
          label="Current wind"
          value={c.windKt}
          unit="kt"
          note="now observed"
          className="gap-1 px-5 py-4 [&_span]:text-xl"
        />
        <OpenMetric
          label="Current pressure"
          value={c.pressureHpa}
          unit="hPa"
          note="now observed"
          className="gap-1 px-5 py-4 [&_span]:text-xl"
        />
        <OpenMetric
          label="Track positions"
          value={f.track.length}
          unit="pts"
          note={`+${lastHour}H horizon`}
          className="gap-1 px-5 py-4 [&_span]:text-xl"
        />
        <OpenMetric
          label="Landfall"
          value="N/A"
          note="not assessed in this run"
          className="gap-1 px-5 py-4 [&_span]:text-xl"
        />
      </div>

      {/* MODEL FORECAST — what the pipeline actually projected */}
      <div className="mt-3 flex items-baseline justify-between">
        <p className="typed text-ink-400">Model Forecast</p>
        <span className="font-mono text-[0.56rem] text-ink-300">
          {hasIntensity ? 'INTENSITY + PRESSURE' : 'POSITION ONLY'}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-1 divide-y divide-ink-100 border-y border-ink-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ForecastMetric
          label="Intensity forecast"
          value={hasIntensity ? `+${f.lifecycle[1].hours}H onwards` : 'NOT AVAILABLE'}
          note={hasIntensity ? 'projected series' : 'position-only trajectory'}
        />
        <ForecastMetric
          label="Track uncertainty"
          value={`±${Math.round(maxUnc)} km`}
          note="saturated · uncalibrated bound"
        />
        <ForecastMetric
          label="Genesis · 24H"
          value={`${genesisProb}%`}
          note={g.risk ? `RISK ${g.risk}` : undefined}
        />
      </div>

      <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-500">
        {demoMode
          ? 'Landfall is not available for this scenario — the forecast recurves and stays over the Bay of Bengal through +72H.'
          : `Live run: the LT3P trajectory maps positions only (${f.track.length} points through +${lastHour}H) — no per-point or peak intensity is forecast by this stage. Landfall is not assessed.`}{' '}
        Movement {c.movement} · {compassLabel(c.bearingDeg)}, {c.movementKph} km/h.
      </p>
    </div>
  )
}

function ForecastMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="typed text-[0.52rem] text-ink-400">{label}</span>
      <span className="font-mono text-[0.9rem] font-bold text-ink-900">{value}</span>
      {note ? <span className="font-mono text-[0.54rem] text-ink-400">{note}</span> : null}
    </div>
  )
}
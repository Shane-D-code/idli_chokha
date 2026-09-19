import { useForecast } from '../../hooks/index'
import { formatFullUtc } from '../../lib/format'
import { useApp } from '../../state/store'
import { Annotation } from '../ui/editorial'

/* Provenance as mono metadata lines beneath the map — no card. */
export function ForecastProvenance() {
  const f = useForecast()
  const p = f.provenance
  const demoMode = useApp((s) => s.demoMode)
  return (
    <>
      <Annotation>
        {demoMode ? 'AMPHAN REPLAY · OBSERVED = IMD BEST TRACK · FORECAST SIMULATED · ' : ''}
        TRACK {f.track.length} POSITIONS · MODEL {p.model} · ENGINE {p.source} · VALID{' '}
        {formatFullUtc(p.validAt)} · HORIZON +{p.horizonHours}H
      </Annotation>
      <Annotation>
        UNCERTAINTY ±{p.uncertaintyNowKm} → ±{p.maxUncertaintyKm} km · LANDFALL{' '}
        {f.landfall ? `${f.landfall.timeLabel} · ${f.landfall.coast}` : 'NOT AVAILABLE'}
      </Annotation>
    </>
  )
}
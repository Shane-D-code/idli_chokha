import { useForecast } from '../../hooks/index'
import { formatFullUtc } from '../../lib/format'
import { Annotation } from '../ui/editorial'

/* Provenance as mono metadata lines beneath the map — no card. */
export function ForecastProvenance() {
  const f = useForecast()
  const p = f.provenance
  return (
    <>
      <Annotation>
        TRACK {f.track.length} POSITIONS · MODEL {p.model} · ENGINE {p.source} · VALID{' '}
        {formatFullUtc(p.validAt)} · HORIZON +{p.horizonHours}H
      </Annotation>
      <Annotation>
        UNCERTAINTY ±{p.uncertaintyNowKm} → ±{p.maxUncertaintyKm} km · {p.status} · LANDFALL{' '}
        {f.landfall ? f.landfall.timeLabel : 'NOT AVAILABLE'}
      </Annotation>
    </>
  )
}
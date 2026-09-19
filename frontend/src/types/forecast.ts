import type { IntensityCategory, ObservedPoint } from './cyclone'
import type { LatLon } from './common'

/** A point on the forecast track — the SAME array powers map, globe,
 *  timeline, charts and popups. Do not define forecast points twice. */
export interface ForecastPoint {
  id: string
  /** Relative forecast hour, e.g. 6 = +6H. Zero is "now". */
  hours: number
  /** ISO-8601 UTC timestamp. */
  validAt: string
  position: LatLon
  /** Per-point intensity — NULL when the pipeline produced no intensity
   *  forecast (e.g. position-only LT3P track). Components render N/A. */
  windKt: number | null
  pressureHpa: number | null
  category: IntensityCategory | null
  /** Compass movement, e.g. "NNE". */
  movement: string
  /** Cross-track uncertainty for this forecast hour, km. */
  uncertaintyKm: number
}

/** 2-hourly intensity snapshot used by the lifecycle timeline + charts. */
export interface IntensityPoint {
  hours: number
  validAt: string
  windKt: number
  pressureHpa: number
  category: IntensityCategory
}

export interface ForecastBundle {
  /** Fixed forecast points for the track / map / globe / popups. */
  track: ForecastPoint[]
  /** 2-hourly lifecycle for timeline + intensity & pressure charts. */
  lifecycle: IntensityPoint[]
  /** Observed (history) intensity series, ending exactly at "now". */
  observed: ObservedPoint[]
  /** Model metadata shown in provenance. */
  provenance: {
    model: string
    checkpoint: string
    validAt: string
    horizonHours: number
    uncertaintyNowKm: number
    maxUncertaintyKm: number
    source: string
    status: 'SIMULATED' | 'LIVE' | 'DEGRADED'
  }
  /** Projected landfall. Never fabricated — null when unavailable. */
  landfall: {
    position: LatLon
    estimateAt: string
    timeLabel: string
    coast: string
  } | null
}

/** Corner-to-corner great-circle offsets used to build the forecast cone
 *  (corridor) from the track + per-point uncertainty. */
export interface ConePoint {
  position: LatLon
  uncertaintyKm: number
}
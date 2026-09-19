import { getCycloneCategory } from '../../lib/ua'
import type { ForecastBundle, ForecastPoint, IntensityPoint } from '../../types/forecast'
import {
  AMPHAN_LANDFALL,
  VALID_BASE_ISO,
  amphanForecastNodes,
  amphanLifecycleNodes,
  amphanObservedTrack,
} from './amphanBestTrack'

const at = (offsetH: number) =>
  new Date(new Date(VALID_BASE_ISO).getTime() + offsetH * 3600_000).toISOString()

/**
 * ONE forecast array powers the map, the globe, the timeline, the intensity
 * & pressure chart, the point popups and the summary panels. Nothing else
 * holds track/intensity numbers. Observed leg = IMD best track; forecast leg
 * = model projection, SIMULATED, from the canonical AMPHAN source.
 */

export const demoForecastTrack: ForecastPoint[] = amphanForecastNodes.map((p) => ({
  id: `p${p.hours}`,
  hours: p.hours,
  validAt: p.hours === 0 ? VALID_BASE_ISO : at(p.hours),
  position: { lat: p.lat, lon: p.lon },
  windKt: p.windKt,
  pressureHpa: p.pressureHpa,
  category: getCycloneCategory(p.windKt),
  movement: p.movement,
  uncertaintyKm: p.uncertaintyKm,
}))

export const demoLifecycle: IntensityPoint[] = amphanLifecycleNodes.map(
  ([hours, windKt, pressureHpa]) => ({
    hours,
    validAt: at(hours),
    windKt,
    pressureHpa,
    category: getCycloneCategory(windKt),
  }),
)

export const demoForecast: ForecastBundle = {
  track: demoForecastTrack,
  lifecycle: demoLifecycle,
  observed: amphanObservedTrack,
  provenance: {
    model: 'Trajectory V12',
    checkpoint: 'v12_best_model.pt',
    validAt: VALID_BASE_ISO,
    horizonHours: 72,
    uncertaintyNowKm: 8,
    maxUncertaintyKm: 272,
    source: 'Toofan Forecast Engine',
    status: 'SIMULATED',
  },
  landfall: AMPHAN_LANDFALL,
}

/** Observed (IMD best track) intensity history ending exactly at "now". */
export const demoObservedIntensity = amphanObservedTrack
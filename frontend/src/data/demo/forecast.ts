import { getCycloneCategory } from '../../lib/ua'
import type { ForecastBundle, ForecastPoint, IntensityPoint } from '../../types/forecast'
import type { ObservedPoint } from '../../types/cyclone'
import { VALID_BASE_ISO } from './cyclone'

const at = (offsetH: number) =>
  new Date(new Date(VALID_BASE_ISO).getTime() + offsetH * 3600_000).toISOString()

/**
 * ONE forecast array powers the map, the globe, the timeline, the intensity
 * & pressure chart, the point popups and the summary panels. Nothing else
 * holds track/intensity numbers.
 */
/** Demo points always carry intensity — keep them numeric, distinct from the
 *  nullable live trajectory type. */
type DemoPoint = Omit<ForecastPoint, 'id' | 'category' | 'windKt' | 'pressureHpa'> & {
  windKt: number
  pressureHpa: number
}

const TRACK: DemoPoint[] = [
  { hours: 0, validAt: at(0), position: { lat: 14.82, lon: 86.31 }, windKt: 92, pressureHpa: 972, movement: 'NNE', uncertaintyKm: 8 },
  { hours: 6, validAt: at(6), position: { lat: 15.48, lon: 86.66 }, windKt: 87, pressureHpa: 975, movement: 'NNE', uncertaintyKm: 24 },
  { hours: 12, validAt: at(12), position: { lat: 15.74, lon: 87.21 }, windKt: 85, pressureHpa: 976, movement: 'NE', uncertaintyKm: 48 },
  { hours: 18, validAt: at(18), position: { lat: 16.6, lon: 87.76 }, windKt: 78, pressureHpa: 981, movement: 'NE', uncertaintyKm: 70 },
  { hours: 24, validAt: at(24), position: { lat: 17.12, lon: 88.45 }, windKt: 62, pressureHpa: 990, movement: 'ENE', uncertaintyKm: 96 },
  { hours: 36, validAt: at(36), position: { lat: 17.95, lon: 89.4 }, windKt: 55, pressureHpa: 995, movement: 'ENE', uncertaintyKm: 140 },
  { hours: 48, validAt: at(48), position: { lat: 18.55, lon: 90.2 }, windKt: 46, pressureHpa: 1000, movement: 'E', uncertaintyKm: 185 },
  { hours: 72, validAt: at(72), position: { lat: 18.95, lon: 90.9 }, windKt: 30, pressureHpa: 1005, movement: 'ESE', uncertaintyKm: 272 },
]

export const demoForecastTrack: ForecastPoint[] = TRACK.map((p) => ({
  ...p,
  id: `p${p.hours}`,
  category: getCycloneCategory(p.windKt),
}))

/** 2-hourly lifecycle 0…24 — consistent with the track at 0/6/12/18/24. */
const LIFECYCLE: number[][] = [
  [0, 92, 972],
  [2, 90, 973],
  [4, 89, 974],
  [6, 87, 975],
  [8, 86, 976],
  [10, 85, 976],
  [12, 85, 976],
  [14, 82, 978],
  [16, 80, 980],
  [18, 78, 981],
  [20, 70, 985],
  [22, 65, 988],
  [24, 62, 990],
]

export const demoLifecycle: IntensityPoint[] = LIFECYCLE.map(
  ([hours, windKt, pressureHpa]) => ({
    hours,
    validAt: at(hours),
    windKt,
    pressureHpa,
    category: getCycloneCategory(windKt),
  }),
)

/** Observed intensity history ending exactly at the current state. */
export const demoObservedIntensity: ObservedPoint[] = [
  { validAt: '2026-08-30T12:00:00Z', position: { lat: 8.4, lon: 82.2 }, windKt: 28, pressureHpa: 1000, classification: getCycloneCategory(28) },
  { validAt: '2026-08-30T18:00:00Z', position: { lat: 8.9, lon: 82.6 }, windKt: 34, pressureHpa: 998, classification: getCycloneCategory(34) },
  { validAt: '2026-08-31T00:00:00Z', position: { lat: 9.6, lon: 83.0 }, windKt: 42, pressureHpa: 994, classification: getCycloneCategory(42) },
  { validAt: '2026-08-31T06:00:00Z', position: { lat: 10.3, lon: 83.4 }, windKt: 50, pressureHpa: 990, classification: getCycloneCategory(50) },
  { validAt: '2026-08-31T12:00:00Z', position: { lat: 11.0, lon: 83.9 }, windKt: 62, pressureHpa: 985, classification: getCycloneCategory(62) },
  { validAt: '2026-08-31T18:00:00Z', position: { lat: 11.7, lon: 84.3 }, windKt: 72, pressureHpa: 980, classification: getCycloneCategory(72) },
  { validAt: '2026-09-01T00:00:00Z', position: { lat: 12.3, lon: 84.7 }, windKt: 84, pressureHpa: 975, classification: getCycloneCategory(84) },
  { validAt: '2026-09-01T06:00:00Z', position: { lat: 13.0, lon: 85.1 }, windKt: 92, pressureHpa: 972, classification: getCycloneCategory(92) },
  { validAt: '2026-09-01T12:00:00Z', position: { lat: 13.6, lon: 85.5 }, windKt: 98, pressureHpa: 969, classification: getCycloneCategory(98) },
  { validAt: '2026-09-01T18:00:00Z', position: { lat: 14.2, lon: 85.9 }, windKt: 100, pressureHpa: 968, classification: getCycloneCategory(100) },
  { validAt: '2026-09-02T00:00:00Z', position: { lat: 14.5, lon: 86.1 }, windKt: 97, pressureHpa: 969, classification: getCycloneCategory(97) },
  { validAt: '2026-09-02T06:00:00Z', position: { lat: 14.7, lon: 86.2 }, windKt: 95, pressureHpa: 970, classification: getCycloneCategory(95) },
  { validAt: VALID_BASE_ISO, position: { lat: 14.82, lon: 86.31 }, windKt: 92, pressureHpa: 972, classification: getCycloneCategory(92) },
]

/**
 * Landfall is NOT included in this demo scenario — the forecast recurves and
 * stays over water for the 72 h horizon. It is deliberately null so the UI
 * shows NOT AVAILABLE instead of fabricating a crossing.
 */
export const demoForecast: ForecastBundle = {
  track: demoForecastTrack,
  lifecycle: demoLifecycle,
  observed: demoObservedIntensity,
  provenance: {
    model: 'Trajectory V12',
    checkpoint: 'v12_best_model.pt',
    validAt: VALID_BASE_ISO,
    horizonHours: 24,
    uncertaintyNowKm: 8,
    maxUncertaintyKm: 272,
    source: 'Toofan Forecast Engine',
    status: 'SIMULATED',
  },
  landfall: null,
}
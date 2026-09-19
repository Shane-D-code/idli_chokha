import { bearingDeg, compassLabel, distanceKm } from '../../lib/geo'
import { getCycloneCategory } from '../../lib/ua'
import type { ObservedPoint } from '../../types/cyclone'
import type { LatLon } from '../../types/common'

/**
 * IMD / RSMC New Delhi best-track data for Super Cyclonic Storm AMPHAN
 * (14–20 May 2020, Bay of Bengal). Official fixes are kept verbatim; the
 * intermediate points are linearly interpolated between official fixes so the
 * demo renders a smooth 6-hourly observed series. Peak intensity (18 May 18Z,
 * 130 kt / 920 hPa) matches the IMD bulletin. Landfall on 20 May ~11:00 UTC
 * at ~21.65N / 88.3E (Sundarbans, West Bengal–Bangladesh).
 */
export const VALID_BASE_ISO = '2020-05-18T18:00:00Z'

export const AMPHAN_PEAK: LatLon = { lat: 14.9, lon: 86.5 }
export const AMPHAN_PEAK_WIND_KT = 130
export const AMPHAN_PEAK_PRESSURE_HPA = 920

function obs(
  validAt: string,
  lat: number,
  lon: number,
  windKt: number,
  pressureHpa: number,
): ObservedPoint {
  return {
    validAt,
    position: { lat, lon },
    windKt,
    pressureHpa,
    classification: getCycloneCategory(windKt),
  }
}

/** Observed (best track) history ending EXACTLY at the current position. */
export const amphanObservedTrack: ObservedPoint[] = [
  obs('2020-05-16T00:00:00Z', 10.4, 87.0, 25, 1000),
  obs('2020-05-16T06:00:00Z', 10.9, 86.9, 38, 996),
  obs('2020-05-16T12:00:00Z', 11.4, 86.8, 51, 991),
  obs('2020-05-16T18:00:00Z', 11.9, 86.6, 62, 986),
  obs('2020-05-17T00:00:00Z', 12.3, 86.4, 70, 979),
  obs('2020-05-17T06:00:00Z', 12.6, 86.3, 74, 976),
  obs('2020-05-17T12:00:00Z', 12.7, 86.2, 75, 974),
  obs('2020-05-17T18:00:00Z', 12.85, 86.2, 88, 966),
  obs('2020-05-18T00:00:00Z', 13.0, 86.2, 100, 955),
  obs('2020-05-18T06:00:00Z', 13.4, 86.2, 120, 930),
  obs('2020-05-18T12:00:00Z', 14.15, 86.35, 128, 923),
  obs(VALID_BASE_ISO, AMPHAN_PEAK.lat, AMPHAN_PEAK.lon, AMPHAN_PEAK_WIND_KT, AMPHAN_PEAK_PRESSURE_HPA),
]

/** Movement derived from the most recent observed leg (18 May 06Z → 18Z). */
export const AMPHAN_BEARING_DEG = Math.round(
  bearingDeg(
    amphanObservedTrack[amphanObservedTrack.length - 2].position,
    amphanObservedTrack[amphanObservedTrack.length - 1].position,
  ),
)
export const AMPHAN_MOVEMENT = compassLabel(AMPHAN_BEARING_DEG)

const legHours =
  (new Date(amphanObservedTrack[amphanObservedTrack.length - 1].validAt).getTime() -
    new Date(amphanObservedTrack[amphanObservedTrack.length - 2].validAt).getTime()) /
  3600_000

export const AMPHAN_MOVEMENT_KPH = Math.round(
  distanceKm(
    amphanObservedTrack[amphanObservedTrack.length - 2].position,
    amphanObservedTrack[amphanObservedTrack.length - 1].position,
  ) / legHours,
)

/** Model forecast track for the next 72 h, starting at the current position. */
export interface AmphanForecastNode {
  hours: number
  lat: number
  lon: number
  windKt: number
  pressureHpa: number
  movement: string
  uncertaintyKm: number
}

export const amphanForecastNodes: AmphanForecastNode[] = [
  { hours: 0, lat: 14.9, lon: 86.5, windKt: 130, pressureHpa: 920, movement: AMPHAN_MOVEMENT, uncertaintyKm: 8 },
  { hours: 6, lat: 15.6, lon: 86.7, windKt: 125, pressureHpa: 926, movement: 'NNE', uncertaintyKm: 24 },
  { hours: 12, lat: 16.35, lon: 87.0, windKt: 118, pressureHpa: 934, movement: 'NNE', uncertaintyKm: 48 },
  { hours: 18, lat: 17.1, lon: 87.4, windKt: 110, pressureHpa: 942, movement: 'NNE', uncertaintyKm: 70 },
  { hours: 24, lat: 17.9, lon: 87.9, windKt: 102, pressureHpa: 950, movement: 'NNE', uncertaintyKm: 96 },
  { hours: 36, lat: 20.1, lon: 88.1, windKt: 95, pressureHpa: 958, movement: 'NNE', uncertaintyKm: 140 },
  { hours: 48, lat: 21.95, lon: 88.35, windKt: 70, pressureHpa: 982, movement: 'NNW', uncertaintyKm: 185 },
  { hours: 72, lat: 24.5, lon: 88.6, windKt: 28, pressureHpa: 1002, movement: 'NNW', uncertaintyKm: 272 },
]

/** 2-hourly lifecycle 0…24 — consistent with the track at 0/6/12/18/24. */
export const amphanLifecycleNodes: [number, number, number][] = [
  [0, 130, 920],
  [2, 128, 922],
  [4, 127, 924],
  [6, 125, 926],
  [8, 121, 930],
  [10, 119, 932],
  [12, 118, 934],
  [14, 113, 938],
  [16, 111, 940],
  [18, 110, 942],
  [20, 108, 944],
  [22, 105, 947],
  [24, 102, 950],
]

/** Projected landfall: Sundarbans coast, ~20 May 11:00 UTC (~+41 h). */
export const AMPHAN_LANDFALL = {
  position: { lat: 21.65, lon: 88.3 } as LatLon,
  estimateAt: '2020-05-20T11:00:00Z',
  timeLabel: '+41H',
  coast: 'Sundarbans · West Bengal–Bangladesh',
}
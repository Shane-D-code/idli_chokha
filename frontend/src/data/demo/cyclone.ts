import { getCycloneCategory } from '../../lib/ua'
import type { Cyclone, ObservedPoint } from '../../types/cyclone'

/** Fixed validity instant for the whole demo scenario. */
export const VALID_BASE_ISO = '2026-09-02T13:12:00Z'

const POSITION = { lat: 14.82, lon: 86.31 }

/**
 * The ACTIVE CYCLONE. EVERY other component reads position, wind and pressure
 * from this single object — never from duplicated literals.
 */
export const demoCyclone: Cyclone = {
  id: 'amphan-sim',
  name: 'AMPHAN-SIM',
  basin: 'BAY OF BENGAL',
  classification: getCycloneCategory(92),
  position: POSITION,
  windKt: 92,
  pressureHpa: 972,
  movement: 'NNE',
  bearingDeg: 22,
  movementKph: 14,
  rmwKm: 35,
  uncertaintyKm: 8,
  validAt: VALID_BASE_ISO,
  status: 'simulated',
  riskScore: 68,
  riskLevel: 'MODERATE',
}

/** Observed history ending EXACTLY at the current cyclone position. */
export const demoObservedTrack: ObservedPoint[] = [
  { validAt: '2026-09-01T01:00:00Z', position: { lat: 11.2, lon: 84.6 }, windKt: 46, pressureHpa: 994, classification: getCycloneCategory(46) },
  { validAt: '2026-09-01T05:00:00Z', position: { lat: 11.95, lon: 84.82 }, windKt: 62, pressureHpa: 986, classification: getCycloneCategory(62) },
  { validAt: '2026-09-01T09:00:00Z', position: { lat: 12.7, lon: 85.04 }, windKt: 75, pressureHpa: 980, classification: getCycloneCategory(75) },
  { validAt: '2026-09-01T13:00:00Z', position: { lat: 13.35, lon: 85.42 }, windKt: 84, pressureHpa: 975, classification: getCycloneCategory(84) },
  { validAt: '2026-09-01T17:00:00Z', position: { lat: 13.95, lon: 85.7 }, windKt: 90, pressureHpa: 973, classification: getCycloneCategory(90) },
  { validAt: '2026-09-01T21:00:00Z', position: { lat: 14.4, lon: 86.0 }, windKt: 94, pressureHpa: 971, classification: getCycloneCategory(94) },
  { validAt: '2026-09-02T01:00:00Z', position: { lat: 14.62, lon: 86.2 }, windKt: 92, pressureHpa: 972, classification: getCycloneCategory(92) },
  { validAt: '2026-09-02T08:00:00Z', position: { lat: 14.8, lon: 86.28 }, windKt: 92, pressureHpa: 972, classification: getCycloneCategory(92) },
  { validAt: VALID_BASE_ISO, position: POSITION, windKt: 92, pressureHpa: 972, classification: getCycloneCategory(92) },
]
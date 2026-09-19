import { getCycloneCategory } from '../../lib/ua'
import type { Cyclone } from '../../types/cyclone'
import {
  AMPHAN_BEARING_DEG,
  AMPHAN_MOVEMENT,
  AMPHAN_MOVEMENT_KPH,
  AMPHAN_PEAK,
  AMPHAN_PEAK_PRESSURE_HPA,
  AMPHAN_PEAK_WIND_KT,
  VALID_BASE_ISO,
} from './amphanBestTrack'

export { VALID_BASE_ISO } from './amphanBestTrack'

/**
 * The ACTIVE CYCLONE. EVERY other component reads position, wind and pressure
 * from this single object — never from duplicated literals. Values come from
 * the canonical AMPHAN best track (src/data/demo/amphanBestTrack.ts).
 */
export const demoCyclone: Cyclone = {
  id: 'amphan',
  name: 'AMPHAN',
  basin: 'BAY OF BENGAL',
  classification: getCycloneCategory(AMPHAN_PEAK_WIND_KT),
  position: AMPHAN_PEAK,
  windKt: AMPHAN_PEAK_WIND_KT,
  pressureHpa: AMPHAN_PEAK_PRESSURE_HPA,
  movement: AMPHAN_MOVEMENT,
  bearingDeg: AMPHAN_BEARING_DEG,
  movementKph: AMPHAN_MOVEMENT_KPH,
  rmwKm: 35,
  uncertaintyKm: 8,
  validAt: VALID_BASE_ISO,
  status: 'simulated',
  riskScore: 80,
  riskLevel: 'HIGH',
}
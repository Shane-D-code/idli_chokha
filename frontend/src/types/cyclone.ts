import type { DataStatus, LatLon } from './common'

/**
 * North Indian Ocean intensity classification (IMD scheme) derived from
 * sustained wind speed. This is the SINGLE source of truth for every
 * category label and colour used anywhere in the UI.
 */
export type IntensityCategory =
  | 'low'
  | 'd'
  | 'dd'
  | 'cs'
  | 'scs'
  | 'vscs'
  | 'escs'
  | 'sucs'

export interface Cyclone {
  id: string
  name: string
  basin: string
  /** Human-readable classification derived from windKt. */
  classification: IntensityCategory
  position: LatLon
  windKt: number
  pressureHpa: number
  /** Compass direction, e.g. "NNE". */
  movement: string
  /** Movement bearing in degrees (0 = north, clockwise). */
  bearingDeg: number
  movementKph: number
  rmwKm: number
  uncertaintyKm: number
  validAt: string
  status: DataStatus
  /** Composite risk 0..100. */
  riskScore: number
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'
}

export interface ObservedPoint {
  validAt: string
  position: LatLon
  windKt: number
  pressureHpa: number
  classification: IntensityCategory
}

export const CATEGORY_LABEL: Record<IntensityCategory, string> = {
  low: 'Low Pressure Area',
  d: 'Depression',
  dd: 'Deep Depression',
  cs: 'Cyclonic Storm',
  scs: 'Severe Cyclonic Storm',
  vscs: 'Very Severe Cyclonic Storm',
  escs: 'Extremely Severe Cyclonic Storm',
  sucs: 'Super Cyclonic Storm',
}

export const CATEGORY_ABBR: Record<IntensityCategory, string> = {
  low: 'LPA',
  d: 'D',
  dd: 'DD',
  cs: 'CS',
  scs: 'SCS',
  vscs: 'VSCS',
  escs: 'ESCS',
  sucs: 'SuCS',
}

export const CATEGORY_RANGE_KT: Record<IntensityCategory, string> = {
  low: '< 17 kt',
  d: '17 – 27 kt',
  dd: '28 – 33 kt',
  cs: '34 – 47 kt',
  scs: '48 – 63 kt',
  vscs: '64 – 89 kt',
  escs: '90 – 119 kt',
  sucs: '≥ 120 kt',
}
import type { DataStatus, RiskLevel } from './common'

export type HazardType = 'rainfall' | 'flood' | 'landslide' | 'surge' | 'wind'

export interface Hazard {
  type: HazardType
  label: string
  probability: number
  severity: RiskLevel
  confidence: number
  affectedArea: string
  status: DataStatus
}

export interface RainfallBucket {
  id: string
  /** e.g. "0–6h" */
  window: string
  /** Forecast start hour. */
  fromHour: number
  toHour: number
  /** Expected accumulation in mm. */
  mm: number
  /** Mean precipitation mm/h for display. */
  meanMmPerH?: number
}

export interface FloodRisk {
  affectedRegion: string
  expectedAccumulationMm: number
  riverCoastalRisk: RiskLevel
  riskLevel: RiskLevel
  affectedDistricts: string[]
  status: DataStatus
}

export interface LandslideRisk {
  riskLevel: RiskLevel
  affectedDistricts: string[]
  soilMoisturePct: number
  rainfallContribution: string
  slopeExposure: string
  status: DataStatus
}

export interface StormSurgeRisk {
  coastalExposure: string
  estimatedSurgeM: number
  affectedCoastline: string
  riskLevel: RiskLevel
  /** False when the surge model is not available — render "DATA UNAVAILABLE". */
  available: boolean
  status: DataStatus
}

export type HazardLayer = Extract<HazardType, 'rainfall' | 'flood' | 'landslide' | 'surge' | 'wind'>

/** Deterministic per-region hazard intensity used by the hazard map. */
export interface HazardRegion {
  type: HazardLayer
  /** Approximate centroid. */
  position: { lat: number; lon: number }
  /** Regional intensity 0..100. */
  intensity: number
  label?: string
}

export interface HazardBundle {
  hazards: Hazard[]
  rainfall: RainfallBucket[]
  flood: FloodRisk
  landslide: LandslideRisk
  surge: StormSurgeRisk
  status: DataStatus
}

export const HAZARD_LABEL: Record<HazardType, string> = {
  rainfall: 'Rainfall',
  flood: 'Flood',
  landslide: 'Landslide',
  surge: 'Storm Surge',
  wind: 'Wind',
}
import type { LatLon, RiskLevel } from './common'

export interface SearchableLocation {
  id: string
  name: string
  type: 'district' | 'city' | 'town' | 'port'
  state?: string
  position: LatLon
  /** Risk band assigned in the demo district model. */
  riskLevel: RiskLevel
}

export interface DistrictRisk {
  id: string
  name: string
  state: string
  position: LatLon
  riskLevel: RiskLevel
  /** Distance between district centroid and the current cyclone position, km. */
  distanceKm: number
  /** Nearest expected approach distance, km. */
  closestApproachKm: number
  /** Forecast hour of nearest approach, e.g. "+24h" or null if far. */
  approachTime: string | null
  /** Trend of the system relative to this district. */
  approachTrend: 'Approaching' | 'Receding' | 'Steady'
  situation: string
  safetyAndMonitoring: string[] 
}

export interface DistrictBundle {
  districts: DistrictRisk[]
  locations: SearchableLocation[]
}
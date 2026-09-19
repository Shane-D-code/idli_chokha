/** Shared primitive types used across the Toofan domain. */

export interface LatLon {
  /** Degrees, north-positive. */
  lat: number
  /** Degrees, east-positive. */
  lon: number
}

export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe'

export type DataStatus = 'live' | 'demo' | 'simulated' | 'degraded' | 'unavailable' | 'not_connected'

export type Favourability = 'favourable' | 'moderate' | 'unfavourable'

export interface FeatureImportanceItem {
  feature: string
  /** Normalized contribution 0..1 (illustrative, not real SHAP). */
  contribution: number
  description: string
}

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  severe: 3,
}
import type { DataStatus, Favourability } from './common'

export interface EnvironmentMetric {
  id: string
  variable: string
  value: number
  unit: string
  favourability: Favourability
  note: string
}

export interface EnvSeries {
  label: string
  value: number
  unit: string
  favourability: Favourability
  /** Deterministic recent trend series (time ascending). */
  series: { t: string; v: number }[]
  trendLabel: string
  /** Deterministic seed for any sparkline decoration. */
  _seed?: number
}

export interface EnvironmentBundle {
  ocean: EnvironmentMetric[]
  atmosphere: EnvironmentMetric[]
  moisture: EnvironmentMetric[]
  pressure: EnvironmentMetric[]
  charts: EnvSeries[]
  /** Provenance of the metrics shown. */
  status?: DataStatus
}

export type EnvChartId = 'sst' | 'shear' | 'slp' | 'humidity' | 'ohc'
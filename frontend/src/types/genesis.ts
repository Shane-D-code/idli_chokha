import type { DataStatus, Favourability } from './common'

export type GenesisHorizon = 24 | 48 | 72

export interface GenesisPrediction {
  horizonHours: GenesisHorizon
  probability: number
  /** Probability above which genesis is considered likely. */
  threshold: number
  /** Derived from probability vs threshold. */
  category: 'LOW' | 'MODERATE' | 'HIGH'
  status: DataStatus
}

/** One environmental variable favouring / suppressing development. */
export interface EnvironmentCondition {
  id: string
  variable: string
  value: number
  unit: string
  favourability: Favourability
  note: string
}

export interface GenesisBundle {
  predictions: GenesisPrediction[]
  conditions: EnvironmentCondition[]
  status: DataStatus
  validAt: string
  /** Model that produced the probabilities (shown in provenance). */
  model?: string
  modelVersion?: string
  /** Whether probabilities are reliability-calibrated. */
  calibrated?: boolean
  /** Threshold above which genesis is considered likely. */
  threshold?: number
  /** Overall alert level, e.g. "HIGH". */
  risk?: string
}
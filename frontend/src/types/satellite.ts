import type { DataStatus } from './common'
import type { LatLon } from './common'

export type SatelliteBand = 'ir' | 'visible' | 'wv' | 'radar'

/** Geographic bounding box the raster/image maps onto. */
export interface SatBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * A single satellite observation (or, when simulated, a single product
 * band). Designed so a real observation source can be connected later with
 * zero component changes — the renderer consumes the same interface whether
 * the pixels come from a seeded procedural field or from `imageUrl`.
 */
export interface SatelliteObservation {
  band: SatelliteBand
  label: string
  /** Source product, e.g. "10.4 µm IR". */
  channel: string
  /** Human-readable source attribution, e.g. "INSAT-3D / INSAT-3DR". */
  source: string
  /** Fixed observation timestamp. */
  capturedAt: string
  status: DataStatus
  /** Deterministic seed used to generate the procedural cloud field. */
  seed: number
  notes: string
  /** Geographic frame the image covers. Required for a real raster. */
  bounds: SatBounds
  /** Canonical storm centre at capture time (same object used everywhere). */
  stormCenter?: LatLon
  /** Real raster URL when real imagery is connected (empty when simulated). */
  imageUrl?: string
  /** Optional brightness-temperature bounds of the real product. */
  temperatureRange?: { min: number; max: number }
}

export interface DataSource {
  id: string
  name: string
  provides: string
  status: DataStatus
  detail: string
}

export interface SystemComponentStatus {
  id: string
  label: string
  status: DataStatus
  detail?: string
}
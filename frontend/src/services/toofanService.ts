import { demoHazardsBundle, demoHazardRegions } from '../data/demo/hazards'
import { demoGenesis } from '../data/demo/genesis'
import { demoEnvironmentMetrics, demoEnvironmentCharts } from '../data/demo/environment'
import { demoSites } from '../data/demo/districts'
import { demoQuickSelectIds } from '../data/demo/districts'
import { buildDistrictBundle } from './districtService'
import { cycloneService } from './cycloneService'
import { forecastService } from './forecastService'
import type { GenesisBundle } from '../types/genesis'
import type { EnvironmentBundle } from '../types/environment'
import type { HazardBundle, HazardRegion } from '../types/hazard'
import type { DistrictBundle } from '../types/district'
import { demoSatellite, demoSources, demoSystemStatus } from '../data/demo/satellite'
import type { DataSource, SatelliteObservation, SystemComponentStatus } from '../types/satellite'

/**
 * Aggregates every demo bundle into one coherent snapshot — the application
 * state seed. Later this is replaced by real API responses with no component
 * changes.
 */
export interface ToofanSnapshot {
  cyclone: ReturnType<typeof cycloneService.getDemoCyclone>
  forecast: ReturnType<typeof forecastService.getForecastBundle>
  genesis: GenesisBundle
  environment: EnvironmentBundle
  hazards: HazardBundle
  hazardRegions: HazardRegion[]
  districts: DistrictBundle
  satellite: SatelliteObservation[]
  sources: DataSource[]
  systemStatus: SystemComponentStatus[]
  sign: { quickSelectIds: string[] }
}

export function getDemoSnapshot(): ToofanSnapshot {
  const cyclone = cycloneService.getDemoCyclone()
  const forecast = forecastService.getForecastBundle()
  return {
    cyclone,
    forecast,
    genesis: demoGenesis,
    environment: { ...demoEnvironmentMetrics, charts: demoEnvironmentCharts },
    hazards: demoHazardsBundle,
    hazardRegions: demoHazardRegions,
    districts: buildDistrictBundle(demoSites, cyclone, forecast),
    satellite: demoSatellite,
    sources: demoSources,
    systemStatus: demoSystemStatus,
    sign: { quickSelectIds: demoQuickSelectIds },
  }
}

/** Async version mirroring a real backend call. */
export async function fetchDemoSnapshot(): Promise<ToofanSnapshot> {
  return getDemoSnapshot()
}
import { appActions, useApp } from '../state/store'
import type { AppState } from '../state/store'
import type { Cyclone } from '../types/cyclone'
import type { ForecastBundle, ForecastPoint, IntensityPoint } from '../types/forecast'
import type { HazardBundle } from '../types/hazard'
import type { DistrictBundle, DistrictRisk } from '../types/district'

function useData(): AppState['data'] {
  return useApp((s) => s.data)
}

/** Single source of truth hooks — everything reads from application state. */
export function useCyclone(): Cyclone {
  return useData().cyclone
}

export function useForecast(): ForecastBundle {
  return useData().forecast
}

export function useForecastTrack(): ForecastPoint[] {
  return useForecast().track
}

export function useLifecycle(): IntensityPoint[] {
  return useForecast().lifecycle
}

export function useObserved(): ForecastBundle['observed'] {
  return useForecast().observed
}

export function useSelectedForecast(): ForecastPoint | null {
  const id = useApp((s) => s.selectedForecastId)
  const track = useForecastTrack()
  return track.find((p) => p.id === id) ?? null
}

export function useHazards(): HazardBundle {
  return useData().hazards
}

export function useHazardRegions() {
  return useData().hazardRegions
}

export function useDistricts(): DistrictBundle {
  return useData().districts
}

export function useSelectedDistrict(): DistrictRisk | null {
  const id = useApp((s) => s.selectedDistrictId)
  const districts = useDistricts()
  return districts.districts.find((d) => d.id === id) ?? null
}

export function useLocations() {
  return useData().districts.locations
}

export function useGenesis() {
  return useData().genesis
}

export function useEnvironment() {
  return useData().environment
}

export function useSatellite() {
  return useData().satellite
}

export function useSources() {
  return useData().sources
}

export { appActions }
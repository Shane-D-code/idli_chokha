import { globeLand as _globeLand } from '../data/geo/globeLand'
import { regionLand as _regionLand } from '../data/geo/regionLand'
import { regionCountries as _regionCountries } from '../data/geo/regionCountries'
import { regionStates as _regionStates } from '../data/geo/regionStates'
import { districts as _districts } from '../data/geo/districts'
import type { GeoCollection, DistrictFeature, StateFeature, CountryFeature, MultiPolygonGeometry } from '../types/geo'

/**
 * Typed single access point for the embedded (offline) geographic assets.
 * All casting is isolated here — components consume clean types.
 */
export const globeLand = _globeLand as unknown as MultiPolygonGeometry
export const regionLand = _regionLand as unknown as MultiPolygonGeometry
export const regionCountries = _regionCountries as unknown as GeoCollection<CountryFeature>
export const regionStates = _regionStates as unknown as GeoCollection<StateFeature>
export const regionDistricts = _districts as unknown as GeoCollection<DistrictFeature>

/** District polygon lookup by name (used by the district risk map). */
export function districtIndex(): Map<string, { name: string; st: string; geometry: MultiPolygonGeometry }> {
  const map = new Map<string, { name: string; st: string; geometry: MultiPolygonGeometry }>()
  for (const f of regionDistricts.features) {
    const name = (f.properties?.name ?? '').trim()
    if (name) map.set(name.toLowerCase(), { name, st: f.properties.st, geometry: f.geometry })
  }
  return map
}
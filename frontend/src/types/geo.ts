/** Geometry types for the embedded (local, offline) geographic layers. */

export type Ring = number[][]
export type Polygon = Ring[]
export type MultiPolygon = Polygon[]

export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: MultiPolygon
}

export interface GeoFeature<P = Record<string, unknown>> {
  type: 'Feature'
  properties: P
  geometry: MultiPolygonGeometry
  id?: string | number
}

export interface GeoCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: GeoFeature<P>[]
}

export interface CountryFeature {
  name: string
}

export interface StateFeature {
  name: string
}

export interface DistrictFeature {
  name: string
  st: string
}

export type MapPlaceKind = 'country' | 'state' | 'city' | 'port' | 'town' | 'sea'

export interface MapPlace {
  id: string
  name: string
  kind: MapPlaceKind
  position: { lat: number; lon: number }
  /** Min zoom level (map scale multiplier) at which the label appears. */
  minZoom: number
  /** Whether the label is emphasised (bigger, bolder). */
  major?: boolean
  extra?: string
}

export const REGION = { x0: 62, x1: 102, y0: -4, y1: 33 }
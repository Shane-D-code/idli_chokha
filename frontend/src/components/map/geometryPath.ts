import type { RegionProjection } from './projection'
import type { MultiPolygonGeometry, Polygon, Ring } from '../../types/geo'

/** Build a single SVG path `d` string for a MultiPolygon geometry. */
export function multipolygonPath(proj: RegionProjection, geom: MultiPolygonGeometry): string {
  const parts: string[] = []
  for (const poly of geom.coordinates) parts.push(polygonPath(proj, poly))
  return parts.join(' ')
}

function polygonPath(proj: RegionProjection, poly: Polygon): string {
  let d = ''
  let first = true
  for (const ring of poly) {
    d += ringPath(proj, ring, first)
    first = false
  }
  return d
}

function ringPath(proj: RegionProjection, ring: Ring, isOuter: boolean): string {
  if (!ring.length) return ''
  const parts: string[] = []
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i]
    const { x, y } = projP(proj, lon, lat)
    parts.push(`${i === 0 ? (isOuter ? 'M' : 'M') : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
  }
  parts.push('Z')
  return parts.join('')
}

function projP(proj: RegionProjection, lon: number, lat: number): { x: number; y: number } {
  return { x: proj.xOf(lon), y: proj.yOf(lat) }
}
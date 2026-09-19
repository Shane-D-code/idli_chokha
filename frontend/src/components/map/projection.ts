import { REGION } from '../../types/geo'
import type { LatLon } from '../../types/common'

/**
 * Thin Mecator projection for the NIO region (62°–102°E, 4°S–33°N).
 * The map is drawn entirely in SVG userspace units then scaled to fit.
 */
const BASE_PX_PER_DEG = 11.4 // default scale ≈ zoom 4

export interface RegionProjection {
  pxPerDeg: number
  width: number
  height: number
  xOf: (lonDeg: number) => number
  yOf: (latDeg: number) => number
  /** Inverse — geo coordinates from map-space x/y (for click hit-testing). */
  lonOf: (x: number) => number
  latOf: (y: number) => number
}

function mercY(latDeg: number): number {
  const r = (latDeg * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + r / 2))
}

function mercInvY(my: number): number {
  return (Math.atan(Math.exp(my)) - Math.PI / 4) * (180 / Math.PI)
}

/** Projection anchored to the REGION bbox with a zoom multiplier. */
export function regionProjection(zoom: number): RegionProjection {
  const pxPerDeg = BASE_PX_PER_DEG * zoom
  const scale = pxPerDeg * (180 / Math.PI)
  const yTop = mercY(REGION.y1)
  const yBottom = yTop - mercY(REGION.y0)
  return {
    pxPerDeg,
    width: (REGION.x1 - REGION.x0) * pxPerDeg,
    height: yBottom * scale,
    xOf: (lon) => (lon - REGION.x0) * pxPerDeg,
    yOf: (lat) => (yTop - mercY(lat)) * scale,
    lonOf: (x) => REGION.x0 + x / pxPerDeg,
    latOf: (y) => mercInvY(yTop - y / scale),
  }
}

export function projectPoint(proj: RegionProjection, p: LatLon): { x: number; y: number } {
  return { x: proj.xOf(p.lon), y: proj.yOf(p.lat) }
}

/** Graticule gridlines every step degrees (light). */
export function graticuleLines(proj: RegionProjection, stepX = 10, stepY = 10) {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let lon = REGION.x0; lon <= REGION.x1; lon += stepX) {
    lines.push({ x1: proj.xOf(lon), y1: 0, x2: proj.xOf(lon), y2: proj.height })
  }
  for (let lat = REGION.y0; lat <= REGION.y1; lat += stepY) {
    lines.push({ x1: 0, y1: proj.yOf(lat), x2: proj.width, y2: proj.yOf(lat) })
  }
  return lines
}

export function graticuleLabels(proj: RegionProjection) {
  const xs: { x: number; y: number; text: string }[] = []
  for (let lat = REGION.y0 + 7; lat <= REGION.y1; lat += 7) {
    if (lat === 0) lat += 7
    xs.push({ x: 2, y: proj.yOf(lat) + 3, text: `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}` })
  }
  const ys: { x: number; y: number; text: string }[] = []
  for (let lon = REGION.x0 + 10; lon <= REGION.x1; lon += 10) {
    ys.push({ x: proj.xOf(lon), y: proj.height - 2, text: `${lon}°E` })
  }
  return { xs, ys }
}
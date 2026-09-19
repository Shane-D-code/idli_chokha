import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import simplify from 'simplify-js'

const TMP = new URL('../.geo-tmp/', import.meta.url).pathname
const OUT = new URL('../src/data/geo/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const REGION = { x0: 62, x1: 102, y0: -4, y1: 33 } // North Indian Ocean focus

function readJson(file) {
  return JSON.parse(readFileSync(TMP + file, 'utf8'))
}

function ringBbox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

function intersects(b, region) {
  return !(b.x1 < region.x0 || b.x0 > region.x1 || b.y1 < region.y0 || b.y0 > region.y1)
}

function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring
  const pts = ring.map(([x, y]) => ({ x, y }))
  const simp = simplify(pts, tol, true)
  if (simp.length < 4) return ring
  return simp.map((p) => [p.x, p.y])
}

function simplifyPolygon(poly, tol) {
  const out = poly.map((ring) => simplifyRing(ring, tol))
  return out.filter((r) => r.length >= 4)
}

function toMultiPolygon(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates]
  if (geom.type === 'MultiPolygon') return geom.coordinates
  return null
}

function cropMultiPolygon(geom, region, tol = 0.025) {
  const polys = toMultiPolygon(geom)
  if (!polys) return null
  const out = []
  for (const polygon of polys) {
    let keep = false
    for (const ring of polygon) {
      if (intersects(ringBbox(ring), region)) { keep = true; break }
    }
    if (!keep) continue
    const simp = simplifyPolygon(polygon, tol)
    if (simp.length) out.push(simp)
  }
  return out.length ? { type: 'MultiPolygon', coordinates: out } : null
}

function mergeFeatures(fc) {
  const merged = []
  for (const f of fc.features) {
    const g = toMultiPolygon(f.geometry)
    if (!g) continue
    merged.push(...g)
  }
  return merged
}

// ---- GLOBE: world land (110m) as single MultiPolygon, lightly simplified ----
{
  const fc = readJson('land110.geojson')
  const polys = mergeFeatures(fc)
  const simplified = polys
    .map((p) => simplifyPolygon(p, 0.12).filter((r) => r.length >= 4))
    .filter((p) => p.length)
  const geom = { type: 'MultiPolygon', coordinates: simplified }
  writeFileSync(OUT + 'globeLand.ts', `// Generated from Natural Earth 1:110m land (public domain)
export const globeLand = ${JSON.stringify(geom)}
`)
}

// ---- MAP REGION land (50m) cropped + simplified ----
{
  const fc = readJson('land50.geojson')
  const polys = mergeFeatures(fc)
  const coordinates = []
  for (const polygon of polys) {
    let keep = false
    for (const ring of polygon) {
      if (intersects(ringBbox(ring), REGION)) { keep = true; break }
    }
    if (!keep) continue
    const simp = simplifyPolygon(polygon, 0.02)
    if (simp.length) coordinates.push(simp)
  }
  const geom = { type: 'MultiPolygon', coordinates }
  writeFileSync(OUT + 'regionLand.ts', `// Generated from Natural Earth 1:50m land (public domain) cropped to NIO region
export const regionLand = ${JSON.stringify(geom)}
`)
}

// ---- MAP REGION countries (50m) cropped + simplified, keep country names + ISO ----
{
  const fc = readJson('admin0_50.geojson')
  const features = []
  for (const f of fc.features) {
    const g = cropMultiPolygon(f.geometry, REGION)
    if (!g) continue
    features.push({ type: 'Feature', properties: { name: f.properties.ADMIN }, geometry: g, id: f.properties.ADM0_A3 })
  }
  writeFileSync(OUT + 'regionCountries.ts', `// Generated from Natural Earth 1:50m admin-0 countries (public domain)
export const regionCountries = ${JSON.stringify({ type: 'FeatureCollection', features })}
`)
}

// ---- INDIA STATES (datameet Admin2) cropped + simplified ----
{
  const fc = readJson('states.geojson')
  const features = []
  for (const f of fc.features) {
    const g = cropMultiPolygon(f.geometry, REGION, 0.05)
    if (!g) continue
    features.push({ type: 'Feature', properties: { name: f.properties.ST_NM }, geometry: g })
  }
  writeFileSync(OUT + 'regionStates.ts', `// Generated from datameet India states Admin2 (CC-BY) 
export const regionStates = ${JSON.stringify({ type: 'FeatureCollection', features })}
`)
}

// ---- DISTRICTS (datameet census 2011) mapshaper-simplified ----
{
  const fc = readJson('dist_region.geojson')
  const features = []
  for (const f of fc.features) {
    const g = cropMultiPolygon(f.geometry, REGION)
    if (!g) continue
    features.push({ type: 'Feature', properties: { name: f.properties.DISTRICT, st: f.properties.ST_NM }, geometry: g })
  }
  writeFileSync(OUT + 'districts.ts', `// Generated from datameet India Census 2011 districts (CC-BY) - coastal states
export const districts = ${JSON.stringify({ type: 'FeatureCollection', features })}
`)
}

for (const f of ['regionLand.ts', 'regionCountries.ts', 'regionStates.ts', 'districts.ts', 'globeLand.ts']) {
  const b = readFileSync(OUT + f, 'utf8').length
  console.log(f, (b / 1024).toFixed(1) + 'KB')
}
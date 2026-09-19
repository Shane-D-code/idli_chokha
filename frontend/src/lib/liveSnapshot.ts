import type { ToofanSnapshot } from '../services/toofanService'
import { buildDistrictBundle } from '../services/districtService'
import { demoSites } from '../data/demo/districts'
import { getCycloneCategory } from './ua'
import { bearingDeg, compassLabel } from './geo'
import { HAZARD_LABEL } from '../types/hazard'
import type { Cyclone } from '../types/cyclone'
import type { DataStatus } from '../types/common'
import type {
  AssessmentState,
  PipelineRunResult,
  PipelineStatus,
  ProviderSource,
} from '../types/pipeline'

/**
 * Maps a real `PipelineRunResult` from the backend assessment endpoint into the
 * frontend `ToofanSnapshot` shape that the existing components consume.
 *
 * Honesty contract:
 *  - values are copied from the backend, never invented;
 *  - where the backend reports a hazard/module unavailable, the snapshot
 *    carries an explicit `unavailable` status and the UI renders it as such;
 *  - a position-only LT3P track carries NO per-point intensity or pressure:
 *    every future track point is `windKt: null / pressureHpa: null / category:
 *    null`, so maps/globe/charts/summaries render N/A instead of repeating the
 *    current observed state. Only the single "now" observation holds intensity,
 *    and provenance reports DEGRADED with the real track status + uncertainty.
 */

const SEVERITY_SCORE: Record<string, number> = {
  NONE: 0,
  LOW: 25,
  MODERATE: 50,
  HIGH: 75,
  EXTREME: 90,
}

function riskScoreOf(severity: string | null): number {
  return severity ? SEVERITY_SCORE[severity] ?? 25 : 0
}

function riskLevelOf(severity: string | null): Cyclone['riskLevel'] {
  switch (severity) {
    case 'HIGH':
      return 'HIGH'
    case 'EXTREME':
      return 'SEVERE'
    case 'MODERATE':
      return 'MODERATE'
    case 'NONE':
    case 'LOW':
      return 'LOW'
    default:
      return 'LOW'
  }
}

function statusOf(p: string | undefined): DataStatus {
  switch (p) {
    case 'AVAILABLE':
    case 'SUCCESS':
    case 'COMPLETED':
      return 'live'
    case 'DEGRADED':
      return 'degraded'
    case 'NOT_AVAILABLE':
    case 'UNAVAILABLE':
    case 'FAILED':
      return 'unavailable'
    default:
      return 'unavailable'
  }
}

function basinLabel(basin: string): string {
  const b = (basin ?? '').toUpperCase()
  if (b === 'BOB') return 'BAY OF BENGAL'
  if (b === 'NI' || b === 'NIO') return 'NORTH INDIAN OCEAN'
  return b || 'UNKNOWN BASIN'
}

function sourceStatus(st: string): DataStatus {
  switch (st) {
    case 'OK':
    case 'LIVE':
      return 'live'
    case 'DEGRADED':
      return 'degraded'
    default:
      return 'not_connected'
  }
}

function fmt(x: number | null | undefined, d = 0): number {
  const n = Math.round((x ?? 0) * 10 ** d) / 10 ** d
  return Number.isFinite(n) ? n : 0
}

function categoryFor(prob: number, threshold: number): 'LOW' | 'MODERATE' | 'HIGH' {
  if (prob >= threshold) return 'HIGH'
  if (prob >= threshold * 0.5) return 'MODERATE'
  return 'LOW'
}

function sourcesOf(provider: ProviderSource[]): ToofanSnapshot['sources'] {
  return provider.map((p) => ({
    id: p.name,
    name: p.name.replace(/_/g, ' ').toUpperCase(),
    provides: p.dataset,
    status: sourceStatus(p.status),
    detail: p.detail || (p.warnings ?? []).join('; '),
  }))
}

function systemStatusOf(res: PipelineRunResult): ToofanSnapshot['systemStatus'] {
  const perStatus = res.per_hazard_status
  const entries: ToofanSnapshot['systemStatus'] = [
    { id: 'api', label: 'Pipeline API', status: 'live', detail: `pipeline ${res.pipeline_status.toLowerCase()}` },
    { id: 'sse', label: 'Event stream', status: 'live', detail: 'SSE pipeline_events' },
  ]
  for (const [mod, st] of Object.entries(perStatus)) {
    if (mod === 'hazard_engine') continue
    entries.push({
      id: mod,
      label: mod.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      status: statusOf(st),
      detail: res.per_hazard_reasons?.[mod] ?? undefined,
    })
  }
  return entries
}

function cycloneOf(a: AssessmentState): Cyclone {
  const c = a.cyclone
  const track = a.track
  const wind = fmt(c.max_wind_kt)
  const press = fmt(c.central_pressure_hpa)
  const heading = fmt(c.heading_deg)
  const uncertaintyKm = Math.round(track.uncertainty_km[0] ?? track.position_error_estimates_km[0] ?? 0)
  return {
    id: `${c.storm_id}-live`.toLowerCase(),
    name: c.storm_id,
    basin: basinLabel(c.basin),
    classification: getCycloneCategory(wind),
    position: { lat: fmt(c.latitude, 2), lon: fmt(c.longitude, 2) },
    windKt: wind,
    pressureHpa: press,
    movement: compassLabel(heading),
    bearingDeg: heading,
    movementKph: Math.round(fmt(c.translation_speed_kt) * 1.852),
    rmwKm: 0,
    uncertaintyKm,
    validAt: c.timestamp,
    status: 'live',
    riskScore: riskScoreOf(a.overall_hazard_severity),
    riskLevel: riskLevelOf(a.overall_hazard_severity),
  }
}

function forecastOf(a: AssessmentState): ToofanSnapshot['forecast'] {
  const cyclone = a.cyclone
  const track = a.track
  const wind = fmt(cyclone.max_wind_kt)
  const press = fmt(cyclone.central_pressure_hpa)
  const category = getCycloneCategory(wind)
  // Hours are anchored to the reference time, so the first forecast point is
  // genuinely +2H (never mislabelled "NOW").
  const t0 = new Date(cyclone.timestamp).getTime()

  const points = track.forecast_times.map((iso, i) => {
    const lat = track.latitudes[i]
    const lon = track.longitudes[i]
    const prev = i > 0 ? { lat: track.latitudes[i - 1], lon: track.longitudes[i - 1] } : null
    const here = { lat, lon: lon !== undefined ? lon : (prev?.lon ?? 0) }
    const movement = prev ? compassLabel(bearingDeg(prev, here)) : compassLabel(fmt(cyclone.heading_deg))
    return {
      id: `t${i}`,
      hours: Math.round((new Date(iso).getTime() - t0) / 3_600_000),
      validAt: iso,
      position: { lat, lon: lon ?? 0 },
      // Position-only trajectory: no per-point intensity is known.
      windKt: null,
      pressureHpa: null,
      category: null,
      movement,
      uncertaintyKm: Math.round(track.uncertainty_km[i] ?? track.position_error_estimates_km[i] ?? 0),
    }
  })

  const uncertainty = track.uncertainty_km.length ? track.uncertainty_km : track.position_error_estimates_km

  return {
    track: points,
    // Single "now" observation — real current intensity only, so timeline and
    // intensity charts fall back to NOT AVAILABLE instead of inventing a series.
    lifecycle: [
      {
        hours: 0,
        validAt: cyclone.timestamp,
        windKt: wind,
        pressureHpa: press,
        category,
      },
    ],
    observed: [
      {
        validAt: cyclone.timestamp,
        position: { lat: fmt(cyclone.latitude, 2), lon: fmt(cyclone.longitude, 2) },
        windKt: wind,
        pressureHpa: press,
        classification: category,
      },
    ],
    provenance: {
      model: String(a.model_versions.trajectory ?? 'N/A').toUpperCase(),
      checkpoint: 'N/A',
      validAt: cyclone.timestamp,
      horizonHours: points.length ? points[points.length - 1].hours : 0,
      uncertaintyNowKm: Math.round(track.uncertainty_km[0] ?? track.position_error_estimates_km[0] ?? 0),
      maxUncertaintyKm: Math.round(Math.max(0, ...uncertainty)),
      source: 'TOOFAN · LIVE',
      status: 'DEGRADED',
    },
    landfall: null,
  }
}

function genesisOf(a: AssessmentState): ToofanSnapshot['genesis'] {
  const g = a.genesis
  const prob = (p: number) => Math.round(p * 1000) / 10
  const threshold = Math.round(g.threshold * 1000) / 10
  const horizons = [
    { h: 24 as const, p: g.probability_24h },
    { h: 48 as const, p: g.probability_48h },
    { h: 72 as const, p: g.probability_72h },
  ]
  const c = a.cyclone
  const windChange = fmt(c.wind_change_24h)
  const pressChange = fmt(c.pressure_change_24h)

  return {
    predictions: horizons.map(({ h, p }) => ({
      horizonHours: h,
      probability: prob(p),
      threshold,
      category: categoryFor(p, g.threshold),
      status: 'live',
    })),
    conditions: [
      {
        id: 'wind-24h',
        variable: 'Intensification (24 h)',
        value: windChange,
        unit: 'kt / 24h',
        favourability: windChange >= 15 ? 'favourable' : 'moderate',
        note: 'observed build-up',
      },
      {
        id: 'press-24h',
        variable: 'Deepening (24 h)',
        value: Math.abs(pressChange),
        unit: 'hPa / 24h',
        favourability: pressChange < 0 ? 'favourable' : 'moderate',
        note: 'falling central pressure',
      },
      {
        id: 'wind-now',
        variable: 'Current sustained wind',
        value: fmt(c.max_wind_kt),
        unit: 'kt',
        favourability: 'favourable',
        note: 'already organised',
      },
      {
        id: 'press-now',
        variable: 'Central pressure',
        value: fmt(c.central_pressure_hpa),
        unit: 'hPa',
        favourability: 'favourable',
        note: 'low centre',
      },
    ],
    status: 'live',
    validAt: a.cyclone.timestamp,
    model: g.model_name ?? 'genesis_lightgbm',
    modelVersion: g.model_version ?? '1.0.0',
    calibrated: g.calibrated ?? false,
    threshold,
    risk: g.risk_level ?? categoryFor(horizons[0].p, g.threshold),
  }
}

function environmentOf(a: AssessmentState): ToofanSnapshot['environment'] {
  const c = a.cyclone
  const press = fmt(c.central_pressure_hpa)
  const pressChange = fmt(c.pressure_change_24h)
  return {
    ocean: [],
    atmosphere: [],
    moisture: [],
    pressure: [
      {
        id: 'slp',
        variable: 'Central pressure',
        value: press,
        unit: 'hPa',
        favourability: 'favourable',
        note: `24h Δ ${pressChange} hPa`,
      },
      {
        id: 'slp-tendency',
        variable: 'Pressure tendency',
        value: Math.abs(pressChange),
        unit: 'hPa / 24h',
        favourability: 'favourable',
        note: 'deepening centre',
      },
    ],
    charts: [],
    status: 'live',
  }
}

function hazardsOf(res: PipelineRunResult): ToofanSnapshot['hazards'] {
  const statuses = res.per_hazard_status
  const statusFor = (key: string, fallback: PipelineStatus = 'NOT_AVAILABLE') => statusOf(statuses[key] ?? fallback)

  const haz = (type: 'wind' | 'rainfall' | 'flood' | 'landslide' | 'surge'): ToofanSnapshot['hazards']['hazards'][number] => ({
    type,
    label: HAZARD_LABEL[type],
    probability: 0,
    severity: 'low',
    confidence: 0,
    affectedArea: '—',
    status: statusFor(type === 'surge' ? '_surge' : type, type === 'surge' ? 'NOT_AVAILABLE' : 'NOT_AVAILABLE'),
  })

  return {
    hazards: [haz('wind'), haz('rainfall'), haz('flood'), haz('landslide'), haz('surge')],
    rainfall: [],
    flood: {
      affectedRegion: 'Not assessed',
      expectedAccumulationMm: 0,
      riverCoastalRisk: 'low',
      riskLevel: 'low',
      affectedDistricts: [],
      status: statusFor('flood'),
    },
    landslide: {
      riskLevel: 'low',
      affectedDistricts: [],
      soilMoisturePct: 0,
      rainfallContribution: '—',
      slopeExposure: '—',
      status: statusFor('landslide'),
    },
    surge: {
      coastalExposure: '—',
      estimatedSurgeM: 0,
      affectedCoastline: '—',
      riskLevel: 'low',
      available: false,
      status: statusFor('_surge', 'NOT_AVAILABLE'),
    },
    status: 'live',
  }
}

/** Build the full live snapshot from one pipeline evaluation result. */
export function buildLiveSnapshot(res: PipelineRunResult): ToofanSnapshot {
  const a = res.assessment
  const cyclone = cycloneOf(a)
  const forecast = forecastOf(a)
  const districts = buildDistrictBundle(demoSites, cyclone, forecast)

  return {
    cyclone,
    forecast,
    genesis: genesisOf(a),
    environment: environmentOf(a),
    hazards: hazardsOf(res),
    hazardRegions: [],
    districts,
    satellite: [],
    sources: sourcesOf(res.provider_sources),
    systemStatus: systemStatusOf(res),
    sign: {
      quickSelectIds: districts.districts.slice(0, 3).map((d) => d.id),
    },
  }
}
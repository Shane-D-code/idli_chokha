import { destination, distanceKm, lerpAngle } from '../lib/geo'
import type { Cyclone } from '../types/cyclone'
import type { DistrictBundle, DistrictRisk, SearchableLocation } from '../types/district'
import type { ForecastBundle } from '../types/forecast'
import { RISK_ORDER } from '../types/common'
import type { SiteSeed } from '../data/demo/districts'

interface ApproachInfo {
  closestApproachKm: number
  approachHour: number | null
}

/** Distance from the site to the nearest point on every track segment. */
function closestApproach(site: SearchableLocation, forecast: ForecastBundle): ApproachInfo {
  const track = forecast.track
  let bestKm = Infinity
  let bestHour = null as number | null
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]
    const b = track[i + 1]
    for (let t = 0; t <= 20; t++) {
      const f = t / 20
      const p = lerpAngle(a.position, b.position, f)
      const d = distanceKm(site.position, p)
      if (d < bestKm) {
        bestKm = d
        bestHour = a.hours + (b.hours - a.hours) * f
      }
    }
  }
  // fallback: distance to the final point
  const last = track[track.length - 1]
  const dLast = distanceKm(site.position, last.position)
  if (dLast < bestKm) {
    bestKm = dLast
    bestHour = last.hours
  }
  return { closestApproachKm: bestKm, approachHour: bestHour }
}

function approachTrend(site: SearchableLocation, cyclone: Cyclone): DistrictRisk['approachTrend'] {
  const toSite = Math.atan2(site.position.lon - cyclone.position.lon, site.position.lat - cyclone.position.lat)
  const toSiteDeg = ((toSite * 180) / Math.PI + 360) % 360
  const diff = ((toSiteDeg - cyclone.bearingDeg + 540) % 360) - 180
  if (Math.abs(diff) <= 55) return 'Approaching'
  if (Math.abs(diff) <= 115) return 'Steady'
  return 'Receding'
}

function riskText(risk: DistrictRisk['riskLevel']): { situation: string; safety: string[] } {
  switch (risk) {
    case 'severe':
      return {
        situation: 'Dangerous conditions. Expect severe rain, storm surge and very high winds near this area during approach.',
        safety: [
          'Follow all evacuation orders issued by district authorities.',
          'Move to a multi-storey cyclone shelter before winds peak.',
          'Do not attempt to travel along coastal roads.',
        ],
      }
    case 'high':
      return {
        situation: 'High-impact conditions possible. Strong winds, heavy rain and localised flooding are expected around closest approach.',
        safety: [
          'Stay indoors in a secure part of the building.',
          'Keep emergency kits and documents ready.',
          'Charge phones and store drinking water.',
        ],
      }
    case 'moderate':
      return {
        situation: 'Noticeable impacts likely. Squally winds, heavy showers and possible short-term waterlogging can disrupt normal activity.',
        safety: [
          'Remain vigilant and monitor official bulletins.',
          'Secure loose outdoor items.',
          'Avoid flooded low-lying roads.',
        ],
      }
    default:
      return {
        situation: 'Minimal direct impact expected. Expect distant cloud bands and light buffeting winds only.',
        safety: [
          'Normal activity can continue, but stay updated.',
          'Avoid spreading unverified information.',
          'Keep emergency numbers handy.',
        ],
      }
  }
}

export function buildDistrictBundle(
  sites: SiteSeed[],
  cyclone: Cyclone,
  forecast: ForecastBundle,
): DistrictBundle {
  const districts: DistrictRisk[] = sites.map((site) => {
    const { closestApproachKm, approachHour } = closestApproach(site, forecast)
    const trend = approachTrend(site, cyclone)
    const { situation, safety } = riskText(site.riskLevel)
    return {
      id: site.id,
      name: site.shortName,
      state: site.state ?? '—',
      position: site.position,
      riskLevel: site.riskLevel,
      distanceKm: distanceKm(site.position, cyclone.position),
      closestApproachKm,
      approachTime: approachHour === null || approachHour > forecast.track[forecast.track.length - 1].hours
        ? null
        : `+${Math.round(approachHour)}h`,
      approachTrend: trend,
      situation,
      safetyAndMonitoring: safety,
    }
  })

  const locations: SearchableLocation[] = sites.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    state: s.state,
    position: s.position,
    riskLevel: s.riskLevel,
  }))

  districts.sort((a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] || a.distanceKm - b.distanceKm)

  return { districts, locations }
}

/** Deterministic "move target" used by the gifted demo to show a live feel. */
export function demoProjectedPosition(src: { lat: number; lon: number }, bearing: number, km: number): { lat: number; lon: number } {
  return destination(src, bearing, km)
}
import type {
  FloodRisk,
  Hazard,
  HazardBundle,
  HazardRegion,
  LandslideRisk,
  RainfallBucket,
  StormSurgeRisk,
} from '../../types/hazard'

export const demoHazards: Hazard[] = [
  { type: 'rainfall', label: 'Rainfall', probability: 78, severity: 'high', confidence: 72, affectedArea: 'Odisha · coastal West Bengal', status: 'simulated' },
  { type: 'flood', label: 'Flood', probability: 64, severity: 'high', confidence: 61, affectedArea: 'Mahanadi–Brahmani–Subarnarekha lowlands', status: 'simulated' },
  { type: 'landslide', label: 'Landslide', probability: 38, severity: 'moderate', confidence: 58, affectedArea: 'Eastern Ghats foothills', status: 'simulated' },
  { type: 'surge', label: 'Storm Surge', probability: 55, severity: 'high', confidence: 48, affectedArea: 'Northern Odisha coastline', status: 'simulated' },
  { type: 'wind', label: 'Wind', probability: 82, severity: 'severe', confidence: 74, affectedArea: 'Coastal Odisha · Southern Bengal', status: 'simulated' },
]

export const demoRainfall: RainfallBucket[] = [
  { id: 'r06', window: '0–6h', fromHour: 0, toHour: 6, mm: 45, meanMmPerH: 7.5 },
  { id: 'r612', window: '6–12h', fromHour: 6, toHour: 12, mm: 120, meanMmPerH: 20 },
  { id: 'r1224', window: '12–24h', fromHour: 12, toHour: 24, mm: 210, meanMmPerH: 17.5 },
  { id: 'r2448', window: '24–48h', fromHour: 24, toHour: 48, mm: 175, meanMmPerH: 7.3 },
]

export const demoFlood: FloodRisk = {
  affectedRegion: 'Mahanadi & Brahmani–Baitarani deltas',
  expectedAccumulationMm: 350,
  riverCoastalRisk: 'high',
  riskLevel: 'high',
  affectedDistricts: ['Kendrapara', 'Jagatsinghpur', 'Bhadrak', 'Balasore', 'Jajapur', 'Puri'],
  status: 'simulated',
}

export const demoLandslide: LandslideRisk = {
  riskLevel: 'moderate',
  affectedDistricts: ['Koraput', 'Rayagada', 'Gajapati', 'Mayurbhanj', 'Keonjhar'],
  soilMoisturePct: 78,
  rainfallContribution: 'High',
  slopeExposure: 'Moderate',
  status: 'simulated',
}

export const demoSurge: StormSurgeRisk = {
  coastalExposure: 'Low-lying, gently sloping Odisha coast',
  estimatedSurgeM: 2.4,
  affectedCoastline: 'Paradip → Dhamra → Balasore (≈180 km)',
  riskLevel: 'high',
  available: true,
  status: 'simulated',
}

/** Deterministic regional intensity for the hazard map (0–100). */
export const demoHazardRegions: HazardRegion[] = [
  { type: 'rainfall', position: { lat: 17.1, lon: 82.6 }, intensity: 48 },
  { type: 'rainfall', position: { lat: 18.9, lon: 84.3 }, intensity: 62 },
  { type: 'rainfall', position: { lat: 19.8, lon: 85.4 }, intensity: 78 },
  { type: 'rainfall', position: { lat: 20.4, lon: 86.6 }, intensity: 95 },
  { type: 'rainfall', position: { lat: 21.6, lon: 87.2 }, intensity: 86 },
  { type: 'rainfall', position: { lat: 22.6, lon: 88.2 }, intensity: 55 },
  { type: 'rainfall', position: { lat: 23.2, lon: 89.8 }, intensity: 40 },

  { type: 'wind', position: { lat: 17.3, lon: 87.6 }, intensity: 52 },
  { type: 'wind', position: { lat: 18.6, lon: 88.8 }, intensity: 70 },
  { type: 'wind', position: { lat: 19.2, lon: 89.6 }, intensity: 45 },
  { type: 'wind', position: { lat: 15.5, lon: 86.9 }, intensity: 88 },

  { type: 'surge', position: { lat: 20.28, lon: 86.6 }, intensity: 74 },
  { type: 'surge', position: { lat: 20.88, lon: 86.99 }, intensity: 82 },
  { type: 'surge', position: { lat: 21.49, lon: 86.93 }, intensity: 68 },
  { type: 'surge', position: { lat: 21.63, lon: 87.34 }, intensity: 58 },

  { type: 'flood', position: { lat: 20.4, lon: 86.3 }, intensity: 85 },
  { type: 'flood', position: { lat: 21.1, lon: 86.5 }, intensity: 72 },
  { type: 'flood', position: { lat: 19.9, lon: 85.9 }, intensity: 66 },
  { type: 'flood', position: { lat: 22.3, lon: 88.1 }, intensity: 44 },

  { type: 'landslide', position: { lat: 19.3, lon: 83.4 }, intensity: 52 },
  { type: 'landslide', position: { lat: 21.4, lon: 86.2 }, intensity: 38 },
  { type: 'landslide', position: { lat: 22.1, lon: 85.8 }, intensity: 34 },
]

export const demoHazardsBundle: HazardBundle = {
  hazards: demoHazards,
  rainfall: demoRainfall,
  flood: demoFlood,
  landslide: demoLandslide,
  surge: demoSurge,
  status: 'simulated',
}
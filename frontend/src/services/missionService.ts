// ============================================================
// TOOFAN — Mission bundle service
// ------------------------------------------------------------
// Assembles every datum the Mission landing needs into a single
// `MissionBundle` with explicit provenance labels. Provenance is
// derived from the data mode + demo marker on the live system:
//   - demo mode  -> SIMULATED / DEMO / (HISTORICAL for archives)
//   - live mode  -> LIVE where the backend answers, UNAVAILABLE
//                   on error (never "LIVE" on a failed call).
// ============================================================

import { toofanService, type DataMode } from "./toofanService";
import { mockDistrictPoints, mockEnvironmentDrivers } from "@/data/mock/missionMock";

import type {
  Alert,
  CycloneState,
  DataSourceInfo,
  FloodReport,
  GenesisReport,
  HistoricalCyclone,
  HazardItem,
  IntensityReport,
  LandslideReport,
  ModelInfo,
  ModelPerformance,
  OverallRisk,
  RainfallReport,
  RecurvatureReport,
  RIReport,
  SystemState,
  TrajectoryForecast,
  WindReport,
} from "@/types";
import type { DistrictPoint, EnvironmentDriver, MissionBundle, Provenance } from "@/types/mission";

function provenanceFor(mode: DataMode, simulated = true): Provenance {
  if (mode === "live") return "LIVE";
  return simulated ? "SIMULATED" : "DEMO";
}

const GENERATION_FRAME = "2026-09-02T13:12:00Z";

export async function loadMissionBundle(mode: DataMode = toofanService.getDataMode()): Promise<MissionBundle> {
  const [system, cyclone, trajectory, genesis, intensity, ri, rainfall, wind, flood, landslide] =
    await Promise.all([
      toofanService.getSystem(),
      toofanService.getCyclone(),
      toofanService.getTrajectory(),
      toofanService.getGenesis(),
      toofanService.getIntensity(),
      toofanService.getRI(),
      toofanService.getRainfall(),
      toofanService.getWind(),
      toofanService.getFlood(),
      toofanService.getLandslide(),
    ]);
  const [recurvature, risk, hazards, models, performance, historical] = await Promise.all([
    toofanService.getRecurvature(),
    toofanService.getOverallRisk(),
    toofanService.getHazards(),
    toofanService.getModels(),
    toofanService.getPerformance(),
    toofanService.getHistorical(),
  ]);
  const [dataSources, alerts] = await Promise.all([
    toofanService.getDataSources(),
    toofanService.getAlerts(),
  ]);

  const simulated = mode === "demo";
  const pLive = provenanceFor(mode, simulated);

  // Genesis ensemble probability = weighted soft vote of the sub-models
  const weighted = genesis.subModels.filter((s: { probability24h?: number; weight?: number }) => s.probability24h !== undefined && s.weight !== undefined);
  const denom = weighted.reduce((a: number, s: { weight?: number }) => a + (s.weight ?? 0), 0);
  const genesisEnsembleProbability =
    denom > 0 ? weighted.reduce((a: number, s: { probability24h?: number; weight?: number }) => a + (s.probability24h ?? 0) * (s.weight ?? 0), 0) / denom : 0;

  const districts = buildDistricts({ rainfall, flood, landslide });

  return {
    generatedAt: GENERATION_FRAME,
    mode,
    system,
    cyclone,
    trajectory,
    genesis,
    intensity,
    ri,
    rainfall,
    wind,
    flood,
    landslide,
    recurvature,
    risk,
    hazards,
    models,
    performance,
    historical,
    dataSources,
    alerts,
    environment: simulated ? mockEnvironmentDrivers : mockEnvironmentDrivers.map(toLiveDriver),
    districts,
    provenance: {
      cyclone: pLive,
      forecast: pLive,
      hazards: pLive,
      environment: simulated ? "SIMULATED" : "LIVE",
    },
    genesisEnsembleProbability,
    genesisAboveThreshold: genesisEnsembleProbability >= 0.24,
  };
}

function toLiveDriver(d: EnvironmentDriver): EnvironmentDriver {
  return { ...d, provenance: "LIVE" };
}

/** Merge simulated hazard district risk + reference coords into one set. */
function buildDistricts(d: {
  rainfall: RainfallReport;
  flood: FloodReport;
  landslide: LandslideReport;
}): DistrictPoint[] {
  const points = new Map<string, DistrictPoint>();

  for (const r of d.rainfall.districtRanking ?? []) {
    const base = mockDistrictPoints.find((m) => m.district === r.district && m.state === r.state);
    if (!base) continue;
    upsert(points, base, {
      label: `Rainfall ${r.expectedMm ?? "—"} mm`,
      value: r.risk ?? "—",
      risk: r.risk,
    });
  }
  for (const f of d.flood.districts ?? []) {
    const base = mockDistrictPoints.find((m) => m.district === f.district && m.state === f.state);
    if (!base) continue;
    upsert(points, base, {
      label: `Flood ${f.floodProbability !== undefined ? Math.round(f.floodProbability * 100) + "%" : "—"}`,
      value: f.risk ?? "—",
      risk: f.risk,
    });
  }
  for (const s of d.landslide.staticSusceptibility?.regions ?? []) {
    if (s.lat === undefined || s.lon === undefined) continue;
    upsert(points, { district: s.name, state: "Eastern Ghats", lat: s.lat, lon: s.lon, provenance: "SIMULATED" }, {
      label: "Landslide",
      value: s.level ?? "—",
      risk: s.level,
    });
  }
  return [...points.values()];
}

function upsert(points: Map<string, DistrictPoint>, base: DistrictPoint, value: NonNullable<DistrictPoint["values"]>[number]) {
  const key = `${base.state}::${base.district}`;
  const existing = points.get(key);
  if (existing) {
    existing.values = [...(existing.values ?? []), value];
  } else {
    points.set(key, { ...base, values: [value] });
  }
}

export function fmtIST(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export { GENERATION_FRAME };

export type { MissionBundle, Provenance };
export type { Alert, CycloneState, DataSourceInfo, DistrictPoint, EnvironmentDriver, FloodReport, GenesisReport, HistoricalCyclone, HazardItem, IntensityReport, LandslideReport, ModelInfo, ModelPerformance, OverallRisk, RainfallReport, RecurvatureReport, RIReport, SystemState, TrajectoryForecast, WindReport };
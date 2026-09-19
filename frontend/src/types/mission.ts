// ============================================================
// TOOFAN — Mission Control domain contracts
// ------------------------------------------------------------
// Types for the cinematic single-page landing experience.
// These wrap the existing service-layer data with explicit
// provenance labels so the UI can HONESTLY distinguish real
// model output from simulated / demo / unavailable values.
// ============================================================

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
import type { DataMode } from "@/services/toofanService";

/** Provenance of a single datum — the honest data label every
 *  number in the mission view carries. */
export type Provenance = "LIVE" | "HISTORICAL" | "DEMO" | "SIMULATED" | "UNAVAILABLE";

export interface Provenanced<T> {
  value: T;
  provenance: Provenance;
  note?: string;
}

/** Environmental drivers for genesis analysis. Demo values are
 *  explicitly SIMULATED — never presented as real observations. */
export interface EnvironmentDriver {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** Operational favorability interpretation. */
  status: "FAVORABLE" | "MODERATE" | "UNFAVORABLE";
  /** Human-readable decision threshold. */
  threshold: string;
  provenance: Provenance;
}

/** A real administrative district enriched with a (real) reference
 *  coordinate for placement on the India outline map. Risk/values
 *  carry provenance separately (always SIMULATED inside demo mode). */
export interface DistrictPoint {
  district: string;
  state: string;
  lat: number;
  lon: number;
  provenance: Provenance;
  values?: { label: string; value: string; risk?: HazardItem["risk"] }[];
}

/** Aggregate bundle loaded by the mission page. */
export interface MissionBundle {
  generatedAt: string;
  mode: DataMode;
  system: SystemState;
  cyclone: CycloneState;
  trajectory: TrajectoryForecast;
  genesis: GenesisReport;
  intensity: IntensityReport;
  ri: RIReport;
  rainfall: RainfallReport;
  wind: WindReport;
  flood: FloodReport;
  landslide: LandslideReport;
  recurvature: RecurvatureReport;
  risk: OverallRisk;
  hazards: HazardItem[];
  models: ModelInfo[];
  performance: ModelPerformance[];
  historical: HistoricalCyclone[];
  dataSources: DataSourceInfo[];
  alerts: Alert[];
  environment: EnvironmentDriver[];
  districts: DistrictPoint[];
  provenance: {
    cyclone: Provenance;
    forecast: Provenance;
    hazards: Provenance;
    environment: Provenance;
  };
  genesisEnsembleProbability: number;
  genesisAboveThreshold: boolean;
}

export interface MissionSectionLink {
  id: string;
  index: string;
  label: string;
}
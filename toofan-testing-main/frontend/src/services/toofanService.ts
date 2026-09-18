// ============================================================
// TOOFAN service facade
// ------------------------------------------------------------
// The UI depends ONLY on this facade (plus the domain types).
// Every method maps to a documented backend API contract.
//
//   GET /api/cyclone/current
//   GET /api/cyclone/track
//   GET /api/cyclone/forecast
//   GET /api/intensity
//   GET /api/ri
//   GET /api/rainfall
//   GET /api/wind
//   GET /api/flood
//   GET /api/landslide
//   GET /api/recurvature
//   GET /api/genesis
//   GET /api/risk
//   GET /api/models
//   GET /api/models/:id
//   GET /api/performance
//   GET /api/historical
//   GET /api/data-sources
//   GET /api/alerts
//   GET /api/system
//   GET /api/events  (SSE/WebSocket realtime)
//
// A DEMO adapter returns clearly-labelled simulated data.
// When a real backend is configured, switch `dataMode` to
// "live" and the same interface routes to HTTP endpoints.
// ============================================================

import * as mock from "@/data/mock/MOCK";
import { apiGet } from "./apiClient";
import { getRecurvatureLive } from "./recurvatureService";

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
  ToofanEvent,
  TrajectoryForecast,
  WindReport,
} from "@/types";

export type DataMode = "demo" | "live";

let dataMode: DataMode = "demo";

export function setDataMode(mode: DataMode) {
  dataMode = mode;
}

export function getDataMode(): DataMode {
  return dataMode;
}

async function resolve<T>(http: () => Promise<T>, demo: () => T): Promise<T> {
  if (dataMode === "live") return http();
  return Promise.resolve(demo());
}

export const toofanService = {
  setDataMode,
  getDataMode,
  getDataModeLabel(): string {
    return dataMode === "demo" ? "DEMO" : "LIVE";
  },
  async getSystem(): Promise<SystemState> {
    return resolve(
      () => apiGet<SystemState>("/system"),
      () => ({
        activeCyclone: mock.mockActiveCyclone,
        systemOperational: true,
        partialOperational: true,
        lastUpdated: mock.mockLastUpdated,
        dataStale: false,
        demoMode: true,
        overallRisk: mock.mockOverallRisk,
      })
    );
  },
  async getCyclone(): Promise<CycloneState> {
    return resolve(() => apiGet<CycloneState>("/cyclone/current"), () => mock.mockActiveCyclone);
  },
  async getTrajectory(): Promise<TrajectoryForecast> {
    return resolve(() => apiGet<TrajectoryForecast>("/cyclone/forecast"), () => mock.mockTrajectory);
  },
  async getIntensity(): Promise<IntensityReport> {
    return resolve(() => apiGet<IntensityReport>("/intensity"), () => mock.mockIntensity);
  },
  async getRI(): Promise<RIReport> {
    return resolve(() => apiGet<RIReport>("/ri"), () => mock.mockRI);
  },
  async getRainfall(): Promise<RainfallReport> {
    return resolve(() => apiGet<RainfallReport>("/rainfall"), () => mock.mockRainfall);
  },
  async getWind(): Promise<WindReport> {
    return resolve(() => apiGet<WindReport>("/wind"), () => mock.mockWind);
  },
  async getFlood(): Promise<FloodReport> {
    return resolve(() => apiGet<FloodReport>("/flood"), () => mock.mockFlood);
  },
  async getLandslide(): Promise<LandslideReport> {
    return resolve(() => apiGet<LandslideReport>("/landslide"), () => mock.mockLandslide);
  },
  async getRecurvature(): Promise<RecurvatureReport> {
    // Live mode returns the real /api/recurvature payload (normalized).
    // Demo mode returns clearly-labelled simulated data exercising the
    // full available-prediction UI path.
    return resolve(
      () => getRecurvatureLive(),
      () => mock.mockRecurvature
    );
  },
  async getGenesis(): Promise<GenesisReport> {
    return resolve(() => apiGet<GenesisReport>("/genesis"), () => mock.mockGenesis);
  },
  async getOverallRisk(): Promise<OverallRisk> {
    return resolve(() => apiGet<OverallRisk>("/risk"), () => mock.mockOverallRisk);
  },
  async getHazards(): Promise<HazardItem[]> {
    return resolve(() => apiGet<HazardItem[]>("/risk/hazards"), () => mock.mockHazards);
  },
  async getModels(): Promise<ModelInfo[]> {
    return resolve(() => apiGet<ModelInfo[]>("/models"), () => mock.mockModels);
  },
  async getModel(id: string): Promise<ModelInfo | undefined> {
    return resolve(
      () => apiGet<ModelInfo>(`/models/${encodeURIComponent(id)}`),
      () => mock.mockModels.find((m) => m.id === id)
    );
  },
  async getPerformance(): Promise<ModelPerformance[]> {
    return resolve(
      () => apiGet<ModelPerformance[]>("/performance"),
      () => mock.mockPerformance
    );
  },
  async getHistorical(): Promise<HistoricalCyclone[]> {
    return resolve(() => apiGet<HistoricalCyclone[]>("/historical"), () => mock.mockHistorical);
  },
  async getDataSources(): Promise<DataSourceInfo[]> {
    return resolve(() => apiGet<DataSourceInfo[]>("/data-sources"), () => mock.mockDataSources);
  },
  async getAlerts(): Promise<Alert[]> {
    return resolve(() => apiGet<Alert[]>("/alerts"), () => mock.mockAlerts);
  },
  async getEvents(): Promise<ToofanEvent[]> {
    return resolve(() => apiGet<ToofanEvent[]>("/events"), () => []);
  },
};

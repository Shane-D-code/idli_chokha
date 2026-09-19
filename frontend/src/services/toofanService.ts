import * as mock from "@/data/mock/MOCK";
import { apiGet, apiPost, getWebSocketUrl } from "./apiClient";
import type {
  Alert,
  CycloneState,
  DataSourceInfo,
  FloodReport,
  GenesisReport,
  HazardItem,
  HistoricalCyclone,
  IntensityReport,
  LandslideReport,
  ModelInfo,
  ModelOperationalStatus,
  ModelPerformance,
  OverallRisk,
  RainfallReport,
  RecurvatureReport,
  RIReport,
  ToofanEvent,
  TrajectoryForecast,
  TrackPoint,
  WindReport,
  HazardSeverity,
} from "@/types";
import type {
  BackendDataSourcesResponse,
  BackendHazardStatus,
  BackendHealth,
  BackendModelEntry,
  BackendModelsResponse,
  BasinCode,
  PipelineEvent,
  PipelineRunRequest,
  PipelineRunResult,
  UnifiedForecastState,
} from "@/types/backend";

export type DataMode = "demo" | "live";

const _envHasApi = Boolean(import.meta.env.VITE_API_BASE_URL);
let dataMode: DataMode = _envHasApi ? "live" : "demo";
let latestRun: PipelineRunResult | null = null;
let latestEvents: PipelineEvent[] = [];
const _eventSubscribers: Array<(ev: PipelineEvent) => void> = [];
const _wsMap: Record<string, { socket: WebSocket; intentionalClose: boolean; retries: number; reconnect: boolean; maxRetries: number } | undefined> = {};

export function setDataMode(mode: DataMode) {
  dataMode = mode;
}

export function getDataMode(): DataMode {
  return dataMode;
}

export function setLatestAssessment(result: PipelineRunResult | null) {
  latestRun = result;
}

export function subscribeEvents(fn: (ev: PipelineEvent) => void) {
  _eventSubscribers.push(fn);
  return () => {
    const i = _eventSubscribers.indexOf(fn);
    if (i >= 0) _eventSubscribers.splice(i, 1);
  };
}

export function getLatestAssessment(): PipelineRunResult | null {
  return latestRun;
}

export function getLatestEvents(): PipelineEvent[] {
  return latestEvents;
}

export function closeAssessmentWebSocket(eventId: string) {
  const entry = _wsMap[eventId];
  if (entry) {
    entry.intentionalClose = true;
    try {
      entry.socket.close();
    } catch {}
    delete _wsMap[eventId];
  }
}

function demoOrLive<T>(live: () => Promise<T>, demo: () => T): Promise<T> {
  if (dataMode === "live") return live();
  return Promise.resolve(demo());
}

function assessment(): UnifiedForecastState | null {
  return latestRun?.assessment ?? null;
}

function moduleStatus(name: string): ModelOperationalStatus {
  const run = latestRun;
  if (!run) return "NOT_AVAILABLE";
  const status = run.per_hazard_status[name] ?? run.assessment?.module_status?.[name];
  return normalizeStatus(status);
}

function moduleReason(name: string): string | undefined {
  return latestRun?.per_hazard_reasons[name] ?? latestRun?.assessment?.module_reasons?.[name];
}

function normalizeStatus(status?: string | null): ModelOperationalStatus {
  if (!status) return "NOT_AVAILABLE";
  const upper = status.toUpperCase();
  if (upper === "SUCCESS") return "AVAILABLE";
  if (upper === "FAILED") return "ERROR";
  if (upper === "UNAVAILABLE" || upper === "DATA_UNAVAILABLE") return "NOT_AVAILABLE";
  if (upper === "LIMITED" || upper === "UNVERIFIED" || upper === "LIMITED/UNVERIFIED") {
    return "DEGRADED";
  }
  if (
    upper === "AVAILABLE" ||
    upper === "BASELINE" ||
    upper === "DEGRADED" ||
    upper === "ERROR" ||
    upper === "NOT_AVAILABLE"
  ) {
    return upper as ModelOperationalStatus;
  }
  return "DEGRADED";
}

function riskLevel(value?: string | null): HazardSeverity | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper === "NONE" || upper === "LOW" || upper === "MODERATE" || upper === "HIGH" || upper === "EXTREME") {
    return upper as HazardSeverity;
  }
  if (upper === "VERY_HIGH") return "VERY_HIGH";
  return undefined;
}

function basinName(code?: string): CycloneState["basin"] {
  switch (code) {
    case "BOB":
      return "Bay of Bengal";
    case "AS":
      return "Arabian Sea";
    case "NI":
      return "North Indian Ocean";
    case "SI":
      return "South Indian Ocean";
    case "WP":
      return "Western Pacific";
    case "EP":
      return "Eastern Pacific";
    case "NA":
      return "North Atlantic";
    case "SP":
      return "South Pacific";
    default:
      return "North Indian Ocean";
  }
}

function unavailableCyclone(): CycloneState {
  return {
    id: "NO_BACKEND_ASSESSMENT",
    name: "No live assessment",
    basin: "North Indian Ocean",
    timestamp: new Date().toISOString(),
    latitude: 0,
    longitude: 0,
    status: {
      status: "NOT_AVAILABLE",
      message: "Run a live assessment to populate cyclone state.",
      timestamp: new Date().toISOString(),
    },
  };
}

function backendCyclone(): CycloneState {
  const a = assessment();
  const c = a?.cyclone;
  if (!c) return unavailableCyclone();
  return {
    id: c.storm_id,
    name: c.storm_id,
    basin: basinName(c.basin),
    timestamp: c.timestamp,
    latitude: c.latitude,
    longitude: c.longitude,
    windKt: c.max_wind_kt ?? undefined,
    mslpHpa: c.central_pressure_hpa ?? undefined,
    category: c.category ?? undefined,
    movement: {
      bearingDeg: c.heading_deg ?? undefined,
      speedKt: c.translation_speed_kt ?? undefined,
      speedKph: c.translation_speed_kt != null ? c.translation_speed_kt * 1.852 : undefined,
    },
    status: {
      status: latestRun?.pipeline_status === "FAILED" ? "ERROR" : "AVAILABLE",
      timestamp: c.timestamp,
    },
  };
}

function backendTrack(): TrajectoryForecast {
  const a = assessment();
  const track = a?.track;
  const cyclone = a?.cyclone;
  const status = moduleStatus("trajectory");
  const times = track?.forecast_times ?? [];
  const points: TrackPoint[] = times.map((timestamp, i) => ({
    timestamp,
    horizonHours: Math.max(
      0,
      Math.round((new Date(timestamp).getTime() - new Date(cyclone?.timestamp ?? timestamp).getTime()) / 36e5)
    ),
    latitude: track?.latitudes?.[i] ?? cyclone?.latitude ?? 0,
    longitude: track?.longitudes?.[i] ?? cyclone?.longitude ?? 0,
    uncertaintyKm: track?.uncertainty_km?.[i] ?? track?.position_error_estimates_km?.[i],
    isForecast: true,
  }));
  if (cyclone) {
    points.unshift({
      timestamp: cyclone.timestamp,
      horizonHours: 0,
      latitude: cyclone.latitude,
      longitude: cyclone.longitude,
      windKt: cyclone.max_wind_kt ?? undefined,
      isForecast: false,
    });
  }
  return {
    model: "Cyclone Path",
    modelVersion: track?.model_version ?? a?.model_versions?.trajectory ?? "—",
    status: {
      status,
      message: moduleReason("trajectory") ?? track?.explanation,
      timestamp: track?.timestamp ?? a?.timestamp,
    },
    forecastHorizonHours: 24,
    predictionSteps: Math.max(0, points.length - 1),
    initialized: cyclone?.timestamp ?? a?.timestamp ?? new Date().toISOString(),
    points,
  };
}

function backendGenesis(): GenesisReport {
  const ge = assessment()?.genesis;
  const status = moduleStatus("genesis");
  return {
    status: {
      status,
      message: moduleReason("genesis") ?? ge?.model_name,
      timestamp: ge?.timestamp,
    },
    threshold: ge?.threshold,
    calibrated: ge?.calibrated,
    scientificStatus: status === "NOT_AVAILABLE" ? moduleReason("genesis") : "Backend result",
    subModels: [
      {
        modelId: "genesis",
        name: ge?.model_name ?? "Genesis",
        role: "PRIMARY",
        status,
        probability24h: ge?.probability_24h ?? ge?.probability,
        probability48h: ge?.probability_48h,
        probability72h: ge?.probability_72h,
        message: moduleReason("genesis"),
      },
    ],
  };
}

function backendIntensity(): IntensityReport {
  const out = assessment()?.intensity;
  return {
    current: {
      windKt: assessment()?.cyclone.max_wind_kt ?? undefined,
      mslpHpa: assessment()?.cyclone.central_pressure_hpa ?? undefined,
      category: assessment()?.cyclone.category ?? undefined,
      observed: true,
    },
    status: {
      status: moduleStatus("intensity"),
      message: moduleReason("intensity") ?? out?.reason ?? undefined,
      timestamp: out?.timestamp,
    },
    forecastPoints: [
      { horizonHours: 6, windKt: out?.predicted_msw_6h ?? undefined },
      { horizonHours: 12, windKt: out?.predicted_msw_12h ?? undefined },
      { horizonHours: 24, windKt: out?.predicted_msw_24h ?? undefined },
      { horizonHours: 48, windKt: out?.predicted_msw_48h ?? undefined },
    ].filter((p) => p.windKt != null),
  };
}

function backendRI(): RIReport {
  const ri = assessment()?.rapid_intensification;
  const status = moduleStatus("ri");
  return {
    status: { status, message: moduleReason("ri") ?? ri?.explanation ?? undefined, timestamp: ri?.timestamp },
    leadProbability: ri?.probability_24h,
    fusionProbability: ri?.fusion_probability ?? undefined,
    models: [
      {
        modelId: "ri",
        name: "Rapid Intensification",
        status,
        probability: ri?.probability_24h,
        inputType: "Backend CycloneState",
        lastRun: ri?.timestamp,
        risk: riskLevel(ri?.risk_level),
        statusNote: moduleReason("ri"),
      },
    ],
  };
}

function backendRainfall(): RainfallReport {
  const rain = assessment()?.rainfall;
  const status = moduleStatus("rainfall");
  return {
    status: { status, message: moduleReason("rainfall") ?? rain?.explanation, timestamp: rain?.timestamp },
    modelName: rain?.model_version ?? "Rainfall",
    isBaseline: status === "BASELINE",
    baselineNotice: status === "BASELINE" ? "Backend reports rainfall as a baseline/case-study output." : "",
    accepted: status === "AVAILABLE" || status === "BASELINE" || status === "DEGRADED",
  };
}

function backendWind(): WindReport {
  const wind = assessment()?.wind;
  const status = moduleStatus("wind");
  const reason = moduleReason("wind") ?? wind?.explanation;
  return {
    status: {
      status,
      message: status === "NOT_AVAILABLE" ? reason ?? "U10/V10 gridded provider unavailable." : reason,
      timestamp: wind?.timestamp,
    },
    requiresRuntime: "TensorFlow",
    modelName: wind?.model_version ?? "wind_model_best.keras",
    message:
      status === "NOT_AVAILABLE"
        ? "WIND DATA UNAVAILABLE — U10/V10 gridded provider unavailable."
        : wind?.explanation ?? "Backend wind output.",
  };
}

function backendFlood(): FloodReport {
  const flood = assessment()?.flood;
  const status = moduleStatus("flood");
  return {
    status: { status, message: moduleReason("flood") ?? flood?.reason ?? undefined, timestamp: flood?.timestamp },
    modelName: flood?.model_version ?? "Flood",
    modelType: "XGBoost flood classifier",
    predictionTimestamp: flood?.timestamp,
    accepted: status === "AVAILABLE" || status === "BASELINE" || status === "DEGRADED",
    overallRisk: flood?.high_risk_regions?.length ? "HIGH" : undefined,
  };
}

function backendLandslide(): LandslideReport {
  const land = assessment()?.landslide;
  const status = moduleStatus("landslide");
  return {
    modelStatus: { status, message: moduleReason("landslide") ?? land?.reason ?? undefined, timestamp: land?.timestamp },
    staticSusceptibility: {
      available: status !== "NOT_AVAILABLE" && status !== "ERROR",
      description: moduleReason("landslide") ?? "Backend landslide susceptibility output.",
      classification: "STATIC",
    },
  };
}

function backendRecurvature(): RecurvatureReport {
  const rec = assessment()?.recurvature;
  const status = moduleStatus("recurvature");
  return {
    status: { status, message: moduleReason("recurvature"), timestamp: rec?.timestamp },
    probability: rec?.probability,
    risk: riskLevel(rec?.risk_level),
    prediction: {
      probability: rec?.probability,
      risk: riskLevel(rec?.risk_level),
    },
    model: {
      name: "Recurvature",
      version: rec?.model_version,
      framework: "XGBoost",
    },
  };
}

function backendRisk(): OverallRisk {
  const a = assessment();
  if (!a) {
    return {
      available: false,
      reason: "No live backend assessment has been run.",
      engineName: "Hazard Engine",
    };
  }
  const severity = riskLevel(typeof a.overall_hazard_severity === "string" ? a.overall_hazard_severity : null);
  return {
    available: severity != null,
    severity,
    score: a.confidence != null ? Math.round(a.confidence * 100) : undefined,
    reason: severity ? undefined : "Hazard engine did not assess a severity from usable components.",
    engineName: "Hazard Engine",
  };
}

function backendHazards(): HazardItem[] {
  const a = assessment();
  const modules = ["genesis", "trajectory", "recurvature", "intensity", "ri", "rainfall", "flood", "wind", "landslide"];
  return modules.map((id) => ({
    id,
    label: id === "ri" ? "RI" : id === "trajectory" ? "Cyclone Path" : id.toUpperCase(),
    status: moduleStatus(id),
    model: a?.model_versions?.[id] ?? "—",
    risk: riskLevel(a?.uncertainty_summary?.components?.[id]?.risk_level),
    data: moduleReason(id),
    lastUpdate: a?.timestamp,
  }));
}

function backendModels(entries: BackendModelEntry[]): ModelInfo[] {
  const registered = entries.map((m) => ({
    id: `${m.name}-${m.version}`,
    name: m.name,
    slug: m.model_type,
    artifact: m.checkpoint_path,
    framework: m.model_type === "wind" ? "TensorFlow/Keras" : "Backend registry",
    version: m.version,
    load: m.artifact_present ? "AVAILABLE" : "NOT_AVAILABLE",
    predict: m.artifact_present ? "AVAILABLE" : "NOT_AVAILABLE",
    adapter: m.artifact_present ? "AVAILABLE" : "NOT_AVAILABLE",
    orchestrator: m.artifact_present ? "AVAILABLE" : "NOT_AVAILABLE",
    status: m.artifact_present ? "AVAILABLE" : "NOT_AVAILABLE",
    category: m.model_type,
    hash: m.file_hash,
  })) satisfies ModelInfo[];

  const known = ["genesis", "intensity", "rainfall", "flood", "landslide", "recurvature"];
  const placeholders = known
    .filter((slug) => !registered.some((m) => m.slug === slug))
    .map((slug) => ({
      id: slug,
      name: slug,
      slug,
      framework: "Backend module",
      load: "NOT_AVAILABLE" as const,
      predict: "NOT_AVAILABLE" as const,
      adapter: "NOT_AVAILABLE" as const,
      orchestrator: "NOT_AVAILABLE" as const,
      status: moduleStatus(slug),
      category: slug,
      error: moduleReason(slug),
    }));
  return [...registered, ...placeholders];
}

function backendDataSources(sources: BackendDataSourcesResponse["sources"]): DataSourceInfo[] {
  return Object.entries(sources).map(([id, src]) => ({
    id,
    name: id,
    category: src.dataset ?? "Provider",
    status: src.available ? "AVAILABLE" : "NOT_AVAILABLE",
    description: src.source_path ?? "No source path configured",
  }));
}

function backendAlerts(): Alert[] {
  const run = latestRun;
  if (!run) return [];
  return Object.entries(run.per_hazard_reasons).map(([module, reason]) => ({
    id: `${run.run_id}-${module}`,
    severity: run.per_hazard_status[module] === "ERROR" ? "WARNING" : "INFO",
    title: `${module.toUpperCase()} ${run.per_hazard_status[module] ?? "STATUS"}`,
    message: reason,
    source: "FastAPI",
    timestamp: run.generated_at,
  }));
}

export const toofanService = {
  setDataMode,
  getDataMode,
  setLatestAssessment,
  getLatestAssessment,
  getLatestEvents,
  getDataModeLabel(): string {
    return dataMode === "demo" ? "DEMO" : "LIVE BACKEND";
  },
  async getHealth(): Promise<BackendHealth> {
    return apiGet<BackendHealth>("/health/");
  },
  async runPipeline(request: PipelineRunRequest): Promise<PipelineRunResult> {
    const result = await apiPost<PipelineRunResult>("/pipeline/run", request);
    latestRun = result;
    return result;
  },
  async getAssessment(requestId: string): Promise<PipelineRunResult> {
    const result = await apiGet<PipelineRunResult>(`/assessment/${encodeURIComponent(requestId)}`);
    latestRun = result;
    return result;
  },
  connectAssessmentWebSocket(eventId: string, handlers: {
    onMessage: (event: PipelineEvent) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: () => void;
  }, options?: { reconnect?: boolean; maxRetries?: number }): WebSocket {
    const reconnect = options?.reconnect ?? true;
    const maxRetries = options?.maxRetries ?? 6;

    // Return existing socket if present
    const existing = _wsMap[eventId];
    if (existing && existing.socket && existing.socket.readyState === WebSocket.OPEN) {
      return existing.socket;
    }

    const create = (): WebSocket => {
      const wsUrl = getWebSocketUrl(`/ws/assessment/${encodeURIComponent(eventId)}`);
      const ws = new WebSocket(wsUrl);
      _wsMap[eventId] = { socket: ws, intentionalClose: false, retries: 0, reconnect, maxRetries };

      ws.onopen = () => {
        _wsMap[eventId] && (_wsMap[eventId]!.retries = 0);
        handlers.onOpen?.();
      };

      ws.onclose = () => {
        handlers.onClose?.();
        const entry = _wsMap[eventId];
        if (!entry) return;
        if (entry.intentionalClose) {
          delete _wsMap[eventId];
          return;
        }
        if (entry.reconnect && entry.retries < entry.maxRetries) {
          const to = Math.min(30_000, 500 * Math.pow(2, entry.retries));
          entry.retries += 1;
          setTimeout(() => {
            create();
          }, to);
        } else {
          delete _wsMap[eventId];
        }
      };

      ws.onerror = () => {
        handlers.onError?.();
      };

      ws.onmessage = (message) => {
        const parsed = JSON.parse(message.data as string) as PipelineEvent;
        latestEvents = [...latestEvents, parsed].slice(-200);
        // Notify local subscribers
        try {
          _eventSubscribers.forEach((s) => s(parsed));
        } catch (e) {
          // ignore subscriber errors
        }
        handlers.onMessage(parsed);
      };

      return ws;
    };

    return create();
  },
  async getSystem(): Promise<any> {
    return demoOrLive(
      async () => {
        const health = await apiGet<BackendHealth>("/health/");
        return {
          activeCyclone: latestRun?.assessment ? backendCyclone() : undefined,
          systemOperational: health.status === "healthy",
          partialOperational: health.status === "degraded",
          lastUpdated: latestRun?.generated_at ?? new Date().toISOString(),
          dataStale: false,
          demoMode: false,
          overallRisk: backendRisk(),
        };
      },
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
    return demoOrLive(async () => backendCyclone(), () => mock.mockActiveCyclone);
  },
  async getTrajectory(): Promise<TrajectoryForecast> {
    return demoOrLive(async () => backendTrack(), () => mock.mockTrajectory);
  },
  async getIntensity(): Promise<IntensityReport> {
    return demoOrLive(async () => backendIntensity(), () => mock.mockIntensity);
  },
  async getRI(): Promise<RIReport> {
    return demoOrLive(async () => backendRI(), () => mock.mockRI);
  },
  async getRainfall(): Promise<RainfallReport> {
    return demoOrLive(async () => backendRainfall(), () => mock.mockRainfall);
  },
  async getWind(): Promise<WindReport> {
    return demoOrLive(async () => backendWind(), () => mock.mockWind);
  },
  async getFlood(): Promise<FloodReport> {
    return demoOrLive(async () => backendFlood(), () => mock.mockFlood);
  },
  async getLandslide(): Promise<LandslideReport> {
    return demoOrLive(async () => backendLandslide(), () => mock.mockLandslide);
  },
  async getRecurvature(): Promise<RecurvatureReport> {
    return demoOrLive(async () => backendRecurvature(), () => mock.mockRecurvature);
  },
  async getGenesis(): Promise<GenesisReport> {
    return demoOrLive(async () => backendGenesis(), () => mock.mockGenesis);
  },
  async getOverallRisk(): Promise<OverallRisk> {
    return demoOrLive(async () => backendRisk(), () => mock.mockOverallRisk);
  },
  async getHazards(): Promise<HazardItem[]> {
    return demoOrLive(async () => backendHazards(), () => mock.mockHazards);
  },
  async getModels(): Promise<ModelInfo[]> {
    return demoOrLive(
      async () => {
        const res = await apiGet<BackendModelsResponse>("/models/");
        return backendModels(res.models);
      },
      () => mock.mockModels
    );
  },
  async getModel(id: string): Promise<ModelInfo | undefined> {
    return demoOrLive(
      async () => (await this.getModels()).find((m) => m.id === id || m.slug === id),
      () => mock.mockModels.find((m) => m.id === id)
    );
  },
  async getPerformance(): Promise<ModelPerformance[]> {
    return demoOrLive(async () => [], () => mock.mockPerformance);
  },
  async getHistorical(): Promise<HistoricalCyclone[]> {
    return demoOrLive(async () => [], () => mock.mockHistorical);
  },
  async getDataSources(): Promise<DataSourceInfo[]> {
    return demoOrLive(
      async () => {
        const res = await apiGet<BackendDataSourcesResponse>("/data/sources");
        return backendDataSources(res.sources);
      },
      () => mock.mockDataSources
    );
  },
  async getAlerts(): Promise<Alert[]> {
    return demoOrLive(async () => backendAlerts(), () => mock.mockAlerts);
  },
  async getEvents(): Promise<ToofanEvent[]> {
    return demoOrLive(async () => [], () => []);
  },
};

export type { BackendHazardStatus, BasinCode, PipelineEvent, PipelineRunRequest, PipelineRunResult };

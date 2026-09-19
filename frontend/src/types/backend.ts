export type BasinCode = "NI" | "BOB" | "AS" | "WP" | "EP" | "NA" | "SI" | "SP";

export type BackendHazardStatus =
  | "AVAILABLE"
  | "DEGRADED"
  | "BASELINE"
  | "NOT_AVAILABLE"
  | "ERROR";

export type BackendExecutionStatus = "SUCCESS" | "FAILED" | "UNAVAILABLE" | "NOT_RUN";

export type BackendRiskLevel = "NONE" | "LOW" | "MODERATE" | "HIGH" | "EXTREME";

export interface PipelineRunRequest {
  storm_id: string;
  basin: BasinCode;
  reference_time: string;
  latitude?: number;
  longitude?: number;
  modules?: string[] | null;
  mode?: "full" | "genesis_only" | "track_only" | "hazard_only";
  request_id?: string | null;
  max_workers?: number | null;
  labels?: Record<string, string>;
}

export interface ProviderSource {
  name: string;
  dataset?: string | null;
  source_path?: string | null;
  retrieved_at: string;
  observation_timestamp?: string | null;
  is_stale: boolean;
  latency_ms: number;
  status: "AVAILABLE" | "DEGRADED" | "NOT_AVAILABLE" | "ERROR";
  warnings: string[];
  detail?: string | null;
}

export interface CycloneStateBackend {
  storm_id: string;
  basin: BasinCode;
  timestamp: string;
  latitude: number;
  longitude: number;
  max_wind_kt?: number | null;
  central_pressure_hpa?: number | null;
  category?: string | null;
  heading_deg?: number | null;
  translation_speed_kt?: number | null;
  metadata?: {
    source_datasets?: string[];
    ingestion_timestamp?: string;
    warnings?: string[];
    missing_modalities?: string[];
  };
}

export interface GenesisPredictionBackend {
  probability_24h?: number;
  probability_48h?: number;
  probability_72h?: number;
  probability?: number;
  threshold?: number;
  predicted_class?: number;
  model_name?: string;
  model_version?: string;
  timestamp?: string;
  risk_level?: BackendRiskLevel;
  confidence?: number;
  artifact_path?: string;
  provenance?: Record<string, unknown>;
  calibrated?: boolean;
}

export interface TrackPredictionBackend {
  forecast_times?: string[];
  latitudes?: number[];
  longitudes?: number[];
  position_error_estimates_km?: number[];
  uncertainty_km?: number[];
  confidence?: number;
  model_version?: string;
  timestamp?: string;
  status?: string;
  explanation?: string;
}

export interface IntensityPredictionBackend {
  predicted_msw_6h?: number | null;
  predicted_msw_12h?: number | null;
  predicted_msw_24h?: number | null;
  predicted_msw_48h?: number | null;
  predicted_category_24h?: string | null;
  uncertainty_kt?: number | null;
  confidence?: number;
  model_version?: string;
  timestamp?: string;
  status?: string;
  reason?: string | null;
}

export interface RIPredictionBackend {
  probability_24h?: number;
  risk_level?: BackendRiskLevel;
  imd_probability?: number | null;
  era5_probability?: number | null;
  satellite_probability?: number | null;
  fusion_probability?: number | null;
  calibrated_probability?: number | null;
  explanation?: string | null;
  confidence?: number;
  model_version?: string;
  timestamp?: string;
  status?: string;
}

export interface RecurvaturePredictionBackend {
  probability?: number;
  expected_turning_window?: string | null;
  risk_level?: BackendRiskLevel;
  confidence?: number;
  model_version?: string;
  timestamp?: string;
}

export interface RainfallPredictionBackend {
  rainfall_3h?: unknown | null;
  rainfall_6h?: unknown | null;
  rainfall_12h?: unknown | null;
  rainfall_24h?: unknown | null;
  model_version?: string;
  timestamp?: string;
  confidence?: number;
  status?: string;
  explanation?: string;
}

export interface WindFieldPredictionBackend {
  wind_fields?: unknown[];
  model_version?: string;
  timestamp?: string;
  confidence?: number;
  status?: string;
  explanation?: string;
}

export interface FloodPredictionBackend {
  probability_grid?: unknown;
  risk_grid?: unknown;
  affected_area_km2?: number;
  high_risk_regions?: Array<Record<string, unknown>>;
  confidence?: number;
  model_version?: string;
  timestamp?: string;
  status?: string;
  reason?: string | null;
}

export interface LandslidePredictionBackend {
  probability_grid?: unknown;
  high_risk_regions?: Array<Record<string, unknown>>;
  confidence?: number;
  model_version?: string;
  timestamp?: string;
  status?: string;
  reason?: string | null;
}

export interface UnifiedForecastState {
  cyclone: CycloneStateBackend;
  genesis?: GenesisPredictionBackend | null;
  track?: TrackPredictionBackend | null;
  intensity?: IntensityPredictionBackend | null;
  rapid_intensification?: RIPredictionBackend | null;
  recurvature?: RecurvaturePredictionBackend | null;
  wind?: WindFieldPredictionBackend | null;
  rainfall?: RainfallPredictionBackend | null;
  flood?: FloodPredictionBackend | null;
  landslide?: LandslidePredictionBackend | null;
  uncertainty_summary?: {
    components?: Record<string, { risk_level?: BackendRiskLevel | string; score?: number }>;
    [key: string]: unknown;
  };
  explanations?: Record<string, unknown>;
  timestamp?: string;
  model_versions?: Record<string, string>;
  overall_hazard_severity?: BackendRiskLevel | string | null;
  affected_region?: Record<string, unknown> | null;
  confidence?: number;
  module_status?: Record<string, BackendExecutionStatus | string>;
  module_reasons?: Record<string, string>;
  assessed_hazards?: string[];
  unassessed_hazards?: string[];
}

export interface PipelineRunResult {
  request_id: string;
  run_id: string;
  generated_at: string;
  pipeline_status: "COMPLETED" | "PARTIAL" | "FAILED" | string;
  assessment: UnifiedForecastState | null;
  per_hazard_status: Record<string, BackendHazardStatus | string>;
  per_hazard_reasons: Record<string, string>;
  provider_sources: ProviderSource[];
  stage_latency_ms: Record<string, number>;
  total_latency_ms: number;
  warnings: string[];
}

export interface BackendHealth {
  status: "healthy" | "degraded" | string;
  provider_summary: Record<string, boolean>;
  runs_completed: number;
  last_health_audit?: number | null;
  health_audit_count: number;
}

export interface BackendModelEntry {
  name: string;
  version: string;
  model_type: string;
  checkpoint_path?: string;
  file_hash?: string;
  git_commit?: string | null;
  artifact_present: boolean;
  registered_at?: string;
}

export interface BackendModelsResponse {
  models: BackendModelEntry[];
}

export interface BackendDataSourcesResponse {
  sources: Record<string, {
    available: boolean;
    source_path?: string | null;
    dataset?: string | null;
  }>;
}

export interface PipelineEvent {
  kind?: "pipeline" | "assessment_snapshot" | string;
  event_id?: string;
  run_id?: string;
  stage?: string;
  status?: string;
  message?: string;
  data?: {
    run_id?: string;
    module?: string;
    status?: string;
    reason?: string | null;
    execution_time_ms?: number;
    total_latency_ms?: number;
    [key: string]: unknown;
  };
  pipeline_status?: string;
  per_hazard_status?: Record<string, string>;
  timestamp?: number | string;
}

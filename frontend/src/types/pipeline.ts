/** Typed views of the TOOFAN backend pipeline API responses. */

export type PipelineStatus = 'AVAILABLE' | 'DEGRADED' | 'NOT_AVAILABLE' | 'FAILED'

export interface CycloneState {
  storm_id: string
  basin: string
  timestamp: string
  latitude: number
  longitude: number
  max_wind_kt: number | null
  central_pressure_hpa: number | null
  category: string | null
  heading_deg: number | null
  translation_speed_kt: number | null
  wind_change_6h: number | null
  wind_change_12h: number | null
  wind_change_24h: number | null
  pressure_change_6h: number | null
  pressure_change_12h: number | null
  pressure_change_24h: number | null
  environmental_features?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface GenesisState {
  probability_24h: number
  probability_48h: number
  probability_72h: number
  threshold: number
  predicted_class: number
  model_name: string
  model_version: string
  mode: string
  artifact_hash?: string
  risk_level?: string
  confidence?: number
  calibrated?: boolean
  explanation?: string
  timestamp?: string
}

export interface TrackState {
  forecast_times: string[]
  latitudes: number[]
  longitudes: number[]
  position_error_estimates_km: number[]
  uncertainty_km: number[]
  confidence: number | null
  model_version: string
  timestamp: string
  status: string
  explanation?: string
  cone_polygons?: unknown
}

export interface RIState {
  probability_24h: number
  risk_level: string
  imd_probability?: number
  era5_probability?: number
  satellite_probability?: number
  calibrated_probability?: number
  explanation?: string
  confidence?: number
  model_version?: string
  status?: string
}

export interface AffectedRegion {
  center_lat: number
  center_lon: number
  radius_km: number
  hazard_zones: Record<string, unknown>
  track_bounds: {
    min_lat: number
    max_lat: number
    min_lon: number
    max_lon: number
  }
}

export interface UncertaintySummary {
  components: Record<string, { confidence: number; probability: number; risk_level: string }>
  overall_confidence: number
  min_confidence: number
  max_confidence: number
}

export interface AssessmentState {
  cyclone: CycloneState
  genesis: GenesisState
  track: TrackState
  rapid_intensification: RIState | null
  wind: unknown
  rainfall: unknown
  flood: unknown
  landslide: unknown
  intensity: unknown
  recurvature: unknown
  module_status: Record<string, string>
  module_reasons?: Record<string, string>
  model_versions: Record<string, string>
  overall_hazard_severity: string | null
  confidence: number | null
  affected_region: AffectedRegion
  assessed_hazards: string[]
  unassessed_hazards: string[]
  explanations: Record<string, string>
  uncertainty_summary: UncertaintySummary
  timestamp: string
}

export interface ProviderSource {
  name: string
  dataset: string
  source_path: string | null
  retrieved_at: string
  observation_timestamp: string | null
  is_stale: boolean
  latency_ms: number
  status: string
  warnings: string[]
  detail: string
}

export interface PipelineRunResult {
  request_id: string
  run_id: string
  generated_at: string
  pipeline_status: string
  per_hazard_status: Record<string, PipelineStatus>
  per_hazard_reasons: Record<string, string>
  provider_sources: ProviderSource[]
  warnings: string[]
  stage_latency_ms: Record<string, number>
  total_latency_ms?: number
  assessment: AssessmentState
}

/** One event on the shared SSE pipeline event bus. */
export interface PipelineEvent {
  kind: string
  run_id?: string
  request_id?: string
  stage: string
  status?: string
  message?: string
  data?: unknown
  timestamp: string
}

export interface RunRequest {
  storm_id: string
  basin: string
  reference_time: string
  mode?: string
}
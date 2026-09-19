// ============================================================
// TOOFAN data contracts
// These types define the shape of every backend API response &
// internal domain model. The service layer maps raw API payloads
// onto these types. UI components depend ONLY on these types,
// never on model file paths.
// ============================================================

export type ModelOperationalStatus =
  | "AVAILABLE"
  | "LIVE"
  | "BASELINE"
  | "DEGRADED"
  | "NOT_AVAILABLE"
  | "ERROR"
  | "MODEL_MISSING"
  | "RUNTIME_REQUIRED"
  | "DATA_REQUIRED"
  | "NOT_INTEGRATED"
  | "UNAVAILABLE";

export type DataSourceStatus =
  | "CONNECTED"
  | "STALE"
  | "MISSING"
  | "ERROR"
  | "AVAILABLE"
  | "DEGRADED"
  | "NOT_AVAILABLE";

export type HazardSeverity = "NONE" | "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "EXTREME";

export type AlertSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

export type BasinName =
  | "Bay of Bengal"
  | "Arabian Sea"
  | "North Indian Ocean"
  | "South Indian Ocean"
  | "Western Pacific"
  | "Eastern Pacific"
  | "North Atlantic"
  | "South Pacific";

// --- Predicate / status blocks -------------------------------
export interface PredictionStatus {
  status: ModelOperationalStatus;
  message?: string;
  timestamp?: string;
}

export interface DataSourceInfo {
  id: string;
  name: string;
  category: string;
  status: DataSourceStatus;
  lastUpdate?: string;
  coverage?: string;
  description?: string;
}

// --- Cyclone ------------------------------------------------
export interface CycloneMovement {
  direction?: string; // compass point, e.g. "NW"
  bearingDeg?: number;
  speedKph?: number;
  speedKt?: number;
}

export interface CycloneState {
  id: string;
  name?: string;
  basin: BasinName;
  timestamp: string;
  latitude: number;
  longitude: number;
  windKt?: number;
  mslpHpa?: number;
  rmwKm?: number;
  category?: string;
  movement?: CycloneMovement;
  status?: PredictionStatus;
}

export interface TrackPoint {
  timestamp: string;
  horizonHours: number; // 0 = current position
  latitude: number;
  longitude: number;
  windKt?: number;
  uncertaintyKm?: number; // sigma from model
  isForecast: boolean;
}

export interface TrajectoryForecast {
  model: string;
  modelVersion: string;
  status: PredictionStatus;
  forecastHorizonHours: number;
  predictionSteps: number;
  initialized: string;
  points: TrackPoint[];
  observedVsPredicted?: ObservedVsPredicted;
}

export interface ObservedVsPredicted {
  available: boolean;
  observedLabel: string;
  errorKm?: number;
  history?: ObservedPredictedPair[];
}

export interface ObservedPredictedPair {
  horizonHours: number;
  observedLat?: number;
  observedLon?: number;
  predictedLat: number;
  predictedLon: number;
  errorKm?: number;
}

// --- Intensity ---------------------------------------------
export interface IntensityReport {
  current: {
    windKt?: number;
    mslpHpa?: number;
    rmwKm?: number;
    category?: string;
    observed: boolean;
  };
  status: PredictionStatus;
  forecastPoints?: IntensityPoint[];
}

export interface IntensityPoint {
  horizonHours: number;
  windKt?: number;
  mslpHpa?: number;
  rmwKm?: number;
}

// --- Rapid Intensification ---------------------------------
export interface RIModelOutput {
  modelId: string;
  name: string;
  status: ModelOperationalStatus;
  statusNote?: string;
  probability?: number; // 0..1
  inputType: string;
  featureCount?: number;
  lastRun?: string;
  framework?: string;
  risk?: HazardSeverity;
}

export interface RIReport {
  models: RIModelOutput[];
  leadProbability?: number; // reference probability from operational model
  fusionProbability?: number; // weighted ensemble total predictability 0..1
  ensembleWeights?: Record<string, number>; // weights per branch modelId
  status: PredictionStatus;
  featureImportance?: FeatureImportance[];
}

export interface FeatureImportance {
  feature: string;
  importance: number; // normalized 0..1
  source: ModelOperationalStatus;
  category?: string;
}

// --- Rainfall ----------------------------------------------
export interface RainfallReport {
  status: PredictionStatus;
  modelName: string;
  isBaseline: boolean;
  baselineNotice: string;
  accepted: boolean;
  accumulations?: RainfallAccumulation[];
  districtRanking?: DistrictRainfall[];
}

export interface RainfallAccumulation {
  window: string; // "0-6h" etc
  label: string;
  regions: RadialRain[];
}

export interface RadialRain {
  radiusKm: number;
  expectedMm?: number;
  risk: HazardSeverity;
}

export interface DistrictRainfall {
  district: string;
  state: string;
  expectedMm?: number;
  risk: HazardSeverity;
}

// --- Wind --------------------------------------------------
export interface WindReport {
  status: PredictionStatus;
  requiresRuntime: "TensorFlow";
  modelName: string;
  message: string;
  zones?: WindZone[];
}

export interface WindZone {
  name: string;
  maxKt?: number;
  radiusKm?: number;
  risk?: HazardSeverity;
}

// --- Flood ------------------------------------------------
export interface FloodReport {
  status: PredictionStatus;
  modelName: string;
  modelType: string;
  featureCount?: number;
  predictionTimestamp?: string;
  accepted: boolean;
  districts?: FloodDistrict[];
  overallRisk?: HazardSeverity;
}

export interface FloodDistrict {
  district: string;
  state: string;
  risk: HazardSeverity;
  floodProbability?: number;
}

// --- Landslide --------------------------------------------
export interface LandslideReport {
  modelStatus: PredictionStatus;
  staticSusceptibility?: StaticSusceptibility;
}

export interface StaticSusceptibility {
  available: boolean;
  description: string;
  classification: "STATIC" | "DYNAMIC";
  regions?: SusceptibilityRegion[];
}

export interface SusceptibilityRegion {
  name: string;
  level: HazardSeverity;
  lat?: number;
  lon?: number;
}

// --- Recurvature ------------------------------------------
// Track geometry primitives for the recurvature visualization.
// These are GeoJSON-compatible and kept deliberately separate so the
// actual model forecast is never overwritten by a reference scenario.
export interface RecurvatureTrackPoint {
  lat: number;
  lon: number;
  timestamp?: string;
  windKt?: number;
  mslpHpa?: number;
  uncertaintyKm?: number;
}

export interface RecurvatureTrackData {
  historical?: RecurvatureTrackPoint[];
  forecast?: RecurvatureTrackPoint[];
}

export interface RecurvatureModelMeta {
  name?: string;
  framework?: string;
  featureCount?: number;
  target?: string;
  version?: string;
}

export type RecurvaturePrediction = {
  probability?: number; // recurvature probability 0..1
  risk?: HazardSeverity;
  headingChangeDeg?: number;
  predictedHeadingDeg?: number;
};

export interface RecurvatureReport {
  status: PredictionStatus;
  currentHeadingDeg?: number;
  predictedHeadingDeg?: number;
  headingChangeDeg?: number;
  probability?: number; // recurvature probability 0..1
  risk?: HazardSeverity;
  /** Structured prediction payload that the UI reads from when the model is available. */
  prediction?: RecurvaturePrediction;
  /** Model metadata shown in the "Model Information" panel. */
  model?: RecurvatureModelMeta;
  /** Feature-level attribution (normalized 0..1). Only show if supplied. */
  featureImportance?: FeatureImportance[];
  /** Observed + forecast cyclone track used on the map. */
  track?: RecurvatureTrackData;
  currentEquiv?: { name?: string; timestamp?: string };
}

// --- Genesis ----------------------------------------------
export interface GenesisSubModel {
  modelId: string;
  name: string;
  role: "PRIMARY" | "ENSEMBLE";
  status: ModelOperationalStatus;
  probability24h?: number;
  probability48h?: number;
  probability72h?: number;
  weight?: number;
  message?: string;
}

export interface GenesisReport {
  status: PredictionStatus;
  subModels: GenesisSubModel[];
  riskZones?: GenesisZone[];
  /** Decision threshold for the binary genesis class (e.g. 0.24). */
  threshold?: number;
  /** Whether a calibration artifact was applied to the raw probabilities. */
  calibrated?: boolean;
  /** Scientific status reported by the provenance layer (e.g. "prototype"). */
  scientificStatus?: string;
}

export interface GenesisZone {
  id: string;
  lat: number;
  lon: number;
  probability24h?: number;
  risk: HazardSeverity;
  label?: string;
}

// --- Risk / Hazard overview -------------------------------
export interface HazardItem {
  id: string;
  label: string;
  status: ModelOperationalStatus;
  model?: string;
  risk?: HazardSeverity;
  confidence?: string;
  data?: string;
  lastUpdate?: string;
  /** Contribution score (0..100) toward the composite risk, when the backend reports it. */
  score?: number;
}

export interface OverallRisk {
  available: boolean;
  score?: number; // 0..100
  severity?: HazardSeverity;
  reason?: string;
  engineName: string;
}

// --- Model health -----------------------------------------
export interface ModelInfo {
  id: string;
  name: string;
  slug: string;
  artifact?: string;
  framework: string;
  version?: string;
  load: ModelOperationalStatus;
  predict: ModelOperationalStatus;
  adapter: ModelOperationalStatus;
  orchestrator: ModelOperationalStatus;
  status: ModelOperationalStatus;
  category: string;
  inputFeatures?: number;
  output?: string;
  trainingInfo?: string;
  validation?: string[] | string;
  lastInference?: string;
  inferenceTimeMs?: number;
  error?: string;
  provenance?: string;
  hash?: string;
  inputFeatureNames?: string[];
}

// --- Performance ------------------------------------------
export interface PerformanceMetric {
  metric: string;
  value?: number;
  model?: string;
  dataset?: string;
}

export interface ModelPerformance {
  modelId: string;
  name: string;
  available: boolean;
  metrics: PerformanceMetric[];
}

// --- Historical events ------------------------------------
export interface HistoricalCyclone {
  id: string;
  name: string;
  year: number;
  basin: BasinName;
  peakIntensityKt?: number;
  category?: string;
  landfall?: string;
  availableData: string[];
}

// --- Alerts & notifications -------------------------------
export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message?: string;
  source: string;
  timestamp: string;
  region?: string;
  /** Likelihood / confidence (0..100) associated with the alert, if available. */
  percentage?: number;
  /** New target coordinates the alert refers to (e.g. updated track endpoint). */
  latitude?: number;
  longitude?: number;
}

// --- Event / realtime -------------------------------------
export type ToofanEventType =
  | "CYCLONE_UPDATED"
  | "TRACK_UPDATED"
  | "INTENSITY_UPDATED"
  | "HAZARD_UPDATED"
  | "MODEL_STATUS_CHANGED"
  | "ALERT_CREATED";

export interface ToofanEvent {
  type: ToofanEventType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

// --- System state -----------------------------------------
export interface SystemState {
  activeCyclone?: CycloneState;
  systemOperational: boolean;
  partialOperational: boolean;
  lastUpdated: string;
  dataStale: boolean;
  demoMode: boolean;
  overallRisk: OverallRisk;
}

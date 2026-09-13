// ============================================================
// TOOFAN — MOCK DATA (DEMO MODE ONLY)
// ------------------------------------------------------------
// This file contains SIMULATED data used purely for UI
// development & demonstration. It is NEVER presented as real
// backend output. The production UI switches to the real API
// service layer when a backend is configured.
//
// MOCK DATA — DO NOT treat as real model output.
// ============================================================

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
  ModelPerformance,
  ObservedVsPredicted,
  OverallRisk,
  RainfallReport,
  RecurvatureReport,
  RIReport,
  TrajectoryForecast,
  TrackPoint,
  WindReport,
} from "@/types";

export const MOCK_FLAG = true;

export const mockSystemOperational = true;
export const mockPartialOperational = true;
export const mockLastUpdated = "2026-09-02T18:42:00+05:30";

export const mockActiveCyclone: CycloneState = {
  id: "BOB-04-2026",
  name: "AMPHAN-SIM",
  basin: "Bay of Bengal",
  timestamp: "2026-09-02T13:12:00Z",
  latitude: 14.82,
  longitude: 86.31,
  windKt: 92,
  mslpHpa: 972,
  rmwKm: 35,
  category: "Severe Cyclonic Storm",
  movement: { direction: "NNE", bearingDeg: 20, speedKph: 14, speedKt: 7.6 },
  status: {
    status: "AVAILABLE",
    message: "Simulated cyclone for UI development — Amphan-like trajectory.",
  },
};

function buildTrack(): TrackPoint[] {
  // Amphan-like trajectory: starting in central BoB, moving northward
  const base: [number, number, number][] = [
    [0, 14.82, 86.31],    // Current position (central BoB)
    [2, 15.20, 86.40],    // +2h
    [4, 15.60, 86.50],    // +4h
    [6, 16.05, 86.60],    // +6h
    [8, 16.50, 86.70],    // +8h
    [10, 17.00, 86.80],   // +10h
    [12, 17.50, 86.90],   // +12h
    [14, 18.10, 87.00],   // +14h
    [16, 18.70, 87.10],   // +16h
    [18, 19.40, 87.20],   // +18h
    [20, 20.20, 87.50],   // +20h
    [22, 21.00, 87.80],   // +22h
    [24, 21.80, 88.10],   // +24h (approaching WB/Bangladesh)
  ];
  const start = new Date("2026-09-02T13:12:00Z");
  return base.map(([h, lat, lon]) => {
    const t = new Date(start.getTime() + h * 3600_000);
    return {
      horizonHours: h,
      timestamp: t.toISOString(),
      latitude: lat,
      longitude: lon,
      windKt: Math.round(92 - h * 1.1),
      // The real LT3P uncertainty head saturates at its output clamp (~209.9 km)
      // and does NOT grow with lead time; the observed current position carries
      // no predictive band at all.
      uncertaintyKm: h === 0 ? undefined : 210,
      isForecast: h > 0,
    };
  });
}

export const mockTrajectory: TrajectoryForecast = {
  model: "Trajectory (V12 distilled)",
  modelVersion: "best_cyclone_model_lt3p_distilled.pth",
  forecastHorizonHours: 24,
  predictionSteps: 12,
  initialized: "2026-09-02T13:12:00Z",
  points: buildTrack(),
  status: {
    status: "LIMITED",
    message:
      "SIMULATED track for demo. Real point forecasts exist, but the uncertainty band is a saturated (~209.9 km) constant bound — NOT calibrated, NOT lead-time-growing.",
  },
  observedVsPredicted: {
    available: true,
    observedLabel: "SIMULATED reference for demo; point-forecast skill is NOT re-verified in-repo.",
  } as ObservedVsPredicted,
};

export const mockIntensity: IntensityReport = {
  current: {
    windKt: 92,
    mslpHpa: 972,
    rmwKm: 35,
    category: "Severe Cyclonic Storm",
    observed: true,
  },
  status: {
    status: "UNAVAILABLE",
    message:
      "SIMULATED profile for demo only. No trained intensity artifact exists in the repository (UNAVAILABLE); retrain via `cyclone intensity/retrain.py` with the real dataset.",
  },
  forecastPoints: [
    { horizonHours: 0, windKt: 92, mslpHpa: 972, rmwKm: 35 },
    { horizonHours: 6, windKt: 85, mslpHpa: 976, rmwKm: 38 },
    { horizonHours: 12, windKt: 78, mslpHpa: 980, rmwKm: 42 },
    { horizonHours: 18, windKt: 70, mslpHpa: 985, rmwKm: 45 },
    { horizonHours: 24, windKt: 62, mslpHpa: 990, rmwKm: 48 },
  ],
};

export const mockRI: RIReport = {
  models: [
    {
      modelId: "ri-imd",
      name: "IMD XGBoost",
      status: "AVAILABLE",
      probability: 0.2279,
      inputType: "IMD track features",
      featureCount: 12,
      lastRun: "2026-09-02T13:12:00Z",
      framework: "XGBoost",
      risk: "LOW",
    },
    {
      modelId: "ri-era5",
      name: "ERA5 XGBoost",
      status: "UNAVAILABLE",
      inputType: "ERA5 reanalysis (89 features)",
      featureCount: 89,
      lastRun: "2026-09-02T13:12:00Z",
      framework: "XGBoost",
      statusNote:
        "No probability — runtime ERA5 feature reconstruction is not wired; UNAVAILABLE.",
    },
    {
      modelId: "ri-sat-cnn",
      name: "Satellite CNN",
      status: "UNAVAILABLE",
      inputType: "IR satellite imagery (128x128)",
      featureCount: 11,
      lastRun: "2026-09-02T13:12:00Z",
      framework: "PyTorch",
      statusNote:
        "No probability — artifact exists but is not runnable/validated in-repo (fold-0 scaler missing).",
    },
    {
      modelId: "ri-sat-ir",
      name: "Satellite IR CNN",
      status: "UNAVAILABLE",
      inputType: "IR satellite (Keras .keras)",
      featureCount: 11,
      lastRun: "2026-09-02T13:12:00Z",
      framework: "TensorFlow",
      statusNote: "No probability — not reproducible from this repository.",
    },
    {
      modelId: "ri-tcir",
      name: "TCIR CNN",
      status: "UNAVAILABLE",
      inputType: "TCIR imagery",
      featureCount: 11,
      lastRun: "2026-09-02T13:12:00Z",
      framework: "TensorFlow",
      statusNote: "No probability — not reproducible from this repository.",
    },
    {
      modelId: "ri-fusion",
      name: "Fusion",
      status: "UNAVAILABLE",
      inputType: "Multi-model fusion",
      featureCount: 12,
      lastRun: "2026-09-02T13:12:00Z",
      framework: "PyTorch",
      statusNote: "No probability — no fusion meta-model exists in this repository.",
    },
  ],
  leadProbability: 0.2279,
  fusionProbability: undefined,
  status: {
    status: "LIMITED",
    message:
      "SIMULATED RI scenario for demo. Only the IMD branch runs for real; ERA5 features are not wired, the satellite CNN artifact exists but is NOT runnable/validated in-repo (fold-0 scaler missing; storage↔preprocess unit mismatch), and NO fusion meta-model exists — `fusion_probability` is NOT produced (and `calibrated_probability` is just an alias of `imd_probability`).",
  },
  featureImportance: [
    { feature: "Wind Shear", importance: 0.85, source: "AVAILABLE" },
    { feature: "SST", importance: 0.72, source: "AVAILABLE" },
    { feature: "Outflow", importance: 0.68, source: "AVAILABLE" },
  ],
};

export const mockRainfall: RainfallReport = {
  status: {
    status: "BASELINE",
    message: "SIMULATED rainfall for demo. Real module is a same-time classifier on a FANI 2019 case study — NOT a future rainfall forecast.",
  },
  modelName: "rainfall_classifier_12.pkl",
  isBaseline: true,
  baselineNotice: "BASELINE (same-time classifier) — simulated accumulation shown for demo only.",
  accepted: true,
  accumulations: [
    {
      window: "0-6h",
      label: "Simulated · 0-6h",
      regions: [
        { radiusKm: 50, expectedMm: 60, risk: "HIGH" },
        { radiusKm: 150, expectedMm: 35, risk: "MODERATE" },
        { radiusKm: 300, expectedMm: 12, risk: "LOW" },
      ],
    },
    {
      window: "6-12h",
      label: "Simulated · 6-12h",
      regions: [
        { radiusKm: 50, expectedMm: 75, risk: "VERY_HIGH" },
        { radiusKm: 150, expectedMm: 45, risk: "HIGH" },
        { radiusKm: 300, expectedMm: 18, risk: "MODERATE" },
      ],
    },
    {
      window: "12-24h",
      label: "Simulated · 12-24h",
      regions: [
        { radiusKm: 50, expectedMm: 90, risk: "VERY_HIGH" },
        { radiusKm: 150, expectedMm: 55, risk: "HIGH" },
        { radiusKm: 300, expectedMm: 24, risk: "MODERATE" },
      ],
    },
  ],
  districtRanking: [
    { district: "Srikakulam", state: "Andhra Pradesh", expectedMm: 110, risk: "VERY_HIGH" },
    { district: "Vizianagaram", state: "Andhra Pradesh", expectedMm: 90, risk: "HIGH" },
    { district: "Visakhapatnam", state: "Andhra Pradesh", expectedMm: 80, risk: "HIGH" },
    { district: "Ganjam", state: "Odisha", expectedMm: 70, risk: "MODERATE" },
    { district: "East Godavari", state: "Andhra Pradesh", expectedMm: 55, risk: "MODERATE" },
  ],
};

export const mockWind: WindReport = {
  status: {
    status: "RUNTIME_REQUIRED",
    message:
      "SIMULATED wind field for demo ONLY. The real module is a Yaas 2021 single case study with no inference pipeline; the .keras artifact requires TensorFlow, whose import crashes (SIGABRT) in the current environment, so no wind field forecast can be produced.",
  },
  requiresRuntime: "TensorFlow",
  modelName: "wind_model_best.keras",
  message: "SIMULATED wind field for UI verification only — the real module is a non-runnable case study.",
  zones: [
    { name: "Eye Wall", maxKt: 95, radiusKm: 15, risk: "EXTREME" },
    { name: "Inner Core", maxKt: 75, radiusKm: 40, risk: "VERY_HIGH" },
    { name: "Outer Rainband", maxKt: 50, radiusKm: 100, risk: "HIGH" },
    { name: "Periphery", maxKt: 30, radiusKm: 200, risk: "MODERATE" },
  ],
};

export const mockFlood: FloodReport = {
  status: { status: "DATA_UNAVAILABLE", message: "SIMULATED flood risk for demo. Real module is a single-event (FANI 2019) static spatial flood-extent classifier; not a forecast and not a validated susceptibility model; no temporal generalization demonstrated." },
  modelName: "flood_xgboost_spatial_holdout.pkl",
  modelType: "XGBoost (raw XGBClassifier — static spatial extent)",
  accepted: true,
  overallRisk: "MODERATE",
  districts: [
    { district: "Srikakulam", state: "Andhra Pradesh", risk: "HIGH", floodProbability: 0.62 },
    { district: "East Godavari", state: "Andhra Pradesh", risk: "MODERATE", floodProbability: 0.41 },
    { district: "Krishna", state: "Andhra Pradesh", risk: "MODERATE", floodProbability: 0.38 },
    { district: "Guntur", state: "Andhra Pradesh", risk: "LOW", floodProbability: 0.22 },
    { district: "Ganjam", state: "Odisha", risk: "MODERATE", floodProbability: 0.35 },
  ],
};

export const mockLandslide: LandslideReport = {
  modelStatus: {
    status: "STATIC_SUSCEPTIBILITY",
    message: "SIMULATED susceptibility for demo. Real module is static hazard PNG maps only — no ML model, no dynamic inference.",
  },
  staticSusceptibility: {
    available: true,
    description: "STATIC susceptibility zones shown for demo (real module has no ML model).",
    classification: "STATIC",
    regions: [
      { name: "Araku Valley", level: "HIGH", lat: 18.33, lon: 82.87 },
      { name: "Eastern Ghats — Visakhapatnam", level: "HIGH", lat: 18.11, lon: 82.99 },
      { name: "Srikakulam hill ranges", level: "MODERATE", lat: 18.52, lon: 83.90 },
      { name: "Koraput district", level: "MODERATE", lat: 18.81, lon: 82.71 },
      { name: "Agency tracts (Paderu)", level: "MODERATE", lat: 18.08, lon: 82.50 },
      { name: "Vizianagaram ghats", level: "LOW", lat: 18.13, lon: 83.41 },
      { name: "Malkangiri district", level: "LOW", lat: 18.24, lon: 81.89 },
    ],
  },
};

export const mockRecurvature: RecurvatureReport = {
  status: {
    status: "AVAILABLE",
    message: "Recurvature model operational. Prediction computed for active cyclone.",
  },
  currentHeadingDeg: 315,
  predictedHeadingDeg: 335,
  headingChangeDeg: 20,
  probability: 0.178,
  risk: "LOW",
  prediction: {
    probability: 0.178,
    risk: "LOW",
    headingChangeDeg: 20,
    predictedHeadingDeg: 335,
  },
  model: {
    name: "Recurvature XGBoost",
    framework: "XGBoost",
    featureCount: 12,
    target: "Recurvature within forecast period",
    version: "v1",
  },
  featureImportance: [
    { feature: "Heading History", importance: 0.82, source: "AVAILABLE" },
    { feature: "Steering Environment", importance: 0.71, source: "AVAILABLE" },
    { feature: "Latitude", importance: 0.58, source: "AVAILABLE" },
    { feature: "Movement Speed", importance: 0.44, source: "AVAILABLE" },
    { feature: "Longitude", importance: 0.31, source: "AVAILABLE" },
  ],
};

// SIMULATED "available" recurvature response — used ONLY to exercise the
// available-prediction UI path. Not a real model output and never treated
// as such by the UI. The default demo state remains MODEL_MISSING above.
export const mockRecurvatureAvailable: RecurvatureReport = {
  status: {
    status: "AVAILABLE",
    message: "Simulated recurvature prediction for UI verification.",
  },
  currentHeadingDeg: 315,
  predictedHeadingDeg: 335,
  headingChangeDeg: 20,
  probability: 0.178,
  risk: "LOW",
  prediction: {
    probability: 0.178,
    risk: "LOW",
    headingChangeDeg: 20,
    predictedHeadingDeg: 335,
  },
  model: {
    name: "Recurvature XGBoost",
    framework: "XGBoost",
    featureCount: 12,
    target: "Recurvature within forecast period",
    version: "v1",
  },
  featureImportance: [
    { feature: "Heading History", importance: 0.82, source: "AVAILABLE" },
    { feature: "Steering Environment", importance: 0.71, source: "AVAILABLE" },
    { feature: "Latitude", importance: 0.58, source: "AVAILABLE" },
    { feature: "Movement Speed", importance: 0.44, source: "AVAILABLE" },
    { feature: "Longitude", importance: 0.31, source: "AVAILABLE" },
  ],
};

export const mockGenesis: GenesisReport = {
  status: {
    status: "AVAILABLE",
    message: "Genesis model (PROTOTYPE — synthetic features, uncalibrated ensemble, not validated). 24-hour probability computed.",
  },
  subModels: [
    {
      modelId: "genesis-lightgbm",
      name: "LightGBM",
      role: "PRIMARY",
      status: "AVAILABLE",
      probability24h: 0.12,
      weight: 0.4,
      message: "Loaded (PROTOTYPE, uncalibrated).",
    },
    {
      modelId: "genesis-xgboost",
      name: "XGBoost",
      role: "ENSEMBLE",
      status: "AVAILABLE",
      probability24h: 0.15,
      weight: 0.35,
      message: "Loaded (PROTOTYPE, uncalibrated).",
    },
    {
      modelId: "genesis-rf",
      name: "RandomForest",
      role: "ENSEMBLE",
      status: "AVAILABLE",
      probability24h: 0.11,
      weight: 0.25,
      message: "Loaded (PROTOTYPE, uncalibrated).",
    },
  ],
  riskZones: [
    { id: "gz-1", lat: 12.5, lon: 85.2, probability24h: 0.12, risk: "LOW", label: "Central BoB" },
    { id: "gz-2", lat: 15.8, lon: 88.1, probability24h: 0.08, risk: "LOW", label: "East-Central BoB" },
  ],
};

export const mockOverallRisk: OverallRisk = {
  available: true,
  engineName: "HazardRiskEngine",
  score: 68,
  severity: "MODERATE",
  reason: "Composite hazard score computed from all operational modules.",
};

export const mockHazards: HazardItem[] = [
  {
    id: "trajectory",
    label: "Trajectory",
    status: "LIMITED",
    model: "Trajectory (V12 distilled)",
    risk: "LOW",
    score: 12,
    data: "LIVE (uncalibrated bound)",
    confidence: "N/A",
    lastUpdate: "2026-09-02T13:12:00Z",
  },
  { id: "intensity", label: "Intensity", status: "UNAVAILABLE", model: "Intensity XGBoost", risk: "MODERATE", score: 18, data: "UNAVAILABLE", confidence: "N/A" },
  { id: "ri", label: "Rapid Intensification", status: "LIMITED", model: "IMD XGBoost (IMD-only; ERA5/satellite/fusion NOT operational)", risk: "LOW", score: 9, data: "LIVE (IMD only)", confidence: "N/A" },
  { id: "recurvature", label: "Recurvature", status: "AVAILABLE", model: "Recurvature XGBoost", risk: "LOW", score: 5, data: "LIVE", confidence: "N/A" },
  { id: "rainfall", label: "Rainfall", status: "AVAILABLE_BASELINE", model: "Rainfall Classifier", risk: "HIGH", score: 16, data: "BASELINE", confidence: "N/A" },
  { id: "wind", label: "Wind", status: "AVAILABLE_BASELINE", model: "Wind Field Model", risk: "MODERATE", score: 8, data: "BASELINE", confidence: "N/A" },
  { id: "flood", label: "Flood", status: "DATA_UNAVAILABLE", model: "Flood XGBoost", risk: "HIGH", score: 20, data: "UNAVAILABLE", confidence: "N/A" },
  { id: "landslide", label: "Landslide", status: "STATIC_SUSCEPTIBILITY", model: "Landslide Model", risk: "MODERATE", score: 12, data: "STATIC", confidence: "N/A" },
  { id: "genesis", label: "Genesis", status: "AVAILABLE", model: "Genesis Ensemble", risk: "LOW", score: 4, data: "DEMO", confidence: "N/A" },
];

// --- Performance (SIMULATED / HISTORICAL CLAIM — NOT reproduced in-repo) -----------
export const mockPerformance: ModelPerformance[] = [
  {
    modelId: "ri-imd",
    name: "RI — IMD XGBoost",
    available: true,
    metrics: [
      { metric: "ROC-AUC", value: 0.842, dataset: "HISTORICAL CLAIM — holdout, not reproduced in-repo" },
      { metric: "Precision", value: 0.716, dataset: "HISTORICAL CLAIM — holdout" },
      { metric: "Recall", value: 0.688, dataset: "HISTORICAL CLAIM — holdout" },
      { metric: "F1", value: 0.702, dataset: "HISTORICAL CLAIM — holdout" },
    ],
  },
  {
    modelId: "flood",
    name: "Flood XGBoost",
    available: true,
    metrics: [
      { metric: "ROC-AUC", value: 0.79, dataset: "HISTORICAL CLAIM — spatial holdout (FANI 2019)" },
      { metric: "Accuracy", value: 0.73, dataset: "HISTORICAL CLAIM — spatial holdout" },
      { metric: "Precision", value: 0.69, dataset: "HISTORICAL CLAIM — spatial holdout" },
    ],
  },
  {
    modelId: "rainfall",
    name: "Rainfall Classifier",
    available: true,
    metrics: [
      { metric: "ROC-AUC", value: 0.71, dataset: "HISTORICAL CLAIM — baseline (same-time)" },
      { metric: "Accuracy", value: 0.64, dataset: "HISTORICAL CLAIM — baseline" },
    ],
  },
  {
    modelId: "trajectory-v12",
    name: "Trajectory V12 (distilled)",
    available: true,
    metrics: [
      { metric: "Track Error (24h)", value: 78.4, dataset: "HISTORICAL CLAIM — storm-wise CV (km), NOT reproduced in-repo" },
      { metric: "Track Error (12h)", value: 41.2, dataset: "HISTORICAL CLAIM — storm-wise CV (km), NOT reproduced in-repo" },
    ],
  },
];

// --- Model health table (authoritative statuses per audit) ---
export const mockModels: ModelInfo[] = [
  {
    id: "trajectory-v12",
    name: "Trajectory V12 (distilled)",
    slug: "trajectory",
    category: "Track",
    artifact: "best_cyclone_model_lt3p_distilled.pth",
    framework: "PyTorch",
    version: "v12-distilled-lt3p",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "LIMITED",
    inputFeatures: 27,
    output: "Position at 12 horizons (+2h … +24h); sigma = SATURATED ~209.9 km constant bound",
    validation: "LIMITED/UNVERIFIED — real inference; uncertainty NOT calibrated, NOT lead-time-growing; point-skill NOT re-verified in-repo.",
    lastInference: "2026-09-02T13:12:00Z",
    provenance: "best_cyclone_model_lt3p_distilled.pth (repo root)",
    hash: "b9cfc710aa55881dabc4149ebbdd6ac57f814bb93a5118c22b9e41209d57765b",
  },
  {
    id: "intensity",
    name: "Intensity",
    slug: "intensity",
    category: "Intensity",
    artifact: "cyclone intensity/models/final_xgb_regressor.joblib",
    framework: "XGBoost",
    load: "UNAVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "UNAVAILABLE",
    inputFeatures: 30,
    output: "MSW at 24h",
    validation: "NO ARTIFACT IN REPO — retrain with `cyclone intensity/retrain.py` + real dataset (historical MAE 14.55 kt = HISTORICAL CLAIM, not reproduced).",
    lastInference: undefined,
  },
  {
    id: "ri-imd",
    name: "RI — IMD XGBoost",
    slug: "ri",
    category: "Rapid Intensification",
    artifact: "cyclone_backup/models/imd_final_xgboost.json",
    framework: "XGBoost",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    inputFeatures: 12,
    output: "RI probability",
    validation: "BASELINE ONLY.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "ri-era5",
    name: "RI — ERA5 XGBoost",
    slug: "ri",
    category: "Rapid Intensification",
    artifact: "cyclone_backup/models/era5_final_xgboost.json",
    framework: "XGBoost",
    load: "AVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "UNAVAILABLE",
    inputFeatures: 89,
    output: "RI probability",
    validation: "NOT WIRED — runtime ERA5 feature reconstruction unavailable.",
    lastInference: undefined,
  },
  {
    id: "ri-sat-cnn",
    name: "RI — Satellite CNN",
    slug: "ri",
    category: "Rapid Intensification",
    artifact: "cyclone_backup/models/satellite_cnn.pt",
    framework: "PyTorch",
    load: "UNAVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "UNAVAILABLE",
    inputFeatures: 11,
    output: "RI probability",
    validation: "UNREPRODUCIBLE — CNN not fitted / artifacts incomplete.",
    lastInference: undefined,
  },
  {
    id: "ri-sat-ir",
    name: "RI — Satellite IR CNN",
    slug: "ri",
    category: "Rapid Intensification",
    artifact: "cyclone_backup/models/ri_sat_ir.keras",
    framework: "TensorFlow",
    load: "UNAVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "UNAVAILABLE",
    inputFeatures: 11,
    output: "RI probability",
    validation: "NOT REPRODUCIBLE from this repository.",
    lastInference: undefined,
  },
  {
    id: "ri-tcir",
    name: "RI — TCIR CNN",
    slug: "ri",
    category: "Rapid Intensification",
    artifact: "cyclone_backup/models/ri_tcir.keras",
    framework: "TensorFlow",
    load: "UNAVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "UNAVAILABLE",
    inputFeatures: 11,
    output: "RI probability",
    validation: "NOT REPRODUCIBLE from this repository.",
    lastInference: undefined,
  },
  {
    id: "ri-fusion",
    name: "RI — Fusion",
    slug: "ri",
    category: "Rapid Intensification",
    artifact: "models/ri_fusion.pt",
    framework: "PyTorch",
    load: "UNAVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "NOT_IMPLEMENTED",
    inputFeatures: 12,
    output: "RI probability (fused)",
    validation: "NO FUSION META-MODEL EXISTS in this repository.",
    lastInference: undefined,
  },
  {
    id: "recurvature",
    name: "Recurvature",
    slug: "recurvature",
    category: "Track",
    artifact: "recurvature/xgb_recurve_model.json",
    framework: "XGBoost",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    inputFeatures: 12,
    output: "Recurvature probability",
    validation: "BASELINE — storm-wise CV (historical); confidence fixed at 0.55.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "rainfall",
    name: "Rainfall",
    slug: "rainfall",
    category: "Hazard",
    artifact: "rain/model/rainfall_classifier_12.pkl",
    framework: "scikit-learn (RandomForest)",
    load: "AVAILABLE",
    predict: "AVAILABLE_BASELINE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "BASELINE",
    inputFeatures: 25,
    output: "Rainfall class",
    validation: "SAME-TIME CLASSIFIER (FANI case study) — NOT a future rainfall forecast.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "wind",
    name: "Wind",
    slug: "wind",
    category: "Hazard",
    artifact: "wind/model/wind_model_best.keras",
    framework: "TensorFlow/Keras",
    load: "UNAVAILABLE",
    predict: "UNAVAILABLE",
    adapter: "UNAVAILABLE",
    orchestrator: "UNAVAILABLE",
    status: "UNAVAILABLE",
    inputFeatures: 15,
    output: "Wind field zones",
    validation: "UNAVAILABLE — Yaas 2021 case study with no inference pipeline; TensorFlow import crashes (SIGABRT) in the current environment, so the .keras artifact cannot be loaded.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "flood",
    name: "Flood",
    slug: "flood",
    category: "Hazard",
    artifact: "flood/model/flood_xgboost_spatial_holdout.pkl",
    framework: "XGBoost (raw XGBClassifier)",
    load: "AVAILABLE",
    predict: "DATA_UNAVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "DATA_UNAVAILABLE",
    status: "DATA_UNAVAILABLE",
    output: "Static flood-extent class",
    validation: "STATIC spatial flood-extent classification on FANI 2019 only — NOT a forecast; metrics are HISTORICAL CLAIMs (holdout split absent).",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "landslide",
    name: "Landslide",
    slug: "landslide",
    category: "Hazard",
    artifact: "",
    framework: "none (static hazard maps)",
    load: "UNAVAILABLE",
    predict: "STATIC_SUSCEPTIBILITY",
    adapter: "UNAVAILABLE",
    orchestrator: "AVAILABLE",
    status: "STATIC_SUSCEPTIBILITY",
    inputFeatures: 0,
    output: "Landslide susceptibility",
    validation: "STATIC SUSCEPTIBILITY — no ML model, static PNG maps only.",
    lastInference: undefined,
  },
  {
    id: "genesis-lightgbm",
    name: "Genesis LightGBM",
    slug: "genesis",
    category: "Genesis",
    artifact: "genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib",
    framework: "LightGBM",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    inputFeatures: 34,
    output: "Genesis probability",
    validation: "PROTOTYPE — features are synthetic; storm-aware CV metrics < held-out (not production-validated).",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "genesis-xgboost",
    name: "Genesis XGBoost",
    slug: "genesis",
    category: "Genesis",
    artifact: "genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib",
    framework: "XGBoost",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    inputFeatures: 34,
    output: "Genesis probability",
    validation: "PROTOTYPE — synthetic features; not production-validated.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "genesis-rf",
    name: "Genesis RandomForest",
    slug: "genesis",
    category: "Genesis",
    artifact: "genisis models/tc_genesis_rf_300_OPTIMIZED.joblib",
    framework: "scikit-learn",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    inputFeatures: 34,
    output: "Genesis probability",
    validation: "PROTOTYPE — synthetic features; not production-validated.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "genesis-ensemble",
    name: "Genesis Ensemble",
    slug: "genesis",
    category: "Genesis",
    framework: "Ensemble",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    inputFeatures: 34,
    output: "Genesis probability (weighted)",
    validation: "PROTOTYPE — synthetic features; soft-voting LightGBM/XGBoost/RF.",
    lastInference: "2026-09-02T13:12:00Z",
  },
  {
    id: "hazard-engine",
    name: "HazardRiskEngine",
    slug: "risk",
    category: "Risk",
    framework: "Composite Engine",
    load: "AVAILABLE",
    predict: "AVAILABLE",
    adapter: "AVAILABLE",
    orchestrator: "AVAILABLE",
    status: "AVAILABLE",
    output: "Composite hazard risk score",
    lastInference: "2026-09-02T13:12:00Z",
  },
];

// --- Data sources -----------------------------------------
export const mockDataSources: DataSourceInfo[] = [
  { id: "ibtracs", name: "IBTrACS", category: "Best-track archive", status: "CONNECTED", coverage: "Global, 1980–2026" },
  { id: "era5", name: "ERA5", category: "Reanalysis", status: "CONNECTED", coverage: "Global" },
  { id: "satellite", name: "Satellite", category: "Imagery", status: "STALE", coverage: "Regional" },
  { id: "sst", name: "SST", category: "Sea surface temperature", status: "CONNECTED" },
  { id: "ohc", name: "Ocean Heat Content", category: "Ocean", status: "STALE" },
  { id: "tchp", name: "Tropical Cyclone Heat Potential", category: "Ocean", status: "STALE" },
  { id: "rainfall", name: "Rainfall (IMERG)", category: "Precipitation", status: "CONNECTED" },
  { id: "dem", name: "DEM", category: "Elevation", status: "CONNECTED", coverage: "Regional" },
  { id: "geospatial", name: "Geospatial data", category: "Boundaries", status: "CONNECTED" },
];

// --- Historical events ------------------------------------
export const mockHistorical: HistoricalCyclone[] = [
  {
    id: "fani-2019",
    name: "Fani",
    year: 2019,
    basin: "Bay of Bengal",
    peakIntensityKt: 140,
    category: "Extremely Severe Cyclonic Storm",
    landfall: "Odisha coastline, India",
    availableData: ["Rainfall", "Flood"],
  },
  {
    id: "yaas-2021",
    name: "Yaas",
    year: 2021,
    basin: "Bay of Bengal",
    peakIntensityKt: 100,
    category: "Very Severe Cyclonic Storm",
    landfall: "Odisha/West Bengal",
    availableData: ["Wind"],
  },
  {
    id: "amphan-2020",
    name: "Amphan",
    year: 2020,
    basin: "Bay of Bengal",
    peakIntensityKt: 155,
    category: "Super Cyclonic Storm",
    landfall: "West Bengal, India",
    availableData: ["Track", "Wind"],
  },
  {
    id: "maha-2019",
    name: "Maha",
    year: 2019,
    basin: "Arabian Sea",
    peakIntensityKt: 100,
    category: "Very Severe Cyclonic Storm",
    availableData: ["Track"],
  },
  {
    id: "taufaan-2020",
    name: "Nisarga",
    year: 2020,
    basin: "Arabian Sea",
    peakIntensityKt: 100,
    category: "Severe Cyclonic Storm",
    availableData: ["Track"],
  },
];

export const mockAlerts: Alert[] = [
  {
    id: "a-1",
    severity: "INFO",
    title: "Trajectory updated",
    message: "Trajectory (V12 distilled) produced a new +24h forecast (simulated).",
    source: "Trajectory (V12 distilled)",
    timestamp: "2026-09-02T13:12:00Z",
    region: "Bay of Bengal",
    percentage: 78,
    latitude: 21.80,
    longitude: 88.10,
  },
  {
    id: "a-2",
    severity: "WARNING",
    title: "Heavy rainfall expected",
    message: "Rainfall model indicates heavy accumulation potential along the coast.",
    source: "Rainfall model",
    timestamp: "2026-09-02T13:05:00Z",
    region: "Odisha / West Bengal coast",
    percentage: 85,
  },
  {
    id: "a-3",
    severity: "INFO",
    title: "RI probability available",
    message: "IMD XGBoost RI probability computed.",
    source: "RI IMD XGBoost",
    timestamp: "2026-09-02T13:12:00Z",
    percentage: 23,
  },
];

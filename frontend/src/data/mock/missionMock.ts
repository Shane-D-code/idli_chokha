// ============================================================
// TOOFAN — MISSION MOCK DATA (DEMO MODE ONLY)
// ------------------------------------------------------------
// SIMULATED environmental driver values + reference coordinates
// for named districts. Everything here is explicitly labelled
// SIMULATED and must never be presented as real observation.
// MOCK DATA — DO NOT treat as real model output.
// ============================================================

import type { DistrictPoint, EnvironmentDriver } from "@/types/mission";

// -----------------------------------------------------------------
// SIMULATED environmental drivers consistent with a Bay of Bengal
// disturbance during the 24h genesis-analysis window. Interpretation
// thresholds follow standard NIO tropical-cyclone climatology.
// -----------------------------------------------------------------
export const mockEnvironmentDrivers: EnvironmentDriver[] = [
  {
    id: "sst",
    label: "Sea Surface Temperature",
    value: 29.4,
    unit: "°C",
    status: "FAVORABLE",
    threshold: "≥ 28°C",
    provenance: "SIMULATED",
  },
  {
    id: "sst-anomaly",
    label: "SST Anomaly",
    value: 0.8,
    unit: "°C",
    status: "FAVORABLE",
    threshold: "> 0°C",
    provenance: "SIMULATED",
  },
  {
    id: "tchp",
    label: "Tropical Cyclone Heat Potential",
    value: 68,
    unit: "kJ/cm²",
    status: "FAVORABLE",
    threshold: "≥ 50 kJ/cm²",
    provenance: "SIMULATED",
  },
  {
    id: "ohc700",
    label: "Ocean Heat Content (700 m)",
    value: 94,
    unit: "kJ/cm²",
    status: "FAVORABLE",
    threshold: "> 75 kJ/cm²",
    provenance: "SIMULATED",
  },
  {
    id: "shear",
    label: "Vertical Wind Shear (200–850 hPa)",
    value: 8,
    unit: "kt",
    status: "FAVORABLE",
    threshold: "≤ 10 kt",
    provenance: "SIMULATED",
  },
  {
    id: "rh",
    label: "Mid-level Relative Humidity",
    value: 62,
    unit: "%",
    status: "FAVORABLE",
    threshold: "≥ 60%",
    provenance: "SIMULATED",
  },
  {
    id: "divergence",
    label: "Upper-level Divergence (200 hPa)",
    value: 1.4,
    unit: "×10⁻⁵ s⁻¹",
    status: "MODERATE",
    threshold: "≥ 2 ×10⁻⁵ s⁻¹",
    provenance: "SIMULATED",
  },
  {
    id: "vorticity",
    label: "Low-level Relative Vorticity (850 hPa)",
    value: 3.8,
    unit: "×10⁻⁵ s⁻¹",
    status: "FAVORABLE",
    threshold: "cyclonic",
    provenance: "SIMULATED",
  },
];

// -----------------------------------------------------------------
// Reference coordinates for districts referenced by the mock hazard
// reports (rainfall ranking / flood). Coordinates are real
// administrative reference points; the RISK VALUES attached in the
// mission service come from the (simulated) mock reports.
// -----------------------------------------------------------------
export const mockDistrictPoints: DistrictPoint[] = [
  { district: "Srikakulam", state: "Andhra Pradesh", lat: 18.3, lon: 83.9, provenance: "SIMULATED" },
  { district: "Vizianagaram", state: "Andhra Pradesh", lat: 18.11, lon: 83.43, provenance: "SIMULATED" },
  { district: "Visakhapatnam", state: "Andhra Pradesh", lat: 17.69, lon: 83.22, provenance: "SIMULATED" },
  { district: "East Godavari", state: "Andhra Pradesh", lat: 17.03, lon: 82.18, provenance: "SIMULATED" },
  { district: "Krishna", state: "Andhra Pradesh", lat: 16.48, lon: 80.8, provenance: "SIMULATED" },
  { district: "Guntur", state: "Andhra Pradesh", lat: 16.3, lon: 80.4, provenance: "SIMULATED" },
  { district: "Ganjam", state: "Odisha", lat: 19.5, lon: 84.9, provenance: "SIMULATED" },
  { district: "Koraput", state: "Odisha", lat: 18.81, lon: 82.71, provenance: "SIMULATED" },
  { district: "Araku Valley", state: "Andhra Pradesh", lat: 18.33, lon: 82.87, provenance: "SIMULATED" },
  { district: "Malkangiri", state: "Odisha", lat: 18.24, lon: 81.89, provenance: "SIMULATED" },
];

export interface SimulatedHelicopterMarker {
  name: string;
  role: string;
  lat: number;
  lon: number;
}

export const mockReportBand = {
  production: "GENESIS PROTOTYPE",
  calibrated: false,
  threshold: 0.24,
  ensembleWeights: { lightgbm: 0.4, xgboost: 0.35, randomforest: 0.25 },
  featureCount: 34,
};

export const mockForecastConfig = {
  trajectory: { horizons: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24], steps: 12, uncertainty: "sigma_km" },
  intensity: { model: "Intensity XGBoost (BASELINE)" },
  recurvature: { probability: 0.178 },
  ri: { fusion: 0.2472 },
};
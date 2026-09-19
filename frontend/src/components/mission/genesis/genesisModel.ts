// ============================================================
// TOOFAN — Genesis view-model adapter
// ------------------------------------------------------------
// Pure derivation of the values the section displays. It never
// synthesises scientific claims — it only aggregates sub-model
// outputs that already exist in the mission data layer, applying
// the SAME calibrated soft-vote weights the backend uses for the
// 24-hour ensemble (missionService already does this for h24).
//
// Bands follow the documented `probability_to_risk_level` mapping
// from src/core/schema.py: <0.1 NONE, 0.1–0.3 LOW, 0.3–0.5
// MODERATE, 0.5–0.75 HIGH, >=0.75 EXTREME.
// ============================================================

import type { GenesisReport, GenesisSubModel } from "@/types";

export type ProbabilityHorizon = "probability24h" | "probability48h" | "probability72h";

export interface GenesisHorizons {
  h24: number | null;
  h48: number | null;
  h72: number | null;
}

export type ProbabilityBand = "NONE" | "LOW" | "MODERATE" | "HIGH" | "EXTREME";

/** Weighted soft-vote for one horizon — the documented 0.40/0.35/0.25
 *  ensemble formula applied to whatever horizon data each member carries. */
export function ensembleProbability(sub: GenesisSubModel[], horizon: ProbabilityHorizon): number | null {
  const members = sub.filter((s) => s.weight != null && s[horizon] != null);
  const denom = members.reduce((sum, s) => sum + (s.weight ?? 0), 0);
  if (members.length === 0 || denom <= 0) return null;
  return members.reduce((sum, s) => sum + (s[horizon] ?? 0) * (s.weight ?? 0), 0) / denom;
}

/** The three display horizons of the mission's genesis ensemble. */
export function horizonsFrom(sub: GenesisSubModel[]): GenesisHorizons {
  return {
    h24: ensembleProbability(sub, "probability24h"),
    h48: ensembleProbability(sub, "probability48h"),
    h72: ensembleProbability(sub, "probability72h"),
  };
}

/** Public band mapping — NEVER communicates risk through colour alone. */
export function probabilityBand(p: number | null | undefined): ProbabilityBand | null {
  if (p == null) return null;
  if (p >= 0.75) return "EXTREME";
  if (p >= 0.5) return "HIGH";
  if (p >= 0.3) return "MODERATE";
  if (p >= 0.1) return "LOW";
  return "NONE";
}

export function bandTone(band: ProbabilityBand | null): "low" | "moderate" | "high" {
  if (band === "MODERATE") return "moderate";
  if (band === "HIGH" || band === "EXTREME") return "high";
  return "low";
}

/** Human label for a probability over a 100-scale, or an em-dash when missing. */
export function pct(p: number | null | undefined, decimals = 0): string {
  if (p == null) return "—";
  return (p * 100).toFixed(decimals);
}

/** Binary genesis class relative to the model's decision threshold. */
export function thresholdState(p: number | null, threshold: number | undefined): "ABOVE" | "BELOW" | "NONE" {
  if (p == null || threshold == null) return "NONE";
  return p >= threshold ? "ABOVE" : "BELOW";
}

export type DisplayStatus = "LIVE" | "SIMULATED" | "HISTORICAL" | "UNAVAILABLE" | "UNCALIBRATED";

/** Resolve the honest provenance display for the genesis block. */
export function genesisProvenance(report: GenesisReport, mode: string): DisplayStatus {
  const st = report.status?.status;
  if (st === "NOT_AVAILABLE" || st === "ERROR") return "UNAVAILABLE";
  if (!report.calibrated) return "UNCALIBRATED";
  return mode === "live" ? "LIVE" : "SIMULATED";
}

/** Ensemble metadata shown in micro-rows across the section. */
export interface GenesisModelMeta {
  threshold: number | null;
  calibrated: boolean;
  scientificStatus: string | null;
}

export function genesisMeta(report: GenesisReport): GenesisModelMeta {
  return {
    threshold: report.threshold ?? null,
    calibrated: report.calibrated ?? false,
    scientificStatus: report.scientificStatus ?? null,
  };
}

export function genesisReason(report: GenesisReport): string | null {
  return report.status?.message ?? null;
}
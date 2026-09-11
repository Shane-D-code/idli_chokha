// ============================================================
// TOOFAN — Recurvature service
// ------------------------------------------------------------
// Frontend-only adapter for the recurvature prediction API.
//
//   GET /api/recurvature
//
// Expected response (parsed defensively below):
//   {
//     status: "AVAILABLE",
//     probability: 0.178,
//     risk: "LOW",
//     currentHeading: 315,
//     predictedHeading: 335,
//     headingChange: 20,
//     model: { name, framework, featureCount, target, version },
//     featureImportance: [{ feature, importance, source }],
//     timestamp: "...",
//     track: { historical: [...], forecast: [...] }
//   }
//
// The frontend must tolerate `{ status: "MODEL_MISSING" }` (or any
// unavailable status) without crashing, and simply surface the status
// to the UI. No fake probabilities are ever injected here.
//
// Reference/illustrative trajectories are derived in the page from
// the current cyclone heading. The ACTUAL model forecast (if supplied
// via `track.forecast`) is kept strictly separate from those reference
// scenarios.
// ============================================================

import type {
  FeatureImportance,
  HazardSeverity,
  ModelOperationalStatus,
  RecurvatureModelMeta,
  RecurvatureReport,
  RecurvatureTrackPoint,
} from "@/types";
import { apiGet } from "./apiClient";

/** Raw wire shape — superset of both demo and live payloads. */
interface RecurvatureWire {
  status?: string;
  probability?: number;
  risk?: string;
  currentHeading?: number;
  heading?: number;
  predictedHeading?: number;
  headingChange?: number;
  model?: {
    name?: string;
    framework?: string;
    featureCount?: number;
    feature_count?: number;
    target?: string;
    version?: string;
  };
  featureImportance?: Array<{
    feature?: string;
    importance?: number;
    source?: string;
    category?: string;
  }>;
  timestamp?: string;
  track?: {
    historical?: unknown;
    forecast?: unknown;
  };
  message?: string;
}

function statusOf(raw: RecurvatureWire): ModelOperationalStatus {
  const s = (raw.status ?? "UNAVAILABLE").toUpperCase().replace(/-/g, "_");
  switch (s) {
    case "AVAILABLE":
    case "LIVE":
    case "BASELINE":
    case "DEGRADED":
    case "MODEL_MISSING":
    case "RUNTIME_REQUIRED":
    case "DATA_REQUIRED":
    case "NOT_INTEGRATED":
    case "UNAVAILABLE":
      return s;
    default:
      return "UNAVAILABLE";
  }
}

function riskOf(raw: RecurvatureWire): HazardSeverity | undefined {
  const r = (raw.risk ?? "").toUpperCase().replace(/ /g, "_");
  switch (r) {
    case "LOW":
    case "MODERATE":
    case "HIGH":
    case "VERY_HIGH":
    case "EXTREME":
      return r;
    default:
      return rawerRisk(raw);
  }
}

// Accept loose values like "low risk", "MODERATE" etc. from any payload shape.
function rawerRisk(raw: RecurvatureWire): HazardSeverity | undefined {
  const r = String(raw.risk ?? "").toUpperCase();
  if (r.includes("VERY_HIGH") || r.includes("VERY HIGH")) return "VERY_HIGH";
  if (r.includes("EXTREME")) return "EXTREME";
  if (r.includes("HIGH")) return "HIGH";
  if (r.includes("MODERATE")) return "MODERATE";
  if (r.includes("LOW")) return "LOW";
  return undefined;
}

function pointsOf(value: unknown): RecurvatureTrackPoint[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const pts: RecurvatureTrackPoint[] = [];
  for (const p of value) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;
    const lat = Number(rec.lat ?? rec.latitude ?? NaN);
    const lon = Number(rec.lon ?? rec.longitude ?? rec.lng ?? NaN);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      pts.push({
        lat,
        lon,
        timestamp: typeof rec.timestamp === "string" ? rec.timestamp : undefined,
        windKt: typeof rec.windKt === "number" ? rec.windKt : undefined,
        mslpHpa: typeof rec.pressure === "number" ? rec.pressure : undefined,
        uncertaintyKm:
          typeof rec.uncertaintyKm === "number" ? rec.uncertaintyKm : undefined,
      });
    }
  }
  return pts.length ? pts : undefined;
}

export function normalizeRecurvature(raw: unknown): RecurvatureReport {
  const wire: RecurvatureWire =
    raw && typeof raw === "object" ? (raw as RecurvatureWire) : {};
  const status = statusOf(wire);

  const currentHeadingDeg =
    num(wire.currentHeading) ?? num(wire.heading) ?? undefined;
  const predictedHeadingDeg = num(wire.predictedHeading) ?? undefined;
  const headingChangeDeg =
    num(wire.headingChange) ??
    (currentHeadingDeg !== undefined && predictedHeadingDeg !== undefined
      ? ((predictedHeadingDeg - currentHeadingDeg + 540) % 360) - 180
      : undefined);

  const probability =
    typeof wire.probability === "number" && Number.isFinite(wire.probability)
      ? wire.probability
      : undefined;

  const model: RecurvatureModelMeta | undefined = wire.model
    ? {
        name: wire.model.name,
        framework: wire.model.framework,
        featureCount: wire.model.featureCount ?? wire.model.feature_count,
        target: wire.model.target,
        version: wire.model.version,
      }
    : undefined;

  const featureImportance: FeatureImportance[] | undefined = Array.isArray(
    wire.featureImportance
  )
    ? wire.featureImportance
        .filter((f) => f && typeof f.feature === "string")
        .map((f) => ({
          feature: f.feature!,
          importance:
            typeof f.importance === "number" && Number.isFinite(f.importance)
              ? f.importance
              : 0,
          source: (f.source ?? wire.status ?? "UNAVAILABLE") as ModelOperationalStatus,
          category: f.category,
        }))
        .sort((a, b) => b.importance - a.importance)
    : undefined;

  const track =
    wire.track && typeof wire.track === "object"
      ? {
          historical: pointsOf(wire.track.historical),
          forecast: pointsOf(wire.track.forecast),
        }
      : undefined;

  const available = probability !== undefined && status === "AVAILABLE";

  return {
    status: {
      status,
      message: wire.message,
      timestamp: wire.timestamp,
    },
    currentHeadingDeg,
    predictedHeadingDeg,
    headingChangeDeg,
    probability,
    risk: available ? riskOf(wire) : undefined,
    prediction:
      probability !== undefined
        ? {
            probability,
            risk: riskOf(wire),
            headingChangeDeg,
            predictedHeadingDeg,
          }
        : undefined,
    model,
    featureImportance,
    track,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export async function getRecurvatureLive(): Promise<RecurvatureReport> {
  const raw = await apiGet<unknown>("/recurvature");
  return normalizeRecurvature(raw);
}

import type { HazardSeverity, ModelOperationalStatus } from "@/types";

export type ModuleKey =
  | "genesis"
  | "trajectory"
  | "intensity"
  | "ri"
  | "recurvature"
  | "rainfall"
  | "wind"
  | "flood"
  | "landslide"
  | "hazard_engine";

export interface ModuleDef {
  id: ModuleKey;
  label: string;
  short: string;
  route: string;
  anchor?: string;
  group: "core" | "forecast" | "impact";
}

/** Authoritative module list used by the pipeline strip + overview flow.
 *  Order follows the TOOFAN data pipeline (DATA → GENESIS → CYCLONE PATH
 *  → [INTENSITY|RI|RECURVATURE] → [RAIN|WIND|IMPACT] → FLOOD/LANDSLIDE
 *  → HAZARD ENGINE). Each node is routable so operators can jump to the
 *  section that produced it. */
export const PIPELINE_MODULES: ModuleDef[] = [
  { id: "genesis", label: "GENESIS", short: "GENESIS", route: "/genesis", group: "core" },
  { id: "trajectory", label: "TRACK", short: "TRACK", route: "/forecast", anchor: "track", group: "core" },
  { id: "intensity", label: "INTENSITY", short: "INTENSITY", route: "/forecast", anchor: "intensity", group: "forecast" },
  { id: "ri", label: "RAPID INTENSIFICATION", short: "RI", route: "/forecast", anchor: "ri", group: "forecast" },
  { id: "recurvature", label: "RECURVATURE", short: "RECURVATURE", route: "/forecast", anchor: "recurvature", group: "forecast" },
  { id: "rainfall", label: "RAINFALL", short: "RAIN", route: "/impact", anchor: "rainfall", group: "impact" },
  { id: "wind", label: "WIND", short: "WIND", route: "/impact", anchor: "wind", group: "impact" },
  { id: "flood", label: "FLOOD", short: "FLOOD", route: "/impact", anchor: "flood", group: "impact" },
  { id: "landslide", label: "LANDSLIDE", short: "LANDSLIDE", route: "/impact", anchor: "landslide", group: "impact" },
  { id: "hazard_engine", label: "UNIFIED HAZARD ENGINE", short: "HAZARD ENGINE", route: "/impact", anchor: "hazard-engine", group: "impact" },
];

export function moduleByKey(key: ModuleKey): ModuleDef {
  return PIPELINE_MODULES.find((m) => m.id === key) ?? PIPELINE_MODULES[0];
}

/** Accent color used for status dots / left borders on dark surfaces. */
export function moduleStatusColor(status?: ModelOperationalStatus | string | null): string {
  switch (String(status ?? "").toUpperCase().replace(/_/g, "")) {
    case "AVAILABLE":
    case "LIVE":
    case "SUCCESS":
      return "#46d17e";
    case "BASELINE":
    case "DEGRADED":
    case "DATA_REQUIRED":
    case "LIMITED":
    case "UNVERIFIED":
      return "#f0b429";
    case "ERROR":
    case "FAILED":
    case "MODEL_MISSING":
    case "RUNTIME_REQUIRED":
    case "NOT_INTEGRATED":
      return "#e5604f";
    default:
      return "#54687d";
  }
}

/** Visual frame name for a pipeline node / strip item. */
export function moduleStatusFrame(status?: ModelOperationalStatus | string | null): "ok" | "warn" | "bad" | "muted" {
  const color = moduleStatusColor(status);
  if (color === "#46d17e") return "ok";
  if (color === "#f0b429") return "warn";
  if (color === "#e5604f") return "bad";
  return "muted";
}

export function severityColor(sev?: HazardSeverity | null): string {
  switch (sev) {
    case "NONE":
    case "LOW":
      return "#46d17e";
    case "MODERATE":
      return "#f0b429";
    case "HIGH":
      return "#ffa25e";
    case "VERY_HIGH":
    case "EXTREME":
      return "#e5604f";
    default:
      return "#54687d";
  }
}

export function severityFrame(sev?: HazardSeverity | null): "low" | "moderate" | "high" | "na" {
  switch (sev) {
    case "LOW":
    case "NONE":
      return "low";
    case "MODERATE":
      return "moderate";
    case "HIGH":
    case "VERY_HIGH":
    case "EXTREME":
      return "high";
    default:
      return "na";
  }
}
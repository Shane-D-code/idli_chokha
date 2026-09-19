import { useEffect, useMemo, useState } from "react";
import usePipelineEvents from "@/hooks/usePipelineEvents";
import { toofanService } from "@/services/toofanService";
import type { HazardItem, ModelOperationalStatus } from "@/types";
import { PIPELINE_MODULES, type ModuleKey } from "@/lib/moduleStatus";

export interface ModuleStatusEntry {
  status: ModelOperationalStatus;
  reason?: string;
  active?: boolean;
}

function normalizeStatus(status?: string | null): ModelOperationalStatus {
  if (!status) return "NOT_AVAILABLE";
  const upper = status.toUpperCase();
  if (upper === "SUCCESS") return "AVAILABLE";
  if (upper === "FAILED") return "ERROR";
  if (upper === "UNAVAILABLE" || upper === "DATA_UNAVAILABLE") return "NOT_AVAILABLE";
  if (upper === "AVAILABLE" || upper === "BASELINE" || upper === "DEGRADED" || upper === "ERROR" || upper === "NOT_AVAILABLE") {
    return upper as ModelOperationalStatus;
  }
  return "DEGRADED";
}

/**
 * Single source of truth for the mutable pipeline state (the persistent
 * status strip + the overview flow diagram).
 *
 * Precedence (most recent first):
 *   1. Live pipeline events (WebSocket) — statuses stamped on module completion.
 *   2. Latest assessment snapshot (`setLatestAssessment`).
 *   3. The per-module hazard report (mockHazards in DEMO, per_hazard_status in LIVE).
 *
 * In DEMO mode the hazard engine is part of the simulated stack, so it reads
 * AVAILABLE when no assessment has been run yet.
 */
export function useModuleStatuses(): Record<ModuleKey, ModuleStatusEntry> {
  const { moduleStatus, moduleActive } = usePipelineEvents();
  const [hazards, setHazards] = useState<HazardItem[]>([]);
  const [demoHazardEngine, setDemoHazardEngine] = useState(false);

  useEffect(() => {
    let cancelled = false;
    toofanService.getHazards().then((h) => {
      if (cancelled && Array.isArray(h)) return;
      if (!Array.isArray(h)) return;
      setHazards(h);
    });
    toofanService
      .getOverallRisk()
      .then((r) => {
        if (cancelled) return;
        if (toofanService.getDataMode() === "demo" && r?.available) setDemoHazardEngine(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const assessment = toofanService.getLatestAssessment();
    const hazardMap = new Map(hazards.map((h) => [h.id, h]));
    const result = {} as Record<ModuleKey, ModuleStatusEntry>;

    for (const mod of PIPELINE_MODULES) {
      const hazard = hazardMap.get(mod.id);
      const liveStatus =
        assessment?.per_hazard_status?.[mod.id] ?? assessment?.assessment?.module_status?.[mod.id];
      const liveReason =
        assessment?.per_hazard_reasons?.[mod.id] ?? assessment?.assessment?.module_reasons?.[mod.id];

      let status: ModelOperationalStatus = normalizeStatus(hazard?.status ?? null);
      let reason = hazard?.data;

      // Event stamps win while a run is live.
      if (moduleStatus[mod.id]) {
        status = normalizeStatus(moduleStatus[mod.id]);
        reason = undefined;
      }
      // A completed assessment snapshot overrides the static report.
      if (assessment && liveStatus) {
        status = normalizeStatus(liveStatus);
        if (liveReason) reason = String(liveReason);
      }
      if (mod.id === "hazard_engine" && status === "NOT_AVAILABLE" && demoHazardEngine) {
        status = "AVAILABLE";
      }
      result[mod.id] = {
        status,
        reason,
        active: moduleActive[mod.id] ?? false,
      };
    }
    return result;
  }, [hazards, moduleStatus, moduleActive, demoHazardEngine]);
}
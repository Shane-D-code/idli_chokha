import { useEffect, useMemo, useState } from "react";
import { getLatestEvents, subscribeEvents } from "@/services/toofanService";
import type { PipelineEvent } from "@/types/backend";

function normalizeModuleStatus(status?: string | null) {
  if (!status) return "NOT_AVAILABLE";
  const s = status.toUpperCase();
  if (s === "SUCCESS" || s === "AVAILABLE") return "AVAILABLE";
  if (s === "FAILED" || s === "ERROR") return "ERROR";
  if (s === "UNAVAILABLE" || s === "DATA_UNAVAILABLE") return "NOT_AVAILABLE";
  if (s.includes("LIMITED") || s.includes("DEGRADED") || s.includes("UNVERIFIED")) return "DEGRADED";
  if (s.includes("BASELINE")) return "BASELINE";
  return "DEGRADED";
}

export function usePipelineEvents() {
  const [events, setEvents] = useState<PipelineEvent[]>(() => getLatestEvents());

  useEffect(() => {
    const unsub = subscribeEvents((ev) => {
      setEvents((s) => [...s, ev].slice(-200));
    });
    return unsub;
  }, []);

  const latest = events[events.length - 1];

  const { moduleActive, moduleStatus, moduleMeta } = useMemo(() => {
    const activeMap: Record<string, boolean> = {};
    const statusMap: Record<string, string> = {};
    const metaMap: Record<string, { reason?: string; executionTimeMs?: number }> = {};
    // Walk recent events and build status/active indicators. Later events win.
    for (const ev of events) {
      const mod = ev.data?.module as string | undefined;
      const st = ev.data?.status ?? ev.status ?? ev.pipeline_status;
      if (mod) {
        // Running / started indicators
        if ((ev.stage && ev.stage.endsWith("_started")) || (String(ev.status).toLowerCase() === "running")) {
          activeMap[mod] = true;
        }
        // Completion events (completed / failed) clear active and set final status
        if (ev.stage && (ev.stage.endsWith("_completed") || ev.stage === "pipeline_degraded" || ev.stage === "pipeline_failed")) {
          activeMap[mod] = false;
          statusMap[mod] = normalizeModuleStatus(String(st));
        }
        // If event carries explicit per_hazard_status map, merge it
        if (ev.per_hazard_status && typeof ev.per_hazard_status === "object") {
          Object.entries(ev.per_hazard_status).forEach(([k, v]) => {
            statusMap[k] = normalizeModuleStatus(String(v));
          });
        }
        // Capture reason / execution_time if present
        if (ev.data?.execution_time_ms != null) {
          metaMap[mod] = { ...(metaMap[mod] ?? {}), executionTimeMs: Number(ev.data.execution_time_ms) };
        }
        if (ev.data?.reason) {
          metaMap[mod] = { ...(metaMap[mod] ?? {}), reason: String(ev.data.reason) };
        }
        // Fallback: if we have a status-like field, set it
        if (!statusMap[mod] && st) {
          statusMap[mod] = normalizeModuleStatus(String(st));
        }
      }
      // Also handle top-level per_hazard_status
      if (ev.per_hazard_status && typeof ev.per_hazard_status === "object") {
        Object.entries(ev.per_hazard_status).forEach(([k, v]) => {
          statusMap[k] = normalizeModuleStatus(String(v));
        });
      }
    }
    return { moduleActive: activeMap, moduleStatus: statusMap, moduleMeta: metaMap };
  }, [events]);

  return { events, latest, moduleActive, moduleStatus, moduleMeta };
}

export default usePipelineEvents;

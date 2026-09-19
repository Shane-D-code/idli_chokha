import { useCallback, useEffect, useRef, useState } from "react";
import { loadMissionBundle, type MissionBundle } from "@/services/missionService";
import { toofanService } from "@/services/toofanService";

export interface MissionDataState {
  bundle: MissionBundle | null;
  loading: boolean;
  error: string | null;
  mode: "demo" | "live";
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useMissionData(): MissionDataState {
  const [bundle, setBundle] = useState<MissionBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mode = toofanService.getDataMode();
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const b = await loadMissionBundle();
      if (!mounted.current) return;
      setBundle(b);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "Failed to load the mission feed.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load, mode]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const b = await loadMissionBundle();
      if (mounted.current) {
        setBundle(b);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Failed to refresh the mission feed.");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  return { bundle, loading, error, mode, refreshing, refresh };
}
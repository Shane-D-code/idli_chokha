import { useCallback, useEffect, useState } from "react";
import { toofanService } from "@/services/toofanService";
import type {
  CycloneState,
  DataSourceInfo,
  FloodReport,
  GenesisReport,
  HazardItem,
  IntensityReport,
  LandslideReport,
  OverallRisk,
  RainfallReport,
  RecurvatureReport,
  RIReport,
  SystemState,
  TrajectoryForecast,
  WindReport,
} from "@/types";

export interface CommandCenterData {
  cyclone: CycloneState | null;
  trajectory: TrajectoryForecast | null;
  risk: OverallRisk | null;
  ripple: RIReport | null;
  flood: FloodReport | null;
  genesis: GenesisReport | null;
  rainfall: RainfallReport | null;
  wind: WindReport | null;
  landslide: LandslideReport | null;
  recurvature: RecurvatureReport | null;
  intensity: IntensityReport | null;
  hazards: HazardItem[];
  dataSources: DataSourceInfo[];
  system: SystemState | null;
  loading: boolean;
  refresh: () => void;
}

const INITIAL: CommandCenterData = {
  cyclone: null,
  trajectory: null,
  risk: null,
  ripple: null,
  flood: null,
  genesis: null,
  rainfall: null,
  wind: null,
  landslide: null,
  recurvature: null,
  intensity: null,
  hazards: [],
  dataSources: [],
  system: null,
  loading: true,
  refresh: () => undefined,
};

/** Shared async loader for the four command-center pages.
 *  Polls the service layer every 15s so LIVE mode stays honest and the
 *  intent never goes stale; in DEMO mode the mocked services resolve
 *  instantly. Individual panels remain responsible for NOT_AVAILABLE. */
export function useCommandCenterData(pollMs = 15000): CommandCenterData {
  const [state, setState] = useState<CommandCenterData>(INITIAL);

  const refresh = useCallback(async () => {
    try {
      const [
        cyc,
        traj,
        risk,
        ri,
        flood,
        genesis,
        rainfall,
        wind,
        landslide,
        recurvature,
        intensity,
        hazards,
        sources,
        system,
      ] = await Promise.all([
        toofanService.getCyclone(),
        toofanService.getTrajectory(),
        toofanService.getOverallRisk(),
        toofanService.getRI(),
        toofanService.getFlood(),
        toofanService.getGenesis(),
        toofanService.getRainfall(),
        toofanService.getWind(),
        toofanService.getLandslide(),
        toofanService.getRecurvature(),
        toofanService.getIntensity(),
        toofanService.getHazards(),
        toofanService.getDataSources(),
        toofanService.getSystem(),
      ]);
      setState({
        cyclone: cyc,
        trajectory: traj,
        risk,
        ripple: ri,
        flood,
        genesis,
        rainfall,
        wind,
        landslide,
        recurvature,
        intensity,
        hazards: Array.isArray(hazards) ? hazards : [],
        dataSources: sources ?? [],
        system,
        loading: false,
        refresh,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollMs]);

  return state;
}

export default useCommandCenterData;
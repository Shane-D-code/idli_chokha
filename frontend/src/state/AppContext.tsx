import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toofanService, type DataMode } from "@/services/toofanService";
import type { Alert, SystemState, ToofanEvent } from "@/types";

interface AppContextValue {
  mode: DataMode;
  setMode: (m: DataMode) => void;
  system: SystemState | null;
  alerts: Alert[];
  events: ToofanEvent[];
  unread: number;
  markAllRead: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataMode>(() => toofanService.getDataMode());
  const [system, setSystem] = useState<SystemState | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events] = useState<ToofanEvent[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sys, al] = await Promise.all([
        toofanService.getSystem(),
        toofanService.getAlerts(),
      ]);
      if (cancelled) return;
      setSystem(sys as any);
      const alertsArr = al as Alert[];
      setAlerts(alertsArr);
      setUnread(alertsArr.filter((a: Alert) => a.severity !== "INFO").length);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((m: DataMode) => {
    setModeState(m);
    toofanService.setDataMode(m);
  }, []);

  const markAllRead = useCallback(() => setUnread(0), []);

  const value = useMemo(
    () => ({ mode, setMode, system, alerts, events, unread, markAllRead }),
    [mode, setMode, system, alerts, events, unread, markAllRead]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

import { useEffect, useState } from "react";
import { toofanService } from "@/services/toofanService";

export default function HealthIndicator() {
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const h = await toofanService.getHealth();
        if (cancelled) return;
        setStatus(h.status ?? null);
      } catch (e) {
        if (cancelled) return;
        setStatus("unavailable");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!loaded) return <span className="small muted">Backend: …</span>;
  if (status === "healthy") return <span className="small ok">Backend Connected</span>;
  if (status === "degraded") return <span className="small warn">Backend Degraded</span>;
  return <span className="small bad">Backend Unavailable</span>;
}

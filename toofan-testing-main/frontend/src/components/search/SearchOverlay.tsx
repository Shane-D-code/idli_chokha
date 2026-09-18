import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";

const INDEX: { to: string; label: string; keywords: string; group: string }[] = [
  { to: "/dashboard", label: "Command Center", keywords: "dashboard command live ops", group: "Command" },
  { to: "/live", label: "Live Monitor", keywords: "live satellite imagery feed monitor", group: "Forecast" },
  { to: "/track", label: "Cyclone Track", keywords: "trajectory v12 track forecast 24h", group: "Forecast" },
  { to: "/intensity", label: "Intensity & RI", keywords: "wind pressure msw mslp rmw rapid intensification ri xgboost cnn ensemble", group: "Forecast" },
  { to: "/recurvature", label: "Recurvature", keywords: "recurvature turn heading change", group: "Forecast" },
  { to: "/rainfall", label: "Rainfall", keywords: "rain precipitation accumulation baseline", group: "Forecast" },
  { to: "/wind", label: "Wind", keywords: "wind field radii tensorflow", group: "Forecast" },
  { to: "/flood", label: "Flood", keywords: "flood inundation risk district", group: "Forecast" },
  { to: "/landslide", label: "Landslide", keywords: "landslide susceptibility terrain", group: "Forecast" },
  { to: "/risk", label: "Risk Analysis", keywords: "risk hazard overview threat", group: "Analysis" },
  { to: "/models", label: "Model Health", keywords: "models health status framework artifact", group: "Analysis" },
  { to: "/performance", label: "Performance", keywords: "metrics score evaluation validation", group: "Analysis" },
  { to: "/historical", label: "Historical Events", keywords: "fani amphan yaas nisarga archive history", group: "Analysis" },
  { to: "/data", label: "Data Sources", keywords: "era5 ibtracs sources satellite", group: "System" },
  { to: "/reports", label: "Reports", keywords: "report generate", group: "System" },
  { to: "/settings", label: "Settings", keywords: "settings demo live mode", group: "System" },
];

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return INDEX.filter(
      (r) => r.label.toLowerCase().includes(s) || r.keywords.toLowerCase().includes(s)
    );
  }, [q]);

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Global search">
      <div className="search-box-inner">
        <div className="row gap-8" style={{ marginBottom: 8 }}>
          <Search size={18} style={{ color: "var(--ink-3)" }} />
          <span className="lbl">Global search</span>
          <button className="header-icon-btn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>
        <input
          className="search-input"
          placeholder="Search cyclones, hazards, models, locations…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="search-hint">Press ESC to close · e.g. Fani, RI, Flood, Trajectory V12</div>
      </div>
      <div className="search-results">
        {results.length === 0 ? (
          <div className="small muted">{q ? "No matches found." : "Type to search across TOOFAN."}</div>
        ) : (
          results.map((r) => (
            <button
              key={r.to}
              className="data-row"
              style={{ background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left" }}
              onClick={() => {
                navigate(r.to);
                onClose();
              }}
            >
              <span className="k" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 800, color: "var(--ink)" }}>
                {r.label}
              </span>
              <span className="v muted-3">{r.group}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

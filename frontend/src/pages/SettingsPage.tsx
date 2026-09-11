import { DemoBanner } from "@/components/common/DemoBanner";
import { useApp } from "@/state/AppContext";
import { SectionLabel, ThinDivider } from "@/components/design";
import { useNavigate } from "react-router-dom";

const ENDPOINTS = [
  "GET /api/cyclone/current",
  "GET /api/cyclone/track",
  "GET /api/cyclone/forecast",
  "GET /api/intensity",
  "GET /api/ri",
  "GET /api/rainfall",
  "GET /api/wind",
  "GET /api/flood",
  "GET /api/landslide",
  "GET /api/recurvature",
  "GET /api/genesis",
  "GET /api/risk",
  "GET /api/models",
  "GET /api/models/:id",
  "GET /api/performance",
  "GET /api/historical",
  "GET /api/data-sources",
  "GET /api/alerts",
  "GET /api/system",
  "GET /api/events  (SSE)",
];

export default function SettingsPage() {
  const { mode, setMode } = useApp();
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">System</div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Configure TOOFAN command center mode and preferences.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      <div className="panel" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head"><span className="panel-title">Data Mode</span></div>
        <div className="panel-body">
          <p className="small muted">
            Switch between DEMO (simulated mock data, clearly labeled) and LIVE (connected to backend API).
          </p>
          <div className="row gap-8">
            <button type="button" className={`btn ${mode === "demo" ? "solid" : ""}`} onClick={() => setMode("demo")}>
              DEMO DATA
            </button>
            <button type="button" className={`btn ${mode === "live" ? "solid" : ""}`} onClick={() => setMode("live")}>
              LIVE DATA
            </button>
          </div>
          <p className="small muted">
            {mode === "demo"
              ? "Using simulated forecast data. All mock data is clearly labeled."
              : "Connected to live backend. If the backend is unavailable, errors will display."}
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head"><span className="panel-title">About</span></div>
        <div className="panel-body">
          <SectionLabel label="TOOFAN — Multi-Hazard Cyclone Intelligence & Prediction System" />
          <p className="small muted">Version 1.0.0</p>
          <ThinDivider faint />
          <div className="small muted">
            Backend: Python pipeline with LightGBM, XGBoost, scikit-learn, PyTorch.
            <br />
            Frontend: React + TypeScript + MapLibre GL + Recharts.
            <br />
            TensorFlow models require runtime installation before they can execute.
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><span className="panel-title">Backend API Endpoints</span></div>
        <div className="panel-body">
          <div className="small mono muted" style={{ lineHeight: 2.0, userSelect: "all" }}>
            {ENDPOINTS.map((ep) => (
              <div key={ep}>{ep}</div>
            ))}
          </div>
          <ThinDivider faint />
          <button type="button" className="btn sm muted-b" onClick={() => navigate("/")}>Return to Command Center</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { DemoBanner } from "@/components/common/DemoBanner";
import { toofanService } from "@/services/toofanService";
import { EditorialButton, SectionLabel, ThinDivider, StatusLabel } from "@/components/design";
import type { CycloneState, ModelOperationalStatus } from "@/types";
import { FileText } from "lucide-react";

interface ReportRow {
  title: string;
  status: ModelOperationalStatus;
  note: string;
}

const ROWS: ReportRow[] = [
  { title: "TRACK / TRAJECTORY", status: "LIMITED", note: "Real point forecasts (+2h…+24h); uncertainty band is an uncalibrated ~209.9 km bound — NOT calibrated, NOT lead-time-growing." },
  { title: "INTENSITY", status: "UNAVAILABLE", note: "No trained artifact in repo — retrain via `cyclone intensity/retrain.py` with the real dataset." },
  { title: "RAPID INTENSIFICATION", status: "LIMITED", note: "IMD branch runs for real; ERA5 features not wired, satellite CNN not fitted, no fusion meta-model — `calibrated_probability` is only an alias of `imd_probability`." },
  { title: "RAINFALL", status: "AVAILABLE_BASELINE", note: "Same-time classifier (FANI case study) — NOT a future rainfall forecast." },
  { title: "WIND", status: "BASELINE", note: "Single case study (Yaas); no inference pipeline; .keras artifact not loadable in current env (TensorFlow import crash)." },
  { title: "FLOOD", status: "DATA_UNAVAILABLE", note: "Single-event (FANI 2019) spatial-holdout baseline; no temporal generalization demonstrated." },
  { title: "LANDSLIDE", status: "STATIC_SUSCEPTIBILITY", note: "Static vulnerability maps only — no ML model, no dynamic inference." },
  { title: "RECURVATURE", status: "AVAILABLE", note: "Real inference; confidence fixed at 0.55 (not calibrated)." },
  { title: "GENESIS", status: "AVAILABLE", note: "Functional prototype — features are synthetic, `calibrated=False`; not production-validated." },
  { title: "OVERALL RISK", status: "AVAILABLE", note: "HazardRiskEngine combines available outputs; includes static/baseline modules by design." },
];

export default function ReportsPage() {
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [activeCyclone, setActiveCyclone] = useState<CycloneState | null>(null);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenerated(false);
    try {
      const cyc = await toofanService.getCyclone();
      setActiveCyclone(cyc);
      await new Promise((r) => setTimeout(r, 900));
      setGenerated(true);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">System</div>
        <h1 className="page-title">Reports</h1>
        <p className="page-sub">Generate operational event reports. Reports distinguish observed, predicted, baseline, and unavailable data.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      <div className="panel" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head"><span className="panel-title">Generate Event Report</span></div>
        <div className="panel-body">
          <p className="small muted" style={{ marginBottom: "var(--sp-3)" }}>
            Generate a TOOFAN operational event report covering track, intensity, RI, rainfall, wind, flood,
            landslide, recurvature, genesis, and risk — with truthful model status per hazard.
          </p>
          <EditorialButton onClick={handleGenerate} variant="solid">
            <><FileText size={15} /> {generating ? "Generating…" : "Generate Report"}</>
          </EditorialButton>
        </div>
      </div>

      {generated && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">TOOFAN Event Report</span>
            <StatusLabel status="AVAILABLE" />
          </div>
          <div className="panel-body">
            <div className="small">
              <div><strong>Cyclone:</strong> {activeCyclone?.name ?? "—"} ({activeCyclone?.id ?? "—"})</div>
              <div className="muted" style={{ marginTop: 4 }}>Generated {new Date().toISOString()}</div>
            </div>
            <ThinDivider faint />
            {ROWS.map((r) => (
              <div key={r.title} className="report-section">
                <div className="report-section-head">
                  <SectionLabel label={r.title} />
                  <StatusLabel status={r.status} />
                </div>
                <p className="small muted">{r.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import { SectionLabel, StatusLabel, DataRow } from "@/components/design";
import type { ModelInfo } from "@/types";
import { AlertTriangle, X } from "lucide-react";

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setModels(await toofanService.getModels());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={4} /></div>;

  const operational = models.filter((m) => m.status === "AVAILABLE" || m.status === "LIVE").length;
  const missing = models.filter((m) => m.status === "MODEL_MISSING").length;
  const blocked = models.filter((m) => m.status === "RUNTIME_REQUIRED" || m.status === "DEGRADED").length;
  const integrated = models.filter((m) => m.status === "NOT_INTEGRATED").length;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Analysis</div>
        <h1 className="page-title">Model Health</h1>
        <p className="page-sub">Complete system model status — artifact, framework, load, predict, adapter, and orchestrator state.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      <div className="hazard-strip" style={{ marginBottom: "var(--section-gap)" }}>
        <MetricStrip label="Total Models" value={models.length} />
        <MetricStrip label="Operational" value={operational} tone="ok" />
        <MetricStrip label="Blocked" value={blocked} tone="warn" />
        <MetricStrip label="Not Integrated" value={integrated} tone="warn" />
        <MetricStrip label="Missing" value={missing} tone="bad" />
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">System Model Health — Appendix</span>
          <span className="small muted-3">{models.length} models · select a row for details</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Framework</th>
                <th>Load</th>
                <th>Predict</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} onClick={() => setSelected(m)} style={{ cursor: "pointer" }}>
                  <td style={{ fontWeight: 700 }}>{m.name}</td>
                  <td className="small mono muted">{m.framework}</td>
                  <td><StatusLabel status={m.load} /></td>
                  <td><StatusLabel status={m.predict} /></td>
                  <td><StatusLabel status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="drawer-overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Model detail: ${selected.name}`}>
            <div className="drawer-head">
              <div>
                <div className="page-kicker">{selected.category}</div>
                <h3 className="drawer-title">{selected.name}</h3>
              </div>
              <button className="drawer-close" onClick={() => setSelected(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="drawer-body">
              <StatusLabel status={selected.status} />

              {selected.error && (
                <div className="warning-block" style={{ marginTop: "var(--sp-3)" }}>
                  <div className="lbl"><AlertTriangle size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Error / Limitation</div>
                  <p className="small muted" style={{ marginTop: "var(--sp-1)" }}>{selected.error}</p>
                </div>
              )}

              <div className="panel" style={{ marginTop: "var(--sp-3)" }}>
                <div className="panel-body">
                  <SectionLabel label="Specification" strong />
                  <DataRow label="Framework" value={selected.framework} />
                  <DataRow label="Version" value={selected.version ?? "—"} />
                  <DataRow label="Artifact" value={selected.artifact ?? "—"} />
                  <DataRow label="Input Features" value={selected.inputFeatures?.toString() ?? "—"} />
                  <DataRow label="Output" value={selected.output ?? "—"} />
                  <DataRow label="Last Inference" value={selected.lastInference ? new Date(selected.lastInference).toLocaleString() : "—"} />
                  <DataRow label="Inference Time" value={selected.inferenceTimeMs != null ? `${selected.inferenceTimeMs} ms` : "—"} />
                  <DataRow label="Hash" value={selected.hash ?? "—"} />
                </div>
              </div>

              {selected.validation && (
                <div className="panel" style={{ marginTop: "var(--sp-3)" }}>
                  <div className="panel-body">
                    <SectionLabel label={"Validation / Training"} strong />
                    <div className="small muted">
                      {Array.isArray(selected.validation)
                        ? selected.validation.map((v, i) => <div key={i}>{v}</div>)
                        : selected.validation}
                    </div>
                  </div>
                </div>
              )}

              {selected.inputFeatureNames && selected.inputFeatureNames.length > 0 && (
                <div className="panel" style={{ marginTop: "var(--sp-3)" }}>
                  <div className="panel-body">
                    <SectionLabel label={`Input Features (${selected.inputFeatureNames.length})`} strong />
                    <div className="small mono muted" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                      {selected.inputFeatureNames.map((f) => (
                        <span key={f} className="service-tab" style={{ cursor: "default" }}>{f}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selected.provenance && (
                <div className="panel" style={{ marginTop: "var(--sp-3)" }}>
                  <div className="panel-body">
                    <SectionLabel label="Provenance" strong />
                    <div className="small mono muted">{selected.provenance}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricStrip({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "var(--sev-low)" : tone === "warn" ? "var(--sev-moderate)" : tone === "bad" ? "var(--sev-veryhigh)" : "var(--ink)";
  return (
    <div className="hazard-module">
      <span className="lbl">{label}</span>
      <span className="val" style={{ color, fontWeight: 800 }}>{value}</span>
    </div>
  );
}

import { useEffect, useState } from "react";
import { DemoBanner } from "@/components/common/DemoBanner";
import { EmptyState, LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import type { ModelPerformance } from "@/types";

export default function PerformancePage() {
  const [data, setData] = useState<ModelPerformance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setData(await toofanService.getPerformance());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={3} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Analysis</div>
        <h1 className="page-title">Model Performance</h1>
        <p className="page-sub">Validation metrics and observed-vs-predicted analysis. Only real evaluation data is shown — no fabricated metrics.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      {data.length === 0 ? (
        <div className="panel">
          <EmptyState
            big="EVALUATION DATA UNAVAILABLE"
            message="No performance metrics have been returned by the backend."
            footer="Only real evaluation data will be shown here."
          />
        </div>
      ) : (
        <div className="stack">
          {data.map((model) => (
            <div key={model.modelId} className="panel">
              <div className="panel-head">
                <span className="panel-title">{model.name}</span>
                <span className="small muted">{model.available ? "DATA AVAILABLE" : "NO DATA"}</span>
              </div>
              <div className="panel-body">
                {model.metrics.length === 0 ? (
                  <p className="small muted">No metrics available for this model.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th style={{ textAlign: "right" }}>Value</th>
                        <th>Dataset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.metrics.map((m, i) => (
                        <tr key={`${m.metric}-${i}`}>
                          <td style={{ fontWeight: 600 }}>{m.metric}</td>
                          <td style={{ textAlign: "right" }} className="mono">{m.value !== undefined ? m.value.toFixed(4) : "—"}</td>
                          <td className="muted small">{m.dataset ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

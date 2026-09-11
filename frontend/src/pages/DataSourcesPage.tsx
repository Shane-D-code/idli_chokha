import { useEffect, useState } from "react";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import type { DataSourceInfo, DataSourceStatus } from "@/types";

function toneFor(s: DataSourceStatus): string {
  switch (s) {
    case "CONNECTED": return "ok";
    case "STALE": return "warn";
    case "ERROR": return "bad";
    default: return "info";
  }
}

export default function DataSourcesPage() {
  const [sources, setSources] = useState<DataSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setSources(await toofanService.getDataSources());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={3} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">System</div>
        <h1 className="page-title">Data Sources</h1>
        <p className="page-sub">Status and availability of all upstream data feeds.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Upstream Feeds</span>
          <span className="small muted">{sources.length} sources</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Category</th>
                <th>Status</th>
                <th>Coverage</th>
                <th>Last Update</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 700 }}>{s.name}</td>
                  <td className="muted">{s.category}</td>
                  <td>
                    <span className={`status-label ${toneFor(s.status)}`}>
                      <span className="dot" /> {s.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="muted small">{s.coverage ?? "—"}</td>
                  <td className="mono small muted-3">
                    {s.lastUpdate ? new Date(s.lastUpdate).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

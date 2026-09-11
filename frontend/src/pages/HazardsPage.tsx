import { useEffect, useState } from "react";
import { DemoBanner } from "@/components/common/DemoBanner";
import { EmptyState, LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import { StatusLabel, SectionLabel } from "@/components/design";
import { RiskPill } from "@/components/common/RiskPill";
import type { RainfallReport, WindReport, FloodReport, HazardSeverity } from "@/types";

export default function HazardsPage() {
  const [rain, setRain] = useState<RainfallReport | null>(null);
  const [wind, setWind] = useState<WindReport | null>(null);
  const [flood, setFlood] = useState<FloodReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, w, f] = await Promise.all([
          toofanService.getRainfall(),
          toofanService.getWind(),
          toofanService.getFlood(),
        ]);
        setRain(r);
        setWind(w);
        setFlood(f);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={3} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Forecast</div>
        <h1 className="page-title">Hazards</h1>
        <p className="page-sub">Rainfall, wind, and flood hazard analysis on a single view.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      <div className="hazard-strip" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="hazard-module">
          <span className="lbl">Rainfall Model</span>
          <div className="mono small" style={{ marginTop: 4 }}>{rain?.modelName ?? "—"}</div>
          {rain ? <div style={{ marginTop: 6 }}><StatusLabel status={rain.status.status} /></div> : null}
        </div>
        <div className="hazard-module">
          <span className="lbl">Wind Model</span>
          <div className="mono small" style={{ marginTop: 4 }}>{wind?.modelName ?? "—"}</div>
          {wind ? <div style={{ marginTop: 6 }}><StatusLabel status={wind.status.status} /></div> : null}
        </div>
        <div className="hazard-module">
          <span className="lbl">Flood Model</span>
          <div className="mono small" style={{ marginTop: 4 }}>{flood?.modelName ?? "—"}</div>
          {flood ? <div style={{ marginTop: 6 }}><StatusLabel status={flood.status.status} /></div> : null}
        </div>
        <div className="hazard-module">
          <span className="lbl">Flood Overall Risk</span>
          <div style={{ marginTop: 4 }}>
            {flood?.overallRisk ? <RiskPill severity={flood.overallRisk} /> : <span className="muted-3">—</span>}
          </div>
        </div>
      </div>

      {/* ═══ RAINFALL ═══ */}
      <section style={{ marginBottom: "var(--section-gap)" }}>
        <SectionLabel label="Rainfall" strong />
        <div className="stack" style={{ marginTop: "var(--sp-2)" }}>
          {rain?.isBaseline && (
            <div className="warning-block warn-accent">
              <div className="lbl">BASELINE MODEL</div>
              <p className="small muted" style={{ marginTop: 8 }}>
                This is a <strong>same-time classifier</strong>, <strong>NOT</strong> a validated 24-hour future rainfall forecast. Do not present these values as future predictions.
              </p>
              <p className="micro muted-3" style={{ marginTop: 8 }}>Model: {rain.modelName}</p>
            </div>
          )}

          {rain?.accumulations && rain.accumulations.length > 0 && (
            <div className="card-grid">
              {rain.accumulations.map((acc) => (
                <AccumulationCard
                  key={acc.window}
                  title={`${acc.label} · ${acc.window}`}
                  rows={acc.regions.map((r) => ({
                    label: `${r.radiusKm} km`,
                    value: r.expectedMm != null ? `${r.expectedMm} mm` : "—",
                    risk: r.risk,
                  }))}
                />
              ))}
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">District Ranking</span>
              <span className="small muted">By expected rainfall</span>
            </div>
            <div className="panel-body">
              {rain?.districtRanking && rain.districtRanking.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>District</th>
                      <th>State</th>
                      <th style={{ textAlign: "right" }}>Expected (mm)</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rain.districtRanking.map((d, i) => (
                      <tr key={d.district}>
                        <td className="mono muted-3">{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{d.district}</td>
                        <td className="muted">{d.state}</td>
                        <td style={{ textAlign: "right" }} className="mono">{d.expectedMm ?? "—"}</td>
                        <td><RiskPill severity={d.risk} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState big="NO DISTRICT DATA" message="No district-level rainfall data available." />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ WIND ═══ */}
      <section style={{ marginBottom: "var(--section-gap)" }}>
        <SectionLabel label="Wind" strong />
        <div className="stack" style={{ marginTop: "var(--sp-2)" }}>
          {wind?.status.status === "RUNTIME_REQUIRED" && (
            <div className="warning-block bad-accent">
              <div className="lbl">RUNTIME REQUIRED</div>
              <p className="small muted" style={{ marginTop: 8 }}>
                TensorFlow is required to execute the wind model (.keras). TensorFlow is not currently installed in this environment.
              </p>
              <p className="micro muted-3" style={{ marginTop: 8 }}>Model: {wind.modelName}</p>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Wind Field Forecast</span>
              {wind ? <StatusLabel status={wind.status.status} /> : null}
            </div>
            <div className="panel-body">
              {wind && wind.zones && wind.zones.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th style={{ textAlign: "right" }}>Max Wind (kt)</th>
                      <th style={{ textAlign: "right" }}>Radius (km)</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wind.zones.map((z) => (
                      <tr key={z.name}>
                        <td style={{ fontWeight: 600 }}>{z.name}</td>
                        <td style={{ textAlign: "right" }} className="mono">{z.maxKt ?? "—"}</td>
                        <td style={{ textAlign: "right" }} className="mono">{z.radiusKm ?? "—"}</td>
                        <td><RiskPill severity={z.risk ?? "MODERATE"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  big="WIND FORECAST UNAVAILABLE"
                  message={wind?.message ?? "No wind forecast data is available."}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FLOOD ═══ */}
      <section>
        <SectionLabel label="Flood" strong />
        <div className="stack" style={{ marginTop: "var(--sp-2)" }}>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">District Flood Risk</span>
              <span className="small muted">{flood?.districts?.length ?? 0} districts</span>
            </div>
            <div className="panel-body">
              {flood?.districts && flood.districts.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>District</th>
                      <th>State</th>
                      <th>Risk</th>
                      <th style={{ textAlign: "right" }}>Probability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flood.districts.map((d) => (
                      <tr key={d.district}>
                        <td style={{ fontWeight: 600 }}>{d.district}</td>
                        <td className="muted">{d.state}</td>
                        <td><RiskPill severity={d.risk} /></td>
                        <td style={{ textAlign: "right" }} className="mono">
                          {d.floodProbability !== undefined ? `${(d.floodProbability * 100).toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState big="NO FLOOD DATA" message="No district-level flood risk data available." />
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Validation Note</span></div>
            <div className="panel-body">
              <p className="small muted">
                Flood model: <code>flood_xgboost_spatial_holdout.pkl</code> (XGBoost / sklearn Pipeline).
                Case study: FANI 2019 (spatial holdout). Status: AVAILABLE. Model not yet integrated —
                generalization evidence limited to single-event spatial holdout validation.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AccumulationCard({
  title, rows,
}: {
  title: string;
  rows: { label: string; value: string; risk: HazardSeverity }[];
}) {
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">{title}</span></div>
      <div className="panel-body tight">
        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-small)" }}>
          {rows.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                padding: "10px 12px",
                borderBottom: i < rows.length - 1 ? "1px solid var(--line-soft)" : "none",
              }}
            >
              <span className="mono" style={{ fontWeight: 600 }}>{r.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="mono muted">{r.value}</span>
                <RiskPill severity={r.risk} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

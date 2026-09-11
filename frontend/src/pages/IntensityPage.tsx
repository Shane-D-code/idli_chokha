import { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "@/components/common/StateBox";
import { RiskPill } from "@/components/common/RiskPill";
import { toofanService } from "@/services/toofanService";
import { SectionLabel, MetricBlock, StatusLabel, DataRow, ThinDivider } from "@/components/design";
import type {
  HazardSeverity,
  IntensityReport,
  RIReport,
  RIModelOutput,
} from "@/types";

export default function IntensityPage() {
  const [data, setData] = useState<IntensityReport | null>(null);
  const [ri, setRi] = useState<RIReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [intensity, riReport] = await Promise.all([
          toofanService.getIntensity(),
          toofanService.getRI(),
        ]);
        setData(intensity);
        setRi(riReport);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={3} /></div>;

  const fusionAvail = ri?.fusionProbability !== undefined;
  const leadAvail = ri?.leadProbability !== undefined;
  const members = ri?.models ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Forecast</div>
        <h1 className="page-title">Intensity & Rapid Intensification</h1>
        <p className="page-sub">
          Current observed intensity, forecast maximum sustained wind, and the total probability of rapid
          intensification within 24 hours across the RI model ensemble.
        </p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}>
          {data?.status ? <StatusLabel status={data.status.status} /> : null}
        </div>
      </div>

      {/* ═══ RAPID INTENSIFICATION ═══ */}
      <SectionLabel label="Rapid Intensification · 24h" strong />
      <div className="panel heavy" style={{ marginTop: "var(--sp-2)", marginBottom: "var(--section-gap)" }}>
        <div className="panel-body">
          <SectionLabel label="Total Predictability" />
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: "clamp(52px, 6vw, 96px)", lineHeight: 1 }}>
              {fusionAvail ? `${(ri!.fusionProbability! * 100).toFixed(1)}%` : "—"}
            </span>
            <div className="row gap-8">
              {leadAvail ? (
                <RiskPill severity={riskForProbability(ri!.leadProbability ?? ri!.fusionProbability!)} />
              ) : null}
              <StatusLabel status={ri?.status.status ?? "UNAVAILABLE"} />
            </div>
          </div>
          {fusionAvail ? (
            <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
              Weighted ensemble total · {members.filter((m) => m.probability !== undefined).length} contributing models
            </p>
          ) : (
            <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
              No ensemble total produced — fusion model is not trained.
            </p>
          )}
        </div>
      </div>

      {/* ═══ OBSERVED INTENSITY + TREND ═══ */}
      <SectionLabel label="Observed Intensity" strong />
      <div className="hero-grid" style={{ marginTop: "var(--sp-2)", marginBottom: "var(--section-gap)" }}>
        <div className="panel heavy">
          <div className="panel-head"><span className="panel-title">Observed Intensity</span></div>
          <div className="panel-body">
            <SectionLabel label="Current Readout" />
            <div className="metric-grid">
              <MetricBlock label="Max Wind" value={data?.current.windKt} unit="kt" />
              <MetricBlock label="Pressure" value={data?.current.mslpHpa} unit="hPa" />
              <MetricBlock label="RMW" value={data?.current.rmwKm} unit="km" />
            </div>
            <ThinDivider />
            {data?.current.category ? (
              <DataRow label="Category" value={data.current.category} />
            ) : null}
            <DataRow
              label="Observation"
              value={data?.current.observed ? "OBSERVED" : "ESTIMATE"}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Intensity Trend</span>
            {data?.status ? <StatusLabel status={data.status.status} /> : null}
          </div>
          <div className="panel-body">
            {data && data.forecastPoints && data.forecastPoints.length > 0 ? (
              <IntensityChart
                points={data.forecastPoints}
                currentWindKt={data.current.windKt}
              />
            ) : (
              <EmptyState
                big="INTENSITY FORECAST UNAVAILABLE"
                message="No intensity forecast is available. Only current observed values are shown."
              />
            )}
          </div>
        </div>
      </div>

      {/* ═══ INTENSITY FORECAST TABLE ═══ */}
      {data && data.forecastPoints && data.forecastPoints.length > 0 && (
        <>
          <SectionLabel label="Intensity Forecast" strong />
          <div className="panel" style={{ marginTop: "var(--sp-2)", marginBottom: "var(--section-gap)" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Horizon</th>
                  <th>Wind (kt)</th>
                  <th>Pressure (hPa)</th>
                  <th>RMW (km)</th>
                </tr>
              </thead>
              <tbody>
                {data.forecastPoints.map((p) => (
                  <tr key={p.horizonHours}>
                    <td className="mono">+{p.horizonHours}h</td>
                    <td className="mono">{p.windKt ?? "—"}</td>
                    <td className="mono">{p.mslpHpa ?? "—"}</td>
                    <td className="mono">{p.rmwKm ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ═══ RI MODEL ENSEMBLE ═══ */}
      <SectionLabel label="RI Model Ensemble" strong />
      <div className="stack" style={{ marginTop: "var(--sp-2)", marginBottom: "var(--section-gap)" }}>
        {members.length === 0 ? (
          <EmptyState big="NO RI MODELS" message="No rapid intensification model outputs returned." />
        ) : (
          members.map((m) => (
            <ModelRow key={m.modelId} m={m} />
          ))
        )}
      </div>

      {/* ═══ RI FEATURE ATTRIBUTION ═══ */}
      <div className="panel">
        <div className="panel-head"><span className="panel-title">RI Feature Attribution</span></div>
        <div className="panel-body">
          {ri?.featureImportance && ri.featureImportance.length ? (
            <div className="stack-sm">
              {ri.featureImportance.map((f) => (
                <DataRow key={f.feature} label={f.feature} value={f.importance.toFixed(2)} />
              ))}
            </div>
          ) : (
            <EmptyState
              big="FEATURE ATTRIBUTION UNAVAILABLE"
              message="No SHAP or feature-importance explanation is currently provided by the RI backend."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function riskForProbability(p: number): HazardSeverity {
  if (p < 0.3) return "LOW";
  if (p < 0.5) return "MODERATE";
  if (p < 0.75) return "HIGH";
  return "EXTREME";
}

function ModelRow({ m }: { m: RIModelOutput }) {
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--sp-2)" }}>
        <div>
          <div style={{ fontFamily: "var(--display)", fontWeight: 900, textTransform: "uppercase", fontSize: "var(--text-section)" }}>
            {m.name}
          </div>
          <div className="small muted">{m.inputType}</div>
        </div>
        <div className="row gap-8">
          {m.risk ? <RiskPill severity={m.risk} /> : null}
          <StatusLabel status={m.status} />
        </div>
      </div>
      <ThinDivider />
      <div className="metric-grid">
        <MetricBlock label="Probability" value={m.probability !== undefined ? `${(m.probability * 100).toFixed(1)}%` : "—"} size="sm" />
        <MetricBlock label="Framework" value={m.framework ?? "—"} size="sm" />
        <MetricBlock label="Features" value={m.featureCount ?? "—"} size="sm" />
      </div>
      {m.statusNote ? (
        <>
          <ThinDivider faint />
          <p className="small muted">{m.statusNote}</p>
        </>
      ) : null}
    </div>
  );
}

/* Editorial hand-rolled line chart — plots real backend points. */
function IntensityChart({
  points,
  currentWindKt,
}: {
  points: { horizonHours: number; windKt?: number }[];
  currentWindKt?: number;
}) {
  const data = points.filter((p) => p.windKt !== undefined);
  const all = currentWindKt !== undefined ? [{ horizonHours: 0, windKt: currentWindKt }, ...data] : data;
  const max = Math.max(...all.map((p) => p.windKt!)) || 1;
  const min = Math.min(...all.map((p) => p.windKt!));
  const span = Math.max(1, max - min);
  const W = 520;
  const H = 220;
  const pad = 26;

  const x = (i: number) => pad + (i / Math.max(1, all.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const linePts = all.map((p, i) => `${x(i)},${y(p.windKt!)}`).join(" ");
  const last = all[all.length - 1];

  return (
    <div role="img" aria-label="Intensity forecast chart">
      <div className="lbl" style={{ marginBottom: 6 }}>Max Sustained Wind (kt)</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={pad + t * (H - pad * 2)} y2={pad + t * (H - pad * 2)} stroke="var(--line-soft)" strokeWidth="1" />
        ))}
        {all.length > 1 && (
          <polyline points={linePts} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {all.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.windKt!)} r="4" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="row" style={{ justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: "var(--text-micro)", color: "var(--ink-3)" }}>
        <span>NOW</span>
        <span>+{last.horizonHours}h · {last.windKt} kt</span>
      </div>
    </div>
  );
}

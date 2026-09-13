import { useEffect, useState } from "react";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { toofanService } from "@/services/toofanService";
import {
  SectionLabel,
  StatusLabel,
  DataRow,
  ThinDivider,
  HazardModule,
} from "@/components/design";
import { RiskPill } from "@/components/common/RiskPill";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import type { RainfallReport, CycloneState } from "@/types";

export default function RainfallPage() {
  const [data, setData] = useState<RainfallReport | null>(null);
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([
          toofanService.getRainfall(),
          toofanService.getCyclone(),
        ]);
        setData(d);
        setCyc(c);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={3} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Hazard</div>
        <h1 className="page-title">Rainfall</h1>
        <p className="page-sub">Cyclone precipitation — simulated accumulation for demo (same-time baseline classifier).</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}>
          {data?.status ? <StatusLabel status={data.status.status} /> : null}
          <DemoBanner />
        </div>
      </div>

      {data?.isBaseline || data?.status.status === "BASELINE" ? (
        <div className="warning-block warn-accent" style={{ marginBottom: "var(--section-gap)" }}>
          <div className="lbl" style={{ color: "var(--warn)" }}>BASELINE MODEL</div>
          <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-section)", textTransform: "uppercase", marginTop: 4 }}>
            Not a validated future forecast
          </div>
          <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
            {data?.baselineNotice ||
              "This model is a baseline / same-time classifier. It is NOT a validated 24-hour future rainfall forecast."}
          </p>
        </div>
      ) : null}

      {/* ═══ LARGE RAINFALL MAP ═══ */}
      <div className="map-container" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="map-kicker">RAINFALL · REGIONAL ACCUMULATION</div>
        <MapErrorBoundary title="RAINFALL MAP UNAVAILABLE" height="100%">
          <CycloneMap
            current={
              cyc ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name } : undefined
            }
          />
        </MapErrorBoundary>
      </div>

      {/* ═══ ACCUMULATION WINDOWS ═══ */}
      {data?.accumulations && data.accumulations.length ? (
        <>
          <SectionLabel label="Accumulation Windows" strong />
          <div className="hazard-strip" style={{ marginTop: "var(--sp-2)", marginBottom: "var(--section-gap)" }}>
            {data.accumulations.map((w) => (
              <div key={w.window} className="hazard-module">
                <div className="m-title" style={{ fontSize: "0.9rem" }}>{w.label}</div>
                <div className="m-meta stack-sm">
                  {w.regions.map((r) => (
                    <div key={r.radiusKm} className="data-row">
                      <span className="k">{r.radiusKm} km</span>
                      <span className="v">
                        {r.expectedMm !== undefined ? `${r.expectedMm} mm` : "—"}
                        {" · "}<RiskPill severity={r.risk} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* ═══ DISTRICT RANKING + MODEL INFO ═══ */}
      <div className="hero-grid" style={{ gridTemplateColumns: "1fr 360px" }}>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">District Ranking</span></div>
          <div className="panel-body tight">
            {data?.districtRanking && data.districtRanking.length ? (
              data.districtRanking.map((d) => (
                <div className="data-row" key={d.district}>
                  <span className="k">{d.district} · {d.state}</span>
                  <span className="v">
                    {d.expectedMm !== undefined ? `${d.expectedMm} mm` : ""} <RiskPill severity={d.risk} />
                  </span>
                </div>
              ))
            ) : (
              <p className="small muted">No district ranking available.</p>
            )}
          </div>
        </div>

        <aside className="rail-stack">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Model Information</span></div>
            <div className="panel-body">
              <DataRow label="Model" value={data?.modelName ?? "—"} />
              <DataRow label="Classification" value={data?.isBaseline ? "BASELINE" : "—"} />
              <DataRow label="Accepted" value={data?.accepted ? "YES" : "NO"} />
              <ThinDivider faint />
              <HazardModule
                label="Rainfall"
                status={data?.status.status ?? "UNAVAILABLE"}
                detail={data?.baselineNotice}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

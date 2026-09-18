import { useEffect, useState } from "react";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { toofanService } from "@/services/toofanService";
import {
  StatusLabel,
  DataRow,
  ThinDivider,
  HazardModule,
} from "@/components/design";
import { RiskPill } from "@/components/common/RiskPill";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import { formatIST } from "@/utils/format";
import type { FloodReport, CycloneState } from "@/types";

export default function FloodPage() {
  const [data, setData] = useState<FloodReport | null>(null);
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([
          toofanService.getFlood(),
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

  // A flood module reporting DATA_UNAVAILABLE has no assessed overall risk —
  // the pill must not be rendered as a live classification.
  const floodUsable =
    data?.status.status !== "UNAVAILABLE" &&
    data?.status.status !== "DATA_UNAVAILABLE" &&
    data?.status.status !== "RUNTIME_REQUIRED";

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Hazard</div>
        <h1 className="page-title">Flood</h1>
        <p className="page-sub">Spatial flood hazard analysis — affected districts and inundation risk.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}>
          {data?.status ? <StatusLabel status={data.status.status} /> : null}
          <DemoBanner />
        </div>
      </div>

      {/* ═══ LARGE GEOGRAPHIC FLOOD MAP ═══ */}
      <div className="map-container" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="map-kicker">FLOOD · SPATIAL HAZARD ANALYSIS</div>
        <MapErrorBoundary title="FLOOD MAP UNAVAILABLE" height="100%">
          <CycloneMap
            current={
              cyc ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name } : undefined
            }
          />
        </MapErrorBoundary>
      </div>

      {/* ═══ RISK / AFFECTED AREAS ═══ */}
      <div className="hero-grid">
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Affected Districts</span></div>
          <div className="panel-body tight">
            {data?.districts && data.districts.length ? (
              data.districts.map((d) => (
                <div className="data-row" key={d.district}>
                  <span className="k">{d.district} · {d.state}</span>
                  <span className="v">
                    {d.floodProbability !== undefined
                      ? `${(d.floodProbability * 100).toFixed(0)}% `
                      : ""}
                    <RiskPill severity={d.risk} />
                  </span>
                </div>
              ))
            ) : (
              <p className="small muted">No district-level flood output available.</p>
            )}
          </div>
        </div>

        <aside className="rail-stack">
          <div className="panel heavy">
            <div className="panel-head"><span className="panel-title">Overall Flood Risk</span></div>
            <div className="panel-body">
              {floodUsable && data?.overallRisk ? (
                <RiskPill severity={data.overallRisk} />
              ) : (
                <p className="small muted">
                  {data ? "No overall risk — flood module is not producing a live assessment." : "—"}
                </p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Model Information</span></div>
            <div className="panel-body">
              <DataRow label="Model" value={data?.modelName ?? "—"} />
              <DataRow label="Type" value={data?.modelType ?? "—"} />
              <DataRow label="Features" value={data?.featureCount ?? "—"} />
              <DataRow label="Prediction" value={formatIST(data?.predictionTimestamp)} />
              <DataRow label="Status" value={<StatusLabel status={data?.status.status ?? "UNAVAILABLE"} />} />
              <ThinDivider faint />
              <HazardModule
                label="Flood Model"
                status={data?.status.status ?? "UNAVAILABLE"}
                detail={data?.modelName}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

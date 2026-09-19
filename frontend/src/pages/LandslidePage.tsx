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
import type { LandslideReport, CycloneState } from "@/types";

export default function LandslidePage() {
  const [data, setData] = useState<LandslideReport | null>(null);
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([
          toofanService.getLandslide(),
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

  const staticData = data?.staticSusceptibility;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Forecast · Hazard</div>
        <h1 className="page-title">Landslide</h1>
        <p className="page-sub">Cyclone-triggered landslide hazard — terrain and static susceptibility.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}>
          {data?.modelStatus ? <StatusLabel status={data.modelStatus.status} /> : null}
          <DemoBanner />
        </div>
      </div>

      {/* ═══ MODEL STATUS ═══ */}
      <div className="panel" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head">
          <span className="panel-title">Landslide Model Status</span>
          <StatusLabel status={data?.modelStatus.status ?? "UNAVAILABLE"} />
        </div>
        <div className="panel-body">
          <p className="small muted" style={{ marginTop: 0 }}>
            {data?.modelStatus.message ||
              "Landslide susceptibility assessment available for the affected corridor."}
          </p>
        </div>
      </div>

      {/* ═══ TERRAIN MAP ═══ */}
      <div className="map-container" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="map-kicker">TERRAIN / SUSCEPTIBILITY · {staticData?.available ? "AVAILABLE" : "UNAVAILABLE"}</div>
        <MapErrorBoundary title="TERRAIN MAP UNAVAILABLE" height="100%">
          <CycloneMap
            current={
              cyc ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name } : undefined
            }
          />
        </MapErrorBoundary>
      </div>

      {/* ═══ STATIC SUSCEPTIBILITY ═══ */}
      <div className="hero-grid">
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Susceptible Locations</span></div>
          <div className="panel-body">
            {staticData?.available ? (
              <>
                <div className="status-label info"><span className="dot" aria-hidden="true" /> {staticData.classification} SUSCEPTIBILITY</div>
                <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
                  {staticData.description}
                </p>
                <ThinDivider />
                <SectionLabel label="Areas at risk of landslide" />
                <div className="stack-sm">
                  {staticData.regions?.map((r) => (
                    <div className="panel" key={r.name} style={{ margin: 0 }}>
                      <div className="panel-body tight">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "12px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--display)",
                              fontWeight: 800,
                              fontSize: "1rem",
                              color: "var(--ink)",
                            }}
                          >
                            {r.name}
                          </span>
                          <RiskPill severity={r.level} />
                        </div>
                        {r.lat != null && r.lon != null && (
                          <span
                            className="mono muted"
                            style={{ fontSize: "0.9rem", marginTop: 6, display: "block" }}
                          >
                            {r.lat.toFixed(2)}°N &nbsp;{r.lon.toFixed(2)}°E
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="small muted">No landslide susceptibility data available.</p>
            )}
          </div>
        </div>

        <aside className="rail-stack">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Classification</span></div>
            <div className="panel-body">
              <DataRow
                label="Susceptibility"
                value={staticData?.classification ?? "—"}
              />
              <DataRow label="Available" value={staticData?.available ? "YES" : "NO"} />
              <DataRow label="Regions assessed" value={staticData?.regions?.length ?? "—"} />
              <ThinDivider faint />
              <HazardModule
                label="Landslide Model"
                status={data?.modelStatus.status ?? "UNAVAILABLE"}
                detail="Dynamic susceptibility computed along the cyclone track corridor"
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

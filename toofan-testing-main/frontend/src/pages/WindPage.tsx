import { useEffect, useState } from "react";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { toofanService } from "@/services/toofanService";
import {
  SectionLabel,
  StatusLabel,
  DataRow,
  ThinDivider,
} from "@/components/design";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import type { WindReport, CycloneState } from "@/types";

export default function WindPage() {
  const [data, setData] = useState<WindReport | null>(null);
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([
          toofanService.getWind(),
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

  const runtimeBlocked = data?.status.status === "RUNTIME_REQUIRED";

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Hazard</div>
        <h1 className="page-title">Wind</h1>
        <p className="page-sub">Wind field analysis — maximum wind and wind radii by zone.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}>
          {data?.status ? <StatusLabel status={data.status.status} /> : null}
          <DemoBanner />
        </div>
      </div>

      {/* ═══ RUNTIME REQUIRED WARNING ═══ */}
      {runtimeBlocked ? (
        <div className="warning-block bad-accent" style={{ marginBottom: "var(--section-gap)" }}>
          <div className="lbl" style={{ color: "var(--bad)" }}>RUNTIME REQUIRED</div>
          <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-section)", textTransform: "uppercase", marginTop: 4 }}>
            TensorFlow unavailable — no wind forecast
          </div>
          <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
            {data?.message ||
              "The wind field model is a Keras model and requires the TensorFlow runtime. TensorFlow is not currently installed, so no wind field forecast can be produced. No fabricated wind values are displayed."}
          </p>
        </div>
      ) : null}

      {/* ═══ WIND FIELD MAP ═══ */}
      <div className="map-container" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="map-kicker">WIND FIELD · {runtimeBlocked ? "UNAVAILABLE" : "SIMULATED"}</div>
        <MapErrorBoundary title="WIND MAP UNAVAILABLE" height="100%">
          <CycloneMap
            current={
              cyc ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name, windKt: cyc.windKt } : undefined
            }
          />
        </MapErrorBoundary>
      </div>

      {/* ═══ READOUT ═══ */}
      <div className="hero-grid">
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Maximum Wind</span></div>
          <div className="panel-body">
            <SectionLabel label="At Current Cyclone" />
            <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-metric)" }}>
              {cyc?.windKt ?? "—"}<span className="unit" style={{ fontSize: "0.5em", color: "var(--ink-3)" }}> kt</span>
            </div>
            <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
              {runtimeBlocked
                ? "Field-level wind radii are unavailable (TensorFlow runtime required). Only the observed cyclone intensity is shown."
                : "Simulated wind radii shown below for UI verification in demo mode."}
            </p>
          </div>
        </div>

        <aside className="rail-stack">
          {!runtimeBlocked && data?.zones && data.zones.length ? (
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Wind Radii</span></div>
              <div className="panel-body tight">
                {data.zones.map((z) => (
                  <DataRow
                    key={z.name}
                    label={z.name}
                    value={`${z.maxKt ?? "—"} kt · ${z.radiusKm ?? "—"} km`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Model Information</span></div>
            <div className="panel-body">
              <DataRow label="Model" value={data?.modelName ?? "—"} />
              <DataRow label="Framework" value={data?.requiresRuntime ?? "—"} />
              <DataRow label="Runtime" value={runtimeBlocked ? "REQUIRED" : "—"} />
              <DataRow label="Status" value={<StatusLabel status={data?.status.status ?? "UNAVAILABLE"} />} />
              <ThinDivider faint />
              <p className="small muted">
                {data?.message}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

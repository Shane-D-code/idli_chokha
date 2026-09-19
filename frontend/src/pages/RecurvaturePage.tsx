import { useEffect, useMemo, useRef, useState } from "react";
import { SectionLabel, ThinDivider, DataRow } from "@/components/design";
import { StatusBadge } from "@/components/common/StatusBadge";
import { RiskPill } from "@/components/common/RiskPill";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import { RecurvatureMap } from "@/components/recurvature/RecurvatureMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { CycloneTimeline } from "@/components/map/CycloneTimeline";
import {
  buildNormalReference,
  buildRecurvingReference,
  compassPoint,
} from "@/components/recurvature/recurvatureGeometry";
import { bearing } from "@/utils/trackGeometry";
import type {
  CycloneState,
  FeatureImportance,
  HazardSeverity,
  RecurvatureReport,
  TrajectoryForecast,
} from "@/types";

const PLAYBACK_MS = 1200;

export default function RecurvaturePage() {
  const [report, setReport] = useState<RecurvatureReport | null>(null);
  const [cyclone, setCyclone] = useState<CycloneState | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<Record<string, boolean>>({
    current: true,
    historical: true,
    forecast: true,
    uncertainty: true,
    normal: true,
    recurving: true,
    recurvePoint: true,
    arrows: true,
  });
  const [timelineIdx, setTimelineIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [highlightScenario, setHighlightScenario] = useState<"normal" | "recurving" | null>(null);
  const [showLayers, setShowLayers] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [rep, cyc, traj] = await Promise.all([
          toofanService.getRecurvature(),
          toofanService.getCyclone(),
          toofanService.getTrajectory(),
        ]);
        setReport(rep);
        setCyclone(cyc);
        setTrajectory(traj);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const forecastPts = useMemo(
    () =>
      (trajectory?.points ?? []).filter((p) => p.isForecast).map((p) => ({
        lat: p.latitude,
        lon: p.longitude,
        timestamp: p.timestamp,
        windKt: p.windKt,
        uncertaintyKm: p.uncertaintyKm,
        horizonHours: p.horizonHours,
      })),
    [trajectory]
  );
  const historicalPts = useMemo(
    () =>
      (trajectory?.points ?? [])
        .filter((p) => !p.isForecast)
        .map((p) => ({
          lat: p.latitude,
          lon: p.longitude,
          timestamp: p.timestamp,
          windKt: p.windKt,
        })),
    [trajectory]
  );

  const currentPos = cyclone
    ? { lat: cyclone.latitude, lon: cyclone.longitude, name: cyclone.name, windKt: cyclone.windKt, mslpHpa: cyclone.mslpHpa }
    : trajectory?.points?.[0]
    ? { lat: trajectory.points[0].latitude, lon: trajectory.points[0].longitude }
    : undefined;

  const currentHeading = report?.currentHeadingDeg ?? cyclone?.movement?.bearingDeg;
  const currentSpeed = cyclone?.movement?.speedKph ?? (cyclone?.movement?.speedKt != null ? Math.round(cyclone.movement.speedKt * 1.852) : undefined);

  // Autoplay
  useEffect(() => {
    setTimelineIdx(0);
    setPlaying(false);
  }, [forecastPts.length]);

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setTimelineIdx((i) => {
          if (i >= forecastPts.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      }, PLAYBACK_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, forecastPts.length]);

  const refs = useMemo(() => {
    if (!currentPos) return { normal: [], recurving: [], recurvePoint: null as null | { lat: number; lon: number } };
    const heading = currentHeading ?? 315;
    const start = { lat: currentPos.lat, lon: currentPos.lon };
    const normal = buildNormalReference(start, heading).map((p) => ({ lat: p.lat, lon: p.lon }));
    const { path, recurvatureIndex } = buildRecurvingReference(start, heading);
    const recurvePt = path[recurvatureIndex]
      ? { lat: path[recurvatureIndex].lat, lon: path[recurvatureIndex].lon }
      : null;
    return {
      normal,
      recurving: path.map((p) => ({ lat: p.lat, lon: p.lon })),
      recurvePoint: recurvePt,
    };
  }, [currentPos, currentHeading]);

  const available =
    report?.status.status === "AVAILABLE" && report.prediction?.probability !== undefined;
  const probability = available ? report!.prediction!.probability : undefined;
  const risk = available ? report!.prediction!.risk : report?.risk;

  const headingChange = available ? report!.prediction!.headingChangeDeg : undefined;

  const selectedForecast = forecastPts[timelineIdx] ?? null;
  const highlightPoint = selectedForecast
    ? { lat: selectedForecast.lat, lon: selectedForecast.lon }
    : null;

  // Move the vortex along the trajectory: at timelineIdx 0 → currentPos,
  // otherwise at the selected forecast position.
  const vortexPos = currentPos && selectedForecast && timelineIdx > 0
    ? { lat: selectedForecast.lat, lon: selectedForecast.lon, name: currentPos.name, windKt: currentPos.windKt, mslpHpa: currentPos.mslpHpa }
    : currentPos;

  // Direction for the vortex: current → next forecast point, or along the forecast track.
  const vortexBearing = useMemo(() => {
    if (!vortexPos) return null;
    if (timelineIdx === 0 && currentPos && forecastPts.length > 0) {
      return bearing(
        { lat: currentPos.lat, lon: currentPos.lon },
        { lat: forecastPts[0].lat, lon: forecastPts[0].lon },
      );
    }
    if (timelineIdx >= 0 && timelineIdx < forecastPts.length - 1) {
      return bearing(
        { lat: forecastPts[timelineIdx].lat, lon: forecastPts[timelineIdx].lon },
        { lat: forecastPts[timelineIdx + 1].lat, lon: forecastPts[timelineIdx + 1].lon },
      );
    }
    if (forecastPts.length > 1) {
      return bearing(
        { lat: forecastPts[0].lat, lon: forecastPts[0].lon },
        { lat: forecastPts[1].lat, lon: forecastPts[1].lon },
      );
    }
    return null;
  }, [vortexPos, currentPos, forecastPts, timelineIdx]);

  const toggleLayer = (k: string) => setLayers((p) => ({ ...p, [k]: !p[k] }));

  if (loading) return <div className="page"><LoadingState rows={4} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Forecast</div>
        <h1 className="page-title">Recurvature</h1>
        <p className="page-sub">
          Track direction change — the likelihood of a cyclone turning from its current trajectory toward a
          northward or northeastward path.
        </p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}>
          {report ? <StatusBadge status={report.status.status} /> : null}
          <DemoBanner />
        </div>
        {report?.status && (report.status.status === "NOT_AVAILABLE" || report.status.status === "ERROR") && report.status.message ? (
          <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>Reason: {report.status.message}</p>
        ) : null}
      </div>

      {/* ═══ HERO: MAP + ANALYSIS ═══ */}
      <div className="hero-grid" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="map-container">
          <div className="map-kicker">CYCLONE TRAJECTORY · NORTH INDIAN OCEAN</div>
          <div className="map-overlay" style={{ top: 52, display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn sm muted-b" onClick={() => setShowLayers((s) => !s)} aria-expanded={showLayers}>
              Layers
            </button>
            {showLayers ? (
              <div className="layer-panel" style={{ position: "static" }}>
                <div className="layer-group">
                  <h4>Tracks</h4>
                  {[
                    ["current", "Current Position"],
                    ["historical", "Historical Track"],
                    ["forecast", "Model Forecast"],
                    ["normal", "Normal Reference"],
                    ["recurving", "Recurving Reference"],
                  ].map(([k, l]) => (
                    <LayerCheck key={k} k={k} l={l} state={layers} onToggle={toggleLayer} />
                  ))}
                </div>
                <div className="layer-group">
                  <h4>Environment</h4>
                  {[
                    ["wind", "Wind Field"],
                    ["sst", "SST"],
                    ["pressure", "Pressure"],
                  ].map(([k, l]) => (
                    <LayerCheck key={k} k={k} l={l} state={layers} onToggle={toggleLayer} unavailable />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <Legend onScenario={setHighlightScenario} activeScenario={highlightScenario} />
          <MapErrorBoundary title="RECURVATURE MAP UNAVAILABLE" height="100%">
            <RecurvatureMap
              current={vortexPos}
              historical={historicalPts}
              forecast={forecastPts}
              normalRef={refs.normal}
              recurvingRef={refs.recurving}
              recurvaturePoint={refs.recurvePoint}
              highlightPoint={highlightPoint}
              bearing={vortexBearing}
              layers={{
                ...layers,
                normal: layers.normal && highlightScenario !== "recurving",
                recurving: layers.recurving && highlightScenario !== "normal",
              }}
            />
          </MapErrorBoundary>

          {/* Timeline */}
          <div className="timeline" style={{ border: "none", borderTop: "1px solid var(--line-soft)", borderRadius: 0, marginTop: 0, padding: 0 }}>
            <CycloneTimeline
              points={forecastPts.map((p) => ({
                horizonHours: p.horizonHours,
                timestamp: p.timestamp,
                latitude: p.lat,
                longitude: p.lon,
              }))}
              currentIndex={timelineIdx}
              playing={playing}
              onIndexChange={(i) => setTimelineIdx(i)}
              onPlayToggle={() => setPlaying((p) => !p)}
              onStep={(d) => setTimelineIdx((i) => Math.max(0, Math.min(forecastPts.length - 1, i + d)))}
              currentLabel={selectedForecast?.timestamp
                ? new Date(selectedForecast.timestamp).toLocaleString([], {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })
                : "—"}
            />
          </div>
        </div>

        {/* Right analysis rail */}
        <aside className="rail-stack">
          <div className="panel heavy">
            <div className="panel-head"><span className="panel-title">Recurvature Assessment</span></div>
            <div className="panel-body">
              {available && probability !== undefined ? (
                <AssessmentAvailable probability={probability} risk={risk} report={report} />
              ) : (
                <AssessmentUnavailable status={report?.status.status ?? "UNAVAILABLE"} />
              )}
            </div>
          </div>

          {report?.model ? (
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Model Information</span></div>
              <div className="panel-body tight">
                <DataRow label="Model" value={report.model.name ?? "—"} />
                <DataRow label="Framework" value={report.model.framework ?? "—"} />
                <DataRow label="Input Features" value={report.model.featureCount ?? "—"} />
                <DataRow label="Target" value={report.model.target ?? "Recurvature within forecast period"} />
                {report.model.version ? <DataRow label="Version" value={report.model.version} /> : null}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Track Scenario</span></div>
            <div className="panel-body stack-sm">
              <ScenarioButton
                icon="→"
                title="Normal Track"
                desc="Continues current heading"
                active={highlightScenario === "normal"}
                onClick={() => setHighlightScenario(highlightScenario === "normal" ? null : "normal")}
              />
              <ScenarioButton
                icon="↗"
                title="Recurving Track"
                desc="Changes heading north / northeast"
                active={highlightScenario === "recurving"}
                onClick={() => setHighlightScenario(highlightScenario === "recurving" ? null : "recurving")}
              />
              <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
                Reference trajectories for illustration. Not a second ML prediction.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* ═══ TRACK ANALYSIS ═══ */}
      <div className="panel" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head"><span className="panel-title">Track Analysis</span></div>
        <div className="panel-body">
          <div className="metric-grid">
            <TrackMetric
              label="Current Heading"
              value={currentHeading !== undefined ? `${compassPoint(currentHeading)} · ${Math.round(currentHeading)}°` : "—"}
            />
            <TrackMetric
              label="Movement Speed"
              value={currentSpeed !== undefined ? `${currentSpeed} km/h` : "—"}
            />
            <TrackMetric
              label="Heading Change"
              value={headingChange !== undefined ? `${headingChange >= 0 ? "+" : ""}${Math.round(headingChange)}°` : "—"}
              pill={risk}
            />
            <TrackMetric
              label="Recurvature Probability"
              value={probability !== undefined ? `${(probability * 100).toFixed(1)}%` : "—"}
            />
          </div>
        </div>
      </div>

      {/* ═══ RECURVATURE INDICATORS ═══ */}
      <div className="panel" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head">
          <span className="panel-title">Recurvature Indicators</span>
          {report ? <StatusBadge status={report.status.status} /> : null}
        </div>
        <div className="panel-body">
          {report?.featureImportance && report.featureImportance.length ? (
            <FeatureBars items={report.featureImportance} />
          ) : (
            <div>
              <DataRow label="Model Inputs" value={report?.model?.featureCount ? `${report.model.featureCount} features` : "—"} />
              <DataRow label="Target" value={report?.model?.target ?? "Recurvature within 24h"} />
              <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
                Feature-level attribution is not currently available for this model.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssessmentAvailable({ probability, risk, report }: { probability: number; risk?: HazardSeverity; report: RecurvatureReport | null }) {
  return (
    <div>
      <SectionLabel label="Probability of Recurvature" />
      <div style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: "clamp(44px, 5vw, 80px)", lineHeight: 1 }}>
        {(probability * 100).toFixed(1)}%
      </div>
      <div style={{ marginTop: "var(--sp-2)" }}>
        <div className="timeline-track" style={{ position: "relative", height: 8, borderRadius: 4, marginBottom: 4 }}>
          <div className="timeline-track filled" style={{ width: `${Math.min(100, probability * 100)}%`, height: 8, borderRadius: 4, background: "var(--ok)" }} />
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}><span className="small muted">0%</span><span className="small muted">100%</span></div>
      </div>
      <ThinDivider />
      {risk ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="lbl">Risk Classification</span>
          <RiskPill severity={risk} />
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: "space-between", marginTop: "var(--sp-2)" }}>
        <span className="lbl">Model Status</span>
        <StatusBadge status={report?.status.status ?? "AVAILABLE"} />
      </div>
    </div>
  );
}

function AssessmentUnavailable({ status }: { status: string }) {
  return (
    <div>
      <SectionLabel label="Recurvature Assessment" />
      <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-title)", textTransform: "uppercase" }}>
        Model Missing
      </div>
      <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
        No trained recurvature model artifact is currently available. A recurvature probability has not been
        fabricated.
      </p>
      <ThinDivider />
      <DataRow label="Probabilistic Output" value="—" />
      <DataRow label="Risk Classification" value="—" />
      <DataRow label="Heading Change" value="—" />
      <p className="small muted" style={{ marginTop: "var(--sp-2)" }}>
        Status: {status.replace(/_/g, " ")}
      </p>
    </div>
  );
}

function FeatureBars({ items }: { items: FeatureImportance[] }) {
  const top = items.slice(0, 8);
  const max = Math.max(...top.map((i) => i.importance), 0.0001);
  return (
    <div className="stack-sm">
      {top.map((i) => (
        <div
          key={i.feature}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 150px 48px",
            gap: "14px",
            alignItems: "center",
            padding: "10px 12px",
            border: "1px solid var(--line-soft)",
            borderRadius: "var(--radius-small)",
            background: "var(--surface)",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--ink)" }}>
            {i.feature}
          </span>
          <span
            className="timeline-track filled"
            style={{ position: "relative", height: 8, borderRadius: 4, background: "rgba(0,0,0,0.08)" }}
          >
            <span
              style={{
                display: "block",
                height: 8,
                borderRadius: 4,
                background: "var(--ink)",
                width: `${(i.importance / max) * 100}%`,
              }}
            />
          </span>
          <span
            className="mono"
            style={{ textAlign: "right", fontWeight: 800, fontSize: "0.95rem", color: "var(--ink-2)" }}
          >
            {i.importance.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrackMetric({ label, value, pill }: { label: string; value: string; pill?: HazardSeverity }) {
  return (
    <div className="metric-block">
      <span className="lbl">{label}</span>
      <span className="val sm" style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-metric-sm)", lineHeight: 1.1, marginTop: 3 }}>
        {value}
      </span>
      {pill ? <span style={{ marginTop: 4 }}><RiskPill severity={pill} /></span> : null}
    </div>
  );
}

function ScenarioButton({ icon, title, desc, active, onClick }: { icon: string; title: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="service-tab"
      style={{
        justifyContent: "space-between",
        width: "100%",
        cursor: "pointer",
        background: active ? "var(--ink)" : "var(--surface)",
        color: active ? "var(--bg)" : "var(--ink-2)",
        borderColor: "var(--line)",
      }}
      onClick={onClick}
      aria-pressed={active}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true">{icon}</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontSize: "var(--text-body)", fontWeight: 800 }}>{title}</span>
      </span>
      <span className="small muted" style={{ color: "inherit", opacity: 0.75 }}>{desc}</span>
    </button>
  );
}

function Legend({ onScenario, activeScenario }: { onScenario: (s: "normal" | "recurving" | null) => void; activeScenario: "normal" | "recurving" | null }) {
  return (
    <div className="layer-toggler" style={{ position: "absolute", bottom: 64, left: 12, zIndex: 10 }}>
      <div className="layer-panel" style={{ position: "static", width: 190 }}>
        <div className="lay-group"><h4>Track Legend</h4></div>
        <LegendRow swatch="dot current" label="Current Cyclone" />
        <LegendRow swatch="line hist" label="Historical" />
        <LegendRow swatch="line forecast" label="Model Forecast" />
        <LegendRow
          swatch="line normal"
          label="Normal Reference"
          interactive
          active={activeScenario === "normal"}
          onClick={() => onScenario(activeScenario === "normal" ? null : "normal")}
        />
        <LegendRow
          swatch="line recurving"
          label="Recurving Reference"
          interactive
          active={activeScenario === "recurving"}
          onClick={() => onScenario(activeScenario === "recurving" ? null : "recurving")}
        />
        <LegendRow swatch="dot recurvept" label="Recurvature Point" />
      </div>
    </div>
  );
}

function LegendRow({ swatch, label, interactive, active, onClick }: { swatch: string; label: string; interactive?: boolean; active?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <span className={swatch} aria-hidden="true" />
      <span>{label}</span>
    </>
  );
  return interactive && onClick ? (
    <button type="button" className="data-row" style={{ background: "none", border: "none", cursor: "pointer", width: "100%", color: active ? "var(--ink)" : "var(--ink-2)" }} onClick={onClick} aria-pressed={active}>
      {content}
    </button>
  ) : (
    <div className="data-row">{content}</div>
  );
}

function LayerCheck({ k, l, state, onToggle, unavailable }: { k: string; l: string; state: Record<string, boolean>; onToggle: (k: string) => void; unavailable?: boolean }) {
  return (
    <label className={`layer-item ${unavailable ? "disabled" : ""}`}>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <input type="checkbox" checked={!!state[k]} disabled={unavailable} onChange={() => onToggle(k)} />
        <span>{l}</span>
      </span>
      {unavailable ? <span className="small muted-3">Unavailable</span> : null}
    </label>
  );
}

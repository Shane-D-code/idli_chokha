import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Crosshair, Database, Gauge, Map as MapIcon, Waves } from "lucide-react";
import { useApp } from "@/state/AppContext";
import { useCommandCenterData } from "@/hooks/useCommandCenterData";
import { useModuleStatuses } from "@/hooks/useModuleStatuses";
import { PipelineFlow } from "@/components/overview/PipelineFlow";
import { CmSev } from "@/components/overview/CmSev";
import { PipelineStatusStrip } from "@/components/layout/PipelineStatusStrip";
import { RunAssessment } from "@/components/pipeline/RunAssessment";
import { CycloneMap, type HazardLayerData } from "@/components/map/CycloneMap";
import { moduleStatusColor, PIPELINE_MODULES, type ModuleKey } from "@/lib/moduleStatus";
import { formatIST } from "@/utils/format";
import { horizonsFrom, pct } from "@/components/mission/genesis/genesisModel";
import { TRACK_PLACES } from "@/utils/trackPlaces";
import { toofanService } from "@/services/toofanService";
import type { CycloneState, HazardSeverity, WindReport } from "@/types";
import type { ReactNode } from "react";

interface TileProps {
  label: string;
  status?: string | null;
  value?: ReactNode;
  unit?: string;
  sub?: string;
}

function Tile({ label, status, value, unit, sub }: TileProps) {
  const color = status ? moduleStatusColor(status) : undefined;
  return (
    <div className="cm-tile">
      <div className="cm-tile__kicker">
        <span className="cm-label">{label}</span>
        {status ? (
          <span className="cm-dot" style={{ ["--cm-dot" as string]: color }} />
        ) : null}
      </div>
      {value != null ? (
        <div className="cm-tile__value">
          {value}
          {unit ? <span className="unit">{unit}</span> : null}
        </div>
      ) : (
        <div className="cm-notavail">NOT_AVAILABLE</div>
      )}
      {sub ? <div className="cm-tile__sub">{sub}</div> : null}
    </div>
  );
}

/** Geocode a district / place name to a real lat/lon from the place registry.
 *  Only names that exist in the registry are plotted — never invented. */
function placeCoords(name: string): { lat: number; lon: number } | null {
  const n = name.trim().toLowerCase();
  const hit = TRACK_PLACES.find(
    (p) => p.name.toLowerCase() === n || n.includes(p.name.toLowerCase())
  );
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

/** District hazard points (rainfall / flood / landslide regions) — plotted
 *  only for names with registry coordinates, at their model-reported risk. */
function districtLayer(
  id: string,
  name: string,
  list: { district: string; risk: HazardSeverity }[]
): HazardLayerData | null {
  const points: NonNullable<HazardLayerData["points"]> = [];
  for (const d of list) {
    const c = placeCoords(d.district);
    if (c) {
      points.push({ lat: c.lat, lon: c.lon, level: d.risk, name: d.district, label: d.district });
    }
  }
  return points.length ? { id, name, points } : null;
}

type HazardPolyLevel = "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "EXTREME";

function polyLevel(risk?: HazardSeverity | null): HazardPolyLevel {
  return risk && risk !== "NONE" ? (risk as HazardPolyLevel) : "MODERATE";
}

/** Radial wind-field bands drawn around the current cyclone using the
 *  model-reported zone radii (km) and risk. Pure backend geometry — the ring
 *  radius comes straight from the wind report. */
function windFieldLayer(cyclone: CycloneState | null, wind: WindReport | null): HazardLayerData | null {
  if (!cyclone || !wind?.zones?.length) return null;
  const lat = cyclone.latitude;
  const lon = cyclone.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cosLat = Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  const rings: NonNullable<HazardLayerData["polygons"]> = [];
  for (const z of wind.zones) {
    if (z.radiusKm == null || z.radiusKm <= 0) continue;
    const radiusDeg = z.radiusKm / 111;
    const k = radiusDeg / cosLat;
    const n = 48;
    const ring: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      ring.push([lon + Math.cos(a) * k, lat + Math.sin(a) * radiusDeg]);
    }
    ring.push([ring[0][0], ring[0][1]]);
    rings.push({ coordinates: [ring], level: polyLevel(z.risk), name: z.name });
  }
  return rings.length ? { id: "wind-field", name: "Wind Field", polygons: rings } : null;
}

export default function DashboardPage() {
  const { mode } = useApp();
  const data = useCommandCenterData();
  const statuses = useModuleStatuses();
  const latest = toofanService.getLatestAssessment();
  const {
    cyclone, genesis, trajectory, intensity, ripple, recurvature,
    risk, flood, rainfall, wind, landslide, hazards, dataSources, system,
  } = data;

  const hazardById = new Map(hazards.map((h) => [h.id, h]));
  const genH = hazardById.get("genesis");
  const rainH = hazardById.get("rainfall");
  const windH = hazardById.get("wind");
  const floodH = hazardById.get("flood");
  const lsH = hazardById.get("landslide");

  // ── Mission metrics ──
  const hs = genesis ? horizonsFrom(genesis.subModels) : null;
  const genOk =
    genesis?.status?.status != null &&
    genesis.status.status !== "NOT_AVAILABLE" &&
    genesis.status.status !== "ERROR";
  const riProb = ripple?.leadProbability ?? ripple?.fusionProbability;
  const riOk =
    ripple?.status?.status != null &&
    ripple.status.status !== "NOT_AVAILABLE" &&
    ripple.status.status !== "ERROR";
  const recProb = recurvature?.probability ?? recurvature?.prediction?.probability;
  const floodRisk = flood?.overallRisk ?? floodH?.risk;
  const riskSeverity = risk?.available ? risk.severity : undefined;
  const riskScore = risk?.available && risk?.score != null ? `Score ${risk.score}` : risk?.engineName;

  const trackOk =
    trajectory?.status?.status != null &&
    trajectory.status.status !== "NOT_AVAILABLE" &&
    trajectory.status.status !== "ERROR";
  const trackPoints = trackOk ? trajectory?.points ?? [] : [];

  const dataStatus = mode === "demo"
    ? "AVAILABLE"
    : dataSources.length > 0
      ? (dataSources.some((s) => s.status === "AVAILABLE" || s.status === "CONNECTED")
          ? "AVAILABLE"
          : "DEGRADED")
      : "NOT_AVAILABLE";

  // ── Operational map layers (only layers the backend actually supplies) ──
  const hazardLayers = useMemo(() => {
    const layers: HazardLayerData[] = [];
    const rain = districtLayer("rainfall", "Rainfall", rainfall?.districtRanking ?? []);
    if (rain) layers.push(rain);
    const fld = districtLayer("flood", "Flood", flood?.districts ?? []);
    if (fld) layers.push(fld);
    const ls = districtLayer(
      "landslide",
      "Landslide",
      (landslide?.staticSusceptibility?.regions ?? []).map((r) => ({ district: r.name, risk: r.level }))
    );
    if (ls) layers.push(ls);
    const wf = windFieldLayer(cyclone, wind);
    if (wf) layers.push(wf);
    return layers;
  }, [cyclone, rainfall, flood, landslide, wind]);

  const layerAvailability = [
    { id: "storm", label: "STORM", on: Boolean(cyclone) },
    { id: "track", label: "TRACK", on: trackPoints.length > 0 },
    { id: "cone", label: "UNCERTAINTY", on: trackPoints.some((p) => p.uncertaintyKm != null) },
    { id: "rain", label: "RAINFALL", on: Boolean(rainH && rainH.status !== "NOT_AVAILABLE") },
    { id: "wind", label: "WIND FIELD", on: Boolean(wind?.zones?.length) },
    { id: "flood", label: "FLOOD", on: Boolean(floodH && floodH.status !== "NOT_AVAILABLE") },
    { id: "ls", label: "LANDSLIDE", on: Boolean(landslide?.staticSusceptibility?.regions?.length) },
    { id: "he", label: "HAZARD ENGINE", on: Boolean(risk?.available) },
  ];

  // ── Pipeline node short results (backend values only; blank when absent) ──
  const flowResults: Partial<Record<ModuleKey, string>> = {
    genesis: genOk && hs?.h24 != null ? `${pct(hs.h24)}%` : undefined,
    trajectory: trackPoints.length ? `${trackPoints.length} PTS` : undefined,
    intensity:
      intensity?.current?.observed && intensity.current.windKt != null
        ? `${intensity.current.windKt} KT`
        : undefined,
    ri: riOk && riProb != null ? `${(riProb * 100).toFixed(1)}%` : undefined,
    recurvature: recProb != null ? `${(recProb * 100).toFixed(1)}%` : undefined,
    rainfall: rainH?.risk?.replace(/_/g, " "),
    wind: windH?.risk?.replace(/_/g, " "),
    flood: floodRisk?.replace(/_/g, " "),
    landslide: lsH?.risk?.replace(/_/g, " "),
    hazard_engine: riskSeverity?.replace(/_/g, " "),
  };

  // ── Pipeline aggregate ──
  const onlineCount = PIPELINE_MODULES.filter((m) => {
    const st = statuses[m.id]?.status;
    return st != null && st !== "NOT_AVAILABLE" && st !== "ERROR";
  }).length;
  const runId = latest?.run_id ?? undefined;
  const runStatus = latest?.pipeline_status ?? undefined;

  return (
    <div className="cm-page">
      <div className="cm-wrap">
        {/* ═══ HEADER ═══ */}
        <header className="cm-masthead">
          <div>
            <div className="cm-kicker">TOOFAN — Tropical Cyclone Intelligence</div>
            <h1 className="cm-title">
              AI FOR A <span className="cm-title-accent">SAFER</span> TOMORROW
            </h1>
            <p className="cm-sub">
              One unified engine forecasting genesis, track, intensity and multi-hazard impact across
              the North Indian Ocean — every signal traced to its model and provenance.
            </p>
          </div>
          <div className="cm-masthead__meta">
            <div className="cm-pillrow">
              <span className={`cm-pill ${mode === "demo" ? "cm-pill--warn" : "cm-pill--accent"}`}>
                <span className="cm-dot" style={{ ["--cm-dot" as string]: mode === "demo" ? "#f0b429" : "#46d17e" }} />
                {mode === "demo" ? "DEMO" : "LIVE"}
              </span>
              <span className={`cm-pill ${system?.systemOperational !== false ? "cm-pill--ok" : "cm-pill--bad"}`}>
                <span
                  className="cm-dot"
                  style={{ ["--cm-dot" as string]: system?.systemOperational !== false ? "#46d17e" : "#e5604f" }}
                />
                {system?.systemOperational === false ? "BACKEND DEGRADED" : "BACKEND HEALTHY"}
              </span>
              {runId ? (
                <span className="cm-pill cm-pill--accent">RUN {runId}</span>
              ) : null}
            </div>
            <span className="cm-muted-2 cm-mono">
              LAST UPDATE&nbsp; {system?.lastUpdated ? formatIST(system.lastUpdated) : "—"}
            </span>
          </div>
        </header>

        {/* ═══ MISSION / EVENT STRIP ═══ */}
        <section className="cm-eventstrip">
          <div className="cm-eventstrip__group">
            <span className="cm-eventstrip__k">Current Event</span>
            <span className="cm-eventstrip__v">
              {cyclone ? (cyclone.name ?? cyclone.id) : "NONE"}
            </span>
          </div>
          <div className="cm-eventstrip__group">
            <span className="cm-eventstrip__k">Storm ID</span>
            <span className="cm-eventstrip__v">{cyclone?.id ?? "—"}</span>
          </div>
          <div className="cm-eventstrip__group">
            <span className="cm-eventstrip__k">Basin</span>
            <span className="cm-eventstrip__v">{cyclone?.basin ?? "—"}</span>
          </div>
          <div className="cm-eventstrip__group">
            <span className="cm-eventstrip__k">Reference Time</span>
            <span className="cm-eventstrip__v">{cyclone?.timestamp ? formatIST(cyclone.timestamp) : "—"}</span>
          </div>
          <div className="cm-eventstrip__group">
            <span className="cm-eventstrip__k">Pipeline Status</span>
            <span className="cm-eventstrip__v cm-eventstrip__v--accent">
              {onlineCount}/{PIPELINE_MODULES.length} ONLINE{runStatus ? ` · ${runStatus}` : ""}
            </span>
          </div>
          <div className="cm-eventstrip__actions">
            <div className="cm-pillrow">
              <Link to="/genesis" className="cm-pill cm-pill--accent">Genesis →</Link>
              <Link to="/forecast" className="cm-pill cm-pill--accent">Forecast →</Link>
              <Link to="/impact" className="cm-pill cm-pill--accent">Impact →</Link>
            </div>
          </div>
        </section>

        {/* ═══ PIPELINE VISUALIZATION ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Activity size={13} className="text-cyan-400" />
            <span className="cm-section__title">Pipeline</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">CLICK A NODE <ArrowRight size={10} /></span>
          </div>
          <div className="cm-card">
            <PipelineFlow
              results={flowResults}
              dataStatus={dataStatus}
              dataReason={dataSources.length ? undefined : "No configured data sources"}
            />
          </div>
        </section>

        {/* ═══ LIVE METRICS ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Crosshair size={13} className="text-cyan-400" />
            <span className="cm-section__title">Live Metrics</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">BACKEND-VERIFIED SIGNALS</span>
          </div>
          <div className="cm-grid">
            <Tile
              label="Genesis 24h"
              status={genOk ? genesis?.status?.status : genH?.status}
              value={genOk ? `${pct(hs?.h24)}%` : undefined}
              sub={genOk ? (genH?.status ?? "ENSEMBLE") : (genesis?.status?.message ?? "No genesis signal")}
            />
            <Tile
              label="Genesis 48h"
              status={genOk ? genesis?.status?.status : genH?.status}
              value={genOk ? `${pct(hs?.h48)}%` : undefined}
              sub={genOk ? "ENSEMBLE SOFT-VOTE" : (genesis?.status?.message ?? "No genesis signal")}
            />
            <Tile
              label="Genesis 72h"
              status={genOk ? genesis?.status?.status : genH?.status}
              value={genOk ? `${pct(hs?.h72)}%` : undefined}
              sub={genOk ? "72H WINDOW" : (genesis?.status?.message ?? "No genesis signal")}
            />
            <Tile
              label="Current Wind"
              status={cyclone?.status?.status}
              value={cyclone?.windKt != null ? `${cyclone.windKt}` : undefined}
              unit="kt"
              sub={cyclone?.category ? `CAT ${cyclone.category}` : undefined}
            />
            <Tile
              label="Current Pressure"
              status={cyclone?.status?.status}
              value={cyclone?.mslpHpa != null ? `${cyclone.mslpHpa}` : undefined}
              unit="hPa"
              sub={cyclone?.basin ?? undefined}
            />
            <Tile
              label="RI Probability"
              status={riOk ? ripple?.status?.status : ripple?.models?.[0]?.status}
              value={riOk && riProb != null ? `${(riProb * 100).toFixed(1)}%` : undefined}
              sub={riOk ? "24H WINDOW" : (ripple?.status?.message ?? undefined)}
            />
            <Tile
              label="Rainfall"
              status={rainH?.status}
              value={rainH ? <CmSev severity={rainH.risk} /> : undefined}
              sub={rainH?.status ?? undefined}
            />
            <Tile
              label="Flood Risk"
              status={floodH?.status}
              value={floodRisk ? <CmSev severity={floodRisk} /> : undefined}
              sub={floodH?.status ?? undefined}
            />
            <Tile
              label="Landslide Risk"
              status={lsH?.status}
              value={lsH ? <CmSev severity={lsH.risk} /> : undefined}
              sub={lsH?.status ?? undefined}
            />
            <Tile
              label="Overall Hazard"
              status={risk?.available ? risk?.severity ?? risk?.engineName : undefined}
              value={riskSeverity ? <CmSev severity={riskSeverity} /> : undefined}
              sub={riskScore ?? (risk?.reason ?? undefined)}
            />
          </div>
        </section>

        {/* ═══ OPERATIONAL MAP ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <MapIcon size={13} className="text-cyan-400" />
            <span className="cm-section__title">Operational Map</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">DOMINANT TRACK</span>
          </div>
          <div className="cm-card cm-card--flush">
            <div className="cm-maphead">
              <div className="cm-layers">
                {layerAvailability.map((l) => (
                  <span
                    key={l.id}
                    className="cm-layerchip"
                    title={`${l.label} layer — ${l.on ? "BACKEND SUPPLIED" : "NOT SUPPLIED"}`}
                  >
                    <span className="cm-dot" style={{ ["--cm-dot" as string]: l.on ? "#46d17e" : "#54687d" }} />
                    {l.label}
                  </span>
                ))}
              </div>
              <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.56rem" }}>
                LAYERS FOLLOW BACKEND DATA
              </span>
            </div>
            <CycloneMap
              forecast={trackPoints}
              current={
                trackOk && cyclone
                  ? { lat: cyclone.latitude, lon: cyclone.longitude, name: cyclone.name ?? cyclone.id, windKt: cyclone.windKt }
                  : undefined
              }
              hazardLayers={hazardLayers}
              height={430}
              simplified={false}
              isDemo={mode === "demo"}
              focusPadding={40}
            />
          </div>
        </section>

        {/* ═══ BOTTOM — MODEL HEALTH / DATA PROVIDERS / PIPELINE STATUS ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Waves size={13} className="text-cyan-400" />
            <span className="cm-section__title">Operational Status</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">MODEL HEALTH · DATA · PIPELINE</span>
          </div>

          <div className="cm-bottom">
            {/* Model health */}
            <div className="cm-card">
              <div className="cm-card__head">
                <Activity size={12} className="text-cyan-400" />
                <span className="cm-card__title">Model Health</span>
              </div>
              {PIPELINE_MODULES.map((m) => {
                const st = statuses[m.id]?.status ?? "NOT_AVAILABLE";
                return (
                  <div className="cm-healthrow" key={m.id} title={statuses[m.id]?.reason ?? m.label}>
                    <span className="cm-kv__k">{m.short}</span>
                    <span className="cm-dot" style={{ ["--cm-dot" as string]: moduleStatusColor(st) }} />
                    <span className="cm-healthrow__v" style={{ color: moduleStatusColor(st) }}>
                      {st.replace(/_/g, " ")}
                    </span>
                    {statuses[m.id]?.active ? (
                      <span className="cm-flow__node__result">RUNNING</span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Data providers */}
            <div className="cm-card">
              <div className="cm-card__head">
                <Database size={12} className="text-cyan-400" />
                <span className="cm-card__title">Data Providers</span>
              </div>
              {dataSources.length ? (
                dataSources.map((s) => (
                  <div className="cm-healthrow" key={s.id} title={s.coverage ?? s.category}>
                    <span className="cm-kv__k">{s.name}</span>
                    <span className="cm-pill cm-pill--muted" style={{ fontSize: "0.5rem", padding: "2px 8px" }}>
                      <span className="cm-dot" style={{ ["--cm-dot" as string]: moduleStatusColor(s.status) }} />
                      {s.status.replace(/_/g, " ")}
                    </span>
                  </div>
                ))
              ) : (
                <div className="cm-notavail">No data sources configured.</div>
              )}
            </div>

            {/* Pipeline status */}
            <div className="cm-card">
              <div className="cm-card__head">
                <Gauge size={12} className="text-cyan-400" />
                <span className="cm-card__title">Pipeline Status</span>
                {runId ? <span className="cm-pill cm-pill--accent">RUN {runId}</span> : null}
              </div>
              <PipelineStatusStrip />
              {runStatus ? (
                <div className="cm-kv" style={{ marginTop: 12 }}>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Pipeline</span>
                    <span className="cm-kv__v">{runStatus}</span>
                  </div>
                </div>
              ) : null}
              <div className="cm-card__foot">
                <span>ONLINE {onlineCount}/{PIPELINE_MODULES.length}</span>
                {latest?.generated_at ? <span>RUN {formatIST(latest.generated_at)}</span> : null}
              </div>
              <RunAssessment />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
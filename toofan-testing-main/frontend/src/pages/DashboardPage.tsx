import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "@/components/common/StateBox";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { LayerControl, type LayerGroup } from "@/components/map/LayerControl";
import { AlertCard } from "@/components/alerts/AlertCard";
import { toofanService } from "@/services/toofanService";
import { SectionLabel, ThinDivider, StatusLabel } from "@/components/design";
import { ModelPipeline } from "@/components/pipeline/ModelPipeline";
import { RiskPill } from "@/components/common/RiskPill";
import { formatIST } from "@/utils/format";
import type {
  CycloneState,
  OverallRisk,
  TrajectoryForecast,
  RIReport,
  FloodReport,
  GenesisReport,
  ModelInfo,
  HazardItem,
  Alert,
} from "@/types";

const PLAYBACK_MS = 1200;

const LAYERS: LayerGroup[] = [
  {
    group: "Cyclone",
    options: [
      { key: "track", label: "Historical Track", available: true },
      { key: "forecast", label: "Forecast Track", available: true },
      { key: "uncertainty", label: "Uncertainty Band (uncalibrated)", available: true },
      { key: "position", label: "Current Position", available: true },
    ],
  },
  {
    group: "Hazards",
    options: [
      { key: "rainfall", label: "Rainfall", available: false },
      { key: "wind", label: "Wind", available: false },
      { key: "flood", label: "Flood", available: false },
      { key: "landslide", label: "Landslide", available: false },
    ],
  },
];

export default function DashboardPage() {
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [track, setTrack] = useState<TrajectoryForecast | null>(null);
  const [risk, setRisk] = useState<OverallRisk | null>(null);
  const [ri, setRi] = useState<RIReport | null>(null);
  const [flood, setFlood] = useState<FloodReport | null>(null);
  const [genesis, setGenesis] = useState<GenesisReport | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hazards, setHazards] = useState<HazardItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    track: true,
    forecast: true,
    uncertainty: true,
    position: true,
  });
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const points = useMemo(() => track?.points ?? [], [track]);

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [points.length]);

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setIdx((i) => {
          if (i >= points.length - 1) {
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
  }, [playing, points.length]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [c, t, r, riR, fl, ge, al] = await Promise.all([
          toofanService.getCyclone(),
          toofanService.getTrajectory(),
          toofanService.getOverallRisk(),
          toofanService.getRI(),
          toofanService.getFlood(),
          toofanService.getGenesis(),
          toofanService.getAlerts(),
        ]);
        const mod = await toofanService.getModels();
        if (!cancelled) {
          setCyc(c);
          setTrack(t);
          setRisk(r);
          setRi(riR);
          setFlood(fl);
          setGenesis(ge);
          setAlerts(al);
          setModels(mod);
          const h = await toofanService.getHazards();
          if (!cancelled && Array.isArray(h)) setHazards(h as unknown as HazardItem[]);
        }
      } catch {
        /* panels handle their own states */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="page">
        <LoadingState rows={4} />
      </div>
    );
  }

  const forecastForMap = visible.forecast ? track?.points ?? [] : [];
  const historicalForMap = visible.track
    ? (track?.points ?? [])
        .filter((p) => !p.isForecast)
        .map((p) => ({ lat: p.latitude, lon: p.longitude, timestamp: p.timestamp }))
    : [];

  const hazardMap = new Map(hazards.map((h) => [h.id, h]));

  const riPct = ri?.leadProbability !== undefined ? (ri.leadProbability * 100).toFixed(1) : undefined;
  const riModel = ri?.models?.find((m) => m.status === "AVAILABLE")?.name ?? "IMD XGBoost";
  const floodTop = (flood?.districts ?? []).slice(0, 3);
  const sevOrder: Record<string, number> = { CRITICAL: 0, WARNING: 1, WATCH: 2, INFO: 3 };
  const sortedAlerts = [...alerts].sort(
    (a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9)
  );

  return (
    <div className="page command-center">
      {/* ═══ HEADER ═══ */}
      <div className="page-head cc-head">
        <div className="page-kicker">Command Center</div>
        <h1 className="page-title">Cyclone Intelligence</h1>
        <p className="page-sub">
          Live event operations — active cyclone, forecast trajectory, and multi-hazard status.
        </p>
      </div>

      {/* ═══ ACTIVE EVENT HERO ═══ */}
      <div className="cc-hero-grid">
        {/* MAP */}
        <div className="cc-map-box">
          <div className="cc-map-head">
            <div className="cc-map-head-left">
              <span className="cc-map-kicker">ACTIVE EVENT</span>
              <span className="cc-map-name">{cyc?.name ?? "CYCLONE"}</span>
            </div>
            <span className="cc-map-basin">{(cyc?.basin ?? "NORTH INDIAN OCEAN").toUpperCase()}</span>
          </div>
          <div className="map-overlay">
            <LayerControl
              groups={LAYERS}
              visible={visible}
              onToggle={(k) => setVisible((v) => ({ ...v, [k]: !v[k] }))}
            />
          </div>
          <MapErrorBoundary title="CYCLONE MAP UNAVAILABLE" height="100%">
            <CycloneMap
              current={
                cyc
                  ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name, windKt: cyc.windKt }
                  : undefined
              }
              forecast={forecastForMap}
              historicalTrack={historicalForMap}
              selectedIdx={idx}
              playing={playing}
              onIdxChange={setIdx}
              onPlayToggle={() => setPlaying((p) => !p)}
              showTimeline
              showTag
              simplified
            />
          </MapErrorBoundary>
        </div>

        {/* INTELLIGENCE SUMMARY */}
        <aside className="cc-rail">
          {/* Active cyclone block */}
          <div className="cc-block cc-cyclone">
            <div className="cc-block-head">
              <span className="cc-block-title">Active Cyclone</span>
              {cyc?.status ? <StatusLabel status={cyc.status.status} /> : null}
            </div>
            <div className="cc-cyc-name">
              {cyc?.name ?? "NO ACTIVE CYCLONE"}
              <span className="cc-cyc-cat">{cyc?.category ?? ""}</span>
            </div>

            <ThinDivider faint />

            <div className="cc-cols">
              <div>
                <div className="lbl">Position</div>
                <div className="cc-mono-lg">
                  {cyc ? `${cyc.latitude.toFixed(2)}°N, ${cyc.longitude.toFixed(2)}°E` : "—"}
                </div>
              </div>
              <div className="cc-move-inten">
                <div className="cc-inline">
                  <span className="lbl">Movement</span>
                  <span className="cc-metric-inline">
                    {cyc?.movement?.direction ?? "—"}
                    {cyc?.movement?.speedKph ? ` · ${cyc.movement.speedKph} km/h` : ""}
                  </span>
                </div>
                <div className="cc-inline">
                  <span className="lbl">Intensity</span>
                  <span className="cc-metric-inline">
                    {cyc?.windKt ?? "—"} kt
                    {cyc?.mslpHpa ? ` · ${cyc.mslpHpa} hPa` : ""}
                  </span>
                </div>
              </div>
            </div>

            <ThinDivider faint />

            <div className="cc-cols">
              <div className="cc-inline">
                <span className="lbl">Basin</span>
                <span className="cc-body">{cyc?.basin ?? "—"}</span>
              </div>
              <div className="cc-inline">
                <span className="lbl">Observed</span>
                <span className="cc-body cc-mono">{formatIST(cyc?.timestamp)}</span>
              </div>
            </div>
          </div>

          {/* Key conditions */}
          <div className="cc-block cc-key">
            <div className="cc-block-head">
              <span className="cc-block-title">Key Conditions</span>
            </div>
            <div className="cc-key-rows">
              <Link to="/intensity" className="cc-key-row">
                <span className="cc-key-label">Rapid Intensification <span className="cc-arrow">→</span></span>
                {riPct ? (
                  <span className="cc-key-val">{riPct}% <RiskPill severity={ri?.models?.[0]?.risk} /></span>
                ) : (
                  <span className="cc-key-val muted">—</span>
                )}
                <span className="cc-key-sub">Model · {riModel}</span>
              </Link>

              <Link to="/flood" className="cc-key-row">
                <span className="cc-key-label">Flood <span className="cc-arrow">→</span></span>
                {flood?.status ? (
                  <span className="cc-key-val">
                    <StatusLabel status={flood.status.status} />
                    {flood.overallRisk ? <RiskPill severity={flood.overallRisk} /> : null}
                  </span>
                ) : (
                  <span className="cc-key-val muted">UNAVAILABLE</span>
                )}
                <span className="cc-key-sub">Flood XGBoost</span>
              </Link>

              <Link to="/recurvature" className="cc-key-row">
                <span className="cc-key-label">Recurvature <span className="cc-arrow">→</span></span>
                <span className="cc-key-val">
                  <StatusLabel status={hazardMap.get("recurvature")?.status ?? "MODEL_MISSING"} />
                </span>
                <span className="cc-key-sub">Recurvature XGBoost</span>
              </Link>

              <div className="cc-key-row cc-key-row-plain">
                <span className="cc-key-label">Genesis</span>
                <span className="cc-key-val">
                  <StatusLabel status={genesis?.status.status ?? "MODEL_MISSING"} />
                </span>
                <span className="cc-key-sub">Genesis ensemble</span>
              </div>
            </div>
            {floodTop.length > 0 && (
              <div className="cc-flood-mini">
                <span className="cc-flood-mini-label">TOP FLOOD AFFECTED</span>
                {floodTop.map((d) => (
                  <span key={d.district} className="cc-flood-mini-item">
                    {d.district} · {d.risk.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Overall risk — compact notice */}
          <div className="cc-block cc-risk">
            <span className="cc-block-title">Overall Risk</span>
            {risk?.available && risk?.severity ? (
              <>
                <div className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
                  <span className="cc-risk-val">{risk.severity.replace(/_/g, " ")}</span>
                  <RiskPill severity={risk.severity} />
                </div>
                <span className="cc-risk-sub">
                  {risk.score !== undefined ? `Composite score ${risk.score}/100 · ` : ""}
                  {risk.reason ?? risk.engineName}
                </span>
              </>
            ) : (
              <>
                <span className="cc-risk-val">NOT AVAILABLE</span>
                <span className="cc-risk-sub">
                  {risk?.reason ?? "HazardRiskEngine is not currently operational."}
                </span>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* ═══ RECENT ALERTS + MODEL PIPELINE ═══ */}
      <div className="cc-lower-grid">
        <section className="cc-alerts-section">
          <SectionLabel label="Recent Alerts" strong />
          <div className="cc-alerts">
            {alerts.length > 0 ? (
              sortedAlerts.slice(0, 4).map((a) => <AlertCard key={a.id} alert={a} />)
            ) : (
              <p className="small muted">No active alerts.</p>
            )}
          </div>
        </section>

        <section className="cc-models-section">
          <ModelPipeline models={models} />
        </section>
      </div>
    </div>
  );
}

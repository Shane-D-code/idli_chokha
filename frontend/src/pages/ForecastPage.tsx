import { useEffect, useState } from "react";
import { useApp } from "@/state/AppContext";
import { useCommandCenterData } from "@/hooks/useCommandCenterData";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { PageHead } from "@/components/overview/PageHead";
import { ModuleGate } from "@/components/overview/ModuleGate";
import { CmSev } from "@/components/overview/CmSev";
import { CycloneMap } from "@/components/map/CycloneMap";
import { formatIST } from "@/utils/format";
import { moduleStatusColor } from "@/lib/moduleStatus";
import { toofanService } from "@/services/toofanService";
import { probabilityBand } from "@/components/mission/genesis/genesisModel";
import type { ModelInfo, TrackPoint } from "@/types";

const TL_HORIZONS = [0, 6, 12, 18, 24];

function fmtPos(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

function SectionHead({ title, pill }: { title: string; pill?: string }) {
  return (
    <div className="cm-section__head">
      <span className="cm-section__title">{title}</span>
      <span className="cm-section__rule" />
      {pill ? <span className="cm-pill cm-pill--muted">{pill}</span> : null}
    </div>
  );
}

/** Honest per-step status label derived only from the reported wind series. */
function intStepStatus(windKt: number | undefined, prev: number | undefined, horizon: number, observedCurrent: boolean): string {
  if (windKt == null) return "—";
  if (horizon === 0) return observedCurrent ? "OBSERVED" : "MODEL CURRENT";
  if (prev == null) return "FORECAST";
  if (windKt > prev + 1) return "INTENSIFYING";
  if (windKt < prev - 1) return "WEAKENING";
  return "STEADY";
}

function intStatusTone(s: string): string {
  if (s === "INTENSIFYING") return "cm-pill--warn";
  if (s === "WEAKENING" || s === "OBSERVED") return "cm-pill--ok";
  if (s === "MODEL CURRENT") return "cm-pill--accent";
  return "cm-pill--muted";
}

export default function ForecastPage() {
  useScrollToHash();
  const { mode } = useApp();
  const data = useCommandCenterData();
  const [registry, setRegistry] = useState<ModelInfo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    document.title = "Forecast — TOOFAN";
    toofanService
      .getModels()
      .then((models) => setRegistry(Array.isArray(models) ? models : []))
      .catch(() => undefined);
    return () => {
      document.title = "TOOFAN";
    };
  }, []);

  const { cyclone, trajectory, intensity, ripple, recurvature } = data;

  const trackOk =
    trajectory?.status?.status != null &&
    trajectory.status.status !== "NOT_AVAILABLE" &&
    trajectory.status.status !== "ERROR";
  const intOk =
    intensity?.status?.status != null &&
    intensity.status.status !== "NOT_AVAILABLE" &&
    intensity.status.status !== "ERROR";
  const rippleOk =
    ripple?.status?.status != null &&
    ripple.status.status !== "NOT_AVAILABLE" &&
    ripple.status.status !== "ERROR";
  const recOk =
    recurvature?.status?.status != null &&
    recurvature.status.status !== "NOT_AVAILABLE" &&
    recurvature.status.status !== "ERROR";

  // ── Track ──
  const trackPoints = trajectory?.points ?? [];
  const hasObserved = trackPoints.some((p) => p.horizonHours < 0);
  const hasCone = trackPoints.some((p) => p.uncertaintyKm != null);

  const maxUncertainty = trackPoints.reduce<number | undefined>((max, p) =>
    p.uncertaintyKm != null && (max == null || p.uncertaintyKm > max) ? p.uncertaintyKm : max, undefined);
  const maxUncHorizon = trackPoints.find((p) => p.uncertaintyKm === maxUncertainty)?.horizonHours;

  const endWind = trackPoints.find((p) => p.horizonHours === 24)?.windKt ?? intensity?.forecastPoints?.find((p) => p.horizonHours === 24)?.windKt;

  // Time chips — NOW / +6H / +12H / +18H / +24H, only backing real points.
  const tlSel = TL_HORIZONS.map((h) => {
    const c = trackPoints.filter((p) => p.horizonHours >= 0);
    const exact = c.find((p) => p.horizonHours === h);
    const idx = exact ? trackPoints.indexOf(exact) : -1;
    if (idx >= 0) return { h, idx };
    const nearest = c.slice().sort((a, b) => Math.abs(a.horizonHours - h) - Math.abs(b.horizonHours - h))[0];
    return nearest && Math.abs(nearest.horizonHours - h) <= 4
      ? { h, idx: trackPoints.indexOf(nearest) }
      : { h, idx: -1 };
  }).filter((s): s is { h: number; idx: number } => s.idx >= 0);

  const activeHorizon = trackPoints[selectedIdx ?? 0]?.horizonHours;

  const hourlyPick = tlSel
    .map((s) => trackPoints[s.idx])
    .filter((p): p is TrackPoint => Boolean(p));

  // ── Current state ──
  const cur = intensity?.current;
  const curWindKt = cyclone?.windKt ?? cur?.windKt;

  // ── Intensity timeline (whatever horizons the backend supplies) ──
  const intSteps = (() => {
    const pts = (intensity?.forecastPoints ?? []).slice().sort((a, b) => a.horizonHours - b.horizonHours);
    if (pts.length === 0 && cur) {
      return [{ h: 0, label: "NOW", windKt: cur.windKt, hpa: cur.mslpHpa, rmw: cur.rmwKm, status: intStepStatus(cur.windKt, undefined, 0, cur.observed) }];
    }
    return pts.map((p, i) => ({
      h: p.horizonHours,
      label: p.horizonHours === 0 ? "NOW" : `+${p.horizonHours}H`,
      windKt: p.windKt,
      hpa: p.mslpHpa,
      rmw: p.rmwKm,
      status: intStepStatus(p.windKt, i > 0 ? pts[i - 1].windKt : cur?.windKt, p.horizonHours, cur?.observed ?? false),
    }));
  })();

  // ── RI ──
  const riProb = ripple?.fusionProbability ?? ripple?.leadProbability;
  const riBand = probabilityBand(riProb);
  const riRisk = ripple?.models?.[0]?.risk;
  const riLead = ripple?.models?.find((m) => m.modelId === "ri-imd") ?? ripple?.models?.[0];
  const featureImportance = ripple?.featureImportance?.slice(0, 4);

  // ── Recurvature ──
  const recProb = recurvature?.prediction?.probability ?? recurvature?.probability;
  const recRisk = recurvature?.prediction?.risk ?? recurvature?.risk;
  const recForecast = recurvature?.track?.forecast ?? [];
  const recLoc = recForecast.length ? recForecast[recForecast.length - 1] : null;
  const predLoc =
    recLoc != null
      ? fmtPos(recLoc.lat, recLoc.lon)
      : "NOT REPORTED";

  // ── Uncertainty ──
  const uncPts = trackPoints
    .filter((p) => p.horizonHours >= 0 && p.uncertaintyKm != null)
    .sort((a, b) => a.horizonHours - b.horizonHours);

  // ── Provenance (joined against the shared model registry) ──
  const regById = new Map(registry.map((r) => [r.id, r]));
  const prov = [
    {
      mod: "Trajectory",
      model: regById.get("trajectory-v12")?.name ?? trajectory?.model ?? "—",
      ver: trajectory?.modelVersion,
      artifact: regById.get("trajectory-v12")?.artifact,
      time: regById.get("trajectory-v12")?.lastInference,
      status: trajectory?.status?.status,
    },
    {
      mod: "Intensity",
      model: regById.get("intensity")?.name ?? "Intensity model",
      ver: regById.get("intensity")?.version,
      artifact: regById.get("intensity")?.artifact,
      time: regById.get("intensity")?.lastInference ?? intensity?.status?.timestamp,
      status: intensity?.status?.status,
    },
    {
      mod: "Rapid Intensification",
      model: regById.get("ri-fusion")?.name ?? ripple?.models?.[0]?.name,
      ver: regById.get("ri-fusion")?.version,
      artifact: regById.get("ri-fusion")?.artifact,
      time: regById.get("ri-fusion")?.lastInference ?? ripple?.status?.timestamp,
      status: ripple?.status?.status,
    },
    {
      mod: "Recurvature",
      model: regById.get("recurvature")?.name ?? recurvature?.model?.name,
      ver: recurvature?.model?.version,
      artifact: regById.get("recurvature")?.artifact,
      time: regById.get("recurvature")?.lastInference ?? recurvature?.status?.timestamp,
      status: recurvature?.status?.status,
    },
  ];

  return (
    <div className="cm-page">
      <div className="cm-wrap">
        <PageHead
          index="02 / FORECAST"
          kicker="Predict the path before it turns"
          title="Track, Intensity & Recurvature"
          sub="ONE cyclone, ONE track: the multi-horizon outlook from observed position through the forecast corridor, intensity timeline, rapid-intensification probability, recurvature risk and the uncertainty budget."
          meta={
            <div className="cm-pillrow">
              <span className={`cm-pill ${cyclone ? "cm-pill--accent" : "cm-pill--muted"}`}>
                <span className="cm-dot" />
                {cyclone ? `${cyclone.name ?? cyclone.id} · ${cyclone.basin}` : "NO ACTIVE CYCLONE"}
              </span>
              {trajectory?.status?.timestamp ? (
                <span className="cm-pill cm-pill--muted">INIT {formatIST(trajectory.status.timestamp)}</span>
              ) : null}
              {trajectory?.forecastHorizonHours != null ? (
                <span className="cm-pill cm-pill--muted">HORIZON {trajectory.forecastHorizonHours}H</span>
              ) : null}
            </div>
          }
        />

        {/* ═══ 1 · TRACK MAP (dominant) ═══ */}
        <section className="cm-section cm-anchor" id="track">
          <SectionHead title="Cyclone Path" pill={trackOk ? "CYCLONE PATH MODEL" : "UNAVAILABLE"} />

          {!trackOk && trajectory ? (
            <ModuleGate
              label="TRACK MODEL"
              status={trajectory.status.status}
              reason={trajectory.status.message ?? trajectory.status.status}
            >
              <div className="cm-notavail">Track forecast unavailable.</div>
            </ModuleGate>
          ) : null}

          <div className="cm-card cm-card--flush">
            <div className="cm-maphead">
              <div className="cm-layers">
                <span className="cm-layerchip">
                  <span className="cm-dot" style={{ ["--cm-dot" as string]: cyclone ? "#46d17e" : "#54687d" }} />
                  STORM
                </span>
                <span className="cm-layerchip">
                  <span className="cm-dot" style={{ ["--cm-dot" as string]: hasObserved ? "#46d17e" : "#54687d" }} />
                  OBSERVED TRACK
                </span>
                <span className="cm-layerchip">
                  <span className="cm-dot" style={{ ["--cm-dot" as string]: trackOk ? "#46d17e" : "#54687d" }} />
                  FORECAST TRACK
                </span>
                <span className="cm-layerchip">
                  <span className="cm-dot" style={{ ["--cm-dot" as string]: hasCone ? "#46d17e" : "#54687d" }} />
                  UNCERTAINTY CONE
                </span>
                <span className="cm-layerchip">
                  <span className="cm-dot" style={{ ["--cm-dot" as string]: trackPoints.length ? "#46d17e" : "#54687d" }} />
                  FORECAST POINTS
                </span>
              </div>
              <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.6rem" }}>
                NOW {curWindKt != null ? `${curWindKt} KT` : "—"}
                {endWind != null ? ` → +24H ${endWind} KT` : ""}
              </span>
            </div>

            <div style={{ height: 540, display: "flex", flexDirection: "column" }}>
              <CycloneMap
                forecast={trackPoints}
                current={
                  cyclone
                    ? { lat: cyclone.latitude, lon: cyclone.longitude, name: cyclone.name ?? cyclone.id, windKt: cyclone.windKt }
                    : undefined
                }
                selectedIdx={selectedIdx}
                playing={playing}
                onIdxChange={(i) => {
                  setSelectedIdx(i);
                  setPlaying(false);
                }}
                onPlayToggle={() => setPlaying((p) => !p)}
                showTimeline
                showTag
                height="520px"
                interactive={trackOk}
                recenterMode="track"
                focusPadding={40}
                isDemo={mode === "demo"}
              />
            </div>

            {trackOk && tlSel.length > 0 ? (
              <div className="cm-mapfoot">
                <div className="cm-pillrow" role="tablist" aria-label="Forecast time labels">
                  {tlSel.map((s) => {
                    const isActive = activeHorizon === s.h;
                    return (
                      <button
                        key={s.h}
                        type="button"
                        className={`cm-chip-btn ${isActive ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedIdx(s.idx);
                          setPlaying(false);
                        }}
                      >
                        {s.h === 0 ? "NOW" : `+${s.h}H`}
                      </button>
                    );
                  })}
                </div>
                <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.56rem" }}>
                  CLICK A TIME LABEL OR SCRUB THE TIMELINE
                </span>
              </div>
            ) : null}
          </div>

          {trackOk ? (
            <div className="cm-card" style={{ marginTop: 12 }}>
              <div className="cm-card__head">
                <span className="cm-card__title">Forecast Positions</span>
                <span className="cm-pill cm-pill--muted">± {maxUncertainty != null ? Math.round(maxUncertainty) : "—"} KM MAX CONE</span>
              </div>
              <div className="cm-table-wrap">
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Horizon</th>
                      <th>Position</th>
                      <th>Intensity</th>
                      <th className="cm-nowrap">Uncertainty</th>
                      <th>Time (IST)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourlyPick.map((p) => (
                      <tr key={`${p.horizonHours}-${p.timestamp}`}>
                        <td className="cm-nowrap" style={{ fontWeight: 800, color: p.horizonHours === 0 ? "#35cfe3" : "#e9f1f8" }}>
                          {p.horizonHours === 0 ? "NOW" : `+${p.horizonHours}H`}
                        </td>
                        <td className="cm-nowrap">{fmtPos(p.latitude, p.longitude)}</td>
                        <td>{p.windKt != null ? `${p.windKt} kt` : "—"}</td>
                        <td className="cm-nowrap">{p.uncertaintyKm != null ? `± ${Math.round(p.uncertaintyKm)} km` : "—"}</td>
                        <td className="cm-nowrap">{formatIST(p.timestamp)}</td>
                      </tr>
                    ))}
                    {hourlyPick.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="cm-notavail">No forecast positions supplied by the trajectory model.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="cm-card__foot">
                <span>MODEL {trajectory?.model ?? "—"} v{trajectory?.modelVersion ?? "—"}</span>
                <span>HORIZON {trajectory?.forecastHorizonHours ?? "—"}H</span>
              </div>
            </div>
          ) : null}
        </section>

        {/* ═══ 2 · CURRENT STATE ═══ */}
        <section className="cm-section cm-anchor" id="current-state">
          <SectionHead title="Current State" pill={cyclone ? "OBSERVED" : "NO CYCLONE"} />
          <div className="cm-card">
            {cyclone ? (
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Storm</span>
                  <span className="cm-kv__v">{cyclone.name ?? cyclone.id} · {cyclone.category ?? "CATEGORY —"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Latitude</span>
                  <span className="cm-kv__v">{Math.abs(cyclone.latitude).toFixed(3)}°{cyclone.latitude >= 0 ? "N" : "S"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Longitude</span>
                  <span className="cm-kv__v">{Math.abs(cyclone.longitude).toFixed(3)}°{cyclone.longitude >= 0 ? "E" : "W"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Wind</span>
                  <span className="cm-kv__v">{cyclone.windKt != null ? `${cyclone.windKt} kt` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Pressure</span>
                  <span className="cm-kv__v">{cyclone.mslpHpa != null ? `${cyclone.mslpHpa} hPa` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Movement Speed</span>
                  <span className="cm-kv__v">
                    {cyclone.movement?.speedKph != null ? `${cyclone.movement.speedKph} km/h` : ""}
                    {cyclone.movement?.speedKt != null ? ` (${cyclone.movement.speedKt} kt)` : ""}
                    {cyclone.movement?.speedKph == null && cyclone.movement?.speedKt == null ? "—" : ""}
                  </span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Bearing</span>
                  <span className="cm-kv__v">
                    {cyclone.movement?.direction ?? "—"}
                    {cyclone.movement?.bearingDeg != null ? ` (${cyclone.movement.bearingDeg}°)` : ""}
                  </span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">RMW</span>
                  <span className="cm-kv__v">{cyclone.rmwKm != null ? `${cyclone.rmwKm} km` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Last Updated</span>
                  <span className="cm-kv__v">{cyclone.timestamp ? formatIST(cyclone.timestamp) : "—"}</span>
                </div>
              </div>
            ) : (
              <div className="cm-notavail">No active cyclone observed.</div>
            )}
          </div>
        </section>

        {/* ═══ 3 · INTENSITY ═══ */}
        <section className="cm-section cm-anchor" id="intensity">
          <SectionHead title="Intensity" pill={intOk ? "CURRENT + FORECAST STEPS" : "UNAVAILABLE"} />
          <ModuleGate
            label="INTENSITY MODEL"
            status={intensity?.status?.status}
            reason={intensity?.status?.message ?? intensity?.status?.status}
          >
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">Intensity Timeline</span>
                <span className="cm-pill cm-pill--muted">{intensity?.status?.status?.replace(/_/g, " ") ?? "MODEL"}</span>
              </div>
              {intSteps.length ? (
                <div className="cm-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))" }}>
                  {intSteps.map((p) => (
                    <div key={`${p.label}-${p.h}`} className="cm-tile">
                      <div className="cm-tile__kicker">
                        <span className="cm-label">{p.label}</span>
                      </div>
                      <div className="cm-tile__value">
                        {p.windKt != null ? p.windKt : "—"}
                        <span className="unit">kt</span>
                      </div>
                      <div className="cm-tile__sub">
                        {p.hpa != null ? `${p.hpa} hPa` : "PRESSURE —"}
                        {p.rmw != null ? ` · RMW ${p.rmw} km` : ""}
                      </div>
                      <span className={`cm-pill ${intStatusTone(p.status)}`}>{p.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cm-notavail">No intensity steps supplied by the intensity model.</div>
              )}
              {intensity?.status?.timestamp ? (
                <div className="cm-card__foot">
                  <span>MODEL TIME {formatIST(intensity.status.timestamp)}</span>
                  <span>PROVENANCE {cur?.observed ? "OBSERVED CURRENT" : "MODEL CURRENT"}</span>
                </div>
              ) : null}
            </div>
          </ModuleGate>
        </section>

        {/* ═══ 4 · RAPID INTENSIFICATION ═══ */}
        <section className="cm-section cm-anchor" id="ri">
          <SectionHead title="Rapid Intensification" pill={rippleOk ? "24H WINDOW" : "UNAVAILABLE"} />
          <ModuleGate
            label="RI MODEL"
            status={ripple?.status?.status}
            reason={ripple?.status?.message ?? ripple?.status?.status}
          >
            <div className="cm-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <div className="cm-card cm-horizon">
                <div className="cm-card__head">
                  <span className="cm-card__title">Rapid Intensification</span>
                  <span className="cm-pill cm-pill--muted">24H</span>
                </div>
                <div className="cm-tile__value">
                  {riProb != null ? `${(riProb * 100).toFixed(1)}%` : "—"}
                </div>
                <div className="cm-kv" style={{ marginTop: 8 }}>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Classification</span>
                    <span className="cm-kv__v">{riBand ? <CmSev severity={riBand} /> : "—"}</span>
                  </div>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Threshold</span>
                    <span className="cm-kv__v">≥ 30 kt / 24h</span>
                  </div>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Confidence</span>
                    <span className="cm-kv__v">{riLead?.statusNote ? riLead.statusNote : "NOT REPORTED"}</span>
                  </div>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Status</span>
                    <span className="cm-kv__v">{ripple?.status?.status?.replace(/_/g, " ") ?? "—"}</span>
                  </div>
                </div>
                <span className="cm-kv__k" style={{ color: "#54687d", marginTop: "auto" }}>
                  REFERENCE {riRisk ? <CmSev severity={riRisk} /> : "—"}
                </span>
              </div>

              <div className="cm-card">
                <div className="cm-card__head">
                  <span className="cm-card__title">Top Drivers</span>
                  <span className="cm-pill cm-pill--muted">IMPORTANCE</span>
                </div>
                {featureImportance && featureImportance.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {featureImportance.map((f) => (
                      <div key={f.feature} className="flex items-center gap-3">
                        <span className="cm-kv__k" style={{ flex: "0 0 120px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {f.feature}
                        </span>
                        <div className="cm-horizon__bar" style={{ flex: 1, height: 5 }}>
                          <span style={{ width: `${Math.min(100, (f.importance ?? 0) * 100)}%` }} />
                        </div>
                        <span className="cm-mono" style={{ flex: "0 0 34px", textAlign: "right", fontSize: "0.7rem", color: "#b7c6d6" }}>
                          {(f.importance ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="cm-notavail">No feature attribution supplied by the RI model.</div>
                )}
                <div className="cm-card__foot">
                  <span>LEAD {riLead?.name ?? "—"}</span>
                  {ripple?.status?.timestamp ? <span>RUN {formatIST(ripple.status.timestamp)}</span> : null}
                </div>
              </div>
            </div>
          </ModuleGate>
        </section>

        {/* ═══ 5 · RECURVATURE ═══ */}
        <section className="cm-section cm-anchor" id="recurvature">
          <SectionHead title="Recurvature" pill={recOk ? "TRACK RECURVATURE" : "UNAVAILABLE"} />
          <ModuleGate
            label="RECURVATURE MODEL"
            status={recurvature?.status?.status}
            reason={recurvature?.status?.message ?? recurvature?.status?.status}
          >
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">Recurvature Probability</span>
                <span className="cm-pillrow">
                  <CmSev severity={recRisk} />
                </span>
              </div>
              <div className="cm-tile__value">
                {recProb != null ? `${(recProb * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Current Heading</span>
                  <span className="cm-kv__v">{recurvature?.currentHeadingDeg != null ? `${recurvature.currentHeadingDeg}°` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Predicted Heading</span>
                  <span className="cm-kv__v">{recurvature?.predictedHeadingDeg != null ? `${recurvature.predictedHeadingDeg}°` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Heading Change</span>
                  <span className="cm-kv__v">{recurvature?.headingChangeDeg != null ? `${recurvature.headingChangeDeg}°` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Estimated Time to Recurvature</span>
                  <span className="cm-kv__v">WITHIN +{trajectory?.forecastHorizonHours ?? "—"}H FORECAST PERIOD</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Predicted Location</span>
                  <span className="cm-kv__v">{predLoc}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Status</span>
                  <span className="cm-kv__v">{recurvature?.status?.status?.replace(/_/g, " ") ?? "—"}</span>
                </div>
              </div>
              <div className="cm-card__foot">
                <span>MODEL {recurvature?.model?.name ?? "—"} v{recurvature?.model?.version ?? "—"}</span>
                <span>FRAMEWORK {recurvature?.model?.framework ?? "—"}</span>
              </div>
            </div>
          </ModuleGate>
        </section>

        {/* ═══ 6 · UNCERTAINTY ═══ */}
        <section className="cm-section cm-anchor" id="uncertainty">
          <SectionHead title="Uncertainty" pill="BACKEND-REPORTED ONLY" />
          <div className="cm-prov-grid">
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">Uncertainty Budget</span>
              </div>
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Forecast Cone</span>
                  <span className="cm-kv__v">± {maxUncertainty != null ? `${Math.round(maxUncertainty)} km` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Max at Horizon</span>
                  <span className="cm-kv__v">{maxUncHorizon != null ? `+${maxUncHorizon}H` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Track Uncertainty</span>
                  <span className="cm-kv__v">{uncPts.length ? `${uncPts.length} SIGMA READINGS` : "NOT REPORTED"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Intensity Uncertainty</span>
                  <span className="cm-kv__v">NOT REPORTED</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Obs vs Predicted</span>
                  <span className="cm-kv__v">{trajectory?.observedVsPredicted?.available ? "AVAILABLE" : "NOT REPORTED"}</span>
                </div>
              </div>
              <p className="cm-sub" style={{ margin: "10px 0 0", fontSize: "0.76rem" }}>
                The corridor on the track map is drawn strictly from the sigma the trajectory model reports
                per horizon. It is never inflated for visualisation — an empty corridor means the model
                supplied none.
              </p>
            </div>

            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">Track Uncertainty per Horizon</span>
                <span className="cm-pill cm-pill--muted">± KM SIGMA</span>
              </div>
              {uncPts.length ? (
                uncPts.map((p) => {
                  const km = p.uncertaintyKm ?? 0;
                  const maxKm = maxUncertainty ?? 1;
                  const rel = maxKm > 0 ? Math.min(1, km / maxKm) : 0;
                  const col = rel < 0.5 ? "#46d17e" : rel < 0.8 ? "#f0b429" : "#ff7a3c";
                  return (
                    <div className="cm-plot-row" key={`${p.horizonHours}-${p.timestamp}`}>
                      <span className="cm-plot__label">{p.horizonHours === 0 ? "NOW" : `+${p.horizonHours}H`}</span>
                      <div className="cm-plot" style={{ ["--cm-hz" as string]: col }}>
                        <span className="cm-plot__fill" style={{ width: `${Math.max(2, rel * 100)}%` }} />
                      </div>
                      <span className="cm-plot__val">±{Math.round(km)} km</span>
                    </div>
                  );
                })
              ) : (
                <div className="cm-notavail">No track uncertainty supplied by the trajectory model.</div>
              )}
              <div className="cm-card__foot" style={{ marginTop: 12 }}>
                <span>SCALE 0 → {maxUncertainty != null ? `±${Math.round(maxUncertainty)}` : "—"} KM</span>
                {trajectory?.observedVsPredicted?.errorKm != null ? (
                  <span>24H TRACK ERROR {trajectory.observedVsPredicted.errorKm.toFixed(1)} KM</span>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ 7 · PROVENANCE ═══ */}
        <section className="cm-section cm-anchor" id="provenance">
          <SectionHead title="Provenance" pill="MODEL REGISTRY JOIN" />
          <div className="cm-prov-grid">
            {prov.map((p) => (
              <div className="cm-card" key={p.mod}>
                <div className="cm-card__head">
                  <span className="cm-card__title">{p.mod.toUpperCase()}</span>
                  <span className="cm-dot" style={{ ["--cm-dot" as string]: moduleStatusColor(p.status) }} />
                </div>
                <div className="cm-kv">
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Model</span>
                    <span className="cm-kv__v">{p.model}</span>
                  </div>
                  {p.ver ? (
                    <div className="cm-kv__row">
                      <span className="cm-kv__k">Version</span>
                      <span className="cm-kv__v">{p.ver.replace(/_/g, " ")}</span>
                    </div>
                  ) : null}
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Checkpoint</span>
                    <span className="cm-kv__v">{p.artifact ?? "—"}</span>
                  </div>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Last Inference</span>
                    <span className="cm-kv__v">{p.time ? formatIST(p.time) : "—"}</span>
                  </div>
                  <div className="cm-kv__row">
                    <span className="cm-kv__k">Status</span>
                    <span className="cm-kv__v">{p.status?.replace(/_/g, " ") ?? "—"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
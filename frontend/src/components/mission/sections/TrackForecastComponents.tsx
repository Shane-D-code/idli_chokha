import { useMemo } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import type {
  TrackPoint,
  IntensityPoint,
  CycloneMovement,
  CycloneState,
  TrajectoryForecast,
  OverallRisk,
} from "@/types";
import { intensityClassInfo, intensityColor } from "@/utils/intensity";
import { compassFromBearing, movementBearing } from "@/utils/trackGeometry";
import { formatIST } from "@/utils/format";

// ── Status Badge ─────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "LIVE"
      ? "tf-badge--live"
      : status === "AVAILABLE"
        ? "tf-badge--ok"
        : status === "SIMULATED" || status === "DEMO"
          ? "tf-badge--demo"
          : status === "UNAVAILABLE"
            ? "tf-badge--unavail"
            : "tf-badge--neutral";
  return (
    <span className={`tf-badge ${cls}`}>
      <span className="tf-badge__dot" />
      {status}
    </span>
  );
}

// ── Lifecycle point ──────────────────────────────────────────
export interface LifecyclePoint extends TrackPoint {
  mslpHpa?: number;
}

// ── Intensity at an arbitrary horizon ────────────────────────
export function interpolatedIntensity(
  intensityPoints: IntensityPoint[],
  horizon: number,
): { windKt?: number; mslpHpa?: number } {
  if (!intensityPoints.length) return {};
  const sorted = [...intensityPoints].sort((a, b) => a.horizonHours - b.horizonHours);
  const exact = sorted.find((p) => p.horizonHours === horizon);
  if (exact) return { windKt: exact.windKt, mslpHpa: exact.mslpHpa };
  let prev: IntensityPoint | undefined;
  let next: IntensityPoint | undefined;
  for (const p of sorted) {
    if (p.horizonHours < horizon) prev = p;
    else {
      next = p;
      break;
    }
  }
  if (!prev || !next) return {};
  const span = next.horizonHours - prev.horizonHours;
  const t = (horizon - prev.horizonHours) / span;
  const windKt =
    prev.windKt != null && next.windKt != null
      ? Math.round(prev.windKt + (next.windKt - prev.windKt) * t)
      : undefined;
  const mslpHpa =
    prev.mslpHpa != null && next.mslpHpa != null
      ? Math.round(prev.mslpHpa + (next.mslpHpa - prev.mslpHpa) * t)
      : undefined;
  return { windKt, mslpHpa };
}

// ── UTC formatter ────────────────────────────────────────────
export function formatUTC(iso?: string): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mo = d
    .toLocaleString("en-GB", { timeZone: "UTC", month: "short" })
    .toUpperCase()
    .slice(0, 3);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mo} ${d.getUTCFullYear()} \u00B7 ${hh}:${mm}Z`;
}

// ── Current Cyclone Panel ────────────────────────────────────
export function CurrentCyclonePanel({
  cyc,
  risk,
  currentUncertaintyKm,
  statusLabel,
}: {
  cyc: CycloneState | null;
  risk?: OverallRisk;
  currentUncertaintyKm?: number;
  statusLabel: string;
}) {
  const cat = cyc?.windKt != null ? intensityClassInfo(cyc.windKt) : null;
  const move = cyc?.movement;
  const riskScore = risk?.score;
  const riskSeverity =
    risk?.severity ?? (riskScore != null ? (riskScore >= 60 ? "MODERATE" : "LOW") : undefined);

  return (
    <div className="tf-intel__inner">
      <div className="tf-intel__head">
        <div className="tf-intel__head-info">
          <span className="tf-intel__label">CURRENT CYCLONE</span>
          <span className="tf-intel__storm-name">{cyc?.name ?? "\u2014"}</span>
          <span className="tf-intel__id mono">{cyc?.id ?? "\u2014"}</span>
          <span className="tf-intel__basin">{cyc?.basin ?? "\u2014"}</span>
        </div>
        <StatusBadge status={statusLabel} />
      </div>

      <div className="tf-intel__intensity-row">
        <span className="tf-intel__wind" style={{ color: cat?.color ?? "var(--ink)" }}>
          {cyc?.windKt ?? "\u2014"} <span className="tf-intel__unit">kt</span>
        </span>
        {cat && (
          <span className="tf-intel__cat-badge" style={{ color: cat.color, borderColor: `${cat.color}44` }}>
            {cat.shortLabel}
          </span>
        )}
      </div>

      <div className="tf-intel__divider" />

      <div className="tf-intel__kv">
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">MSLP</span>
          <span className="tf-intel__kv-val">{cyc?.mslpHpa != null ? `${cyc.mslpHpa} hPa` : "\u2014"}</span>
        </div>
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">RMW</span>
          <span className="tf-intel__kv-val">{cyc?.rmwKm != null ? `${cyc.rmwKm} km` : "\u2014"}</span>
        </div>
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">MOVE</span>
          <span className="tf-intel__kv-val">
            {move?.direction ?? "\u2014"}
            {move?.speedKph != null ? ` \u00B7 ${move.speedKph} km/h` : ""}
          </span>
        </div>
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">BEARING</span>
          <span className="tf-intel__kv-val">
            {move?.bearingDeg != null ? `${move.bearingDeg}\u00B0` : "\u2014"}
            {move?.bearingDeg != null ? ` (${compassFromBearing(move.bearingDeg)})` : ""}
          </span>
        </div>
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">UNCERTAINTY</span>
          <span className="tf-intel__kv-val">
            {currentUncertaintyKm != null ? `\u00B1${currentUncertaintyKm} km` : "\u2014"}
          </span>
        </div>
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">POSITION</span>
          <span className="tf-intel__kv-val">
            {cyc?.latitude != null
              ? `${Math.abs(cyc.latitude).toFixed(2)}\u00B0${cyc.latitude >= 0 ? "N" : "S"} ${Math.abs(cyc.longitude).toFixed(2)}\u00B0${cyc.longitude >= 0 ? "E" : "W"}`
              : "\u2014"}
          </span>
        </div>
        <div className="tf-intel__kv-row">
          <span className="tf-intel__kv-key">VALID</span>
          <span className="tf-intel__kv-val">{formatUTC(cyc?.timestamp)}</span>
        </div>
      </div>

      <div className="tf-intel__divider" />

      <div className="tf-intel__risk">
        <span className="tf-intel__label">COMPOSITE RISK</span>
        {riskScore != null ? (
          <>
            <div className="tf-intel__risk-row">
              <span className="tf-intel__risk-score">{riskScore}</span>
              <span className="tf-intel__risk-den">/100</span>
              <span className="tf-intel__risk-sev">{riskSeverity ?? "UNAVAILABLE"}</span>
            </div>
            <div className="tf-intel__risk-bar">
              <div
                className="tf-intel__risk-fill"
                style={{ width: `${Math.min(100, Math.max(0, riskScore))}%` }}
              />
            </div>
          </>
        ) : (
          <span className="tf-intel__risk-sev">UNAVAILABLE</span>
        )}
        <div className="tf-intel__risk-engine mono">{risk?.engineName ?? "HazardRiskEngine"}</div>
      </div>

      <div className="tf-intel__divider" />

      <div className="tf-intel__landfall">
        <span className="tf-intel__label">PROJECTED LANDFALL</span>
        <div className="tf-intel__landfall-row">
          <span className="tf-intel__landfall-val">UNAVAILABLE</span>
        </div>
        <span className="tf-intel__landfall-msg">No landfall estimate supplied by the backend.</span>
      </div>
    </div>
  );
}

// ── Intensity Lifecycle ──────────────────────────────────────
export function IntensityLifecycle({
  points,
  statusLabel,
  selectedHorizon,
  onSelect,
  playing,
  onPlayToggle,
  onStep,
}: {
  points: LifecyclePoint[];
  statusLabel: string;
  selectedHorizon?: number;
  onSelect: (horizonHours: number) => void;
  playing: boolean;
  onPlayToggle: () => void;
  onStep: (d: -1 | 1) => void;
}) {
  if (!points.length) return null;

  const currentIdx = points.findIndex((p) => p.horizonHours === selectedHorizon);
  const activeIdx = currentIdx < 0 ? 0 : currentIdx;

  return (
    <div className="tf-lifecycle">
      <div className="tf-lifecycle__header">
        <span className="tf-lifecycle__title">INTENSITY LIFECYCLE</span>
        <div className="tf-lifecycle__header-right">
          <StatusBadge status={statusLabel} />
          <div className="tf-lifecycle__controls">
            <button
              className="tf-lc-btn"
              onClick={() => onStep(-1)}
              disabled={activeIdx <= 0}
              aria-label="Previous forecast step"
            >
              <SkipBack size={13} />
            </button>
            <button
              className="tf-lc-btn tf-lc-btn--play"
              onClick={onPlayToggle}
              aria-label={playing ? "Pause playback" : "Play forecast timeline"}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
              <span>{playing ? "PAUSE" : "PLAY"}</span>
            </button>
            <button
              className="tf-lc-btn"
              onClick={() => onStep(1)}
              disabled={activeIdx >= points.length - 1}
              aria-label="Next forecast step"
            >
              <SkipForward size={13} />
            </button>
          </div>
        </div>
      </div>
      <div className="tf-lifecycle__rail">
        <div className="tf-lifecycle__rail-line" />
        {points.map((p, i) => {
          const wind = p.windKt;
          const color =
            wind != null ? (intensityColor(wind) ?? "var(--ink-4)") : "var(--ink-4)";
          const isActive = i === activeIdx;
          const label = p.horizonHours === 0 ? "NOW" : `+${p.horizonHours}H`;
          return (
            <button
              key={i}
              className={`tf-lc-point ${isActive ? "tf-lc-point--active" : ""}`}
              onClick={() => onSelect(p.horizonHours)}
              aria-pressed={isActive}
              aria-label={`${label} forecast`}
            >
              <span className="tf-lc-point__horizon">{label}</span>
              <span
                className="tf-lc-point__dot"
                style={{ background: color, borderColor: isActive ? "#fff" : undefined }}
              />
              <span className="tf-lc-point__wind" style={{ color }}>
                {wind != null ? `${wind} kt` : "\u2014"}
              </span>
              <span className="tf-lc-point__pressure">
                {p.mslpHpa != null ? `${p.mslpHpa} hPa` : "\u2014"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Selected Forecast Card ───────────────────────────────────
export function SelectedForecastCard({
  selectedPoint,
  lifecyclePoints,
  movement,
}: {
  selectedPoint: TrackPoint | null;
  lifecyclePoints: LifecyclePoint[];
  movement?: CycloneMovement;
}) {
  if (!selectedPoint) {
    return (
      <div className="tf-card tf-card--empty">
        <span className="tf-card__label">SELECTED FORECAST</span>
        <span className="tf-card__hint">Select a forecast position on the map, timeline or lifecycle</span>
      </div>
    );
  }

  const lc = lifecyclePoints.find((p) => p.horizonHours === selectedPoint.horizonHours);
  const wind = lc?.windKt ?? selectedPoint.windKt;
  const cat = wind != null ? intensityClassInfo(wind) : null;
  const pressure = lc?.mslpHpa;
  const label = selectedPoint.horizonHours === 0 ? "NOW" : `+${selectedPoint.horizonHours}H FORECAST`;

  return (
    <div className="tf-card tf-card--selected">
      <span className="tf-card__label">{label}</span>
      <div className="tf-card__coords">
        <span>
          {Math.abs(selectedPoint.latitude).toFixed(2)}\u00B0
          {selectedPoint.latitude >= 0 ? "N" : "S"}
        </span>
        <span className="tf-card__coord-sep">&middot;</span>
        <span>
          {Math.abs(selectedPoint.longitude).toFixed(2)}\u00B0
          {selectedPoint.longitude >= 0 ? "E" : "W"}
        </span>
      </div>
      <div className="tf-card__hero">
        <span className="tf-card__wind" style={{ color: cat?.color ?? "var(--ink)" }}>
          {wind != null ? `${wind} kt` : "\u2014"}
        </span>
        {pressure != null && <span className="tf-card__pressure">{pressure} hPa</span>}
      </div>
      <div className="tf-card__rows">
        <div className="tf-card__row">
          <span className="tf-card__row-label">MOVEMENT</span>
          <span className="tf-card__row-value">
            {movement?.direction ?? "\u2014"}
            {movement?.speedKph != null ? ` \u00B7 ${movement.speedKph} km/h` : ""}
          </span>
        </div>
        <div className="tf-card__row">
          <span className="tf-card__row-label">TRACK UNCERTAINTY</span>
          <span className="tf-card__row-value">
            {selectedPoint.uncertaintyKm != null ? `\u00B1${selectedPoint.uncertaintyKm} km` : "\u2014"}
          </span>
        </div>
        <div className="tf-card__row">
          <span className="tf-card__row-label">VALID</span>
          <span className="tf-card__row-value">
            {selectedPoint.timestamp ? formatIST(selectedPoint.timestamp) : "\u2014"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Forecast Summary Card ────────────────────────────────────
export function ForecastSummaryCard({
  cyc,
  track,
  points,
  intensityPoints,
}: {
  cyc: CycloneState | null;
  track: TrajectoryForecast | null;
  points: TrackPoint[];
  intensityPoints: IntensityPoint[];
}) {
  const horizon = track?.forecastHorizonHours ?? 24;
  const end = intensityPoints[intensityPoints.length - 1];
  const endWind = end?.windKt;
  const endPressure = end?.mslpHpa;
  const endUncertainty = points.find((p) => p.horizonHours === end?.horizonHours)?.uncertaintyKm;
  const maxUncertainty =
    points.reduce((max, p) => Math.max(max, p.uncertaintyKm ?? 0), 0) || undefined;

  const startCompass = useMemo(() => {
    const st = points.findIndex((p) => p.horizonHours === 0);
    if (st < 0) return cyc?.movement?.direction;
    const b = movementBearing(points, st);
    return b != null ? compassFromBearing(b) : cyc?.movement?.direction;
  }, [points, cyc?.movement?.direction]);

  const endCompass = useMemo(() => {
    const en = points.findIndex((p) => p.horizonHours === Math.max(0, horizon - 6));
    if (en < 0) return startCompass;
    const b = movementBearing(points, en);
    return b != null ? compassFromBearing(b) : startCompass;
  }, [points, horizon, startCompass]);

  const movementTrend =
    startCompass && endCompass && startCompass !== endCompass
      ? `${startCompass} \u2192 ${endCompass}`
      : startCompass ?? "\u2014";

  return (
    <div className="tf-card tf-card--summary">
      <span className="tf-card__label">FORECAST SUMMARY</span>
      <div className="tf-card__compare">
        <div className="tf-card__col">
          <span className="tf-card__col-label">CURRENT</span>
          <span className="tf-card__col-big">
            {cyc?.windKt ?? "\u2014"} <span className="tf-card__unit">kt</span>
          </span>
          <span className="tf-card__col-sub">
            {cyc?.mslpHpa != null ? `${cyc.mslpHpa} hPa` : "\u2014"}
          </span>
        </div>
        <div className="tf-card__col tf-card__col--end">
          <span className="tf-card__col-label">+{horizon}H</span>
          <span className="tf-card__col-big">
            {endWind ?? "\u2014"} <span className="tf-card__unit">kt</span>
          </span>
          <span className="tf-card__col-sub">
            {endPressure != null ? `${endPressure} hPa` : "\u2014"}
          </span>
        </div>
      </div>
      <div className="tf-card__rows">
        <div className="tf-card__row">
          <span className="tf-card__row-label">MAX FORECAST UNCERTAINTY</span>
          <span className="tf-card__row-value">
            {endUncertainty != null
              ? `\u00B1${endUncertainty} km`
              : maxUncertainty != null
                ? `\u00B1${maxUncertainty} km`
                : "\u2014"}
          </span>
        </div>
        <div className="tf-card__row">
          <span className="tf-card__row-label">MOVEMENT TREND</span>
          <span className="tf-card__row-value">{movementTrend}</span>
        </div>
      </div>
    </div>
  );
}

// ── Forecast Provenance ──────────────────────────────────────
export function ProvenanceBlock({
  track,
  statusLabel,
  currentUncertaintyKm,
}: {
  track: TrajectoryForecast | null;
  statusLabel: string;
  currentUncertaintyKm?: number;
}) {
  return (
    <div className="tf-provenance">
      <div className="tf-prov__header">
        <span className="tf-prov__title">FORECAST PROVENANCE</span>
      </div>
      <div className="tf-prov__grid">
        <div className="tf-prov__item">
          <span className="tf-prov__label">MODEL</span>
          <span className="tf-prov__value">{track?.model ?? "\u2014"}</span>
        </div>
        <div className="tf-prov__item">
          <span className="tf-prov__label">CHECKPOINT</span>
          <span className="tf-prov__value">{track?.modelVersion ?? "\u2014"}</span>
        </div>
        <div className="tf-prov__item">
          <span className="tf-prov__label">VALID</span>
          <span className="tf-prov__value">
            {track?.initialized ? formatIST(track.initialized) : "\u2014"}
          </span>
        </div>
        <div className="tf-prov__item">
          <span className="tf-prov__label">HORIZON</span>
          <span className="tf-prov__value">{track?.forecastHorizonHours ?? "\u2014"}H</span>
        </div>
        <div className="tf-prov__item">
          <span className="tf-prov__label">UNCERTAINTY</span>
          <span className="tf-prov__value">
            {currentUncertaintyKm != null ? `\u00B1${currentUncertaintyKm} km NOW` : "\u2014"}
          </span>
        </div>
        <div className="tf-prov__item">
          <span className="tf-prov__label">SOURCE</span>
          <span className="tf-prov__value">TOOFAN FORECAST ENGINE</span>
        </div>
        <div className="tf-prov__item">
          <span className="tf-prov__label">STATUS</span>
          <span className="tf-prov__value">
            <StatusBadge status={statusLabel} />
          </span>
        </div>
      </div>
    </div>
  );
}
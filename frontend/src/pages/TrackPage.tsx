import { useEffect, useMemo, useRef, useState } from "react";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { LayerControl, type LayerGroup } from "@/components/map/LayerControl";
import { toofanService } from "@/services/toofanService";
import { SectionLabel, MetricBlock, StatusLabel, DataRow, ThinDivider } from "@/components/design";
import { LoadingState } from "@/components/common/StateBox";
import { formatIST } from "@/utils/format";
import type { TrajectoryForecast, CycloneState } from "@/types";

const PLAYBACK_MS = 1200;

const LAYERS: LayerGroup[] = [
  { group: "Track", options: [
    { key: "observed", label: "Observed Path", available: true },
    { key: "forecast", label: "Model Forecast", available: true },
    { key: "uncertainty", label: "Uncertainty Band (uncalibrated)", available: true },
    { key: "points", label: "Horizon Points", available: true },
  ]},
];

export default function TrackPage() {
  const [track, setTrack] = useState<TrajectoryForecast | null>(null);
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    observed: true,
    forecast: true,
    uncertainty: true,
    points: true,
  });
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, c] = await Promise.all([
          toofanService.getTrajectory(),
          toofanService.getCyclone(),
        ]);
        if (!cancelled) { setTrack(t); setCyc(c); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const observed = visible.observed
    ? (points.filter((p) => !p.isForecast)).map((p) => ({ lat: p.latitude, lon: p.longitude, timestamp: p.timestamp }))
    : [];

  if (loading) {
    return (
      <div className="page">
        <LoadingState rows={4} />
      </div>
    );
  }

  const categorized = track?.status.status ?? "UNAVAILABLE";

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Forecast</div>
        <h1 className="page-title">Cyclone Track</h1>
        <p className="page-sub">24-hour trajectory prediction — model forecast, uncertainty, and observed path.</p>
      </div>

      <div className="hero-grid">
        <div className="map-container">
          <div className="map-kicker">TRACK FORECAST · 24-HOUR TRAJECTORY</div>
          <div className="map-overlay" style={{ top: 52 }}>
            <LayerControl groups={LAYERS} visible={visible} onToggle={(k) => setVisible((v) => ({ ...v, [k]: !v[k] }))} />
          </div>
          <MapErrorBoundary title="TRACK MAP UNAVAILABLE" height="100%">
            <CycloneMap
              current={
                cyc ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name, windKt: cyc.windKt } : undefined
              }
              forecast={points}
              historicalTrack={observed}
              selectedIdx={idx}
              playing={playing}
              onIdxChange={setIdx}
              onPlayToggle={() => setPlaying((p) => !p)}
              showTimeline
              showTag
            />
          </MapErrorBoundary>
        </div>

        <aside className="rail-stack">
          <div className="panel heavy">
            <div className="panel-head">
              <span className="panel-title">Track Forecast</span>
              <StatusLabel status={track?.status.status ?? "UNAVAILABLE"} />
            </div>
            <div className="panel-body">
              <SectionLabel label="Forecast Horizon" />
              <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-title)" }}>
                {track?.forecastHorizonHours ?? "—"}<span className="unit" style={{ fontSize: "0.5em", color: "var(--ink-3)" }}> HOURS</span>
              </div>
              <ThinDivider />
              <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
                <MetricBlock label="Model" value={track?.model ?? "—"} size="sm" />
                <MetricBlock label="Horizons" value={track?.predictionSteps ?? "—"} size="sm" />
              </div>
              <ThinDivider faint />
              {points.filter((p) => p.isForecast).map((p) => (
                <DataRow key={p.horizonHours} label={`+${p.horizonHours}h`} value={`${p.latitude.toFixed(2)}°N ${p.longitude.toFixed(2)}°E`} />
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Uncertainty</span></div>
            <div className="panel-body tight">
              {points.filter((p) => p.isForecast).map((p) => (
                <DataRow key={p.horizonHours} label={`+${p.horizonHours}h`} value={`±${p.uncertaintyKm ?? "—"} km`} />
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Model Information</span></div>
            <div className="panel-body">
              <DataRow label="Source" value={track?.model ?? "—"} />
              <DataRow label="Version" value={track?.modelVersion ?? "—"} />
              <DataRow label="Initialized" value={formatIST(track?.initialized)} />
              <DataRow label="Status" value={<StatusLabel status={categorized} />} />
              {track?.status.message ? (
                <p className="small muted" style={{ marginTop: "var(--sp-1)" }}>
                  {track.status.message}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

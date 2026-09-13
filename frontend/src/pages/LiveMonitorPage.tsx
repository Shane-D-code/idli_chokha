import { useEffect, useMemo, useRef, useState } from "react";
import {
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Maximize,
  Minus,
  Plus,
  Layers,
} from "lucide-react";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { toofanService } from "@/services/toofanService";
import { SectionLabel, StatusLabel, DataRow, ThinDivider } from "@/components/design";
import { useApp } from "@/state/AppContext";
import { formatIST } from "@/utils/format";
import type { TrajectoryForecast } from "@/types";

const PLAYBACK_MS = 900;

export default function LiveMonitorPage() {
  const { mode } = useApp();
  const [track, setTrack] = useState<TrajectoryForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await toofanService.getTrajectory();
        if (!cancelled) setTrack(t);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const interval = setInterval(async () => {
      try {
        const t = await toofanService.getTrajectory();
        if (!cancelled) setTrack(t);
      } catch {
        /* ignore */
      }
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const points = useMemo(() => track?.points ?? [], [track]);
  const activePoint = points[idx];

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

  const step = (d: number) =>
    setIdx((i) => Math.max(0, Math.min(points.length - 1, i + d)));

  const goFrame = (i: number) => {
    setIdx(Math.max(0, Math.min(points.length - 1, i)));
    setPlaying(false);
  };

  if (loading) {
    return (
      <div className="page">
        <div className="stack" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
        </div>
      </div>
    );
  }

  const simulated = mode === "demo";

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Forecast · Live Monitor</div>
        <h1 className="page-title">Live Monitor</h1>
        <p className="page-sub">
          Satellite / weather data viewer with a frame timeline and operational service status.
        </p>
      </div>

      {/* ═══ LARGE VISUALIZATION ═══ */}
      <div className="map-container" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="map-kicker">
          {simulated ? "SIMULATED FEED" : "SATELLITE / WEATHER VIEW"}
        </div>
        <div className="map-instruments">
          <button className="instrument" title="Zoom out" onClick={() => {}}><Minus size={16} /></button>
          <button className="instrument" title="Zoom in" onClick={() => {}}><Plus size={16} /></button>
          <button className="instrument" title="Layers" onClick={() => {}}><Layers size={16} /></button>
          <button className="instrument" title="Fullscreen" onClick={() => {}}><Maximize size={16} /></button>
        </div>
        <MapErrorBoundary title="LIVE VIEW UNAVAILABLE" height="100%">
          <CycloneMap
            current={
              activePoint
                ? { lat: activePoint.latitude, lon: activePoint.longitude, name: "CYCLONE", windKt: activePoint.windKt }
                : undefined
            }
            forecast={points}
            selectedIdx={idx}
            playing={playing}
            onIdxChange={goFrame}
            onPlayToggle={() => setPlaying((p) => !p)}
            flyTo={false}
            showTag={false}
          />
        </MapErrorBoundary>
      </div>

      {/* ═══ TIMELINE ═══ */}
      <div className="timeline" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel-head">
          <span className="panel-title">Forecast Timeline — Trajectory</span>
          <span className="timeline-frame">
            FRAME {Math.min(idx + 1, points.length)} / {points.length}
          </span>
        </div>

        <div className="timeline-rail">
          <div className="timeline-track" />
          <div
            className="timeline-track filled"
            style={{ width: `${points.length > 1 ? (idx / (points.length - 1)) * 100 : 0}%` }}
          />
          {points.map((p, i) => (
            <button
              key={i}
              className={`timeline-tick ${i === idx ? "active" : ""}`}
              style={{ left: `${(i / Math.max(1, points.length - 1)) * 100}%`, top: 0 }}
              onClick={() => goFrame(i)}
              title={`+${p.horizonHours}h · ${p.latitude.toFixed(2)}°N ${p.longitude.toFixed(2)}°E`}
            >
              <span className="tl-dot" />
              <span>+{p.horizonHours}h</span>
            </button>
          ))}
        </div>

        <div className="timeline-controls">
          <button className="instrument" title="Previous frame" onClick={() => step(-1)}><SkipBack size={16} /></button>
          <button
            className="btn solid sm"
            onClick={() => setPlaying((p) => !p)}
            style={{ minWidth: 96 }}
          >
            {playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
          </button>
          <button className="instrument" title="Next frame" onClick={() => step(1)}><SkipForward size={16} /></button>
          <span className="small muted" style={{ marginLeft: "var(--sp-2)" }}>
            {activePoint
              ? `${activePoint.latitude.toFixed(2)}°N ${activePoint.longitude.toFixed(2)}°E · ${formatIST(activePoint.timestamp)}`
              : "—"}
          </span>
        </div>
      </div>

      {/* ═══ LIVE DATA STRIP ═══ */}
      <SectionLabel label="Data Services" strong />
      <div className="hazard-strip" style={{ marginTop: "var(--sp-2)" }}>
        {[
          { n: "Satellite", s: "AVAILABLE" as const },
          { n: "Track", s: "AVAILABLE" as const },
          { n: "Rainfall", s: "BASELINE" as const },
          { n: "Wind", s: "UNAVAILABLE" as const },
          { n: "Flood", s: "DATA_UNAVAILABLE" as const },
        ].map((s) => (
          <div key={s.n} className="hazard-module">
            <div className="m-title" style={{ fontSize: "0.95rem" }}>{s.n}</div>
            <div className="m-meta"><StatusLabel status={s.s} /></div>
          </div>
        ))}
      </div>

      {/* Data source footnote */}
      <div className="panel" style={{ marginTop: "var(--section-gap)" }}>
        <div className="panel-head">
          <span className="panel-title">Frame Metadata</span>
        </div>
        <div className="grid-2">
          <div>
            <DataRow label="Source" value={track?.model ?? "—"} />
            <DataRow label="Model Version" value={track?.modelVersion ?? "—"} />
            <DataRow label="Forecast Horizon" value={`${track?.forecastHorizonHours ?? "—"} h`} />
          </div>
          <div>
            <DataRow label="Initialized" value={formatIST(track?.initialized)} />
            <DataRow label="Steps" value={track?.predictionSteps ?? "—"} />
            <DataRow label="Status" value={<StatusLabel status={track?.status.status ?? "UNAVAILABLE"} />} />
          </div>
        </div>
        <ThinDivider faint />
        <p className="small muted">
          {simulated
            ? "DEMO MODE — SIMULATED DATA. This timeline is illustrative and not real operational satellite output."
            : "Operational live feed. Data updates are polled from the TOOFAN backend."}
        </p>
      </div>
    </div>
  );
}

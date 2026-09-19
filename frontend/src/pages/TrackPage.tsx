import { useEffect, useMemo, useRef, useState } from "react";
import { CycloneMap } from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { LayerControl, type LayerGroup } from "@/components/map/LayerControl";
import { toofanService } from "@/services/toofanService";
import { LoadingState } from "@/components/common/StateBox";
import type {
  TrajectoryForecast,
  CycloneState,
  TrackPoint,
  IntensityReport,
  OverallRisk,
} from "@/types";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  StatusBadge,
  CurrentCyclonePanel,
  IntensityLifecycle,
  SelectedForecastCard,
  ForecastSummaryCard,
  ProvenanceBlock,
  interpolatedIntensity,
  type LifecyclePoint,
} from "@/components/mission/sections/TrackForecastComponents";

const PLAYBACK_MS = 1400;

const LAYERS: LayerGroup[] = [
  { group: "Track", options: [
    { key: "observed", label: "Observed Path", available: true },
    { key: "forecast", label: "Model Forecast", available: true },
    { key: "cone", label: "Uncertainty Cone", available: true },
    { key: "points", label: "Horizon Points", available: true },
  ]},
];

export default function TrackPage() {
  const [track, setTrack] = useState<TrajectoryForecast | null>(null);
  const [cyc, setCyc] = useState<CycloneState | null>(null);
  const [intensity, setIntensity] = useState<IntensityReport | null>(null);
  const [risk, setRisk] = useState<OverallRisk | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<TrackPoint | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState<Record<string, boolean>>({
    observed: true,
    forecast: true,
    cone: true,
    points: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, c, i, r] = await Promise.all([
          toofanService.getTrajectory(),
          toofanService.getCyclone(),
          toofanService.getIntensity(),
          toofanService.getOverallRisk(),
        ]);
        if (!cancelled) {
          setTrack(t);
          setCyc(c);
          setIntensity(i);
          setRisk(r);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const points = useMemo(() => track?.points ?? [], [track]);
  const observedPoints = useMemo(() => points.filter((p) => !p.isForecast), [points]);
  const intensityPoints = useMemo(() => intensity?.forecastPoints ?? [], [intensity]);
  const currentPoint = useMemo(() => points.find((p) => p.horizonHours === 0), [points]);

  // Full 2-hourly lifecycle: positions from the trajectory, wind + pressure
  // from the model intensity report (interpolated to each horizon).
  const lifecyclePoints = useMemo<LifecyclePoint[]>(() => {
    return points
      .filter((p) => p.horizonHours >= 0)
      .sort((a, b) => a.horizonHours - b.horizonHours)
      .map((p) => {
        const { windKt, mslpHpa } = interpolatedIntensity(intensityPoints, p.horizonHours);
        return { ...p, windKt: windKt ?? p.windKt, mslpHpa };
      });
  }, [points, intensityPoints]);

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
    const tp =
      points.find((p) => p.horizonHours === 12) ??
      points.find((p) => p.horizonHours >= 0) ??
      points[0] ?? null;
    setSelectedPoint(tp);
  }, [points]);

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
  }, [playing, points.length, reducedMotion]);

  const pointByHorizon = useMemo(() => {
    const m: Record<number, TrackPoint> = {};
    points.forEach((p) => { m[p.horizonHours] = p; });
    return m;
  }, [points]);

  const handlePointClick = (point: TrackPoint) => {
    setSelectedPoint(point);
    setIdx(points.indexOf(point));
  };

  const handleTimelineClick = (pointIdx: number) => {
    setIdx(pointIdx);
    const p = points[pointIdx];
    if (p?.isForecast) setSelectedPoint(p);
    else setSelectedPoint(null);
  };

  const handleLifecycleSelect = (horizonHours: number) => {
    const tp = pointByHorizon[horizonHours];
    if (tp) {
      setSelectedPoint(tp);
      setIdx(points.indexOf(tp));
    }
  };

  const observed = useMemo(() =>
    (visible.observed ? observedPoints : []).map((p) => ({
      lat: p.latitude,
      lon: p.longitude,
      timestamp: p.timestamp,
      windKt: p.windKt,
      uncertaintyKm: p.uncertaintyKm,
      horizonHours: p.horizonHours,
    })),
    [observedPoints, visible.observed]
  );

  const hiddenLayers = useMemo(() => {
    const hidden: Array<"observed" | "forecast" | "cone" | "points"> = [];
    if (!visible.observed) hidden.push("observed");
    if (!visible.forecast) hidden.push("forecast");
    if (!visible.cone) hidden.push("cone");
    if (!visible.points) hidden.push("points");
    return hidden;
  }, [visible]);

  const statusLabel = track?.status.status ?? cyc?.status?.status ?? getDataStatus();
  function getDataStatus(): string {
    return toofanService.getDataMode() === "live" ? "LIVE" : "SIMULATED";
  }

  function stepLifecycle(d: -1 | 1) {
    if (!lifecyclePoints.length) return;
    const currentH = selectedPoint?.horizonHours ?? 0;
    const i = lifecyclePoints.findIndex((p) => p.horizonHours === currentH);
    const target = i < 0 ? 0 : Math.max(0, Math.min(lifecyclePoints.length - 1, i + d));
    handleLifecycleSelect(lifecyclePoints[target].horizonHours);
  }

  if (loading) {
    return (
      <div className="tf-page">
        <LoadingState rows={4} />
      </div>
    );
  }

  return (
    <div className="tf-page">
      <header className="tf-header">
        <div className="tf-header__left">
          <div className="tf-header__index">
            <span className="tf-header__num">02</span>
            <span className="tf-header__rule" />
          </div>
          <div className="tf-header__text">
            <span className="tf-header__kicker">FOLLOW THE PATH</span>
            <h1 className="tf-header__title">TRACK &amp; INTENSITY FORECAST</h1>
            <p className="tf-header__sub">
              Multi-model ensemble forecast of track, intensity and uncertainty up to 24\u201372 hours.
            </p>
          </div>
        </div>
        <div className="tf-header__right">
          <StatusBadge status={statusLabel} />
        </div>
      </header>

      <div className="tf-workspace">
        <aside className="tf-intel">
          <CurrentCyclonePanel
            cyc={cyc}
            risk={risk}
            currentUncertaintyKm={currentPoint?.uncertaintyKm}
            statusLabel={statusLabel}
          />
        </aside>
        <div className="tf-map-wrap">
          <div className="tf-map-head">
            <div className="tf-map-head__left">
              <span className="tf-map-head__kicker">FORECAST MAP</span>
              <span className="tf-map-head__name">{cyc?.basin ?? "NORTH INDIAN OCEAN"}</span>
              <span className="tf-map-head__sep">&middot;</span>
              <span className="tf-map-head__name">{cyc?.name ?? "\u2014"}</span>
              <span className="tf-map-head__range">NOW &rarr; +{track?.forecastHorizonHours ?? 24}H</span>
            </div>
            <div className="tf-map-head__right">
              <StatusBadge status={statusLabel} />
            </div>
          </div>
          <MapErrorBoundary title="TRACK MAP UNAVAILABLE" height="100%">
            <CycloneMap
              current={cyc ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name, windKt: cyc.windKt } : undefined}
              forecast={points}
              historicalTrack={observed}
              selectedIdx={idx}
              playing={playing}
              onIdxChange={(i) => handleTimelineClick(i)}
              onPlayToggle={() => setPlaying((p) => !p)}
              onPointSelected={handlePointClick}
              showTimeline
              showTag
              hiddenLayers={hiddenLayers}
              recenterMode="cyclone"
              focusPadding={60}
            />
            <div className="tf-layer-ctrl">
              <LayerControl
                groups={LAYERS}
                visible={visible}
                onToggle={(k) => setVisible((v) => ({ ...v, [k]: !v[k] }))}
              />
            </div>
          </MapErrorBoundary>
        </div>
      </div>

      <IntensityLifecycle
        points={lifecyclePoints}
        statusLabel={statusLabel}
        selectedHorizon={selectedPoint?.horizonHours}
        onSelect={handleLifecycleSelect}
        playing={playing}
        onPlayToggle={() => setPlaying((p) => !p)}
        onStep={stepLifecycle}
      />

      <div className="tf-detail-grid">
        <SelectedForecastCard selectedPoint={selectedPoint} lifecyclePoints={lifecyclePoints} movement={cyc?.movement} />
        <ForecastSummaryCard cyc={cyc} track={track} points={points} intensityPoints={intensityPoints} />
      </div>

      <ProvenanceBlock track={track} statusLabel={statusLabel} currentUncertaintyKm={currentPoint?.uncertaintyKm} />
    </div>
  );
}

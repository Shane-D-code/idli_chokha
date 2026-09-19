import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import maplibregl from "maplibre-gl";
import type { MissionBundle } from "@/types/mission";
import { CycloneMap } from "@/components/map/CycloneMap";
import { CycloneVortex } from "@/components/map/CycloneVortex";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { LayerControl, type LayerGroup } from "@/components/map/LayerControl";
import {
  normalizeTrack,
  buildTrackSegments,
  buildUncertaintyCone,
  trackValidationLog,
  type NormalizedTrackPoint,
} from "@/utils/trackModel";
import { intensityClassInfo, intensityColor } from "@/utils/intensity";
import { bearing as calcBearing, compassFromBearing } from "@/utils/trackGeometry";
import { TRACK_PLACES, type TrackPlaceKind } from "@/utils/trackPlaces";
import {
  TRACK_COLOR,
  FORECAST_COLOR,
  UNCERTAINTY_FILL,
  UNCERTAINTY_STROKE,
} from "@/components/map/mapTheme";
import {
  CurrentCyclonePanel,
  IntensityLifecycle,
  SelectedForecastCard,
  ForecastSummaryCard,
  ProvenanceBlock,
  StatusBadge,
  interpolatedIntensity,
  type LifecyclePoint,
} from "./TrackForecastComponents";

interface Props {
  bundle: MissionBundle;
}

/** Full track node — one per horizon, enriched with intensity + movement. */
interface TrackNode {
  horizonHours: number;
  label: string;
  timestamp?: string;
  windKt?: number;
  pressureHpa?: number;
  rmwKm?: number;
  uncertaintyKm?: number;
  latitude?: number;
  longitude?: number;
  bearingDeg?: number;
  direction?: string;
  speedKph?: number;
  phase: "OBS" | "NOW" | "FC";
  source: string;
  status: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Segment features: colour by intensity at segment START point (categorical meaning). */
const segs = (pts: NormalizedTrackPoint[], fallback: string) =>
  buildTrackSegments(pts).map((s) => ({
    type: "Feature" as const,
    properties: {
      color: s.from.windKt != null ? (intensityColor(s.from.windKt) ?? fallback) : fallback,
    },
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [s.from.longitude, s.from.latitude],
        [s.to.longitude, s.to.latitude],
      ],
    },
  }));

const LAYERS: LayerGroup[] = [
  { group: "Track", options: [
    { key: "observed", label: "Observed Path", available: true },
    { key: "forecast", label: "Model Forecast", available: true },
    { key: "cone", label: "Uncertainty Cone", available: true },
    { key: "points", label: "Horizon Points", available: true },
  ]},
];

export function TrackForecastTheatre({ bundle }: Props) {
  const traj = bundle.trajectory;
  const current = bundle.cyclone;
  const intensity = bundle.intensity;
  const risk = bundle.risk;
  const isDemo = bundle.mode === "demo";
  const statusLabel = bundle.provenance.forecast ?? (isDemo ? "SIMULATED" : "LIVE");

  const [mapEl, setMapEl] = useState<maplibregl.Map | null>(null);
  const [selectedHorizon, setSelectedHorizon] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [userPanned, setUserPanned] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const placesRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    observed: true,
    forecast: true,
    cone: true,
    points: true,
  });
  const [loaded, setLoaded] = useState(false);

  // Dev-only debug overlay — ?trackDebug=1, never enabled in production.
  const [debugOn] = useState(() => {
    if (!import.meta.env.DEV) return false;
    try {
      return new URLSearchParams(window.location.search).get("trackDebug") === "1";
    } catch {
      return false;
    }
  });

  const points = useMemo(() => traj?.points ?? [], [traj]);
  const canonical = useMemo(() => normalizeTrack(points), [points]);

  // Reset the theatre when a new trajectory arrives.
  useEffect(() => {
    setSelectedHorizon(0);
    setPlaying(false);
    setUserPanned(false);
  }, [points.length]);

  // ── Single source of truth for intensity along the forecast ──
  // The intensity model is authoritative for wind where it supplies a horizon;
  // intermediate trajectory points are linearly interpolated between those
  // horizons so the map track, points, timeline and lifecycle ALWAYS agree.
  const intensityByHorizon = useMemo(() => {
    const m = new Map<number, { windKt: number; pressureHpa?: number; rmwKm?: number }>();
    for (const fp of intensity.forecastPoints ?? []) {
      if (fp.horizonHours >= 0 && fp.windKt != null) {
        m.set(fp.horizonHours, {
          windKt: fp.windKt,
          pressureHpa: fp.mslpHpa,
          rmwKm: fp.rmwKm,
        });
      }
    }
    return m;
  }, [intensity]);

  const intensityPointsSorted = useMemo(
    () =>
      [...intensityByHorizon.entries()]
        .map(([h, w]) => ({ h, windKt: w.windKt, pressureHpa: w.pressureHpa, rmwKm: w.rmwKm }))
        .sort((a, b) => a.h - b.h),
    [intensityByHorizon],
  );

  const enrichedForecast = useMemo<NormalizedTrackPoint[]>(() => {
    const intPts = intensityPointsSorted;
    if (intPts.length < 2) return canonical.forecast;
    return canonical.forecast.map((pt) => {
      if (pt.horizonHours <= 0) return pt;
      const exact = intensityByHorizon.get(pt.horizonHours);
      if (exact) return { ...pt, windKt: exact.windKt };
      let lo: [number, number] | null = null;
      let hi: [number, number] | null = null;
      for (const e of intPts) {
        if (e.h <= pt.horizonHours) lo = [e.h, e.windKt];
        if (e.h > pt.horizonHours) { hi = [e.h, e.windKt]; break; }
      }
      if (!lo || !hi || hi[0] === lo[0]) return pt;
      const t = (pt.horizonHours - lo[0]) / (hi[0] - lo[0]);
      return { ...pt, windKt: Math.round(lo[1] + (hi[1] - lo[1]) * t) };
    });
  }, [canonical.forecast, intensityByHorizon, intensityPointsSorted]);

  const forecastLine = useMemo<NormalizedTrackPoint[]>(
    () => (canonical.current ? [canonical.current, ...enrichedForecast] : enrichedForecast),
    [canonical.current, enrichedForecast],
  );

  const cone = useMemo(() => buildUncertaintyCone(forecastLine), [forecastLine]);

  // One enriched node per track position — wind/pressure/RMW from the intensity
  // model (interpolated to the exact horizon), movement from consecutive track
  // positions, phase/source/status honest labels.
  const nodes: TrackNode[] = useMemo(() => {
    const track = canonical.points;
    const byH = new Map(track.map((p) => [p.horizonHours, p]));
    const line = canonical.current ? [canonical.current, ...enrichedForecast] : enrichedForecast;

    const moveFor = (h: number): Pick<TrackNode, "bearingDeg" | "direction" | "speedKph"> => {
      if (h === 0 && current.movement) {
        const m = current.movement;
        return {
          bearingDeg: m.bearingDeg,
          direction: m.direction ?? (m.bearingDeg != null ? compassFromBearing(m.bearingDeg) : undefined),
          speedKph: m.speedKph,
        };
      }
      const i = line.findIndex((p) => p.horizonHours === h);
      if (i >= 0 && i < line.length - 1) {
        const deg = calcBearing(
          { lat: line[i].latitude, lon: line[i].longitude },
          { lat: line[i + 1].latitude, lon: line[i + 1].longitude },
        );
        return { bearingDeg: deg, direction: compassFromBearing(deg), speedKph: undefined };
      }
      if (i > 0) {
        const deg = calcBearing(
          { lat: line[i - 1].latitude, lon: line[i - 1].longitude },
          { lat: line[i].latitude, lon: line[i].longitude },
        );
        return { bearingDeg: deg, direction: compassFromBearing(deg), speedKph: undefined };
      }
      const tp = byH.get(h);
      if (tp) {
        const j = track.indexOf(tp);
        if (j >= 0 && j < track.length - 1) {
          const [a, b] = track[j + 1].horizonHours > tp.horizonHours
            ? [tp, track[j + 1]]
            : [track[j - 1], tp];
          const deg = calcBearing({ lat: a.latitude, lon: a.longitude }, { lat: b.latitude, lon: b.longitude });
          return { bearingDeg: deg, direction: compassFromBearing(deg), speedKph: undefined };
        }
      }
      return { bearingDeg: undefined, direction: undefined, speedKph: undefined };
    };

    return line
      .filter((p) => p.horizonHours >= 0)
      .map((p) => {
        const mv = moveFor(p.horizonHours);
        const intensityAt = interpolatedIntensity(intensity.forecastPoints ?? [], p.horizonHours);
        return {
          horizonHours: p.horizonHours,
          label: p.horizonHours === 0 ? "NOW" : `+${p.horizonHours}h`,
          timestamp: p.timestamp,
          windKt: p.windKt,
          pressureHpa: intensityAt.mslpHpa,
          rmwKm: intensityByHorizon.get(p.horizonHours)?.rmwKm ?? undefined,
          uncertaintyKm: p.uncertaintyKm,
          latitude: p.latitude,
          longitude: p.longitude,
          bearingDeg: mv.bearingDeg,
          direction: mv.direction,
          speedKph: mv.speedKph,
          phase: p.horizonHours === 0 ? "NOW" : "FC",
          source: p.horizonHours === 0 ? "OBSERVED" : "FC MODEL",
          status: "AVAILABLE",
        } satisfies TrackNode;
      });
  }, [canonical, enrichedForecast, intensityByHorizon, intensityPointsSorted, intensity.forecastPoints, current]);

  // ── Lifecycle points: the enriched node list shaped for the shared lifecycle ──
  const lifecyclePoints: LifecyclePoint[] = useMemo(
    () =>
      nodes
        .filter((n) => Number.isFinite(n.latitude) && Number.isFinite(n.longitude))
        .map((n) => ({
          timestamp: n.timestamp ?? "",
          horizonHours: n.horizonHours,
          latitude: n.latitude ?? 0,
          longitude: n.longitude ?? 0,
          windKt: n.windKt,
          uncertaintyKm: n.uncertaintyKm,
          isForecast: true,
          mslpHpa: n.pressureHpa,
        })),
    [nodes],
  );

  // ── Tiny playback: walks the forecast nodes (NOW → +2h → …). ──
  const horizons = useMemo(() => nodes.map((n) => n.horizonHours).filter((h) => h >= 0), [nodes]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setSelectedHorizon((prev) => {
        const i = horizons.indexOf(prev);
        if (i < 0 || i === horizons.length - 1) {
          setPlaying(false);
          return 0;
        }
        return horizons[i + 1];
      });
    }, 1400);
    return () => clearInterval(id);
  }, [playing, horizons]);

  const togglePlay = () => {
    if (!playing && horizons.length && selectedHorizon >= horizons[horizons.length - 1]) {
      setSelectedHorizon(0);
    }
    setPlaying((p) => !p);
  };

  const select = (h: number) => {
    setSelectedHorizon(h);
    setPlaying(false);
  };

  const stepLifecycle = (d: -1 | 1) => {
    if (!horizons.length) return;
    const i = horizons.indexOf(selectedHorizon);
    const target = i < 0 ? 0 : Math.max(0, Math.min(horizons.length - 1, i + d));
    select(horizons[target]);
  };

  // ── Dynamic viewport from the real forecast geometry ──
  const envelope = useMemo(() => {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    const ext = (lat: number, lon: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    };
    for (const p of canonical.points) ext(p.latitude, p.longitude);
    cone?.left.forEach((c) => ext(c.lat, c.lon));
    cone?.right.forEach((c) => ext(c.lat, c.lon));
    if (!Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
      return { west: 82, south: 10, east: 90, north: 24 };
    }
    return {
      west: Math.max(56, minLon - 1.1),
      south: Math.max(2, minLat - 0.6),
      east: Math.min(104, maxLon + 1.1),
      north: Math.min(30, maxLat + 1.5),
    };
  }, [canonical, cone]);

  const refit = useCallback(
    (map: maplibregl.Map) => {
      map.fitBounds(
        [
          [envelope.west, envelope.south],
          [envelope.east, envelope.north],
        ],
        {
          padding: { top: 42, bottom: 72, left: 18, right: 18 },
          maxZoom: 8,
          duration: 650,
        },
      );
    },
    [envelope],
  );

  const handleMapReady = useCallback(
    (map: maplibregl.Map) => {
      refit(map);
      setMapEl(map);
      setLoaded(true);
    },
    [refit],
  );

  // Refit only when the underlying data envelope changes (never on playback,
  // never once the operator has dragged away).
  useEffect(() => {
    if (!mapEl || userPanned) return;
    refit(mapEl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envelope]);

  // The map NEVER auto-recentres on playback; only the user's own gesture does.
  useEffect(() => {
    const map = mapEl;
    if (!map) return;
    const onDrag = () => setUserPanned(true);
    map.on("dragstart", onDrag);
    return () => {
      map.off("dragstart", onDrag);
    };
  }, [mapEl]);

  // ── CENTER control — always returns to the CURRENT cyclone ──
  const currentPosition = useMemo(() => {
    if (
      canonical.current &&
      Number.isFinite(canonical.current.latitude) &&
      Number.isFinite(canonical.current.longitude)
    ) {
      return { lat: canonical.current.latitude, lon: canonical.current.longitude };
    }
    if (Number.isFinite(current.latitude) && Number.isFinite(current.longitude)) {
      return { lat: current.latitude, lon: current.longitude };
    }
    return null;
  }, [canonical.current, current.latitude, current.longitude]);

  // Target zoom keeps the forecast corridor visible but never zooms to absurd
  // out-scales — derived from the actual envelope, not a magic constant.
  const centerZoom = useMemo(() => {
    if (canonical.forecast.length === 0) return 6;
    let minLat = 90, maxLat = -90;
    for (const p of canonical.forecast) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
    }
    const span = Math.max(0.2, maxLat - minLat);
    return clamp(Math.round(6 - Math.log2(Math.max(1, span))), 5, 7.5);
  }, [canonical.forecast]);

  const centerOnCyclone = useCallback(() => {
    const map = mapEl;
    if (!map || !currentPosition) return;
    map.flyTo({
      center: [currentPosition.lon, currentPosition.lat],
      zoom: centerZoom,
      duration: 700,
    });
    setUserPanned(false);
  }, [mapEl, currentPosition, centerZoom]);

  const zoomBy = useCallback(
    (d: number) => {
      const map = mapEl;
      if (!map) return;
      map.zoomTo(clamp(map.getZoom() + d, 4, 8.5), { duration: 400 });
    },
    [mapEl],
  );

  // ── Layer the forecast composition over the base map (theatre-owned) ──
  useEffect(() => {
    const map = mapEl;
    if (!map || !loaded) return;

    trackValidationLog("TrackForecastTheatre", canonical);

    const sources = map.getStyle()?.sources ?? {};

    // Uncertainty corridor (only when the model supplied real sigma)
    if (cone) {
      const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [cone.ring] },
      };
      if (!sources["tt-unc"]) map.addSource("tt-unc", { type: "geojson", data: feature });
      else (map.getSource("tt-unc") as maplibregl.GeoJSONSource).setData(feature);
      if (!map.getLayer("tt-unc-fill")) {
        map.addLayer({
          id: "tt-unc-fill",
          type: "fill",
          source: "tt-unc",
          paint: {
            "fill-color": UNCERTAINTY_FILL,
            "fill-opacity": 0.7,
            "fill-antialias": true,
          },
        });
        map.addLayer({
          id: "tt-unc-line",
          type: "line",
          source: "tt-unc",
          paint: { "line-color": UNCERTAINTY_STROKE, "line-width": 1, "line-opacity": 0.8 },
        });
      }
      map.setLayoutProperty("tt-unc-fill", "visibility", visible.cone ? "visible" : "none");
      map.setLayoutProperty("tt-unc-line", "visibility", visible.cone ? "visible" : "none");
    }

    // Observed track — solid white historical path, terminates at the cyclone
    const observedLine = canonical.current
      ? [...canonical.observed, canonical.current]
      : canonical.observed;
    if (observedLine.length >= 2) {
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: segs(observedLine, TRACK_COLOR),
      };
      if (!sources["tt-obs"]) map.addSource("tt-obs", { type: "geojson", data });
      else (map.getSource("tt-obs") as maplibregl.GeoJSONSource).setData(data);
      if (!map.getLayer("tt-obs-casing")) {
        map.addLayer({
          id: "tt-obs-casing",
          type: "line",
          source: "tt-obs",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#FFFFFF", "line-width": 4, "line-opacity": 0.3 },
        });
        map.addLayer({
          id: "tt-obs-core",
          type: "line",
          source: "tt-obs",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#FFFFFF", "line-width": 1.8, "line-opacity": 0.95 },
        });
      }
      map.setLayoutProperty("tt-obs-casing", "visibility", visible.observed ? "visible" : "none");
      map.setLayoutProperty("tt-obs-core", "visibility", visible.observed ? "visible" : "none");
    }

    // Forecast track — dashed, white casing + IMD-intensity core
    if (forecastLine.length >= 2) {
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: segs(forecastLine, FORECAST_COLOR),
      };
      if (!sources["tt-fc"]) map.addSource("tt-fc", { type: "geojson", data });
      else (map.getSource("tt-fc") as maplibregl.GeoJSONSource).setData(data);
      if (!map.getLayer("tt-fc-casing")) {
        map.addLayer({
          id: "tt-fc-casing",
          type: "line",
          source: "tt-fc",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#FFFFFF",
            "line-width": 3,
            "line-opacity": 0.5,
            "line-dasharray": [1.4, 1.6],
          },
        });
        map.addLayer({
          id: "tt-fc-core",
          type: "line",
          source: "tt-fc",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 1.8,
            "line-dasharray": [2.4, 2.2],
          },
        });
      }
      map.setLayoutProperty("tt-fc-casing", "visibility", visible.forecast ? "visible" : "none");
      map.setLayoutProperty("tt-fc-core", "visibility", visible.forecast ? "visible" : "none");
    }

    // Forecast nodes — IMD-intensity coloured, geographically anchored.
    if (enrichedForecast.length > 0) {
      const fc = enrichedForecast.map((p) => ({
        type: "Feature" as const,
        properties: {
          horizon: p.horizonHours,
          color:
            p.windKt != null ? (intensityColor(p.windKt) ?? FORECAST_COLOR) : FORECAST_COLOR,
          sel: p.horizonHours === selectedHorizon ? 1 : 0,
          major: p.horizonHours % 6 === 0 ? 1 : 0,
          dropoff: p.horizonHours < 6 ? 1 : 0,
        },
        geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
      }));
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: fc };
      if (!sources["tt-fc-pts"]) map.addSource("tt-fc-pts", { type: "geojson", data });
      else (map.getSource("tt-fc-pts") as maplibregl.GeoJSONSource).setData(data);
      if (!map.getLayer("tt-fc-points")) {
        map.addLayer({
          id: "tt-fc-points",
          type: "circle",
          source: "tt-fc-pts",
          paint: {
            "circle-radius": ["case", ["==", ["get", "sel"], 1], 6, 3],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#0b1017",
            "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 2, 1],
            "circle-opacity": ["case", ["==", ["get", "sel"], 1], 1, 0.9],
          },
        });
      }
      map.setLayoutProperty("tt-fc-points", "visibility", visible.points ? "visible" : "none");
      // Selection halo — a quiet ring around the selected forecast position.
      if (!map.getLayer("tt-fc-halo")) {
        map.addLayer({
          id: "tt-fc-halo",
          type: "circle",
          source: "tt-fc-pts",
          paint: {
            "circle-radius": ["case", ["==", ["get", "sel"], 1], 11, 0],
            "circle-color": "rgba(255,255,255,0)",
            "circle-stroke-color": "rgba(255,255,255,0.55)",
            "circle-stroke-width": 1,
          },
        });
      }
      map.setLayoutProperty("tt-fc-halo", "visibility", visible.points ? "visible" : "none");
      // Major horizon labels only (+6 / +12 / +18 / +24) to keep the map clean.
      if (!map.getLayer("tt-fc-label")) {
        map.addLayer({
          id: "tt-fc-label",
          type: "symbol",
          source: "tt-fc-pts",
          layout: {
            "text-field": ["coalesce", ["concat", "+", ["to-string", ["get", "horizon"]], "H"], ""],
            "text-size": 10,
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-anchor": "bottom",
            "text-offset": [0, -1.4],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(8,13,24,0.9)",
            "text-halo-width": 1.6,
          },
        });
      }
      map.setLayoutProperty("tt-fc-label", "visibility", visible.points ? "visible" : "none");
      map.setFilter("tt-fc-label", ["==", ["get", "major"], 1]);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEl, loaded, canonical, cone, envelope, selectedHorizon, visible]);

  // ── Timeline ↔ map: highlight exactly the selected forecast node ──
  useEffect(() => {
    const map = mapEl;
    if (!map || !map.getSource("tt-fc-pts")) return;
    const fc = enrichedForecast.map((p) => ({
      type: "Feature" as const,
      properties: {
        horizon: p.horizonHours,
        color:
          p.windKt != null ? (intensityColor(p.windKt) ?? FORECAST_COLOR) : FORECAST_COLOR,
        sel: p.horizonHours === selectedHorizon ? 1 : 0,
        major: p.horizonHours % 6 === 0 ? 1 : 0,
      },
      geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
    }));
    (map.getSource("tt-fc-pts") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: fc,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEl, selectedHorizon, enrichedForecast]);

  // ── Hover on forecast nodes (compact tooltip, cursor) + click = select ──
  useEffect(() => {
    const map = mapEl;
    if (!map) return;
    const stage = stageRef.current;
    if (!stage) return;

    let tip: HTMLDivElement | null = null;
    const ensureTip = () => {
      if (tip) return tip;
      tip = document.createElement("div");
      tip.className = "tf-tooltip";
      tip.style.display = "none";
      stage.appendChild(tip);
      return tip;
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: ["tt-fc-points"] });
      const el = ensureTip();
      if (!feats.length) {
        el.style.display = "none";
        map.getCanvas().style.cursor = "";
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      const h = feats[0].properties?.horizon as number | undefined;
      const n = nodes.find((x) => x.horizonHours === h);
      if (!n) {
        el.style.display = "none";
        return;
      }
      const cat = intensityClassInfo(n.windKt);
      const parts = [
        `<b>${n.label}</b>`,
        n.latitude != null && n.longitude != null
          ? `<span>${n.latitude.toFixed(2)}°N · ${n.longitude.toFixed(2)}°E</span>`
          : "",
        `<span>${n.windKt ?? "—"} kt${cat ? ` · ${cat.shortLabel}` : ""}</span>`,
        n.pressureHpa != null ? `<span>${n.pressureHpa} hPa</span>` : "",
      ].filter((x) => x !== "");
      el.innerHTML = parts.join("");
      el.style.display = "block";
      el.style.left = `${e.point.x + 12}px`;
      el.style.top = `${e.point.y + 14}px`;
    };
    const onLeave = () => {
      const el = ensureTip();
      el.style.display = "none";
      map.getCanvas().style.cursor = "";
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: ["tt-fc-points"] });
      if (!feats.length) return;
      const h = feats[0].properties?.horizon as number | undefined;
      if (typeof h !== "number") return;
      select(h);
    };

    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);
    map.on("click", onClick);
    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onLeave);
      map.off("click", onClick);
      if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEl, nodes]);

  // ── Place-name overlay (bundled reference names, independent of tile glyphs) ──
  // The base Positron tiles only render text labels when the external glyph
  // server is reachable; this grid of geography reference names is drawn
  // directly over the stage so place names are always present.
  useEffect(() => {
    const map = mapEl;
    const el = placesRef.current;
    if (!map || !el) return;
    el.textContent = "";

    const primaries: { s: HTMLSpanElement; kind: TrackPlaceKind; minZoom: number }[] = [];
    const secondaries: { s: HTMLSpanElement; kind: TrackPlaceKind; minZoom: number }[] = [];
    for (const p of TRACK_PLACES) {
      const s = document.createElement("span");
      s.className = `tf-place tf-place--${p.kind}`;
      s.textContent = p.name;
      s.dataset.lat = String(p.lat);
      s.dataset.lon = String(p.lon);
      el.appendChild(s);
      const rec = { s, kind: p.kind, minZoom: p.kind === "country" ? 2.5 : p.kind === "sea" ? 3 : p.kind === "coast" ? 6.5 : 5 };
      (p.kind === "country" || p.kind === "sea" ? primaries : secondaries).push(rec);
    }

    let raf = 0;
    const layout = () => {
      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const zoom = map.getZoom();
      const settled: { x: number; y: number }[] = [];
      const hide = (rec: { s: HTMLSpanElement; kind: TrackPlaceKind; minZoom: number }) => {
        rec.s.style.display = "none";
        rec.s.style.left = "0px";
        rec.s.style.top = "0px";
      };
      const place = (rec: { s: HTMLSpanElement; kind: TrackPlaceKind; minZoom: number }) => {
        if (zoom < rec.minZoom) {
          hide(rec);
          return;
        }
        const pt = map.project([Number(rec.s.dataset.lon), Number(rec.s.dataset.lat)]);
        rec.s.style.left = `${pt.x}px`;
        rec.s.style.top = `${pt.y}px`;
        if (pt.x < -10 || pt.y < -10 || pt.x > w + 10 || pt.y > h + 10) {
          hide(rec);
          return;
        }
        const clash = settled.some((q) => Math.abs(q.x - pt.x) < 26 && Math.abs(q.y - pt.y) < 26);
        if (clash) {
          hide(rec);
          return;
        }
        settled.push({ x: pt.x, y: pt.y });
        rec.s.style.display = "block";
      };
      primaries.forEach(place);
      secondaries.forEach(place);
    };
    const request = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        layout();
      });
    };
    request();
    map.on("move", request);
    map.on("zoom", request);
    map.on("resize", request);
    return () => {
      map.off("move", request);
      map.off("zoom", request);
      map.off("resize", request);
      if (raf) cancelAnimationFrame(raf);
      el.textContent = "";
    };
  }, [mapEl]);

  // ── Geo-scaled storm (theatre-owned) — follows the SELECTED forecast node ──
  // On playback the node walked by the lifecycle is the same one the storm
  // visualises, so pressing PLAY moves the cyclone along the track.
  const [stormView, setStormView] = useState<{ x: number; y: number; size: number } | null>(null);

  const stormNode = useMemo(() => {
    const sel = nodes.find((n) => n.horizonHours === selectedHorizon);
    if (sel && Number.isFinite(sel.latitude) && Number.isFinite(sel.longitude)) return sel;
    return nodes.find((n) => Number.isFinite(n.latitude) && Number.isFinite(n.longitude)) ?? null;
  }, [nodes, selectedHorizon]);

  const stormPos = useMemo(() => {
    if (stormNode) return { lat: stormNode.latitude as number, lon: stormNode.longitude as number };
    if (Number.isFinite(current.latitude) && Number.isFinite(current.longitude)) {
      return { lat: current.latitude, lon: current.longitude };
    }
    return null;
  }, [stormNode, current.latitude, current.longitude]);

  useEffect(() => {
    const map = mapEl;
    if (!map || !stormPos) {
      setStormView(null);
      return;
    }
    let raf = 0;
    const update = () => {
      const p = map.project([stormPos.lon, stormPos.lat]);
      const zoom = map.getZoom();
      const size = Math.round(clamp(46 + (zoom - 3.5) * 5, 46, 84));
      setStormView({ x: p.x, y: p.y, size });
    };
    const request = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    request();
    map.on("move", request);
    map.on("zoom", request);
    map.on("resize", request);
    return () => {
      map.off("move", request);
      map.off("zoom", request);
      map.off("resize", request);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mapEl, stormPos]);

  const stormBearing = useMemo(() => {
    if (stormNode?.bearingDeg != null) return stormNode.bearingDeg;
    if (current.movement?.bearingDeg != null) return current.movement.bearingDeg;
    const pts = canonical.points.filter((p) => p.horizonHours >= 0);
    if (pts.length < 2) return null;
    const i = pts.findIndex((p) => p.horizonHours === 0);
    const idx = i > 0 ? i : 0;
    if (idx < pts.length - 1) {
      return calcBearing(
        { lat: pts[idx].latitude, lon: pts[idx].longitude },
        { lat: pts[idx + 1].latitude, lon: pts[idx + 1].longitude },
      );
    }
    return null;
  }, [stormNode, current.movement?.bearingDeg, canonical]);

  return (
    <section id="forecast" className="tf-page tf-page--mission">
      {/* ═══ Section header ═══ */}
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
              Multi-model ensemble forecast of track, intensity and uncertainty.
            </p>
          </div>
        </div>
        <div className="tf-header__right">
          <StatusBadge status={statusLabel} />
        </div>
      </header>

      {/* ═══ Main forecast workspace: current cyclone + forecast map ═══ */}
      <div className="tf-workspace">
        <aside className="tf-intel">
          <CurrentCyclonePanel
            cyc={current}
            risk={risk}
            currentUncertaintyKm={canonical.current?.uncertaintyKm}
            statusLabel={statusLabel}
          />
        </aside>

        <div className="tf-map-wrap">
          <div className="tf-map-head">
            <div className="tf-map-head__left">
              <span className="tf-map-head__kicker">FORECAST MAP</span>
              <span className="tf-map-head__name">{current?.basin ?? "NORTH INDIAN OCEAN"}</span>
              <span className="tf-map-head__sep">&middot;</span>
              <span className="tf-map-head__name">{current?.name ?? "\u2014"}</span>
              <span className="tf-map-head__range">NOW &rarr; +{traj?.forecastHorizonHours ?? 24}H</span>
            </div>
            <div className="tf-map-head__right">
              <StatusBadge status={statusLabel} />
            </div>
          </div>

          <MapErrorBoundary title="TRACK MAP UNAVAILABLE" height="100%">
            <div ref={stageRef} className="tf-map-stage">
              <CycloneMap
                className="tf-map-canvas"
                forecast={points}
                current={{
                  lat: current.latitude,
                  lon: current.longitude,
                  name: current.name,
                  windKt: current.windKt,
                }}
                height="100%"
                cinematic
                onMapReady={handleMapReady}
                isDemo={isDemo}
                simplified
              />

              {/* ── Relative place-name overlay (geo-anchored reference grid) ── */}
              <div ref={placesRef} className="tf-places" />

              {/* ── Compact vertical control stack ── */}
              <div className="tf-map-controls">
                <button
                  type="button"
                  className="tf-map-ctrl"
                  onClick={() => zoomBy(1)}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="tf-map-ctrl"
                  onClick={() => zoomBy(-1)}
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path d="M4.5 10h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="tf-map-ctrl"
                  onClick={centerOnCyclone}
                  aria-label="Center map on cyclone"
                  title="CENTER ON CYCLONE"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <circle cx="10" cy="10" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="10" cy="10" r="1.2" fill="currentColor" />
                    <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* ── Compact legend ── */}
              <div className="tf-map-legend">
                <div className="tf-map-legend__row">
                  <span className="tf-map-legend__sw tf-map-legend__sw--obs" />
                  <span className="tf-map-legend__txt">OBSERVED</span>
                </div>
                <div className="tf-map-legend__row">
                  <span className="tf-map-legend__sw tf-map-legend__sw--fc" />
                  <span className="tf-map-legend__txt">FORECAST</span>
                </div>
                <div className="tf-map-legend__row">
                  <span className="tf-map-legend__sw tf-map-legend__sw--unc" />
                  <span className="tf-map-legend__txt">&plusmn; UNCERTAINTY</span>
                </div>
                <div className="tf-map-legend__ramp" aria-hidden="true">
                  {[
                    ["#4EC6D6", "DD", "28–33"],
                    ["#F0B429", "CS", "34–47"],
                    ["#EE8131", "SCS", "48–63"],
                    ["#E5533C", "VSCS", "64–89"],
                    ["#D9303C", "ESCS", "90–119"],
                  ].map(([c, , range]) => (
                    <span
                      key={range}
                      className="tf-map-legend__cell"
                      style={{ background: c as string }}
                      title={`${range} kt`}
                    />
                  ))}
                </div>
                <div className="tf-map-legend__note">COLOR = IMD WIND GRADE</div>
              </div>

              {/* ── Layer visibility ── */}
              <div className="tf-layer-ctrl">
                <LayerControl
                  groups={LAYERS}
                  visible={visible}
                  onToggle={(k) => setVisible((v) => ({ ...v, [k]: !v[k] }))}
                />
              </div>

              {/* ── Projected landfall — honest status, map annotation ── */}
              <div className="tf-map-landfall">
                <span className="tf-map-landfall__k">PROJECTED LANDFALL</span>
                <span className="tf-map-landfall__v">UNAVAILABLE</span>
              </div>

              {/* ── Geo-scaled storm — anchored to the CURRENT cyclone ── */}
              {stormView && stormPos && (
                <div
                  className="tf-storm"
                  style={
                    {
                      left: stormView.x,
                      top: stormView.y,
                      width: stormView.size,
                      height: stormView.size,
                    } as CSSProperties
                  }
                >
                  <CycloneVortex size={stormView.size} bearing={stormBearing} selected marker={false} />
                  <button
                    type="button"
                    className="tf-storm__hit"
                    aria-label={`Select ${current.name ?? "cyclone"} current position`}
                    onClick={() => select(0)}
                  />
                </div>
              )}

              {/* ── Dev-only diagnostics ── */}
              {debugOn && mapEl && (
                <div className="tf-map-debug mono">
                  <span>CAM {mapEl.getCenter().lng.toFixed(3)}° / {mapEl.getCenter().lat.toFixed(3)}° z{mapEl.getZoom().toFixed(2)}</span>
                  <span>SEL {selectedHorizon}h</span>
                  <span>STORM {current.latitude.toFixed(2)}°N {current.longitude.toFixed(2)}°E {stormView?.size ?? 0}px</span>
                  <span>PANNED {String(userPanned)}</span>
                </div>
              )}
            </div>
          </MapErrorBoundary>
        </div>
      </div>

      {/* ═══ Intensity lifecycle ═══ */}
      <IntensityLifecycle
        points={lifecyclePoints}
        statusLabel={statusLabel}
        selectedHorizon={selectedHorizon}
        onSelect={select}
        playing={playing}
        onPlayToggle={togglePlay}
        onStep={stepLifecycle}
      />

      {/* ═══ Selected forecast + forecast summary ═══ */}
      <div className="tf-detail-grid">
        <SelectedForecastCard
          selectedPoint={
            selectedHorizon != null
              ? (lifecyclePoints.find((p) => p.horizonHours === selectedHorizon) ?? null)
              : null
          }
          lifecyclePoints={lifecyclePoints}
          movement={current?.movement}
        />
        <ForecastSummaryCard
          cyc={current}
          track={traj}
          points={points}
          intensityPoints={intensity.forecastPoints ?? []}
        />
      </div>

      {/* ═══ Forecast provenance ═══ */}
      <ProvenanceBlock
        track={traj}
        statusLabel={statusLabel}
        currentUncertaintyKm={canonical.current?.uncertaintyKm}
      />
    </section>
  );
}
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_STYLE,
  FORECAST_COLOR,
  TRACK_COLOR,
  UNCERTAINTY_FILL,
  UNCERTAINTY_STROKE,
  cycloneFocus,
  INDIA_EXTENT,
  getMapStyle,
} from "./mapTheme";
import { CycloneVortex } from "./CycloneVortex";
import { CycloneTimeline, type TimelinePoint } from "./CycloneTimeline";
import { CycloneLegend } from "./CycloneLegend";
import { ContourCanvasSource } from "./contourLayer";
import {
  movementBearing,
  intensitySize,
  compassFromBearing,
} from "@/utils/trackGeometry";
import {
  buildTrackSegments,
  buildUncertaintyCone,
  normalizeTrack,
  trackValidationLog,
} from "@/utils/trackModel";
import type { TrackInput, TrackSegment } from "@/utils/trackModel";
import { intensityColor } from "@/utils/intensity";
import type { TrackPoint } from "@/types";
import { formatIST } from "@/utils/format";
import { createRoot, type Root } from "react-dom/client";

/**
 * Validation gate for placing tracked/cyclone geometry on the map.
 * Coordinates must be finite AND inside valid geographic bounds. The cyclone
 * marker, focus box and track layers all feed through this so the map can
 * never be nudged to a fabricated position for visual appeal.
 */
function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export interface HazardLayerData {
  id: string;
  name: string;
  polygons?: {
    coordinates: [number, number][][];
    level: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "EXTREME";
    name?: string;
  }[];
  points?: { lat: number; lon: number; level: string; name?: string; label?: string }[];
}

export interface HazardPointInfo {
  layerId: string;
  layerName?: string;
  name?: string;
  level?: string;
  lat: number;
  lon: number;
}

export interface HistoricalTrackPoint {
  lat: number;
  lon: number;
  timestamp: string;
  windKt?: number;
  uncertaintyKm?: number;
  horizonHours?: number;
}

interface Props {
  historicalTrack?: HistoricalTrackPoint[];
  forecast?: TrackPoint[];
  current?: { lat: number; lon: number; name?: string; windKt?: number };
  hazardLayers?: HazardLayerData[];
  height?: string | number;
  flyTo?: boolean;
  interactive?: boolean;
  onPointSelected?: (point: TrackPoint) => void;
  /** Called when a hazard-layer point (district / region marker) is clicked. */
  onHazardPointSelected?: (info: HazardPointInfo) => void;

  /** Timeline: selected point index. When set, cyclone moves along trajectory. */
  selectedIdx?: number;
  /** Whether the timeline is playing. */
  playing?: boolean;
  /** Called when timeline index changes. */
  onIdxChange?: (idx: number) => void;
  /** Called when play/pause is toggled. */
  onPlayToggle?: () => void;
  /** Show the timeline bar below the map. */
  showTimeline?: boolean;
  /** Show the simple CURRENT tag on the vortex. */
  showTag?: boolean;
  /**
   * Recenter target for the map's own CENTER control and initial framing.
   * "track" (default) fits the whole observed+forecast path; "cyclone" flies
   * to the current cyclone position with a top-left shift (700ms, manual only).
   */
  recenterMode?: "track" | "cyclone";
  /**
   * Track layers to hide: "observed" (observed path), "forecast" (dashed
   * forecast line), "cone" (uncertainty corridor) or "points" (horizon nodes).
   */
  hiddenLayers?: Array<"observed" | "forecast" | "cone" | "points">;
  /** Additional className for the container. */
  className?: string;
  /** Whether this is a "simplified" view (Command Center) with less detail. */
  simplified?: boolean;
  /** Dev-only: show live LAT/LON under the cyclone (must not change on pan/zoom). */
  debug?: boolean;
  /** Whether the trajectory is simulated/demo data (Section 53). */
  isDemo?: boolean;
  /** Vertical fit-bounds padding in px. Compact containers should use a small value. */
  focusPadding?: number;
  /**
   * Cinematic mode (TrackForecastTheatre): suppress the map's own legend,
   * timeline, demo notice, track/cone/hazard layers and click handlers so the
   * theatre can layer its own composition over the raw map canvas.
   */
  cinematic?: boolean;
  /** Called once the base map + geography are ready (layers can be added). */
  onMapReady?: (map: maplibregl.Map) => void;
}

export function CycloneMap({
  historicalTrack = [],
  forecast = [],
  current,
  hazardLayers = [],
  height,
  flyTo = true,
  interactive = true,
  onPointSelected,
  onHazardPointSelected,
  selectedIdx,
  playing = false,
  onIdxChange,
  onPlayToggle,
  showTimeline = false,
  showTag = true,
  className = "map-box",
  simplified = false,
  recenterMode = "track",
  hiddenLayers = [],
  debug = false,
  isDemo = false,
  focusPadding = 70,
  cinematic = false,
  onMapReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const markerRootRef = useRef<Root | null>(null);
  const contourRef = useRef<ContourCanvasSource | null>(null);
  const focusRef = useRef<[[number, number], [number, number]]>(INDIA_EXTENT);
  const focusPaddingRef = useRef(focusPadding);
  const focusCycloneRef = useRef<[[number, number], [number, number]] | null>(null);
  const recenterModeRef = useRef(recenterMode);
  const [loaded, setLoaded] = useState(false);
  const flyToRef = useRef(flyTo);
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const onHazardPointRef = useRef(onHazardPointSelected);
  onHazardPointRef.current = onHazardPointSelected;
  // Hazard-layer ids that have been materialised on the map (for stale cleanup).
  const addedHazardIdsRef = useRef<Set<string>>(new Set());
  // Point-layer ids currently live on the map (queried for hover + click).
  const hazardPointLayersRef = useRef<string[]>([]);

  // Determine the active position — either from timeline selection or from `current` prop
  const allTrackPoints = useMemo(() => {
    if (forecast.length > 0) return forecast;
    if (current) return [{ timestamp: "", horizonHours: 0, latitude: current.lat, longitude: current.lon, isForecast: false }];
    return [];
  }, [forecast, current]);

  const activeIdx = selectedIdx ?? 0;
  const activePoint = allTrackPoints[activeIdx] ?? null;

  const activeLat = activePoint?.latitude ?? current?.lat;
  const activeLon = activePoint?.longitude ?? current?.lon;
  const activeWindKt = activePoint?.windKt ?? current?.windKt;
  const activeTimestamp = activePoint?.timestamp;

  const moveBearing = useMemo(() => {
    if (allTrackPoints.length < 2 || activeIdx == null) return null;
    return movementBearing(allTrackPoints, activeIdx);
  }, [allTrackPoints, activeIdx]);

  const vortexSize = useMemo(() => intensitySize(activeWindKt), [activeWindKt]);

  // Build the canonical track once: observed history (either the dedicated
  // `historicalTrack` prop, or negative-horizon points inside `forecast`) plus
  // every forecast point, normalised by trackModel. Segments/cone/intensity
  // colours below all derive from this single ordered, validated list.
  const canonical = useMemo(() => {
    const history: TrackInput[] =
      historicalTrack.length > 0
        ? historicalTrack.map((p, i, arr) => ({
            timestamp: p.timestamp,
            horizonHours: p.horizonHours ?? -(arr.length - i),
            latitude: p.lat,
            longitude: p.lon,
            windKt: p.windKt,
            uncertaintyKm: p.uncertaintyKm,
            isForecast: false,
          }))
        : forecast
            .filter((p) => p.horizonHours < 0)
            .map((p) => ({
              timestamp: p.timestamp,
              horizonHours: p.horizonHours,
              latitude: p.latitude,
              longitude: p.longitude,
              windKt: p.windKt,
              uncertaintyKm: p.uncertaintyKm,
              isForecast: false,
            }));
    const input: TrackInput[] = [
      ...history,
      ...forecast.map((p) => ({
        timestamp: p.timestamp,
        horizonHours: p.horizonHours,
        latitude: p.latitude,
        longitude: p.longitude,
        windKt: p.windKt,
        uncertaintyKm: p.uncertaintyKm,
        isForecast: p.isForecast,
      })),
    ];
    return normalizeTrack(input);
  }, [historicalTrack, forecast]);

  const edgePoints = useMemo(() => {
    const pts: { lon: number; lat: number }[] = [];
    if (activeLat != null && activeLon != null) pts.push({ lon: activeLon, lat: activeLat });
    forecast.forEach((p) => pts.push({ lon: p.longitude, lat: p.latitude }));
    historicalTrack.forEach((p) => pts.push({ lon: p.lon, lat: p.lat }));
    return pts;
  }, [activeLat, activeLon, forecast, historicalTrack]);

  const focus = useMemo(() => {
    const fit = cycloneFocus(edgePoints);
    if (fit) return fit;
    return INDIA_EXTENT;
  }, [edgePoints]);

  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    focusPaddingRef.current = focusPadding;
  }, [focusPadding]);

  useEffect(() => {
    recenterModeRef.current = recenterMode;
  }, [recenterMode]);

  // Tight bounds around the CURRENT cyclone (used when recenterMode="cyclone").
  // Kept in a ref so the one-shot RecenterControl can always read the latest value.
  useEffect(() => {
    if (current == null || !isValidCoordinate(current.lat, current.lon)) {
      focusCycloneRef.current = null;
      return;
    }
    const r = 0.04;
    focusCycloneRef.current = [
      [current.lon - r, current.lat - r],
      [current.lon + r, current.lat + r],
    ];
  }, [current]);

  // Fly/fit to the recenter target: current cyclone (top-left shift, 700ms) or
  // the full observed+forecast track. Never re-snap after a manual pan — the
  // control is the only trigger here (manual refresh).
  const fitToRecenterTarget = useCallback(
    (map: maplibregl.Map, duration: number) => {
      const cyclone = recenterModeRef.current === "cyclone" ? focusCycloneRef.current : null;
      const cw = map.getContainer().clientWidth || 800;
      const ch = map.getContainer().clientHeight || 600;
      map.fitBounds(cyclone ?? focusRef.current, {
        padding: cyclone
          ? { left: Math.round(cw * 0.1), top: Math.round(ch * 0.16), right: 60, bottom: 60 }
          : { top: focusPaddingRef.current, bottom: focusPaddingRef.current, left: 60, right: 60 },
        maxZoom: 7,
        duration,
      });
    },
    []
  );

  // ── Map initialization ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      // Fetch the custom scientific-atlas style (deep ocean, ivory land, no roads).
      // Falls back to the stock positron basemap on fetch failure.
      let style: maplibregl.StyleSpecification;
      try {
        style = await getMapStyle();
      } catch {
        style = BASE_STYLE as unknown as maplibregl.StyleSpecification;
      }
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [82, 14],
        zoom: 5,
        attributionControl: { compact: true },
      });
      // In cinematic mode the forecast theatre owns framing and storm rendering —
      // no nav/recenter controls, no generic GIS chrome.
      if (!cinematic) {
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(
          new RecenterControl(() => {
            fitToRecenterTarget(map, 700);
          }),
          "top-right"
        );
      }
      map.on("load", () => {
        setLoaded(true);

        // ── Atmospheric contour canvas texture (scientific atlas aesthetic) ──
        const contour = new ContourCanvasSource();
        const { width, height } = contour.dimensions;

        // Position the canvas over the full North Indian Ocean theatre.
        const south = -2;
        const west = 58;
        const east = 108;
        const canvasAspect = height / width;
        const adjustedNorth = south + (east - west) * canvasAspect;

        // Keep a reference so the focal point can be updated later.
        contourRef.current = contour;
        contour.setBounds(west, south, east, adjustedNorth);

        map.addSource("contour-canvas", {
          type: "canvas",
          canvas: contour.getCanvas(),
          coordinates: [[west, south], [east, south], [east, adjustedNorth], [west, adjustedNorth]],
          animate: false,
        });

        // ── Land + coastline (real geographic geometry) ──
        // The tile source renders land as the style background and ocean as the
        // "water" fill. To make land a solid ivory mass that masks the contour
        // field (keeping contours to the ocean) and to draw a green/olive
        // coastline, we overlay a real land-polygon vector source.
        const landUrl = new URL("../../assets/geo/land_india.geojson", import.meta.url).href;
        if (!map.getSource("land-geo")) {
          map.addSource("land-geo", { type: "geojson", data: landUrl });
        }

        // Geographically-buffered coastal band polygons (generated from the real
        // coastline with turf). Each level is a fixed-km offset outward into the
        // ocean, so the green/olive coastal field is geo-anchored and scales
        // naturally with zoom. Rendered as layered fill bands under the ivory land.
        const bandLevels = [
          { id: "coast-band-1", file: "coastal_band_1.geojson", color: "#7FAE55", opacity: 0.62 },
          { id: "coast-band-2", file: "coastal_band_2.geojson", color: "#8EAF59", opacity: 0.38 },
          { id: "coast-band-3", file: "coastal_band_3.geojson", color: "#9FC0A0", opacity: 0.22 },
        ];
        for (const lvl of bandLevels) {
          if (!map.getSource(lvl.id)) {
            const url = new URL(`../../assets/geo/${lvl.file}`, import.meta.url).href;
            map.addSource(lvl.id, { type: "geojson", data: url });
          }
        }

        // ── Layer ordering ──
        // We want, bottom → top:
        //   background (ivory land) , water (deep ocean), CONTOURS,
        //   land polygon (ivory, masks contours off land), coastline (green),
        //   country/state borders, labels, then the geo track overlays.
        const style = map.getStyle();
        const layerList = style?.layers ?? [];
        // Insert contours + ivory land + coastline just before the first admin
        // boundary layer so state/country borders render ABOVE the ivory land.
        const boundaryIndex = layerList.findIndex(
          (l) => (l.id as string) === "boundary_3" || (l.id as string) === "boundary_2"
        );
        const beforeBoundaryId =
          boundaryIndex >= 0 ? layerList[boundaryIndex].id : undefined;

        map.addLayer(
          {
            id: "contour-layer",
            type: "raster",
            source: "contour-canvas",
            layout: { visibility: "visible" },
            paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
          },
          beforeBoundaryId,
        );

        // ── Layered green/olive coastal band (geographic buffer fills) ──
        // Three concentric buffered polygons extending from the real coastline
        // outward into the ocean (10 km / 22 km / 40 km).  Rendered as layered
        // fills that sit ABOVE the atmospheric contour field but BELOW the ivory
        // land-fill, so land covers the inner part.  The outermost band fades
        // into the teal contour field naturally.
        for (const lvl of bandLevels) {
          if (!map.getLayer(lvl.id)) {
            map.addLayer(
              {
                id: lvl.id,
                type: "fill",
                source: lvl.id,
                paint: {
                  "fill-color": lvl.color,
                  "fill-opacity": lvl.opacity,
                  "fill-antialias": true,
                },
              },
              beforeBoundaryId,
            );
          }
        }

        // Crisp coastline line on the exact shore edge (strongest green).
        if (!map.getLayer("coastline")) {
          map.addLayer(
            {
              id: "coastline",
              type: "line",
              source: "land-geo",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#7FAE55",
                "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.0, 8, 1.5, 12, 2.2],
                "line-opacity": 0.92,
              },
            },
            beforeBoundaryId,
          );
        }

        // Solid ivory land polygon — drawn over the coastal band fills so land
        // stays clean while the ocean carries the atmospheric field and the
        // green/olive coastal transition bands show outside the shore.
        if (!map.getLayer("land-fill")) {
          map.addLayer(
            {
              id: "land-fill",
              type: "fill",
              source: "land-geo",
              paint: { "fill-color": "#EDE9DB", "fill-opacity": 1, "fill-antialias": true },
            },
            beforeBoundaryId,
          );
        }

        contour.render(map.getZoom());
        map.triggerRepaint();

        // Re-render contours when zoom changes significantly
        const onMoveEnd = () => {
          contour.render(map.getZoom());
          map.triggerRepaint();
        };
        map.on("moveend", onMoveEnd);

        // In cinematic mode the owner (forecast theatre) owns framing and
        // layers via onMapReady — the base map stays stable and un-fitted.
        if (cinematic) {
          onMapReadyRef.current?.(map);
        } else if (flyToRef.current) {
          fitToRecenterTarget(map, 900);
        }
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      markerRootRef.current?.unmount();
      markerRootRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fit view when track data changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || cinematic) return;
    fitToRecenterTarget(map, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, focus]);

  // ── Update vortex marker position (geographic interpolation) ──
  // Cinematic mode deliberately skips this: the forecast theatre owns its own
  // geo-scaled storm renderer (positioned with map.project, sized with zoom).
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || cinematic || activeLat == null || activeLon == null) return;

    // Hard validation gate: the marker is positioned ONLY from the real
    // [lon, lat] in the forecast data — never hand-placed for visuals.
    if (!isValidCoordinate(activeLat, activeLon)) {
      console.warn(
        `CycloneMap: skipping marker — invalid cyclone coordinate [${activeLon}, ${activeLat}]. ` +
        "Refusing to render a real cyclone at a fabricated position."
      );
      return;
    }

    const nextPos = { lat: activeLat, lon: activeLon };

    // Create the marker on first render.
    if (!markerRef.current) {
      const markerEl = document.createElement("div");
      markerEl.className = "cyclone-vortex-marker";
      markerEl.style.pointerEvents = "auto";
      markerEl.style.transition = "transform 0.1s linear";
      markerEl.setAttribute(
        "aria-label",
        `${current?.name ?? "Cyclone"} at ${activeLat.toFixed(1)} degrees north, ${activeLon.toFixed(1)} degrees east${moveBearing != null ? `, moving ${compassFromBearing(moveBearing)}` : ""}.`
      );
      markerEl.setAttribute("role", "img");

      const root = createRoot(markerEl);
      markerRootRef.current = root;
      markerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
        .setLngLat([nextPos.lon, nextPos.lat])
        .addTo(map);

      root.render(
        <VortexMarker
          size={vortexSize}
          bearing={moveBearing}
          showTag={showTag}
          debug={debug}
          lat={activeLat}
          lon={activeLon}
          horizonHours={activePoint?.horizonHours}
          timestamp={activeTimestamp}
          isDemo={isDemo}
        />
      );
      lastPosRef.current = nextPos;
      return;
    }

    // Update the bearing / size / label instantly via React.
    markerRootRef.current?.render(
      <VortexMarker
        size={vortexSize}
        bearing={moveBearing}
        showTag={showTag}
        debug={debug}
        lat={activeLat}
        lon={activeLon}
        horizonHours={activePoint?.horizonHours}
        timestamp={activeTimestamp}
        isDemo={isDemo}
      />
    );

    // Cancels any in-flight animation, then animate geographically.
    if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);

    const from = lastPosRef.current ?? nextPos;
    const to = nextPos;
    lastPosRef.current = to;

    if (from.lat === to.lat && from.lon === to.lon) {
      markerRef.current.setLngLat([to.lon, to.lat]);
      return;
    }

    const MOVEMENT_MS = 900; // 0.9s geographic transition
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / MOVEMENT_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const lat = from.lat + (to.lat - from.lat) * eased;
      const lon = from.lon + (to.lon - from.lon) * eased;
      markerRef.current?.setLngLat([lon, lat]);
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
      }
    };
    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeLat, activeLon, vortexSize, moveBearing, showTag, debug, isDemo, activeTimestamp, activePoint]);

  // ── Keep the contour density centred on the active cyclone ──
  useEffect(() => {
    const contour = contourRef.current;
    if (!contour || !loaded || activeLat == null || activeLon == null) return;
    contour.setFocal(activeLat, activeLon, 1.0);
    contour.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeLat, activeLon]);

  // ── Add geo layers (track, forecast, uncertainty) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || cinematic) return;

    trackValidationLog("CycloneMap", canonical);

    const sources = map.getStyle()?.sources ?? {};

    // Observed track (solid) — historical + current, IMD-intensity segments
    const observedLinePts = canonical.current
      ? [...canonical.observed, canonical.current]
      : canonical.observed;
    const observedSegments = buildTrackSegments(observedLinePts);
    const observedFeatures = segmentsToFeatures(observedSegments, TRACK_COLOR);
    if (observedFeatures.length > 0) {
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: observedFeatures };
      if (!sources["track-observed"]) map.addSource("track-observed", { type: "geojson", data });
      else (map.getSource("track-observed") as maplibregl.GeoJSONSource).setData(data);
      if (!map.getLayer("track-observed-layer")) {
        map.addLayer({
          id: "track-observed-layer",
          type: "line",
          source: "track-observed",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.95 },
        });
      }
    }

    // Forecast track (dashed) — current + forecast horizons, IMD-intensity segments
    const forecastLinePts = canonical.current
      ? [canonical.current, ...canonical.forecast]
      : canonical.forecast;
    const forecastSegments = buildTrackSegments(forecastLinePts);
    const forecastFeatures = segmentsToFeatures(forecastSegments, FORECAST_COLOR);
    if (forecastFeatures.length > 0) {
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: forecastFeatures };
      if (!sources["track-forecast"]) map.addSource("track-forecast", { type: "geojson", data });
      else (map.getSource("track-forecast") as maplibregl.GeoJSONSource).setData(data);
      if (!map.getLayer("track-forecast-layer")) {
        map.addLayer({
          id: "track-forecast-layer",
          type: "line",
          source: "track-forecast",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 3.5,
            "line-opacity": 0.95,
            "line-dasharray": [2.4, 2.4],
          },
        });
      }
    }

    // Uncertainty corridor — only when the model actually supplied sigma
    if (!simplified && forecastLinePts.length >= 3) {
      const cone = buildUncertaintyCone(forecastLinePts);
      if (cone) {
        const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [cone.ring] },
        };
        if (!sources["unc-fill"]) map.addSource("unc-fill", { type: "geojson", data: feature });
        else (map.getSource("unc-fill") as maplibregl.GeoJSONSource).setData(feature);
        if (!map.getLayer("unc-fill-layer")) {
          map.addLayer({
            id: "unc-fill-layer",
            type: "fill",
            source: "unc-fill",
            paint: { "fill-color": UNCERTAINTY_FILL },
          });
          map.addLayer({
            id: "unc-line-layer",
            type: "line",
            source: "unc-fill",
            paint: { "line-color": UNCERTAINTY_STROKE, "line-width": 1 },
          });
        }
      }
    }

    // Forecast points (small nodes along the track) coloured by intensity
    if (!simplified && canonical.forecast.length > 0) {
      const fc = canonical.forecast.map((p, i) => ({
        type: "Feature" as const,
        properties: {
          horizon: p.horizonHours,
          index: i,
          color: p.windKt != null ? (intensityColor(p.windKt) ?? FORECAST_COLOR) : FORECAST_COLOR,
          // Only major points carry a label to keep the map uncluttered:
          // NOW, then every 6h (a 2-hourly grid would read as noise).
          label:
            p.horizonHours % 6 === 0
              ? p.horizonHours === 0
                ? "NOW"
                : `+${p.horizonHours}H`
              : "",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [p.longitude, p.latitude],
        },
      }));
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: fc };
      if (!sources["fc-points"]) {
        map.addSource("fc-points", { type: "geojson", data });
      } else {
        (map.getSource("fc-points") as maplibregl.GeoJSONSource).setData(data);
      }
      if (!map.getLayer("fc-points-layer")) {
        map.addLayer({
          id: "fc-points-layer",
          type: "circle",
          source: "fc-points",
          paint: {
            "circle-radius": 4,
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#0b1017",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "fc-labels-layer",
          type: "symbol",
          source: "fc-points",
          layout: {
            "text-field": ["get", "label"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
            "text-anchor": "top",
            "text-offset": [0, 1.4],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: {
            "text-color": "#D8E3E9",
            "text-halo-color": "rgba(7,22,28,0.9)",
            "text-halo-width": 1.4,
          },
        });
      }
    }

    // Hazard layers
    hazardLayers.forEach((layer) => {
      const srcId = `hazard-${layer.id}`;
      const features: GeoJSON.Feature[] = [];
      (layer.polygons ?? []).forEach((p) =>
        features.push({
          type: "Feature",
          properties: { level: p.level, name: p.name ?? null },
          geometry: { type: "Polygon", coordinates: p.coordinates },
        })
      );
      (layer.points ?? []).forEach((p, i) =>
        features.push({
          type: "Feature",
          properties: {
            level: p.level ?? "MODERATE",
            name: p.name ?? null,
            label: p.label ?? "",
            layerId: layer.id,
            layerName: layer.name,
            idx: i,
          },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        })
      );
      if (features.length > 0) {
        const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
        if (!sources[srcId]) map.addSource(srcId, { type: "geojson", data });
        else (map.getSource(srcId) as maplibregl.GeoJSONSource).setData(data);
      }
      if (layer.polygons && layer.polygons.length && !map.getLayer(`${srcId}-fill`)) {
        map.addLayer({
          id: `${srcId}-fill`,
          type: "fill",
          source: srcId,
          paint: {
            "fill-color": [
              "match",
              ["get", "level"],
              "HIGH",
              "rgba(238,129,49,0.4)",
              "VERY_HIGH",
              "rgba(229,83,60,0.5)",
              "EXTREME",
              "rgba(217,48,60,0.6)",
              "MODERATE",
              "rgba(240,180,41,0.35)",
              "rgba(78,168,255,0.32)",
            ],
          },
        });
      }
      if (layer.points && layer.points.length && !map.getLayer(`${srcId}-points`)) {
        map.addLayer({
          id: `${srcId}-points`,
          type: "circle",
          source: srcId,
          paint: {
            "circle-radius": 5.5,
            "circle-color": [
              "match",
              ["get", "level"],
              "EXTREME",
              "#d9303c",
              "VERY_HIGH",
              "#e5533c",
              "HIGH",
              "#ee8131",
              "MODERATE",
              "#f0b429",
              "LOW",
              "#4ea8ff",
              "#7e97ae",
            ],
            "circle-stroke-color": "rgba(6,19,31,0.9)",
            "circle-stroke-width": 1.5,
          },
        });
        // Optional name labels (only points that carry a non-empty `label`).
        map.addLayer({
          id: `${srcId}-labels`,
          type: "symbol",
          source: srcId,
          layout: {
            "text-field": ["coalesce", ["get", "label"], ""],
            "text-size": 10.5,
            "text-font": ["Noto Sans Regular"],
            "text-anchor": "top",
            "text-offset": [0, 1.3],
            "text-allow-overlap": false,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#EAF2F9",
            "text-halo-color": "rgba(7,22,28,0.92)",
            "text-halo-width": 1.6,
          },
        });
      }
      addedHazardIdsRef.current.add(layer.id);
    });

    // Remove hazard sources/layers for ids no longer provided (layer toggles).
    hazardPointLayersRef.current = [];
    for (const id of Array.from(addedHazardIdsRef.current)) {
      const srcId = `hazard-${id}`;
      const stillPresent = hazardLayers.some((l) => l.id === id);
      if (!stillPresent) {
        ["-fill", "-points", "-labels"].forEach((suffix) => {
          if (map.getLayer(srcId + suffix)) map.removeLayer(srcId + suffix);
        });
        if (map.getSource(srcId)) map.removeSource(srcId);
        addedHazardIdsRef.current.delete(id);
      } else if (map.getLayer(`${srcId}-points`)) {
        hazardPointLayersRef.current.push(`${srcId}-points`);
      }
    }

    if (cinematic || !interactive) return;

    map.off("click", handleClick);
    map.off("mousemove", handleMove);
    map.on("click", handleClick);
    map.on("mousemove", handleMove);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, historicalTrack, forecast, hazardLayers, simplified]);

  // Apply the LayerControl visibility flags once the relevant layers exist.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || cinematic) return;
    const layerIds: Record<string, string[]> = {
      observed: ["track-observed-layer"],
      forecast: ["track-forecast-layer"],
      cone: ["unc-fill-layer", "unc-line-layer"],
      points: ["fc-points-layer", "fc-labels-layer"],
    };
    const hidden = new Set(hiddenLayers);
    const apply = () => {
      for (const [key, ids] of Object.entries(layerIds)) {
        const hKey = key as "observed" | "forecast" | "cone" | "points";
        for (const id of ids) {
          if (!map.getLayer(id)) continue;
          map.setLayoutProperty(id, "visibility", hidden.has(hKey) ? "none" : "visible");
        }
      }
    };
    let raf = 0;
    const retry = () => {
      const present = Object.values(layerIds)
        .flat()
        .every((id) => map.getLayer(id));
      if (present) apply();
      else raf = window.requestAnimationFrame(retry);
    };
    retry();
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, hiddenLayers, historicalTrack, forecast, simplified]);

  const handleClick = (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const hazardHits = map.queryRenderedFeatures(e.point, { layers: hazardPointLayersRef.current });
    if (hazardHits.length) {
      const props = hazardHits[0].properties as {
        layerId: string;
        layerName?: string;
        name?: string | null;
        level?: string;
        idx: number;
      };
      const name = props.name ?? undefined;
      const level = props.level ?? undefined;
      onHazardPointRef.current?.({
        layerId: props.layerId,
        layerName: props.layerName,
        name,
        level,
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
      });
      const html = [
        name ? `<div class="map-popup-title">${name}</div>` : "",
        level ? `<div class="small">Exposure: <b>${String(level).replace(/_/g, " ")}</b></div>` : "",
        `<div class="mono">${Math.abs(e.lngLat.lat).toFixed(2)}\u00b0${e.lngLat.lat >= 0 ? "N" : "S"} &nbsp;${Math.abs(e.lngLat.lng).toFixed(2)}\u00b0${e.lngLat.lng >= 0 ? "E" : "W"}</div>`,
      ].join("");
      showPopup(html, [e.lngLat.lng, e.lngLat.lat]);
      return;
    }
    const fcId = map.queryRenderedFeatures(e.point, { layers: ["fc-points-layer"] });
    if (fcId.length) {
      const props = fcId[0].properties as { horizon: number; index: number };
      const pt = canonical.forecast[props.index];
      if (pt) {
        onPointSelected?.({
          timestamp: pt.timestamp ?? "",
          horizonHours: pt.horizonHours,
          latitude: pt.latitude,
          longitude: pt.longitude,
          windKt: pt.windKt,
          uncertaintyKm: pt.uncertaintyKm,
          isForecast: true,
        });
        const html = [
          `<div class="map-popup-title">Forecast +${pt.horizonHours}h</div>`,
          `<div class="mono">${pt.latitude.toFixed(2)}°N &nbsp;${pt.longitude.toFixed(2)}°E</div>`,
          `<div class="small muted">${pt.timestamp ? new Date(pt.timestamp).toISOString() : ""}</div>`,
          pt.uncertaintyKm
            ? `<div class="small">Uncertainty: ±${pt.uncertaintyKm} km</div>`
            : "",
        ].join("");
        showPopup(html, [e.lngLat.lng, e.lngLat.lat]);
      }
    } else if (activeLat != null && activeLon != null) {
      // Click on the vortex area
      const name = current?.name ?? "Cyclone";
      const bear = moveBearing != null ? compassFromBearing(moveBearing) : "";
      const html = [
        `<div class="map-popup-title">${name}</div>`,
        `<div class="small muted">CURRENT CYCLONE</div>`,
        `<div class="mono">${activeLat.toFixed(2)}°N &nbsp;${activeLon.toFixed(2)}°E</div>`,
        activeWindKt ? `<div class="small">Max wind: ${activeWindKt} kt</div>` : "",
        bear ? `<div class="small">Moving ${bear}</div>` : "",
        activeTimestamp ? `<div class="small muted">${formatIST(activeTimestamp)}</div>` : "",
      ].join("");
      showPopup(html, [e.lngLat.lng, e.lngLat.lat]);
    }
  };

  const handleMove = (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const hoverable = ["fc-points-layer", ...hazardPointLayersRef.current];
    const feats = map.queryRenderedFeatures(e.point, { layers: hoverable });
    map.getCanvas().style.cursor = feats.length ? "pointer" : "";
  };

  const showPopup = (html: string, lngLat: [number, number]) => {
    new maplibregl.Popup({ closeButton: false, className: "map-tooltip" })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(mapRef.current!);
  };

  // Timeline label
  const timelineLabel = useMemo(() => {
    if (activePoint && activePoint.horizonHours > 0) {
      return `+${String(activePoint.horizonHours).padStart(2, "0")}H · ${formatIST(activePoint.timestamp)}`;
    }
    return activeTimestamp ? `NOW · ${formatIST(activeTimestamp)}` : "";
  }, [activePoint, activeTimestamp]);

  // Timeline points for the component
  const timelinePoints: TimelinePoint[] = useMemo(
    () =>
      allTrackPoints.map((p) => ({
        horizonHours: p.horizonHours,
        timestamp: p.timestamp,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    [allTrackPoints]
  );

  return (
    <div
      className={`${className} ${showTimeline ? "has-timeline" : ""}`}
      style={{ height: showTimeline ? undefined : (height ?? "100%"), display: "flex", flexDirection: "column" }}
      role="application"
      aria-label="Interactive cyclone map"
    >
      <div className="cv-map-stage" style={{ flex: 1, minHeight: 0, position: "relative", height: height ?? "100%" }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {!cinematic && <CycloneLegend simplified={simplified} />}
        {activeLat == null && activeLon == null && (
          <div className="cv-unavailable">
            <span className="cv-unavailable-title">TRAJECTORY DATA UNAVAILABLE</span>
            <span className="cv-unavailable-sub">
              No valid cyclone position could be loaded. No forecast movement is shown.
            </span>
          </div>
        )}
        {!cinematic && isDemo && activeLat != null && (
          <div className="cv-demo-notice">DEMO / SIMULATED TRAJECTORY</div>
        )}
      </div>

      {/* Timeline bar */}
      {!cinematic && showTimeline && timelinePoints.length > 0 && (
        <CycloneTimeline
          points={timelinePoints}
          currentIndex={activeIdx}
          playing={playing}
          onIndexChange={(i) => onIdxChange?.(i)}
          onPlayToggle={() => onPlayToggle?.()}
          onStep={(d) => onIdxChange?.(Math.max(0, Math.min(timelinePoints.length - 1, activeIdx + d)))}
          currentLabel={timelineLabel}
        />
      )}
    </div>
  );
}

// ── Helpers ──

/** One LineString Feature per track segment, coloured by IMD intensity. */
function segmentsToFeatures(
  segments: TrackSegment[],
  fallback: string,
): GeoJSON.Feature<GeoJSON.LineString>[] {
  return segments.map((s) => ({
    type: "Feature",
    properties: { color: s.color ?? fallback },
    geometry: {
      type: "LineString",
      coordinates: [
        [s.from.longitude, s.from.latitude],
        [s.to.longitude, s.to.latitude],
      ],
    },
  }));
}

// ── Map controls ──

class RecenterControl implements maplibregl.IControl {
  private _container?: HTMLElement;
  private _onRecenter: () => void;

  constructor(onRecenter: () => void) {
    this._onRecenter = onRecenter;
  }

  onAdd(_map: maplibregl.Map): HTMLElement {
    const group = document.createElement("div");
    group.className = "maplibregl-ctrl maplibregl-ctrl-group map-recenter-ctrl";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "maplibregl-ctrl-icon map-recenter";
    btn.setAttribute("aria-label", "Recenter to Indian Ocean region");
    btn.setAttribute("title", "Recenter to Indian Ocean region");
    btn.innerHTML =
      '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
      '<path d="M10 2l5 5h-3v6h-4V7H5l5-5z" fill="currentColor"/>' +
      "</svg>";
    btn.addEventListener("click", () => this._onRecenter());
    group.appendChild(btn);
    this._container = group;
    return group;
  }

  onRemove(): void {
    this._container?.remove();
    this._container = undefined;
  }
}

// ── Vortex marker: cyclone SVG + following timestamp label ──
function VortexMarker({
  size,
  bearing,
  showTag,
  debug,
  lat,
  lon,
  horizonHours,
  timestamp,
  isDemo,
}: {
  size: number;
  bearing: number | null;
  showTag: boolean;
  debug?: boolean;
  lat: number | null;
  lon: number | null;
  horizonHours?: number;
  timestamp?: string;
  isDemo?: boolean;
}) {
  return (
    <div className="cv-marker">
      <CycloneVortex size={size} bearing={bearing} selected />
      {isDemo && <span className="cv-demo-badge">DEMO</span>}
      {showTag && (horizonHours != null || timestamp) && (
        <div className="cv-marker-label">
          <span className="cv-label-tag">
            {horizonHours != null && horizonHours > 0
              ? `+${String(horizonHours).padStart(2, "0")}H`
              : "NOW"}
          </span>
          {timestamp && (
            <span className="cv-label-time">{formatIST(timestamp)}</span>
          )}
          {debug && lat != null && lon != null && (
            <span className="cv-label-debug">
              {Math.abs(lat).toFixed(2)}°{lat >= 0 ? "N" : "S"} {Math.abs(lon).toFixed(2)}°E
            </span>
          )}
        </div>
      )}
    </div>
  );
}
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { TrackPoint } from "@/types";
import { formatIST } from "@/utils/format";
import { createRoot, type Root } from "react-dom/client";

export interface HazardLayerData {
  id: string;
  name: string;
  polygons?: {
    coordinates: [number, number][][];
    level: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "EXTREME";
    name?: string;
  }[];
  points?: { lat: number; lon: number; level: string; name?: string }[];
}

interface Props {
  historicalTrack?: { lat: number; lon: number; timestamp: string }[];
  forecast?: TrackPoint[];
  current?: { lat: number; lon: number; name?: string; windKt?: number };
  hazardLayers?: HazardLayerData[];
  height?: string | number;
  flyTo?: boolean;
  interactive?: boolean;
  onPointSelected?: (point: TrackPoint) => void;

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
  /** Additional className for the container. */
  className?: string;
  /** Whether this is a "simplified" view (Command Center) with less detail. */
  simplified?: boolean;
  /** Dev-only: show live LAT/LON under the cyclone (must not change on pan/zoom). */
  debug?: boolean;
  /** Whether the trajectory is simulated/demo data (Section 53). */
  isDemo?: boolean;
}

export function CycloneMap({
  historicalTrack = [],
  forecast = [],
  current,
  hazardLayers = [],
  height,
  flyTo = true,
  interactive = true,
  selectedIdx,
  playing = false,
  onIdxChange,
  onPlayToggle,
  showTimeline = false,
  showTag = true,
  className = "map-box",
  simplified = false,
  debug = false,
  isDemo = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const markerRootRef = useRef<Root | null>(null);
  const arrowImageRef = useRef<string | null>(null);
  const contourRef = useRef<ContourCanvasSource | null>(null);
  const focusRef = useRef<[[number, number], [number, number]]>(INDIA_EXTENT);
  const [loaded, setLoaded] = useState(false);
  const flyToRef = useRef(flyTo);

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
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new RecenterControl(() => {
          map.fitBounds(focusRef.current, {
            padding: { top: 70, bottom: 70, left: 60, right: 60 },
            maxZoom: 7,
            duration: 700,
          });
        }),
        "top-right"
      );
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

        if (flyToRef.current) {
          map.fitBounds(focusRef.current, {
            padding: { top: 70, bottom: 70, left: 60, right: 60 },
            maxZoom: 7,
            duration: 900,
          });
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
    if (!map || !loaded) return;
    map.fitBounds(focus, {
      padding: { top: 70, bottom: 70, left: 60, right: 60 },
      maxZoom: 7,
      duration: 900,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, focus]);

  // ── Update vortex marker position (geographic interpolation) ──
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || activeLat == null || activeLon == null) return;

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
    if (!map || !loaded) return;

    const sources = map.getStyle()?.sources ?? {};

    // Historical track line (thin, muted)
    if (historicalTrack.length > 1) {
      const line: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: historicalTrack.map((p) => [p.lon, p.lat]),
        },
      };
      if (!sources["hist-line"]) map.addSource("hist-line", { type: "geojson", data: line });
      else (map.getSource("hist-line") as maplibregl.GeoJSONSource).setData(line);
      if (!map.getLayer("hist-layer")) {
        map.addLayer({
          id: "hist-layer",
          type: "line",
          source: "hist-line",
          layout: { "line-cap": "round" },
          paint: { "line-color": TRACK_COLOR, "line-width": 2, "line-opacity": 0.7 },
        });
      }
    }

    // Forecast line (stronger, dashed) — only forecast-tagged points
    const forecastPts = forecast.filter((p) => p.isForecast);
    if (forecastPts.length > 1) {
      const line: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: forecastPts.map((p) => [p.longitude, p.latitude]),
        },
      };
      if (!sources["fc-line"]) map.addSource("fc-line", { type: "geojson", data: line });
      else (map.getSource("fc-line") as maplibregl.GeoJSONSource).setData(line);
      if (!map.getLayer("fc-layer")) {
        map.addLayer({
          id: "fc-layer",
          type: "line",
          source: "fc-line",
          layout: { "line-cap": "round" },
          paint: { "line-color": FORECAST_COLOR, "line-width": 3.5, "line-dasharray": [2, 2] },
        });
      }
    }

    // Uncertainty corridor
    if (!simplified && forecastPts.length > 1) {
      const cone = buildCone(forecastPts);
      if (cone) {
        if (!sources["unc-fill"]) map.addSource("unc-fill", { type: "geojson", data: cone });
        else (map.getSource("unc-fill") as maplibregl.GeoJSONSource).setData(cone);
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

    // Forecast points (small nodes along the track)
    if (!simplified && forecast.length > 0) {
      const fc = forecast
        .filter((p) => p.isForecast)
        .map((p, i) => ({
          type: "Feature" as const,
          properties: { horizon: p.horizonHours, index: i },
          geometry: {
            type: "Point" as const,
            coordinates: [p.longitude, p.latitude],
          },
        }));
      if (!sources["fc-points"]) {
        map.addSource("fc-points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: fc },
        });
      } else {
        (map.getSource("fc-points") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: fc,
        });
      }
      if (!map.getLayer("fc-points-layer")) {
        map.addLayer({
          id: "fc-points-layer",
          type: "circle",
          source: "fc-points",
          paint: {
            "circle-radius": 4,
            "circle-color": FORECAST_COLOR,
            "circle-stroke-color": "#0b1017",
            "circle-stroke-width": 1.5,
          },
        });
      }
    }

    // Directional arrows along forecast track
    ensureArrowImage().then((imgId) => {
      arrowImageRef.current = imgId;
      if (forecast.length > 1 && !map.getLayer("fc-arrows")) {
        map.addLayer({
          id: "fc-arrows",
          type: "symbol",
          source: "fc-line",
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 78,
            "icon-image": imgId,
            "icon-size": 0.9,
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-allow-overlap": true,
          },
        });
      }
    });

    // Hazard layers
    hazardLayers.forEach((layer) => {
      const srcId = `hazard-${layer.id}`;
      if (layer.polygons && layer.polygons.length) {
        const features = layer.polygons.map((p) => ({
          type: "Feature" as const,
          properties: { level: p.level, name: p.name },
          geometry: { type: "Polygon" as const, coordinates: p.coordinates },
        }));
        if (!sources[srcId]) {
          map.addSource(srcId, {
            type: "geojson",
            data: { type: "FeatureCollection", features },
          });
        } else {
          (map.getSource(srcId) as maplibregl.GeoJSONSource).setData({
            type: "FeatureCollection",
            features,
          });
        }
        if (!map.getLayer(`${srcId}-fill`)) {
          map.addLayer({
            id: `${srcId}-fill`,
            type: "fill",
            source: srcId,
            paint: {
              "fill-color": [
                "match",
                ["get", "level"],
                "HIGH",
                "rgba(232,119,46,0.4)",
                "VERY_HIGH",
                "rgba(224,71,46,0.5)",
                "EXTREME",
                "rgba(207,31,31,0.6)",
                "MODERATE",
                "rgba(217,165,32,0.35)",
                "rgba(47,168,79,0.3)",
              ],
            },
          });
        }
      }
    });

    if (interactive) {
      map.off("click", handleClick);
      map.off("mousemove", handleMove);
      map.on("click", handleClick);
      map.on("mousemove", handleMove);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, historicalTrack, forecast, hazardLayers, simplified]);

  const ensureArrowImage = async () => {
    const map = mapRef.current;
    if (!map) return "";
    if (map.hasImage("track-arrow")) return "track-arrow";
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = FORECAST_COLOR;
    ctx.beginPath();
    ctx.moveTo(2, 12);
    ctx.lineTo(18, 12);
    ctx.lineTo(18, 6);
    ctx.lineTo(23, 12);
    ctx.lineTo(18, 18);
    ctx.lineTo(18, 12);
    ctx.closePath();
    ctx.fill();
    const imageData = ctx.getImageData(0, 0, size, size);
    map.addImage("track-arrow", imageData);
    return "track-arrow";
  };

  const handleClick = (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const fcId = map.queryRenderedFeatures(e.point, { layers: ["fc-points-layer"] });
    if (fcId.length) {
      const props = fcId[0].properties as { horizon: number; index: number };
      const pt = forecast[props.index];
      if (pt) {
        const html = [
          `<div class="map-popup-title">Forecast +${pt.horizonHours}h</div>`,
          `<div class="mono">${pt.latitude.toFixed(2)}°N &nbsp;${pt.longitude.toFixed(2)}°E</div>`,
          `<div class="small muted">${new Date(pt.timestamp).toISOString()}</div>`,
          pt.uncertaintyKm
            ? `<div class="small">Uncertainty: ±${pt.uncertaintyKm} km (uncalibrated band${isDemo ? ", demo" : ""})</div>`
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
    const hoverable = ["fc-points-layer"];
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
        <CycloneLegend simplified={simplified} />
        {activeLat == null && activeLon == null && (
          <div className="cv-unavailable">
            <span className="cv-unavailable-title">TRAJECTORY DATA UNAVAILABLE</span>
            <span className="cv-unavailable-sub">
              No valid cyclone position could be loaded. No forecast movement is shown.
            </span>
          </div>
        )}
        {isDemo && activeLat != null && (
          <div className="cv-demo-notice">DEMO / SIMULATED TRAJECTORY</div>
        )}
      </div>

      {/* Timeline bar */}
      {showTimeline && timelinePoints.length > 0 && (
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

function buildCone(points: TrackPoint[]): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (points.length < 2) return null;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const kmPerDegLat = 111;
    const kmPerDegLon = 111 * Math.cos((p.latitude * Math.PI) / 180);
    // No fallback corridor: when a point carries no uncertainty value the band
    // simply pinches there instead of fabricating a default +/-10 km radius.
    const unc = p.uncertaintyKm ?? 0;
    const latOff = unc / kmPerDegLat;
    const lonOff = unc / kmPerDegLon;
    left.push([p.longitude - lonOff * 0.5, p.latitude - latOff * 0.5]);
    right.push([p.longitude + lonOff * 0.5, p.latitude + latOff * 0.5]);
  }
  const ring = [...left, ...right.reverse()].map((c) => [
    clamp(c[0], -180, 180),
    clamp(c[1], -90, 90),
  ]);
  ring.push(ring[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

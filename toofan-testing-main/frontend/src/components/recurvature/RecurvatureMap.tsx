import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_STYLE, getMapStyle } from "@/components/map/mapTheme";
import { CycloneVortex } from "@/components/map/CycloneVortex";
import { createRoot, type Root } from "react-dom/client";
import type {
  RecurvatureTrackPoint,
} from "@/types";
import type { GeoPoint, LinePoint } from "./recurvatureGeometry";

// ── Recurvature map palette (dark scientific GIS theme) ──────
const COL = {
  current: "#e0472e",        // cyclone marker — vivid red-orange
  currentHalo: "rgba(224,71,46,0.28)",
  historical: "#6b7a8c",     // thin subdued historical track
  forecast: "#58a6ff",       // actual model forecast (accent)
  uncertaintyFill: "rgba(88,166,255,0.10)",
  uncertaintyStroke: "rgba(88,166,255,0.35)",
  normal: "#9aa7b5",         // subdued dashed normal reference
  recurving: "#e0b33c",      // amber recurving reference
  recurvePoint: "#e0b33c",
};

export interface RecurvatureMapProps {
  current?: { lat: number; lon: number; name?: string; windKt?: number; mslpHpa?: number };
  historical?: RecurvatureTrackPoint[];
  forecast?: RecurvatureTrackPoint[];
  normalRef?: GeoPoint[];
  recurvingRef?: GeoPoint[];
  recurvaturePoint?: GeoPoint | null;
  /** Range 0..1 (0 = start of track, 1 = end). Highlights track up to t. */
  timelineT?: number;
  /** Optional emphasized forecast position (highlights a specific point). */
  highlightPoint?: GeoPoint | null;
  layers?: Record<string, boolean>;
  /** Movement bearing for the vortex direction indicator. */
  bearing?: number | null;
}

export function RecurvatureMap({
  current,
  historical = [],
  forecast = [],
  normalRef = [],
  recurvingRef = [],
  recurvaturePoint,
  highlightPoint,
  layers = {},
  bearing,
}: RecurvatureMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const markerRootRef = useRef<Root | null>(null);
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  const center: [number, number] = useMemo(() => {
    const c = current ?? historical[historical.length - 1] ?? forecast[0];
    if (c) return [c.lon, c.lat];
    // Bay of Bengal / India focus
    return [84, 17];
  }, [current, historical, forecast]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
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
        center,
        zoom: 4.4,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => setLoaded(true));
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

  // Auto-fit map bounds to encompass all track data (historical + forecast + recurving refs).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || fittedRef.current) return;

    const allPts: { lon: number; lat: number }[] = [];
    for (const p of historical) allPts.push({ lon: p.lon, lat: p.lat });
    for (const p of forecast) allPts.push({ lon: p.lon, lat: p.lat });
    for (const p of normalRef) allPts.push({ lon: p.lon, lat: p.lat });
    for (const p of recurvingRef) allPts.push({ lon: p.lon, lat: p.lat });
    if (current) allPts.push({ lon: current.lon, lat: current.lat });
    if (recurvaturePoint) allPts.push({ lon: recurvaturePoint.lon, lat: recurvaturePoint.lat });

    if (allPts.length > 1) {
      let minLon = Infinity, maxLon = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      for (const p of allPts) {
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
      }
      const spanLon = Math.max(0.5, maxLon - minLon);
      const spanLat = Math.max(0.5, maxLat - minLat);
      const padLon = Math.max(3, spanLon * 0.25);
      const padLat = Math.max(2, spanLat * 0.25);

      map.fitBounds(
        [
          [minLon - padLon, minLat - padLat],
          [maxLon + padLon, maxLat + padLat],
        ],
        { maxZoom: 8, padding: { top: 40, bottom: 40, left: 40, right: 40 }, duration: 0 }
      );
      fittedRef.current = true;
    }
  }, [loaded, historical, forecast, normalRef, recurvingRef, current, recurvaturePoint]);

  // Update vortex marker position
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !current) return;

    if (!markerRef.current) {
      const markerEl = document.createElement("div");
      markerEl.className = "cyclone-vortex-marker";
      markerEl.style.transition = "transform 0.9s cubic-bezier(0.25, 0.1, 0.25, 1)";
      const root = createRoot(markerEl);
      markerRootRef.current = root;
      markerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
        .setLngLat([current.lon, current.lat])
        .addTo(map);
      root.render(<CycloneVortex size={52} bearing={bearing} selected />);
    } else {
      markerRef.current.setLngLat([current.lon, current.lat]);
      markerRootRef.current?.render(<CycloneVortex size={52} bearing={bearing} selected />);
    }
  }, [loaded, current, bearing]);

  const visible = (k: string) => layers[k] !== false;

  // Render all layers once the data + map are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    ensureSource("rc-hist");
    ensureSource("rc-hist-pts");
    ensureSource("rc-fc");
    ensureSource("rc-fc-pts");
    ensureSource("rc-unc");
    ensureSource("rc-normal");
    ensureSource("rc-recurve");
    ensureSource("rc-recurve-arrows");
    ensureSource("rc-recurve-point");

    // ── Timeline highlight (emphasized forecast position) ──
    ensureSource("rc-highlight");
    if (highlightPoint) {
      (map.getSource("rc-highlight") as maplibregl.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [highlightPoint.lon, highlightPoint.lat] },
      });
      if (!map.getLayer("rc-highlight-ring")) {
        map.addLayer({
          id: "rc-highlight-ring",
          type: "circle",
          source: "rc-highlight",
          paint: {
            "circle-radius": 12,
            "circle-color": "transparent",
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 2,
          },
        });
      }
    }

    // ── Historical track (thin line + points) ──────────────
    drawLine("rc-hist", historical.map((p) => [p.lon, p.lat]), {
      color: COL.historical,
      width: 2,
      opacity: 0.75,
      dash: [1, 3],
    });
    drawPoints("rc-hist-pts", historical, {
      radius: 2.5,
      color: COL.historical,
      opacity: 0.9,
    });

    // ── Actual model forecast + uncertainty band ───────────
    if (forecast.length > 1) {
      const cone = buildCone(forecast);
      if (cone) {
        (map.getSource("rc-unc") as maplibregl.GeoJSONSource).setData(cone);
        if (!map.getLayer("rc-unc-fill")) {
          map.addLayer({
            id: "rc-unc-fill",
            type: "fill",
            source: "rc-unc",
            paint: { "fill-color": COL.uncertaintyFill },
          });
          map.addLayer({
            id: "rc-unc-line",
            type: "line",
            source: "rc-unc",
            paint: { "line-color": COL.uncertaintyStroke, "line-width": 1 },
          });
        }
      }
      drawLine("rc-fc", forecast.map((p) => [p.lon, p.lat]), {
        color: COL.forecast,
        width: 3.2,
        opacity: 0.95,
        dash: [2, 2],
      });
      drawPoints("rc-fc-pts", forecast, { radius: 4, color: COL.forecast, opacity: 1 });
    }

    // ── Normal (non-recurving) reference — dashed subdued ───
    if (normalRef.length > 1) {
      drawLine("rc-normal", normalRef.map((p) => [p.lon, p.lat]), {
        color: COL.normal,
        width: 2.4,
        opacity: 0.7,
        dash: [4, 5],
      });
    }

    // ── Recurving reference — solid amber, curved ───────────
    if (recurvingRef.length > 1) {
      drawLine("rc-recurve", recurvingRef.map((p) => [p.lon, p.lat]), {
        color: COL.recurvePoint,
        width: 2.8,
        opacity: 0.95,
        dash: [10, 3],
      });
    }

    // ── Direction arrows (normal + recurving) ───────────────
    const normalPts = toLinePoints(normalRef);
    const recurvePts = toLinePoints(recurvingRef);
    const arrows: GeoJSON.Feature[] = [
      ...arrowFeatures(normalPts, "normal", 5),
      ...arrowFeatures(recurvePts, "recurving", 7),
    ];
    (map.getSource("rc-recurve-arrows") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: arrows,
    });
    if (!map.getLayer("rc-arrows")) {
      map.addLayer({
        id: "rc-arrows",
        type: "symbol",
        source: "rc-recurve-arrows",
        layout: {
          "icon-image": "arrow",
          "icon-size": 0.9,
          "icon-allow-overlap": true,
          "icon-rotation-alignment": "map",
          "icon-rotate": ["get", "rot"],
        },
        paint: {
          "icon-color": [
            "match",
            ["get", "type"],
            "normal",
            COL.normal,
            "recurving",
            COL.recurving,
            COL.recurvePoint,
          ],
          "icon-opacity": 0.9,
        },
      });
    }
    if (!map.hasImage("arrow")) {
      map.addImage("arrow", arrowImageData());
    }

    // ── Current cyclone marker — now rendered as CycloneVortex DOM marker ──

    // ── Recurvature point marker ────────────────────────────
    if (recurvaturePoint) {
      (map.getSource("rc-recurve-point") as maplibregl.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: [recurvaturePoint.lon, recurvaturePoint.lat],
        },
      });
      if (!map.getLayer("rc-recurve-point-ring")) {
        map.addLayer({
          id: "rc-recurve-point-ring",
          type: "circle",
          source: "rc-recurve-point",
          paint: {
            "circle-radius": 8,
            "circle-color": "transparent",
            "circle-stroke-color": COL.recurvePoint,
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "rc-recurve-point-core",
          type: "circle",
          source: "rc-recurve-point",
          paint: { "circle-radius": 3, "circle-color": COL.recurvePoint },
        });
      }
    }

    // ── Visibility toggles ──────────────────────────────────
    applyVisibility();

    // ── Interactivity: hover + click tooltips ───────────────
    map.off("click", handleClick);
    map.off("mousemove", handleMove);
    map.on("click", handleClick);
    map.on("mousemove", handleMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, current, historical, forecast, normalRef, recurvingRef, recurvaturePoint, highlightPoint, layers]);

  // Helper closures bound to current render state.
  function drawLine(
    id: string,
    coords: [number, number][],
    paint: { color: string; width: number; opacity: number; dash?: number[] }
  ) {
    const map = mapRef.current!;
    const src = map.getSource(id) as maplibregl.GeoJSONSource;
    src.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    });
    const layout: maplibregl.LineLayerSpecification["layout"] = { "line-cap": "round", "line-join": "round" };
    if (!map.getLayer(`${id}-line`)) {
      map.addLayer({
        id: `${id}-line`,
        type: "line",
        source: id,
        layout,
        paint: {
          "line-color": paint.color,
          "line-width": paint.width,
          "line-opacity": paint.opacity,
          ...(paint.dash ? { "line-dasharray": paint.dash } : {}),
        },
      });
    } else {
      map.setPaintProperty(`${id}-line`, "line-width", paint.width);
    }
  }

  function drawPoints(
    id: string,
    pts: RecurvatureTrackPoint[],
    paint: { radius: number; color: string; opacity: number }
  ) {
    const map = mapRef.current!;
    const src = map.getSource(id) as maplibregl.GeoJSONSource;
    src.setData({
      type: "FeatureCollection",
      features: pts.map((p) => ({
        type: "Feature" as const,
        properties: {
          t: p.timestamp ?? "",
          lat: p.lat,
          lon: p.lon,
          wind: p.windKt,
          pres: p.mslpHpa,
        },
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      })),
    });
    if (!map.getLayer(`${id}-pts`)) {
      map.addLayer({
        id: `${id}-pts`,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": paint.radius,
          "circle-color": paint.color,
          "circle-opacity": paint.opacity,
          "circle-stroke-color": "#0b1017",
          "circle-stroke-width": 1,
        },
      });
    }
  }

  function ensureSource(id: string) {
    const map = mapRef.current!;
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
  }

  function applyVisibility() {
    const map = mapRef.current!;
    const rules: Record<string, string> = {
      historical: "hist",
      forecast: "fc",
      uncertainty: "unc",
      normal: "normal",
      recurving: "recurve",
      arrows: "arrows",
    };
    for (const [key, prefix] of Object.entries(rules)) {
      const on = visible(key);
      map.getStyle()?.layers?.forEach((l) => {
        if (l.id.startsWith(`rc-${prefix}`)) {
          map.setLayoutProperty(l.id, "visibility", on ? "visible" : "none");
        }
      });
    }
    map.setLayoutProperty("rc-recurve-point-ring", "visibility", visible("recurvePoint") ? "visible" : "none");
    map.setLayoutProperty("rc-recurve-point-core", "visibility", visible("recurvePoint") ? "visible" : "none");
    if (highlightPoint) {
      map.setLayoutProperty("rc-highlight-ring", "visibility", "visible");
    } else if (typeof highlightPoint === "undefined") {
      map.setLayoutProperty("rc-highlight-ring", "visibility", "none");
    }
  }

  const handleClick = (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const popup = (
      html: string,
      lngLat: [number, number],
      className = "map-tooltip"
    ) =>
      new maplibregl.Popup({ closeButton: false, className })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);

    const fcHit = map.queryRenderedFeatures(e.point, { layers: ["rc-fc-pts"] });
    if (fcHit.length) {
      const props = fcHit[0].properties as Record<string, unknown>;
      popup(
        [
          `<div class="map-popup-title">Forecast Point</div>`,
          `<div class="mono">${fmt(props.lat)}°N &nbsp;${fmt(props.lon)}°E</div>`,
          props.t ? `<div class="small muted">${String(props.t).slice(0, 19).replace("T", " ")}</div>` : "",
          props.wind != null ? `<div class="small">Wind: ${props.wind} kt</div>` : "",
        ].join(""),
        [e.lngLat.lng, e.lngLat.lat]
      );
      return;
    }

    const histHit = map.queryRenderedFeatures(e.point, { layers: ["rc-hist-pts"] });
    if (histHit.length) {
      const props = histHit[0].properties as Record<string, unknown>;
      popup(
        [
          `<div class="map-popup-title">Historical Position</div>`,
          props.t ? `<div class="small muted">${String(props.t).slice(0, 19).replace("T", " ")}</div>` : "",
          `<div class="mono">${fmt(props.lat)}°N &nbsp;${fmt(props.lon)}°E</div>`,
          props.wind != null ? `<div class="small">Wind: ${props.wind} kt</div>` : "",
          props.pres != null ? `<div class="small">Pressure: ${props.pres} hPa</div>` : "",
        ].join(""),
        [e.lngLat.lng, e.lngLat.lat]
      );
      return;
    }

    const rpHit = map.queryRenderedFeatures(e.point, { layers: ["rc-recurve-point-ring"] });
    if (rpHit.length) {
      popup(
        `<div class="map-popup-title">Recurvature Point</div><div class="small muted">Heading begins to change here.</div>`,
        [e.lngLat.lng, e.lngLat.lat]
      );
      return;
    }

    // Line hovers (normal / recurving) — trigger on proximity via mousemove,
    // but also allow click on default.
    const normalHit = map.queryRenderedFeatures(e.point, { layers: ["rc-normal-line"] });
    if (normalHit.length) {
      popup(
        `<div class="map-popup-title">Normal Track</div><div class="small muted">Reference trajectory — non-recurving continuation.</div>`,
        [e.lngLat.lng, e.lngLat.lat]
      );
      return;
    }
    const recHit = map.queryRenderedFeatures(e.point, { layers: ["rc-recurve-line"] });
    if (recHit.length) {
      popup(
        `<div class="map-popup-title">Recurving Scenario</div><div class="small muted">Illustrative reference path.</div>`,
        [e.lngLat.lng, e.lngLat.lat]
      );
    }
  };

  const handleMove = (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const hoverable = [
      "rc-fc-pts",
      "rc-hist-pts",
      "rc-recurve-point-ring",
      "rc-normal-line",
      "rc-recurve-line",
    ];
    const feats = map.queryRenderedFeatures(e.point, { layers: hoverable });
    map.getCanvas().style.cursor = feats.length ? "pointer" : "";
  };

  return (
    <div
      ref={containerRef}
      className="map-box"
      style={{ height: "100%" }}
      role="application"
      aria-label="India region cyclone recurvature map"
    />
  );
}

function toLinePoints(geo: GeoPoint[]): LinePoint[] {
  return geo.map((p, i) => {
    const prev = geo[Math.max(0, i - 1)];
    const next = geo[Math.min(geo.length - 1, i + 1)];
    const b = i === 0 ? bearingOf(p, next) : bearingOf(prev, p);
    return { ...p, bearing: b, t: geo.length > 1 ? i / (geo.length - 1) : 0, step: i };
  });
}

function bearingOf(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function arrowFeatures(pts: LinePoint[], type: string, count: number): GeoJSON.Feature[] {
  const feats: GeoJSON.Feature[] = [];
  if (pts.length < 2) return feats;
  const step = Math.max(1, Math.floor((pts.length - 1) / count));
  for (let i = 1; i < pts.length - 1; i += step) {
    const p = pts[i];
    feats.push({
      type: "Feature",
      properties: { rot: p.bearing, type },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    });
  }
  return feats;
}

function arrowImageData(): ImageData {
  const size = 24;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  // Triangle pointing up (north) — map rotation handles direction.
  ctx.beginPath();
  ctx.moveTo(size / 2, 3);
  ctx.lineTo(size / 2 + 6, size - 5);
  ctx.lineTo(size / 2, size - 9);
  ctx.lineTo(size / 2 - 6, size - 5);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function buildCone(points: RecurvatureTrackPoint[]): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (points.length < 2) return null;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (const p of points) {
    const kmPerDegLat = 111;
    const kmPerDegLon = 111 * Math.cos((p.lat * Math.PI) / 180);
    // No fallback corridor: a missing uncertainty value pinches the band there
    // instead of fabricating a default +/-10 km radius.
    const unc = p.uncertaintyKm ?? 0;
    const latOff = unc / kmPerDegLat;
    const lonOff = unc / kmPerDegLon;
    left.push([p.lon - lonOff * 0.5, p.lat - latOff * 0.5]);
    right.push([p.lon + lonOff * 0.5, p.lat + latOff * 0.5]);
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
function fmt(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

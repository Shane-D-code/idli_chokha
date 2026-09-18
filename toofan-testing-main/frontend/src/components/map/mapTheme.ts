// Map style + layer definitions for the TOOFAN command center.
// Scientific weather atlas palette: deep blue-green ocean, warm ivory land,
// flowing teal/olive contour accents, dark-ocean-optimized track colours.
//
// Uses a custom-transformed OpenFreeMap vector-tile style (see mapStyle.ts)
// with a fallback to the stock positron basemap.

import { buildScientificStyle } from "./mapStyle";

// Legacy URL kept as fallback only — the map now uses buildScientificStyle().
export const BASE_STYLE =
  "https://tiles.openfreemap.org/styles/positron";

/** Build and return the custom scientific-atlas MapLibre style. */
export { buildScientificStyle as getMapStyle };

export function defaultCenter(): [number, number] {
  // Bay of Bengal / Arabian Sea depending on context. Default North Indian Ocean.
  return [82, 14];
}

// India + surrounding basins — used to keep the Command Center viewport
// focused on the North Indian Ocean theatre rather than the whole world.
// [ [westLon, southLat], [eastLon, northLat] ]
export const INDIA_EXTENT: [[number, number], [number, number]] = [
  [62, 4],
  [102, 32],
];

// Compute a focus bounding box around the active cyclone + forecast track,
// expanded so India's coastline and the surrounding basin remain in context.
// Falls back to INDIA_EXTENT when no event data is available.
export function cycloneFocus(
  points: { lon: number; lat: number }[]
): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const spanLon = Math.max(1, maxLon - minLon);
  const spanLat = Math.max(1, maxLat - minLat);
  const padLon = Math.max(8, spanLon * 1.5);
  const padLat = Math.max(5, spanLat * 1.5);
  return [
    [clampLon(minLon - padLon), Math.max(-60, minLat - padLat)],
    [clampLon(maxLon + padLon), Math.min(80, maxLat + padLat)],
  ];
}

function clampLon(v: number): number {
  return Math.max(-180, Math.min(180, v));
}

// ── Scientific atlas track / forecast / hazard palette ──
// All colours are optimised for strong contrast against the deep blue-green ocean.
export const TRACK_COLOR     = "#F2EFE5";          // observed track — warm ivory
export const FORECAST_COLOR  = "#E84D3D";          // forecast trajectory — warm red
export const CURRENT_POS_COLOR = "#E84D3D";        // current position — warm red
export const UNCERTAINTY_FILL = "rgba(230,163,58,0.13)";
export const UNCERTAINTY_STROKE = "rgba(230,163,58,0.35)";
export const REF_NORMAL_COLOR = "#A6B8B9";         // normal reference — muted teal
export const REF_RECURVING_COLOR = "#D4A33A";      // recurving reference — ochre

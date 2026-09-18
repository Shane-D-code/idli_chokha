/**
 * mapStyle — Scientific Weather Atlas map style for TOOFAN.
 *
 * Fetches the OpenFreeMap positron vector-tile style and transforms every layer
 * into a deep-ocean / warm-ivory scientific cartographic palette.
 * Roads, buildings, tunnels, railways and most urban detail are removed.
 * Labels are recoloured to remain legible over the dark ocean.
 */

const POSITRON_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const OCEAN         = "#0B5967";

// In this tile source, LAND is rendered as the style BACKGROUND (there is no
// dedicated land polygon layer — the "water" layer is drawn over the ocean on
// top of it). So the background colour IS the land colour: warm ivory.
const LAND_COVER    = "#EDE9DB";   // land / background — warm ivory
const LAND_WOOD     = "#DDD9CC";

// Geographic boundary palette (green / olive cartographic treatment).
const COUNTRY_BORDER  = "rgba(110,148,64,0.85)";   // country border — strong olive-green
const STATE_BORDER    = "rgba(160,172,140,0.6)";  // state/admin — visible pale green-gray

const TEXT_DARK     = "#30302C";   // city / country label on ivory land
const TEXT_MID      = "#3A3830";
const TEXT_OCEAN    = "#8FAFB0";   // ocean label — muted teal
const HALO          = "rgba(237,233,219,0.92)";

// Accepted layer IDs that should survive the transformation.
// Aggressively stripped: all roads, tunnels, railways, aeroways, shields,
// minor labels. Only essential geographic reference remains.
const KEEP_LAYERS = new Set([
  "background",
  "water",
  "landcover_ice_shelf",
  "landcover_glacier",
  "landuse_residential",
  "landcover_wood",
  "waterway",
  "boundary_2",
  "boundary_3",
  "boundary_disputed",
  "water_name_point_label",
  "water_name_line_label",
  "label_country_1",
  "label_country_2",
  "label_city",
  "label_city_capital",
]);

/**
 * Produce a custom MapLibre GL JS style by fetching the upstream positron
 * vector-tile style and applying the scientific-atlas colour overrides.
 *
 * Returns a style spec–compatible object (with `sources` and `layers`).
 * Falls back to a minimal inline style if the fetch fails.
 */
export async function buildScientificStyle(): Promise<maplibregl.StyleSpecification> {
  let base: any;
  try {
    const res = await fetch(POSITRON_STYLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    base = await res.json();
  } catch {
    return fallbackStyle();
  }

  if (!base?.layers) return fallbackStyle();

  // Apply scientific-atlas transformations to every layer
  base.layers = (base.layers as any[])
    .filter((layer: any) => KEEP_LAYERS.has(layer.id))
    .map((layer: any) => transformLayer(layer));

  return base as maplibregl.StyleSpecification;
}

/* ------------------------------------------------------------------ */
/*  Layer transformations                                              */
/* ------------------------------------------------------------------ */

function transformLayer(layer: any): any {
  const id: string = layer.id;
  const type: string = layer.type;
  const paint = layer.paint ?? (layer.paint = {});

  // ── Background ──
  // In the OpenMapTiles/positron source the background IS the land colour
  // (water is drawn over the ocean on top of it). Render land as warm ivory.
  if (id === "background") {
    paint["background-color"] = LAND_COVER;
    return layer;
  }

  // ── Water fills (ocean, lakes, reservoirs) ──
  if (id === "water" && type === "fill") {
    paint["fill-color"] = OCEAN;
    return layer;
  }

  // ── Land-use residential ──
  if (id === "landuse_residential") {
    paint["fill-color"] = LAND_COVER;
    return layer;
  }

  // ── Land-cover variants ──
  if (id === "landcover_wood") {
    paint["fill-color"] = LAND_WOOD;
    paint["fill-opacity"] = 0.45;
    return layer;
  }
  if (id === "landcover_glacier") {
    paint["fill-color"] = "#E8E4D8";
    paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 0, 0.75, 8, 0.35];
    return layer;
  }
  if (id === "landcover_ice_shelf") {
    paint["fill-color"] = "#E8E4D8";
    paint["fill-opacity"] = 0.55;
    return layer;
  }

  // ── Buildings → very subtle ivory ──
  if (id === "building") {
    paint["fill-color"] = "#E4DFD0";
    paint["fill-outline-color"] = "#D8D3C6";
    paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, 0, 16, 0.35];
    return layer;
  }

  // ── Waterways / rivers ──
  if (id === "waterway" && type === "line") {
    paint["line-color"] = OCEAN;
    return layer;
  }

  // ── Remove all transportation features not in KEEP_LAYERS ──
  // (handled by filter above — roads, tunnels, railways, aeroways, piers stripped)

  // ── Boundaries (green / olive cartographic hierarchy) ──
  // Country (admin_level 2) borders — muted green, medium strength.
  if (id === "boundary_2") {
    paint["line-color"]      = COUNTRY_BORDER;
    paint["line-opacity"]    = ["interpolate", ["linear"], ["zoom"], 0, 0.6, 4, 0.95];
    paint["line-width"]      = ["interpolate", ["linear"], ["zoom"], 3, 1.0, 5, 1.2, 12, 1.8];
    paint["line-dasharray"]  = [2, 1];
    return layer;
  }
  // State / 3rd+ administrative level borders — subtle pale green-gray.
  if (id === "boundary_3") {
    paint["line-color"]     = STATE_BORDER;
    paint["line-dasharray"] = [1, 2];
    paint["line-width"]     = ["interpolate", ["linear"], ["zoom"], 7, 0.6, 11, 1.2];
    return layer;
  }
  if (id === "boundary_disputed") {
    paint["line-color"]     = "rgba(127,174,85,0.30)";
    paint["line-dasharray"] = [1, 4];
    return layer;
  }

  // ── Text labels ──
  if (type === "symbol") {
    recolourLabel(layer);
    addDevanagariField(layer);
    return layer;
  }

  return layer;
}

/**
 * Add the Devanagari script (Hindi) alongside the English name for place
 * labels. OpenMapTiles exposes a `name:hi` field carrying the Hindi
 * (Devanagari) transliteration; when present we render it as a second line
 * beneath the Latin/English name. Falls back to the existing field when no
 * Hindi name is available.
 */
function addDevanagariField(layer: any): void {
  const layout = layer.layout ?? (layer.layout = {});
  if (!layout["text-field"]) return;

  // English (latin / name) name.
  const latin = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
  // When a Hindi (Devanagari) name exists, show English + Devanagari. Otherwise
  // fall back to the original field (which may include a local-script line).
  const original = layout["text-field"];
  layout["text-field"] = [
    "case",
    ["has", "name:hi"],
    ["concat", latin, "\n", ["get", "name:hi"]],
    original,
  ];
}

/* ------------------------------------------------------------------ */
/*  Label recolouring                                                  */
/* ------------------------------------------------------------------ */

function recolourLabel(layer: any): void {
  const id: string  = layer.id;
  const paint = layer.paint ?? (layer.paint = {});

  // Default: dark charcoal text with ivory halo over warm-ivory land
  paint["text-color"]       = TEXT_DARK;
  paint["text-halo-color"]  = HALO;
  paint["text-halo-width"]  = 1.6;
  paint["text-halo-blur"]   = 0.6;

  // Water-name labels — muted italic teal over dark ocean
  if (id === "water_name_point_label" || id === "water_name_line_label") {
    paint["text-color"]      = TEXT_OCEAN;
    paint["text-halo-color"] = "rgba(6,59,74,0.7)";
    paint["text-halo-width"] = 1.0;
    paint["text-halo-blur"]  = 0;
  }

  // Country labels — dark charcoal, readable
  if (id.startsWith("label_country")) {
    paint["text-color"] = TEXT_MID;
    paint["text-halo-width"] = 1.4;
  }

  // City labels — dark charcoal (no white labels on ivory land)
  if (id === "label_city" || id === "label_city_capital") {
    paint["text-color"] = "#30302C";
    paint["text-halo-width"] = 1.5;
  }
}

/* ------------------------------------------------------------------ */
/*  Inline fallback (minimal, guaranteed to work)                      */
/* ------------------------------------------------------------------ */

function fallbackStyle(): maplibregl.StyleSpecification {
  return {
    version: 8 as any,
    sources: {
      "openmaptiles": {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
      },
    } as any,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    layers: [
      { id: "background", type: "background", paint: { "background-color": LAND_COVER } },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        filter: ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
                      ["!=", ["get", "brunnel"], "tunnel"]],
        paint: { "fill-antialias": true, "fill-color": OCEAN },
      },
      {
        id: "landcover_glacier",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        maxzoom: 8,
        filter: ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
                      ["==", ["get", "subclass"], "glacier"]],
        paint: { "fill-color": "#E8E4D8", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.75, 8, 0.35] },
      },
      {
        id: "landcover_ice_shelf",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        maxzoom: 8,
        filter: ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
                      ["==", ["get", "subclass"], "ice_shelf"]],
        paint: { "fill-color": "#E8E4D8", "fill-opacity": 0.55 },
      },
      {
        id: "landuse_residential",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        maxzoom: 16,
        filter: ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
                      ["==", ["get", "class"], "residential"]],
        paint: { "fill-color": LAND_COVER, "fill-opacity": ["interpolate", ["exponential", 0.6], ["zoom"], 8, 0.8, 9, 0.6] },
      },
      {
        id: "landcover_wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        minzoom: 10,
        filter: ["all", ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
                      ["==", ["get", "class"], "wood"]],
        paint: { "fill-color": LAND_WOOD, "fill-opacity": 0.45 },
      },
      {
        id: "boundary_3",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        minzoom: 8,
        filter: ["all", [">=", ["get", "admin_level"], 3], ["<=", ["get", "admin_level"], 6],
                      ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1], ["!", ["has", "claimed_by"]]],
        paint: { "line-color": STATE_BORDER, "line-dasharray": [1, 3],
                 "line-width": ["interpolate", ["linear", 1], ["zoom"], 7, 0.4, 11, 0.9] },
      },
      {
        id: "boundary_2",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2],
                      ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1], ["!", ["has", "claimed_by"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": COUNTRY_BORDER,
                 "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.4, 4, 0.75],
                 "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 5, 0.8, 12, 1.4] },
      },
      {
        id: "label_country_1",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        maxzoom: 9,
        filter: ["all", ["==", ["get", "class"], "country"], ["==", ["get", "rank"], 1]],
        layout: {
          "text-field": [
            "case",
            ["has", "name:hi"],
            ["concat", ["coalesce", ["get", "name:latin"], ["get", "name"]], "\n", ["get", "name:hi"]],
            ["coalesce", ["get", "name_en"], ["get", "name"]],
          ],
          "text-font": ["Noto Sans Bold"],
          "text-max-width": 6.25,
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 4, 17],
        },
        paint: { "text-color": TEXT_MID, "text-halo-color": HALO, "text-halo-width": 1.4, "text-halo-blur": 0.6 },
      },
      {
        id: "label_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 3,
        filter: ["all", ["==", ["get", "class"], "city"], ["!=", ["get", "capital"], 2]],
        layout: {
          "icon-allow-overlap": true,
          "icon-image": ["step", ["zoom"], "circle_11_black", 9, ""],
          "icon-optional": false,
          "icon-size": 0.4,
          "text-anchor": "bottom",
          "text-field": [
            "case",
            ["has", "name:hi"],
            ["concat", ["coalesce", ["get", "name:latin"], ["get", "name"]], "\n", ["get", "name:hi"]],
            ["coalesce", ["get", "name_en"], ["get", "name"]],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-max-width": 8,
          "text-offset": [0, -0.1],
          "text-size": ["interpolate", ["exponential", 1.2], ["zoom"], 4, 11, 7, 13, 11, 18],
        },
        paint: { "text-color": "#2A2820", "text-halo-color": HALO, "text-halo-width": 1.5, "text-halo-blur": 0.6 },
      },
    ],
  } as any;
}

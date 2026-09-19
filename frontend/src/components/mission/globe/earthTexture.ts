import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import { equirect } from "./geo";

// Rasterised, near-photographic equirectangular earth for the hero globe.
// Deep-blue ocean with bathymetric mottling, climate-shaded land
// (lush tropics -> temperate green -> dry band -> tundra -> ice caps),
// faint terrain detail and a hairline coastal outline. No neon — a
// calm operational Blue Marble. Rasterised once and cached.

const W = 4096;
const H = 2048;

let cached: HTMLCanvasElement | null = null;

export function getEarthTextureCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  cached = build();
  return cached;
}

function build(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  const P = equirect(ctx, W, H);

  // --- ocean: deep blue, brighter toward the tropics ---
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, H);
  oceanGrad.addColorStop(0, "#06131f");
  oceanGrad.addColorStop(0.2, "#0a2942");
  oceanGrad.addColorStop(0.45, "#0d3044");
  oceanGrad.addColorStop(0.55, "#0d3044");
  oceanGrad.addColorStop(0.8, "#0a2942");
  oceanGrad.addColorStop(1, "#06131f");
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, W, H);

  // --- bathymetric mottling (broad deterministic banding) ---
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y / H) * 180;
    const band = Math.max(0, 1 - Math.abs(lat) / 62);
    const n = vnoise((y / H) * 11, 0.37);
    ctx.fillStyle = `rgba(255,255,255,${(band * (n - 0.5) * 0.035).toFixed(3)})`;
    ctx.fillRect(0, y, W, 1);
  }

  // --- land silhouette from world-atlas topojson ---
  const topo = landTopo as unknown as never;
  const raw = landTopo as unknown as { objects: { land: never } };
  const geo = feature(topo, raw.objects.land) as unknown as FeatureCollection<Geometry>;

  const rings: number[][][] = [];
  const coords =
    geo.type === "FeatureCollection"
      ? (geo.features
          .filter((f) => f.geometry)
          .flatMap((f) => {
            const g = f.geometry as { type: string; coordinates: unknown };
            if (g.type === "Polygon") return [g.coordinates as number[][][]];
            if (g.type === "MultiPolygon") return g.coordinates as number[][][][];
            return [];
          }) as number[][][][])
      : [];

  for (const polygon of coords) for (const ring of polygon) rings.push(ring);

  const landMask = document.createElement("canvas");
  landMask.width = W;
  landMask.height = H;
  const lmctx = landMask.getContext("2d")!;
  lmctx.fillStyle = "#000";
  lmctx.fillRect(0, 0, W, H);
  lmctx.globalCompositeOperation = "destination-out";
  lmctx.fillRect(0, 0, W, H);
  lmctx.globalCompositeOperation = "source-over";
  lmctx.beginPath();
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      const [x, y] = P(lon, lat);
      lmctx.lineTo(x, y);
    }
  lmctx.closePath();
  lmctx.fillStyle = "#fff";
  lmctx.fill("evenodd");

  // --- terrain colour map (climate zones + fine relief) ---
  const TW = W;
  const TH = H;
  const img = lmctx.createImageData(TW, TH);
  const d = img.data;
  for (let y = 0; y < TH; y++) {
    const lat = 90 - (y / TH) * 180;
    const py = y / TH;
    const la = Math.min(1, Math.max(0, (lat + 90) / 180));
    for (let x = 0; x < TW; x++) {
      const px = x / TW;
      const c = landColor(lat, la, py, px, vnoise(px * 2.1, py * 2.1), vnoise(px * 7.3 + 9, py * 7.3), vnoise(px * 17.1 + 3, py * 17.1 + 5));
      const idx = (y * TW + x) * 4;
      d[idx] = c[0];
      d[idx + 1] = c[1];
      d[idx + 2] = c[2];
      d[idx + 3] = 255;
    }
  }

  const terrain = document.createElement("canvas");
  terrain.width = TW;
  terrain.height = TH;
  const tctx = terrain.getContext("2d")!;
  tctx.putImageData(img, 0, 0);
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(landMask, 0, 0);

  // subtle lit-aerosol sheen on land (source-atop after masking)
  tctx.globalCompositeOperation = "source-over";
  const sheen = tctx.createLinearGradient(0, 0, 0, TH);
  sheen.addColorStop(0, "rgba(255,255,255,0.05)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.12)");
  tctx.fillStyle = sheen;
  tctx.fillRect(0, 0, TW, TH);

  ctx.drawImage(terrain, 0, 0);

  // --- hairline coastlines ---
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(160,190,200,0.28)";
  ctx.beginPath();
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      const [x, y] = P(lon, lat);
      ctx.lineTo(x, y);
    }
  ctx.closePath();
  ctx.stroke();

  // --- faint graticule (visual read only, no data claim) ---
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) {
    ctx.strokeStyle = lon % 30 === 0 ? "rgba(150,185,205,0.10)" : "rgba(150,185,205,0.04)";
    ctx.beginPath();
    const [x] = P(lon, 0);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.strokeStyle = lat === 0 ? "rgba(150,185,205,0.10)" : "rgba(150,185,205,0.04)";
    ctx.beginPath();
    const [, y] = P(0, lat);
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  return canvas;
}

// --- palette ---
const P_LUSH: [number, number, number] = [42, 98, 60];
const P_GREEN: [number, number, number] = [62, 96, 54];
const P_DRY: [number, number, number] = [104, 102, 70];
const P_SAND: [number, number, number] = [158, 138, 96];
const P_MOUNT: [number, number, number] = [128, 128, 124];
const P_TUNDRA: [number, number, number] = [104, 112, 92];
const P_SNOW: [number, number, number] = [228, 234, 238];

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function landColor(
  lat: number,
  _py: number,
  _po: number,
  px: number,
  e0: number,
  e1: number,
  e2: number
): [number, number, number] {
  const la = Math.abs(lat);
  const f = vnoise(px * 2.1 + 0.5, 0.5);

  // broad climate: wet tropics -> dry subtropics -> cool temperate
  const tropical = Math.max(0, 1 - la / 26);
  const dryBand = Math.max(0, 1 - Math.abs(la - 24) / 18);

  let c: [number, number, number] = P_GREEN;

  // elevation first-order: higher (against hash) -> drier/greier
  c = mix(c, P_DRY, Math.max(0, e0 - 0.46) * 4);
  c = mix(c, P_SAND, Math.max(0, e0 - 0.58) * 3.4);
  c = mix(c, P_LUSH, Math.max(0, 0.28 - e0) * 2.2);

  // fine relief speckle
  c = mix(c, P_MOUNT, Math.max(0, e1 - 0.74) * 2.6 * (0.35 + 0.65 * dryBand));
  c = mix(c, P_SNOW, Math.max(0, e2 - 0.88) * 9);

  // climate zones shift what dominates
  c = mix(c, P_LUSH, tropical * Math.max(0, 0.55 - e0));
  c = mix(c, P_DRY, dryBand * 0.55);
  c = mix(c, P_TUNDRA, Math.min(1, Math.max(0, (la - 52) / 10)));
  c = mix(c, P_SNOW, Math.min(1, Math.max(0, (la - 66) / 10)));

  // grasslands where the two climate signals cross
  const ecotone = Math.max(0, 1 - Math.abs(e0 - 0.42) * 3.2);
  c = mix(c, P_DRY, ecotone * 0.35 * (1 - dryBand));

  // deterministic vignette so the globe reads lit from above
  const lit = 0.95 + 0.1 * f;
  return [
    Math.round(Math.min(255, c[0] * lit)),
    Math.round(Math.min(255, c[1] * lit)),
    Math.round(Math.min(255, c[2] * lit)),
  ];
}

/** Cheap deterministic value noise in [0,1]. */
function vnoise(x: number, y: number): number {
  const hash = (ix: number, iy: number): number => {
    let h = ix * 374761393 + iy * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
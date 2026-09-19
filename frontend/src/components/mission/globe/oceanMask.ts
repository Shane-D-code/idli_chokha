// Rasterised land/ocean mask for driving per-pixel surface roughness.
// Ocean gets a smooth specular response (dark green roughness channel);
// land stays rough (bright green). Built once at startup from the same
// world-atlas TopoJSON the earth texture uses, cached and reused.

import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import { equirect } from "./geo";

const W = 1024;
const H = 512;

let cached: HTMLCanvasElement | null = null;

export function getOceanMaskCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  cached = build();
  return cached;
}

function build(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const P = equirect(ctx, W, H);

  // Ocean = smooth (roughness ~0.35 -> dark green channel 0x59)
  ctx.fillStyle = "rgb(0, 89, 0)";
  ctx.fillRect(0, 0, W, H);

  // Land = rough (roughness ~0.9 -> near-white green channel 0xE6)
  const topo = landTopo as unknown as { objects: { land: never } };
  const geo = feature(landTopo as never, topo.objects.land) as unknown as FeatureCollection<Geometry>;
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

  ctx.beginPath();
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      const [x, y] = P(lon, lat);
      ctx.lineTo(x, y);
    }
  ctx.closePath();
  ctx.fillStyle = "rgb(0, 230, 0)";
  ctx.fill("evenodd");

  return canvas;
}
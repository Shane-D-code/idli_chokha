import * as THREE from "three";

export { toLatLon as vec3ToLatLon, EARTH_RADIUS_KM, D2R, R2D } from "@/geo/geo";
import { toVec3 } from "@/geo/geo";

export const GLOBE_SCALE = 1.6; // globe unit radius in scene space (radii = lat/lon placed on unit sphere below)

/** Degrees to radians. */
export function d2r(d: number): number {
  return (d * Math.PI) / 180;
}

export function r2d(r: number): number {
  return (r * 180) / Math.PI;
}

/** Lat/lon -> unit vector in three.js scene space (Y up). Canonical maths in @/geo. */
export function latLonToVec3(lat: number, lon: number): THREE.Vector3 {
  return toVec3(lat, lon);
}

/**
 * Map a canvas-space point for an equirectangular projection. x in [0,W]
 * maps lon [-180,180], y in [0,H] maps lat [90,-90].
 */
export function equirect(_ctx: CanvasRenderingContext2D, W: number, H: number) {
  return (lon: number, lat: number) => {
    const x = ((lon + 180) / 360) * W;
    const y = ((90 - lat) / 180) * H;
    return [x, y] as const;
  };
}
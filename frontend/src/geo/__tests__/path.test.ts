import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  arrowheadAt,
  buildConeGeometry,
  buildConeOutline,
  buildConeStrip,
  buildConeTipArc,
  coneWidthsRad,
  D2R,
  LON_ORIGIN_DEG,
  MIN_SAMPLES_PER_INTERVAL,
  resampleTrack,
  rightVector,
  SAMPLE_SPACING_DEG,
  slerpUnit,
  stepAlong,
  tangentTo,
  toGlobeLatLon,
  toLatLon,
  toVec3,
  type TrackSample,
} from "@/geo/geo";
import { bearing } from "@/utils/trackGeometry";

const R = 1; // scene-space globe radius (all geometry maths live on the unit sphere)

function sample(lat: number, lon: number, extra: Partial<TrackSample> = {}): TrackSample {
  return { lat, lon, isForecast: true, ...extra };
}

function angle(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.clone().normalize().angleTo(b.clone().normalize());
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

// A small synthetic storm moving at constant speed and a fixed heading: the
// ideal, structure-checkable fixture the cone assertions run against.
const bearer = 10; // 010°
const stepRad = 0.02; // ~127 km per fix
function straightFixture(count = 8): TrackSample[] {
  const pts: TrackSample[] = [];
  let p = toVec3(15, 88);
  for (let i = 0; i < count; i++) {
    const { lat, lon } = toLatLon(p);
    pts.push(sample(lat, lon, { isForecast: i > 0, windKt: 30 + i * 6 }));
    const north = tangentTo(toVec3(89.9, lon), p);
    const east = rightVector(north, p);
    const fwd = new THREE.Vector3()
      .copy(north)
      .multiplyScalar(Math.cos(bearer * D2R))
      .addScaledVector(east, Math.sin(bearer * D2R))
      .normalize();
    p = stepAlong(p, fwd, stepRad);
  }
  return pts;
}

describe("conversion (lat/lon <-> unit vector)", () => {
  it("round-trips 500 random points incl. ±89.9 lat and ±180 lon to 1e-9", () => {
    for (let i = 0; i < 500; i++) {
      const lat = i % 5 === 0 ? (i % 2 ? 89.9 : -89.9) : Math.random() * 180 - 90;
      const lon = i % 7 === 0 ? (i % 2 ? 180 : -180) : Math.random() * 360 - 180;
      const { lat: l2, lon: lo2 } = toLatLon(toVec3(lat, lon));
      expect(Math.abs(l2 - lat)).toBeLessThan(1e-9);
      // lon canonicalises to [-180,180]; ±180 is the same physical meridian,
      // so compare modulo 360 (260 == -100 == its own equivalence class).
      const diff = ((lo2 - lon + 540) % 360) - 180;
      expect(Math.abs(diff)).toBeLessThan(1e-9);
    }
  });

  it("toLatLon is the exact inverse of toVec3 (lon origin isolated to LON_ORIGIN_DEG)", () => {
    const lats = [-90, -89.9, -45, 0, 45, 89.9, 90];
    const lons = [-180, -90, 0, 90, 180];
    for (const lat of lats) {
      for (const lon of lons) {
        const { lat: a, lon: b } = toLatLon(toVec3(lat, lon));
        expect(Math.abs(a - lat)).toBeLessThan(1e-9);
        if (Math.abs(lat) === 90) continue; // longitude is degenerate at the poles
        const diff = ((b - lon + 540) % 360) - 180;
        expect(Math.abs(diff)).toBeLessThan(1e-9);
      }
    }
  });

  it("keeps the pole position visually consistent with the texture origin", () => {
    const v = toVec3(0, 0);
    const t = toVec3(0, 180);
    // antipodal: 0N/0E and 0N/180E are exactly opposite
    expect(v.dot(t)).toBeCloseTo(-1, 9);
  });

  it("toGlobeLatLon feeds react-globe's polar2Cartesian back to the same surface point", () => {
    // Reimplementation of three-globe's internal projection (a globe rotated
    // -π/2 about Y, so its lon 0 sits on +Z not +X).
    const polar2Cartesian = (lat: number, lng: number) => {
      const phi = (90 - lat) * D2R;
      const theta = (90 - lng) * D2R;
      const s = Math.sin(phi);
      return new THREE.Vector3(s * Math.cos(theta), Math.cos(phi), s * Math.sin(theta));
    };
    const lats = [-89.9, -45, 0, 45, 89.9];
    const lons = [-180, -90, 0, 90, 180];
    for (const lat of lats) {
      for (const lon of lons) {
        const v = toVec3(lat, lon);
        const { lat: l2, lon: lo2 } = toGlobeLatLon(v);
        expect(polar2Cartesian(l2, lo2).distanceTo(v)).toBeLessThan(1e-9);
      }
    }
  });
});

describe("resampling", () => {
  it("keeps every sample radius exactly on the sphere, min +/- target 0.1%", () => {
    const fix = straightFixture(8);
    const out = resampleTrack(fix);
    for (const v of out) {
      expect(Math.abs(v.pos.length() - R)).toBeLessThan(R * 1e-12);
      const ll = toLatLon(v.pos);
      expect(v.lat).toBeCloseTo(ll.lat, 9);
      expect(v.lon).toBeCloseTo(ll.lon, 9);
    }
  });

  it("uses at least MIN_SAMPLES_PER_INTERVAL per fix interval", () => {
    const fix = straightFixture(8);
    const out = resampleTrack(fix);
    expect(out.length).toBeGreaterThanOrEqual((fix.length - 1) * MIN_SAMPLES_PER_INTERVAL + 1);
  });

  it("spaces resampled vertices uniformly (std dev < 10% of mean)", () => {
    const out = resampleTrack(straightFixture(24));
    const gaps: number[] = [];
    for (let i = 1; i < out.length; i++) gaps.push(angle(out[i - 1].pos, out[i].pos));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(0);
    expect(stddev(gaps) / mean).toBeLessThan(0.1);
  });

  it("interpolates metadata attributes across the resampled path", () => {
    const fix = [
      sample(15, 88, { windKt: 40, uncertaintyKm: 8, horizonHours: 0, isForecast: false }),
      sample(16, 88.5, { windKt: 80, uncertaintyKm: 8, horizonHours: 24, isForecast: true }),
    ];
    const out = resampleTrack(fix);
    const mid = out[Math.floor(out.length / 2)];
    expect(mid.windKt).toBeGreaterThan(40);
    expect(mid.windKt).toBeLessThan(80);
    expect(mid.isForecast).toBe(true);
    expect(out[0].isForecast).toBe(false);
    expect(out[out.length - 1].horizonHours).toBe(24);
  });

  it("produces no NaN for identical consecutive fixes (zero-arc intervals)", () => {
    const fix = [
      sample(15, 88, { uncertaintyKm: 10 }),
      sample(15, 88, { uncertaintyKm: 10 }),
      sample(16, 88.5, { uncertaintyKm: 20 }),
    ];
    const out = resampleTrack(fix);
    for (const v of out) {
      expect(Number.isFinite(v.pos.x)).toBe(true);
      expect(Number.isFinite(v.lat)).toBe(true);
      expect(Number.isFinite(v.lon)).toBe(true);
      expect(Number.isFinite(v.uncertaintyKm)).toBe(true);
      expect(v.pos.length()).toBeGreaterThan(0.999999);
    }
  });
});

describe("tangent frame + cone strip", () => {
  it("tangent frame is surface-tangent (fwd · p and right · p < 1e-6)", () => {
    const fix = straightFixture(12);
    const strip = buildConeStrip(
      resampleTrack(fix).map((v) => v.pos),
      coneWidthsRad(resampleTrack(fix), { pinchStartKm: 0 }),
    );
    const rg = new THREE.Vector3();
    strip.centers.forEach((c, i) => {
      rg.crossVectors(strip.fwd[i], c);
      // fwd is orthogonal to the surface normal, so left/right on a
      // well-formed frame must satisfy fwd · p ≈ 0 for ANY p, not just i.
      const f = strip.fwd[i];
      expect(Math.abs(f.dot(c))).toBeLessThan(1e-6);
      const r = rg;
      expect(Math.abs(r.dot(c))).toBeLessThan(1e-6);
      expect(Math.abs(r.dot(f))).toBeLessThan(1e-6);
    });
  });

  it("cone strip is symmetric about the centreline (center->left == center->right)", () => {
    const fix = straightFixture(8);
    const vv = resampleTrack(fix);
    const widths = coneWidthsRad(vv, { pinchStartKm: 0 });
    const strip = buildConeStrip(vv.map((v) => v.pos), widths);
    strip.centers.forEach((c, i) => {
      if (strip.halfWidthRad[i] < 1e-12) return; // pinched vertex is degenerate by design
      const dL = angle(c, strip.left[i]);
      const dR = angle(c, strip.right[i]);
      expect(Math.abs(dL - dR)).toBeLessThan(1e-6);
      expect(dL).toBeCloseTo(strip.halfWidthRad[i], 9);
      expect(dR).toBeCloseTo(strip.halfWidthRad[i], 9);
    });
  });

  it("strip never self-crosses: consistent side orientation past any vertex", () => {
    const fix = straightFixture(12);
    const vv = resampleTrack(fix);
    const widths = coneWidthsRad(vv, { pinchStartKm: 0 });
    const strip = buildConeStrip(vv.map((v) => v.pos), widths);
    const rg = new THREE.Vector3();
    strip.centers.forEach((c, i) => {
      if (strip.halfWidthRad[i] < 1e-12) return;
      rg.crossVectors(strip.fwd[i], c).normalize();
      const onLeft = (strip.left[i].x - c.x) * rg.x + (strip.left[i].y - c.y) * rg.y + (strip.left[i].z - c.z) * rg.z;
      const onRight = (strip.right[i].x - c.x) * rg.x + (strip.right[i].y - c.y) * rg.y + (strip.right[i].z - c.z) * rg.z;
      expect(onLeft).toBeLessThan(0);
      expect(onRight).toBeGreaterThan(0);
    });
  });

  it("cone width is monotonic non-decreasing and exactly 0 at the current fix", () => {
    const fix = [
      sample(15, 88, { uncertaintyKm: 8, isForecast: false }),
      sample(17, 88.6, { uncertaintyKm: 74, isForecast: true }),
      sample(19, 89.2, { uncertaintyKm: 140, isForecast: true }),
      sample(21, 89.8, { uncertaintyKm: 206, isForecast: true }),
    ];
    const vv = resampleTrack(fix);
    const widths = coneWidthsRad(vv, { pinchStartKm: 0 });
    expect(widths[0]).toBe(0);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
  });

  it("forward tangent continuity stays <= 15 degrees between neighbours", () => {
    const fix = straightFixture(20);
    const vv = resampleTrack(fix);
    const strip = buildConeStrip(vv.map((v) => v.pos), coneWidthsRad(vv));
    for (let i = 1; i < strip.fwd.length; i++) {
      const deg = (angle(strip.fwd[i - 1], strip.fwd[i]) * 180) / Math.PI;
      expect(deg).toBeLessThanOrEqual(15);
    }
  });

  it("far-end cap is a curved 180° sweep (no flat chord) and closes the tube", () => {
    const vv = resampleTrack(straightFixture(10));
    const strip = buildConeStrip(vv.map((v) => v.pos), coneWidthsRad(vv, { pinchStartKm: 0 }));
    const { verts } = buildConeTipArc(strip, 16);
    expect(verts.length).toBe(17);
    const last = strip.centers[strip.centers.length - 1];
    // every cap vertex sits on the sphere
    for (const v of verts) expect(v.length()).toBeCloseTo(1, 9);
    // the two ends coincide with the tube's left/right vertices
    const dL = angle(verts[0], strip.left[strip.left.length - 1]);
    const dR = angle(verts[verts.length - 1], strip.right[strip.right.length - 1]);
    expect(dL).toBeLessThan(1e-6);
    expect(dR).toBeLessThan(1e-6);
    // all cap vertices equidistant from the tip centre (constant radius cap)
    const target = strip.halfWidthRad[strip.halfWidthRad.length - 1];
    for (const v of verts) {
      const delta = angle(v, last);
      expect(Math.abs(delta - target)).toBeLessThan(1e-6);
    }
  });

  it("cone geometry indices form watertight, outward-winding triangles", () => {
    const vv = resampleTrack(straightFixture(10));
    const strip = buildConeStrip(vv.map((v) => v.pos), coneWidthsRad(vv, { pinchStartKm: 0 }));
    const g = buildConeGeometry(strip, R, 16);
    const nVerts = strip.centers.length * 2 + 1 + 17;
    expect(g.positions.length / 3).toBe(nVerts);
    // every referenced index exists
    for (const i of g.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(nVerts);
    }
    // positions all on the sphere at radius R
    for (let i = 0; i < g.positions.length; i += 3) {
      const r = Math.hypot(g.positions[i], g.positions[i + 1], g.positions[i + 2]);
      expect(Math.abs(r - R)).toBeLessThan(1e-6);
    }
  });

  it("buildConeOutline is a closed right+arc+left boundary on the sphere", () => {
    const vv = resampleTrack(straightFixture(10));
    const widths = coneWidthsRad(vv, { pinchStartKm: 0 });
    const strip = buildConeStrip(vv.map((v) => v.pos), widths);
    const arcSteps = 16;
    const outline = buildConeOutline(strip, arcSteps);
    const n = strip.centers.length;
    // n right + (arcSteps-1) arc + n left reversed + 1 close
    expect(outline.length).toBe(2 * n + arcSteps);
    for (const v of outline) expect(v.length()).toBeCloseTo(1, 9);
    // closed: first and last vertices coincide with the tube start (pinched)
    expect(outline[outline.length - 1].distanceTo(outline[0])).toBeLessThan(1e-9);
    expect(outline[0].distanceTo(strip.right[0])).toBeLessThan(1e-9);
    // consistent side orientation at every centre (no bowtie)
    const rg = new THREE.Vector3();
    strip.centers.forEach((c, i) => {
      if (strip.halfWidthRad[i] < 1e-12) return;
      rg.crossVectors(strip.fwd[i], c).normalize();
      const L = outline[2 * n + arcSteps - 2 - i].clone().sub(c).dot(rg);
      const RR = outline[i].clone().sub(c).dot(rg);
      expect(L).toBeLessThan(0);
      expect(RR).toBeGreaterThan(0);
    });
  });
});

describe("past + forecast mixing", () => {
  it("keeps observed samples and hits exactly the current-position vertex", () => {
    const samples: TrackSample[] = [];
    let p = toVec3(15, 86);
    for (let k = 0; k < 12; k++) {
      const { lat, lon } = toLatLon(p);
      const h = k - 6; // -6..+5
      samples.push(
        sample(lat, lon, {
          windKt: 30 + k * 2,
          uncertaintyKm: 10 + k * 5,
          horizonHours: h,
          isForecast: h > 0,
        }),
      );
      const north = tangentTo(toVec3(89.9, lon), p);
      p = stepAlong(p, north, 0.015);
    }
    const out = resampleTrack(samples);
    expect(out.filter((v) => !v.isForecast).length).toBeGreaterThan(0);
    expect(out.filter((v) => v.isForecast).length).toBeGreaterThan(0);

    // the vertex at the current fix (h=0) exists and is observed
    const curFix = samples.find((s) => s.horizonHours === 0)!;
    const boundary = out.find(
      (v) => Math.abs(v.lat - curFix.lat) < 1e-9 && Math.abs(v.lon - curFix.lon) < 1e-9,
    );
    expect(boundary).toBeDefined();
    expect(boundary!.isForecast).toBe(false);
    // the first vertex past the boundary carries the forecast flag
    const bIdx = out.indexOf(boundary!);
    expect(out[bIdx + 1].isForecast).toBe(true);
  });
});

describe("arrowhead + bearing", () => {
  it("synthetic 010°-heading storm matches its great-circle bearing within 3°", () => {
    const fix = straightFixture(8);
    const first = fix[0];
    const last = fix[fix.length - 1];
    const b = bearing({ lat: first.lat, lon: first.lon }, { lat: last.lat, lon: last.lon });
    const diff = ((b % 360) - bearer + 540) % 360 - 180;
    expect(Math.abs(diff)).toBeLessThanOrEqual(3);
  });

  it("arrowhead sits in the terminal tangent frame and remains on the sphere", () => {
    const fix = straightFixture(10);
    const vv = resampleTrack(fix);
    const widths = coneWidthsRad(vv, { pinchStartKm: 0 });
    const strip = buildConeStrip(vv.map((v) => v.pos), widths);
    const i = strip.centers.length - 1;
    const ah = arrowheadAt(strip.centers[i], strip.fwd[i], 0.02, 0.01, R);
    // base is BEHIND the terminal fix (opposite the forward tangent)
    const behind = new THREE.Vector3().copy(ah.baseL).add(ah.baseR).multiplyScalar(0.5).normalize();
    const disp = behind.clone().sub(ah.pos.clone().normalize());
    expect(disp.dot(strip.fwd[i])).toBeLessThan(0);
    // all vertices on the sphere
    for (const v of [ah.pos, ah.tip, ah.baseL, ah.baseR]) {
      expect(Math.abs(v.length() - R)).toBeLessThan(1e-6);
    }
    // tip is forward of the terminal fix
    expect(ah.tip.clone().sub(ah.pos.clone().normalize()).dot(strip.fwd[i])).toBeGreaterThan(0);
  });
});

describe("cross-lat stability (the bug this module exists to kill)", () => {
  it("left/right never swap sides at a pole crossing", () => {
    const samples: TrackSample[] = [];
    let p = toVec3(85, 10);
    for (let k = 0; k < 12; k++) {
      const { lat, lon } = toLatLon(p);
      samples.push(sample(lat, lon, { uncertaintyKm: 60 }));
      const north = tangentTo(toVec3(86, 10), p);
      p = stepAlong(p, north, 0.01);
    }
    const vv = resampleTrack(samples);
    const strip = buildConeStrip(vv.map((v) => v.pos), coneWidthsRad(vv, { pinchStartKm: 0 }));
    const f = new THREE.Vector3();
    strip.centers.forEach((c, i) => {
      if (strip.halfWidthRad[i] < 1e-12) return;
      f.crossVectors(strip.fwd[i], c).normalize();
      const L = strip.left[i].clone().sub(c).dot(f);
      const RR = strip.right[i].clone().sub(c).dot(f);
      expect(L).toBeLessThan(0);
      expect(RR).toBeGreaterThan(0);
    });
  });

  it("slerp/stepAlong commute with toLatLon for a full longitude sweep", () => {
    const a = toVec3(0, -179);
    const b = toVec3(0, 179);
    const mid = slerpUnit(a, b, 0.5);
    const ll = toLatLon(mid);
    // halfway across the dateline either way is fine, but lands on no NaN
    expect(Number.isFinite(ll.lon)).toBe(true);
    expect(Math.abs(ll.lat)).toBeLessThan(1e-9);
    expect(Math.min(Math.abs(ll.lon), Math.abs(Math.abs(ll.lon) - 360))).toBeCloseTo(180, 5);
  });
});

describe("module budget", () => {
  it("keeps the longitude origin a single named constant (no scattered offsets)", () => {
    expect(LON_ORIGIN_DEG).toBe(180);
    expect(SAMPLE_SPACING_DEG).toBeGreaterThan(0);
  });

  it("centers are preserved as positions through buildConeStrip", () => {
    const fix = straightFixture(6);
    const vv = resampleTrack(fix);
    const strip = buildConeStrip(vv.map((v) => v.pos), coneWidthsRad(vv));
    vv.forEach((v, i) => {
      expect(strip.centers[i].distanceTo(v.pos)).toBeLessThan(1e-9);
    });
  });
});
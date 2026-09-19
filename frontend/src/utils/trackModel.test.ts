import { describe, expect, it } from "vitest";
import {
  buildTrackSegments,
  buildUncertaintyCone,
  normalizeTrack,
  splitTrack,
  type TrackInput,
} from "./trackModel";
import { intensityColor } from "./intensity";

const point = (h: number, lat: number, lon: number, extra: Partial<TrackInput> = {}): TrackInput => ({
  horizonHours: h,
  timestamp: `2026-09-02T13:12:00Z`,
  latitude: lat,
  longitude: lon,
  windKt: 60,
  uncertaintyKm: 20,
  isForecast: h > 0,
  ...extra,
});

describe("normalizeTrack", () => {
  it("sorts by horizon ascending regardless of input order", () => {
    const track = normalizeTrack([
      point(12, 17.5, 86.9),
      point(0, 14.82, 86.31),
      point(-6, 14.42, 86.15),
      point(6, 16.05, 86.6),
      point(24, 21.8, 88.1),
    ]);
    expect(track.points.map((p) => p.horizonHours)).toEqual([-6, 0, 6, 12, 24]);
    expect(track.validation.status).toBe("VALID");
  });

  it("drops invalid points and reports them", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31),
      point(6, NaN, 86.6),
      point(12, 99, 86.9),
    ]);
    expect(track.points).toHaveLength(1);
    expect(track.validation.dropped).toBe(2);
    expect(track.validation.status).toBe("WARN");
  });

  it("dedupes identical lat|lon|horizon points", () => {
    const track = normalizeTrack([point(0, 14.82, 86.31), point(0, 14.82, 86.31)]);
    expect(track.points).toHaveLength(1);
    expect(track.validation.duplicates).toBe(1);
  });

  it("flags points that jumped more than ~800 km (lat/lon swap symptom)", () => {
    // Swapped lat↔lon produces an absurd jump; the geometry check must catch it.
    const a = point(0, 14.82, 86.31);
    const b = point(6, 86.31, 14.82);
    const track = normalizeTrack([a, b]);
    expect(track.validation.issues.join(" ")).toMatch(/km/);
    expect(["WARN", "INVALID"]).toContain(track.validation.status);
  });

  it("never mutates the input", () => {
    const input = [point(12, 17.5, 86.9), point(0, 14.82, 86.31)];
    const before = JSON.stringify(input);
    normalizeTrack(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("splitTrack", () => {
  it("splits observed / current / forecast on horizon sign", () => {
    const track = normalizeTrack([
      point(-12, 13.95, 85.95),
      point(-6, 14.42, 86.15),
      point(0, 14.82, 86.31),
      point(6, 16.05, 86.6),
    ]);
    expect(track.observed.map((p) => p.horizonHours)).toEqual([-12, -6]);
    expect(track.current?.horizonHours).toBe(0);
    expect(track.forecast.map((p) => p.horizonHours)).toEqual([6]);
  });

  it("falls back to the last observed point when no 0h position is supplied", () => {
    const { observed, current } = splitTrack([
      point(-6, 14.42, 86.15),
      point(6, 16.05, 86.6),
    ].map((p) => normalizeTrack([p]).points[0]));
    expect(observed).toHaveLength(1);
    expect(current?.horizonHours).toBe(-6);
  });
});

describe("buildTrackSegments", () => {
  it("returns one segment per consecutive pair", () => {
    const track = normalizeTrack([
      point(-6, 14.42, 86.15),
      point(0, 14.82, 86.31),
      point(6, 16.05, 86.6),
      point(12, 17.5, 86.9),
    ]);
    expect(buildTrackSegments(track.points)).toHaveLength(3);
  });

  it("skips zero-length segments (duplicate locations)", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31),
      point(6, 14.82, 86.31),
    ]);
    expect(buildTrackSegments(track.points)).toHaveLength(0);
  });

  it("colours by average IMD intensity of the endpoints", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31, { windKt: 40 }),
      point(6, 16.05, 86.6, { windKt: 60 }),
    ]);
    const [seg] = buildTrackSegments(track.points);
    // avg wind 50 kt → SCS
    expect(seg.color).toBe(intensityColor(50));
    expect(seg.intensity).toBe("SCS");
    expect(seg.isForecast).toBe(true);
  });

  it("exposes a neutral (null) colour when neither endpoint has wind", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31, { windKt: undefined }),
      point(6, 16.05, 86.6, { windKt: undefined }),
    ]);
    const [seg] = buildTrackSegments(track.points);
    expect(seg.color).toBeNull();
  });

  it("same wind speed always yields the same segment colour", () => {
    const a = normalizeTrack([point(0, 10, 80, { windKt: 70 }), point(6, 11, 80, { windKt: 70 })]);
    const b = normalizeTrack([point(0, 30, 100, { windKt: 70 }), point(6, 31, 100, { windKt: 70 })]);
    expect(buildTrackSegments(a.points)[0].color).toBe(buildTrackSegments(b.points)[0].color);
  });
});

describe("buildUncertaintyCone", () => {
  it("returns null without model-supplied sigma (nothing invented)", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31, { uncertaintyKm: undefined }),
      point(6, 16.05, 86.6, { uncertaintyKm: undefined }),
      point(12, 17.5, 86.9, { uncertaintyKm: undefined }),
    ]);
    expect(buildUncertaintyCone([track.current!, ...track.forecast])).toBeNull();
  });

  it("returns null with fewer than 3 sigma-carrying points", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31),
      point(6, 16.05, 86.6),
    ]);
    expect(buildUncertaintyCone([track.current!, ...track.forecast])).toBeNull();
  });

  it("produces a closed ring in [lon, lat] order", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31),
      point(6, 16.05, 86.6),
      point(12, 17.5, 86.9),
    ]);
    const cone = buildUncertaintyCone([track.current!, ...track.forecast]);
    expect(cone).not.toBeNull();
    const ring = cone!.ring;
    expect(ring.length).toBeGreaterThanOrEqual(6);
    expect(ring[0][0]).toBe(ring[ring.length - 1][0]);
    expect(ring[0][1]).toBe(ring[ring.length - 1][1]);
    // ring entries are [lon, lat]
    for (const [lon, lat] of ring) {
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });

  it("uses the supplied sigma as radius (never scales it up)", () => {
    const track = normalizeTrack([
      point(0, 14.82, 86.31, { uncertaintyKm: 10 }),
      point(6, 16.05, 86.6, { uncertaintyKm: 10 }),
      point(12, 17.5, 86.9, { uncertaintyKm: 10 }),
    ]);
    const cone = buildUncertaintyCone([track.current!, ...track.forecast]);
    expect(Math.max(...cone!.radiiKm)).toBeLessThanOrEqual(10);
  });
});
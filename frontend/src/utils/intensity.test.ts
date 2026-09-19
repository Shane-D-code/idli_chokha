import { describe, expect, it } from "vitest";
import {
  INTENSITY_CLASS_LIST,
  INTENSITY_CLASSES,
  intensityClassForWind,
  intensityColor,
} from "./intensity";

describe("intensityClassForWind — IMD grades", () => {
  it("classifies wind speeds at every IMD boundary", () => {
    expect(intensityClassForWind(0)).toBe("D");
    expect(intensityClassForWind(27)).toBe("D");
    expect(intensityClassForWind(28)).toBe("DD");
    expect(intensityClassForWind(33)).toBe("DD");
    expect(intensityClassForWind(34)).toBe("CS");
    expect(intensityClassForWind(47)).toBe("CS");
    expect(intensityClassForWind(48)).toBe("SCS");
    expect(intensityClassForWind(63)).toBe("SCS");
    expect(intensityClassForWind(64)).toBe("VSCS");
    expect(intensityClassForWind(89)).toBe("VSCS");
    expect(intensityClassForWind(90)).toBe("ESCS");
    expect(intensityClassForWind(119)).toBe("ESCS");
    expect(intensityClassForWind(120)).toBe("SUCS");
    expect(intensityClassForWind(1000)).toBe("SUCS");
  });

  it("returns null for missing or non-finite wind (no invented grade)", () => {
    expect(intensityClassForWind(undefined)).toBeNull();
    expect(intensityClassForWind(null)).toBeNull();
    expect(intensityClassForWind(NaN)).toBeNull();
    expect(intensityClassForWind(-5)).toBeNull();
  });

  it("never maps missing wind to a colour", () => {
    expect(intensityColor(undefined)).toBeNull();
    expect(intensityColor(null)).toBeNull();
  });
});

describe("INTENSITY_SCALE — 7 IMD grades, distinct colours", () => {
  it("exposes exactly the 7 IMD grades weakest → strongest", () => {
    expect(INTENSITY_CLASS_LIST.map((c) => c.key)).toEqual([
      "D",
      "DD",
      "CS",
      "SCS",
      "VSCS",
      "ESCS",
      "SUCS",
    ]);
  });

  it("assigns a distinct colour per grade", () => {
    const colours = INTENSITY_CLASS_LIST.map((c) => c.color);
    expect(new Set(colours).size).toBe(7);
  });

  it("classifies mid-grade winds by value, not by identity", () => {
    expect(intensityColor(45)).toBe(INTENSITY_CLASSES.CS.color);
    expect(intensityColor(70)).toBe(INTENSITY_CLASSES.VSCS.color);
    expect(intensityColor(140)).toBe(INTENSITY_CLASSES.SUCS.color);
  });

  it("same wind always maps to the same grade and colour", () => {
    for (const w of [10, 30, 40, 55, 75, 100, 130]) {
      const a = intensityColor(w);
      const b = intensityColor(w);
      expect(a).toBe(b);
      expect(a).not.toBeNull();
    }
  });
});
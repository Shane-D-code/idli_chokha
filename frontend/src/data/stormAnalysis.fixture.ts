// Chapter fixture for the scroll-driven storm story.
//
// SIMULATED. There is no operational StormAnalysis feed yet — the analysis
// layer in `types/stories.ts` is the contract; this object is an explicitly
// labelled fixture so the UI can be built and reviewed. `simulated: true`
// forces the amber badge and the synthetic-imagery captions on every render.

import type { StormAnalysis } from "@/types/stories";

export const STORM_ANALYSIS_FIXTURE: StormAnalysis = {
  stormId: "bob-varun-2026",
  genesisProbability: [
    { horizonHours: 24, probability: 0.24 },
    { horizonHours: 48, probability: 0.61 },
    { horizonHours: 72, probability: 0.84 },
  ],
  environment: [
    { key: "sst", rawValue: 29.8, unit: "°C", favourability: 0.86, delta24h: 0.2, qualitative: "high" },
    { key: "vorticity", rawValue: 6.2, unit: "×10⁻⁵ s⁻¹", favourability: 0.72, delta24h: 1.4, qualitative: "high" },
    { key: "moisture", rawValue: 58, unit: "mm", favourability: 0.68, delta24h: 4, qualitative: "high" },
    { key: "shear", rawValue: 8, unit: "kt", favourability: 0.82, delta24h: 3, qualitative: "low" },
    { key: "tchp", rawValue: 82, unit: "kJ/cm²", favourability: 0.74, delta24h: 6, qualitative: "high" },
    { key: "ohc", rawValue: 71, unit: "kJ/cm²", favourability: 0.55, delta24h: 2, qualitative: "moderate" },
  ],
  rapidIntensification: null,
  landfall: null,
  windRadiiNm: [],
  alerts: [],
  imagery: [
    {
      sensor: "Synthetic",
      channel: "IR · 10.8 µm",
      url: "",
      capturedAt: "11 Sep 2026 12:00 UTC",
      synthetic: true,
    },
  ],
  simulated: true,
};
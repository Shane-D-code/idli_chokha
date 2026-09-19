// Storm analysis types for the scroll-driven story section.
// Extends the existing CycloneState rather than duplicating it.

export type EnvFactorKey = 'sst' | 'vorticity' | 'moisture' | 'shear' | 'tchp' | 'ohc';

export interface EnvFactor {
  key: EnvFactorKey;
  rawValue: number;
  unit: string;
  /** 0..1, higher = more favourable for cyclogenesis. */
  favourability: number;
  delta24h?: number;
  qualitative: 'low' | 'moderate' | 'high';
}

export interface GenesisProbability {
  horizonHours: 24 | 48 | 72;
  probability: number;
}

export interface RapidIntensification {
  active: boolean;
  windChange24hKt: number;
}

export interface LandfallInfo {
  time: string;
  lat: number;
  lon: number;
  windKt: number;
}

export interface WindRadii {
  threshold: 34 | 50 | 64;
  ne: number;
  se: number;
  sw: number;
  nw: number;
}

export interface StoryAlert {
  area: string;
  level: 'watch' | 'warning' | 'severe';
  issuedAt: string;
}

export interface StoryImagery {
  sensor: string;
  channel: string;
  url: string;
  capturedAt: string;
  synthetic: boolean;
}

export interface StormAnalysis {
  stormId: string;
  genesisProbability: GenesisProbability[];
  environment: EnvFactor[];
  rapidIntensification: RapidIntensification | null;
  landfall: LandfallInfo | null;
  windRadiiNm: WindRadii[];
  surgeM?: number;
  rainfallMm?: number;
  alerts: StoryAlert[];
  imagery: StoryImagery[];
  simulated: boolean;
}

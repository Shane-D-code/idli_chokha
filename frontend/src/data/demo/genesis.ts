import type { EnvironmentCondition, GenesisBundle, GenesisPrediction } from '../../types/genesis'
import { VALID_BASE_ISO } from './cyclone'

export const demoGenesisPredictions: GenesisPrediction[] = [
  { horizonHours: 24, probability: 12.8, threshold: 30, category: 'LOW', status: 'simulated' },
  { horizonHours: 48, probability: 24.4, threshold: 30, category: 'LOW', status: 'simulated' },
  { horizonHours: 72, probability: 39.1, threshold: 30, category: 'MODERATE', status: 'simulated' },
]

export const demoEnvironmentConditions: EnvironmentCondition[] = [
  { id: 'sst', variable: 'Sea Surface Temperature', value: 29.4, unit: '°C', favourability: 'favourable', note: '+0.8°C above climatology' },
  { id: 'sst-anom', variable: 'SST Anomaly', value: 0.8, unit: '°C', favourability: 'favourable', note: 'Warm pool extending from Andaman Sea' },
  { id: 'tchp', variable: 'Tropical Cyclone Heat Potential', value: 68, unit: 'kJ/cm²', favourability: 'favourable', note: 'High-energy ocean reservoir' },
  { id: 'ohc', variable: 'Ocean Heat Content', value: 94, unit: 'kJ/cm²', favourability: 'favourable', note: 'Deep 26°C isotherm' },
  { id: 'shear', variable: 'Vertical Wind Shear', value: 8, unit: 'kt', favourability: 'favourable', note: '0–6 km layer, low shear' },
  { id: 'humidity', variable: 'Mid-Level Humidity', value: 62, unit: '%', favourability: 'moderate', note: '700–500 hPa layer' },
  { id: 'vort-l', variable: 'Low-Level Vorticity', value: 4.2, unit: '×10⁻⁵ s⁻¹', favourability: 'favourable', note: 'Strong cyclonic spin near 850 hPa' },
  { id: 'vort-u', variable: 'Upper-Level Vorticity', value: 1.9, unit: '×10⁻⁵ s⁻¹', favourability: 'moderate', note: 'Anticyclonic outflow developing' },
  { id: 'divergence', variable: 'Upper-Level Divergence', value: 6.5, unit: '×10⁻⁶ s⁻¹', favourability: 'favourable', note: '200 hPa outflow' },
]

export const demoGenesis: GenesisBundle = {
  predictions: demoGenesisPredictions,
  conditions: demoEnvironmentConditions,
  status: 'simulated',
  validAt: VALID_BASE_ISO,
  model: 'GENESIS ENSEMBLE (SIMULATED)',
  modelVersion: 'demo',
  calibrated: false,
  threshold: 30,
  risk: 'MODERATE',
}
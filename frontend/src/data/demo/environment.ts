import type { EnvSeries, EnvironmentBundle, EnvironmentMetric } from '../../types/environment'

export const demoEnvironmentMetrics: Omit<EnvironmentBundle, 'charts'> = {
  ocean: [
    { id: 'sst', variable: 'Sea Surface Temperature', value: 29.4, unit: '°C', favourability: 'favourable', note: '+0.8°C above climatology' },
    { id: 'sst-anom', variable: 'SST Anomaly', value: 0.8, unit: '°C', favourability: 'favourable', note: 'Strong warm anomaly' },
    { id: 'tchp', variable: 'Cyclone Heat Potential', value: 68, unit: 'kJ/cm²', favourability: 'favourable', note: 'Deep warm layer' },
    { id: 'ohc', variable: 'Ocean Heat Content', value: 94, unit: 'kJ/cm²', favourability: 'favourable', note: 'Rising over 5 days' },
  ],
  atmosphere: [
    { id: 'shear', variable: 'Vertical Wind Shear', value: 8, unit: 'kt', favourability: 'favourable', note: '0–6 km layer' },
    { id: 'vort-l', variable: 'Low-Level Vorticity', value: 4.2, unit: '×10⁻⁵ s⁻¹', favourability: 'favourable', note: '850 hPa' },
    { id: 'vort-u', variable: 'Upper-Level Vorticity', value: 1.9, unit: '×10⁻⁵ s⁻¹', favourability: 'moderate', note: '200 hPa' },
    { id: 'div', variable: 'Upper-Level Divergence', value: 6.5, unit: '×10⁻⁶ s⁻¹', favourability: 'favourable', note: 'Outflow strengthening' },
  ],
  moisture: [
    { id: 'hum', variable: 'Mid-Level Humidity', value: 62, unit: '%', favourability: 'moderate', note: '700–500 hPa' },
    { id: 'pw', variable: 'Precipitable Water', value: 63, unit: 'mm', favourability: 'favourable', note: 'Moist column' },
  ],
  pressure: [
    { id: 'slp-ambient', variable: 'Ambient Sea-Level Pressure', value: 1006, unit: 'hPa', favourability: 'moderate', note: 'Near the monsoon trough' },
    { id: 'slp-tend', variable: 'Central Pressure Tendency', value: -0.9, unit: 'hPa/3h', favourability: 'favourable', note: 'Deepening' },
  ],
}

function series(label: string, value: number, unit: string, fav: EnvSeries['favourability'], trendLabel: string, seed: number, points: number[], stepH: number, baseT: number): EnvSeries {
  return {
    label,
    value,
    unit,
    favourability: fav,
    trendLabel,
    series: points.map((v, i) => ({
      t: new Date(baseT - (points.length - 1 - i) * stepH * 3600_000).toISOString(),
      v,
    })),
    _seed: seed,
  }
}

const BASE = new Date('2026-09-02T13:12:00Z').getTime()

export const demoEnvCharts: EnvSeries[] = [
  series('Sea Surface Temperature', 29.4, '°C', 'favourable', 'Rising · +0.4°C/12h', 1, [27.9, 28.1, 28.0, 28.3, 28.6, 28.8, 28.9, 29.1, 29.3, 29.4], 6, BASE),
  series('Vertical Wind Shear', 8, 'kt', 'favourable', 'Falling · −1.2 kt/12h', 2, [19, 17, 16, 14, 13, 12, 11, 10, 9, 8], 6, BASE),
  series('Central Sea-Level Pressure', 972, 'hPa', 'favourable', 'Deepening · −3 hPa/12h', 3, [1004, 1001, 999, 995, 990, 986, 981, 977, 974, 972], 6, BASE),
  series('Mid-Level Humidity', 62, '%', 'moderate', 'Steady · +1%/12h', 4, [54, 55, 57, 58, 58, 60, 61, 61, 62, 62], 6, BASE),
  series('Ocean Heat Content', 94, 'kJ/cm²', 'favourable', 'Rising · +2.4/12h', 5, [80, 82, 84, 85, 87, 89, 90, 91, 93, 94], 6, BASE),
]

export { demoEnvCharts as demoEnvironmentCharts }

export type { EnvironmentMetric }
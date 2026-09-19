import { demoForecast, demoForecastTrack, demoLifecycle, demoObservedIntensity } from '../data/demo/forecast'
import type { ForecastBundle, ForecastPoint, IntensityPoint } from '../types/forecast'
import type { ObservedPoint } from '../types/cyclone'

/**
 * Forecast access layer. The SAME bundle object is the single source for the
 * map, globe, timeline, charts, popups and summary — never redefined elsewhere.
 */
export const forecastService = {
  getForecastBundle(): ForecastBundle {
    return demoForecast
  },

  getForecastTrack(): ForecastPoint[] {
    return demoForecastTrack
  },

  getLifecycle(): IntensityPoint[] {
    return demoLifecycle
  },

  getObservedIntensity(): ObservedPoint[] {
    return demoObservedIntensity
  },

  /** Simulated network read for a specific forecast point. */
  async fetchForecastPoint(id: string): Promise<ForecastPoint | null> {
    return demoForecastTrack.find((p) => p.id === id) ?? null
  },

  async fetchForecastBundle(): Promise<ForecastBundle> {
    return demoForecast
  },
}
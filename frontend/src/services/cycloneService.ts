import { demoCyclone } from '../data/demo/cyclone'
import type { Cyclone } from '../types/cyclone'

/**
 * Cyclone data access. Today every function resolves from deterministic demo
 * fixtures with a `simulated` status; when a Toofan backend arrives these are
 * the ONLY functions that need to change — components never swap data sources.
 */
export const cycloneService = {
  /** Synchronous demo snapshot used to seed the app store. */
  getDemoCyclone(): Cyclone {
    return demoCyclone
  },

  /** Simulated network read. Replaces with `fetch('/api/v1/cyclone/active')`. */
  async fetchActiveCyclone(): Promise<Cyclone> {
    return demoCyclone
  },

  async fetchCycloneHistory(cycloneId: string): Promise<Cyclone[]> {
    void cycloneId
    return [demoCyclone]
  },
}
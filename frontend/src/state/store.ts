import { useSyncExternalStore } from 'react'
import { getDemoSnapshot } from '../services/toofanService'
import type { ToofanSnapshot } from '../services/toofanService'
import { checkBackend, runPipeline, subscribePipelineEvents, errText } from '../lib/api'
import { buildLiveSnapshot } from '../lib/liveSnapshot'
import type { HazardLayer } from '../types/hazard'

export type MapLayerId =
  | 'observed'
  | 'forecast'
  | 'cone'
  | 'satellite'
  | 'wind'
  | 'rainfall'
  | 'pressure'
  | 'flood'
  | 'landslide'
  | 'surge'
  | 'districtRisk'

export const ALL_LAYERS: { id: MapLayerId; label: string }[] = [
  { id: 'observed', label: 'Observed Track' },
  { id: 'forecast', label: 'Forecast Track' },
  { id: 'cone', label: 'Forecast Cone' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'wind', label: 'Wind' },
  { id: 'rainfall', label: 'Rainfall' },
  { id: 'pressure', label: 'Pressure' },
  { id: 'flood', label: 'Flood' },
  { id: 'landslide', label: 'Landslide' },
  { id: 'surge', label: 'Storm Surge' },
  { id: 'districtRisk', label: 'District Risk' },
]

export interface PipelineState {
  running: boolean
  stage: string
  message: string
  progressPct: number
  requestId: string | null
  lastError: string | null
}

export interface AppState {
  demoMode: boolean
  backendOnline: boolean
  pipeline: PipelineState
  activeLayer: MapLayerId
  selectedForecastId: string | null
  selectedDistrictId: string | null
  hazardLayer: HazardLayer
  autoRotate: boolean
  data: ToofanSnapshot
}

const snapshot = getDemoSnapshot()

let state: AppState = {
  demoMode: true,
  backendOnline: false,
  pipeline: {
    running: false,
    stage: 'idle',
    message: 'idle',
    progressPct: 0,
    requestId: null,
    lastError: null,
  },
  activeLayer: 'cone',
  selectedForecastId: null,
  selectedDistrictId: snapshot.sign.quickSelectIds[2] ?? null,
  hazardLayer: 'rainfall',
  autoRotate: true,
  data: snapshot,
}

const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React binding with selector — components subscribe to slices only. */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  )
}

function newRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const DEFAULT_RUN = {
  storm_id: 'FANI',
  basin: 'NI',
  reference_time: '2019-04-30T05:00:00Z',
}

export const appActions = {
  selectForecast(id: string | null) {
    setState({ selectedForecastId: id })
  },
  selectDistrict(id: string | null) {
    setState({ selectedDistrictId: id })
  },
  setHazard(layer: HazardLayer) {
    setState({ hazardLayer: layer })
  },
  setActiveLayer(id: MapLayerId) {
    setState({ activeLayer: id })
  },
  setAutoRotate(on: boolean) {
    setState({ autoRotate: on })
  },
  useDemo() {
    setState({
      demoMode: true,
      data: getDemoSnapshot(),
      pipeline: { ...state.pipeline, running: false, lastError: null },
    })
  },
  /** Probe the backend once; leaves the demo seeded as the default UI. */
  async init() {
    const online = await checkBackend()
    setState({ backendOnline: online })
  },
  /**
   * Kick off a real pipeline run. A client-generated request_id is posted with
   * the request so the SSE stream filters to this run from the first frame.
   * On success the live snapshot REPLACES the store data and the UI switches
   * to LIVE mode. On failure the demo data is kept and an error surfaces.
   */
  async runPipeline() {
    if (getState().pipeline.running) return
    const requestId = newRequestId()
    setState({
      backendOnline: true,
      pipeline: {
        running: true,
        stage: 'pipeline_started',
        message: 'starting assessment',
        progressPct: 4,
        requestId,
        lastError: null,
      },
    })

    const unsub = subscribePipelineEvents(requestId, ({ stage, message, progressPct }) => {
      setState({
        pipeline: {
          ...getState().pipeline,
          running: true,
          stage,
          message,
          progressPct,
          lastError: null,
        },
      })
    })

    try {
      const res = await runPipeline(
        { storm_id: DEFAULT_RUN.storm_id, basin: DEFAULT_RUN.basin, reference_time: DEFAULT_RUN.reference_time, mode: 'full' },
        requestId,
      )
      unsub()
      const live = buildLiveSnapshot(res)
      setState({
        backendOnline: true,
        demoMode: false,
        data: live,
        selectedForecastId: null,
        selectedDistrictId: live.sign.quickSelectIds[1] ?? null,
        hazardLayer: 'wind',
        pipeline: {
          running: false,
          stage: res.pipeline_status.toLowerCase(),
          message: `pipeline ${res.pipeline_status.toLowerCase()}`,
          progressPct: 100,
          requestId,
          lastError: null,
        },
      })
    } catch (e) {
      unsub()
      setState({
        backendOnline: false,
        pipeline: {
          running: false,
          stage: 'error',
          message: 'pipeline failed',
          progressPct: 0,
          requestId,
          lastError: errText(e),
        },
      })
    }
  },
}
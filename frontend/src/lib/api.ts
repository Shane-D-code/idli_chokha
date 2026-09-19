import type { PipelineEvent, PipelineRunResult, RunRequest } from '../types/pipeline'

/**
 * Typed client for the TOOFAN backend pipeline API.
 *
 * Base paths always end in `/` — the backend returns 307 for trailing-slash
 * mismatches, and the Vite dev/preview server proxies `/api/v1` to port 8000.
 */

const BASE = '/api/v1'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${res.status} on ${path}${body ? ` — ${body.slice(0, 220)}` : ''}`)
  }
  return (await res.json()) as T
}

export interface HealthResponse {
  status: string
  provider_summary: Record<string, boolean>
}

/** Probe the backend — used to show LIVE vs NOT CONNECTED state. */
export async function checkBackend(): Promise<boolean> {
  try {
    const h = await json<HealthResponse>('/health/')
    return h.status === 'ok'
  } catch {
    return false
  }
}

export async function fetchSources(): Promise<unknown[]> {
  return json<unknown[]>('/data/sources')
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Trigger a full pipeline run. A client-generated 32-char request_id is passed
 * in the body so the SSE event stream can be filtered to this run from the
 * first event. The response is the full evaluation result.
 */
export async function runPipeline(req: RunRequest, requestId: string): Promise<PipelineRunResult> {
  return json<PipelineRunResult>('/pipeline/run', {
    method: 'POST',
    body: JSON.stringify({ ...req, request_id: requestId }),
  })
}

/** Fetch a previously executed assessment by request id. */
export async function fetchAssessment(requestId: string): Promise<PipelineRunResult> {
  return json<PipelineRunResult>(`/assessment/${requestId}`)
}

export interface PipelineProgressEvent {
  stage: string
  message: string
  progressPct: number
}

/** Progress weight by SSE stage — an honest coarse map of the run lifecycle. */
const STAGE_PCT: Record<string, number> = {
  pipeline_started: 8,
  state: 22,
  pipeline: 40,
  genesis_completed: 55,
  cyclone_path_completed: 70,
  hazard_branch_completed: 85,
  pipeline_completed: 100,
  pipeline_degraded: 100,
  pipeline_failed: 100,
}

export function progressOf(ev: Pick<PipelineEvent, 'stage'>): number {
  return STAGE_PCT[ev.stage] ?? 2
}

export function stageMessage(stage: string): string {
  const table: Record<string, string> = {
    pipeline_started: 'assessment started',
    state: 'assembling cyclone state',
    pipeline: 'executing modules',
    genesis_completed: 'genesis model done',
    cyclone_path_completed: 'track & RI done',
    hazard_branch_completed: 'hazard branches done',
    pipeline_completed: 'pipeline complete',
    pipeline_degraded: 'pipeline complete (degraded)',
    pipeline_failed: 'pipeline failed',
  }
  return table[stage] ?? stage
}

/**
 * Subscribe to the global pipeline SSE bus and emit only events belonging to
 * the given run. Returns an unsubscribe function.
 */
export function subscribePipelineEvents(
  requestId: string,
  onEvent: (ev: PipelineProgressEvent) => void,
): () => void {
  const es = new EventSource(`${BASE}/stream/pipeline_events`)
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as PipelineEvent
      if (ev.run_id !== requestId && ev.request_id !== requestId) return
      onEvent({ stage: ev.stage, message: ev.message ?? stageMessage(ev.stage), progressPct: progressOf(ev) })
    } catch {
      /* ignore malformed keep-alive */
    }
  }
  es.onerror = () => {
    /* keep the EventSource open — the client reconnects automatically */
  }
  return () => es.close()
}

export { errText }
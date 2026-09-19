# TOOFAN Real-Time Architecture

The current system is provider-ready and evented; it should not be described as a complete operational real-time deployment for every data source. Some providers are local-file providers, and the U10/V10 wind provider is intentionally absent.

## Run Lifecycle

1. A client submits a `PipelineRunRequest`.
2. `PipelineService.run()` creates or truncates a `run_id` from `request_id` or a generated UUID.
3. The service emits `pipeline_started`.
4. It builds a `CycloneState` through the ingestion/harmonization layer unless a controlled caller injects state directly into the orchestrator.
5. It snapshots configured providers into `provider_sources`.
6. It calls `execute_parallel(...)`.
7. It emits module completion events after DAG settlement.
8. It stores the result by `request_id` and `run_id`.
9. REST clients retrieve the final result; WebSocket/SSE clients receive lifecycle events.

## Events

Pipeline events are dictionaries appended to the in-memory event bus. Implemented event stages include:

| Event Stage | Meaning |
|---|---|
| `pipeline_started` | Run was requested. |
| `state` | Cyclone state assembly started. |
| `pipeline` | Parallel module DAG execution started. |
| `genesis_completed` | Genesis module completed with a status. |
| `cyclone_path_completed` | Trajectory module completed with a status. |
| `hazard_branch_completed` | A non-genesis/non-track hazard branch completed with a status. |
| `pipeline_completed` | Run completed with all per-hazard statuses available. |
| `pipeline_degraded` | Run completed but one or more modules were degraded, baseline, unavailable, or errored. |
| `pipeline_failed` | Fatal service-level failure before a usable graph result. |

The WebSocket endpoint `/api/v1/ws/assessment/{event_id}` sends an `assessment_snapshot` if a matching run is already stored, then streams matching events by `run_id`. `/api/v1/stream/pipeline_events` exposes all event-bus entries as server-sent events.

## Provider Polling and Caching

Providers are fetched once per pipeline run through `PipelineService._snapshot_providers()`. This is a snapshot model, not a background external polling system. A scheduled health audit may periodically collect provider availability when APScheduler is installed, but that audit does not replace per-run provider provenance.

`TTLCache` can be supplied to providers. It is in-memory, keyed by provider name and query, and defaults to 300 seconds. Cache hits preserve provider status and provenance and are copied before being marked as cache hits.

## Stale Data, Retries, and Timeouts

Provider base logic handles:

- timeout wrapping,
- bounded retry with exponential backoff for retryable provider errors,
- immediate `NOT_AVAILABLE` when no source is configured,
- `DEGRADED` for partial or stale data,
- `ERROR` for fetch failures after retry.

Stale observations remain visible through `is_stale` and warnings. Stale data should not be interpreted as fresh `AVAILABLE` data without reading these fields.

## Concurrent Branches

The parallel executor only waits on true dependencies. One failed provider or failed module does not destroy unrelated branches. For example, missing gridded wind data keeps wind unavailable and may make flood unavailable, but RI can still run after genesis because it is unrelated to wind.

## Identifiers and Timestamps

`request_id` is the client-facing identifier when supplied. `run_id` is the service-generated or derived execution id used in lifecycle events. Provider provenance includes `retrieved_at`, optional `observation_timestamp`, `latency_ms`, status, warning details, and source path/dataset.

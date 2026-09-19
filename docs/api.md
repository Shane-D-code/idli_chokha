# TOOFAN FastAPI API

The FastAPI app is defined in `backend/app/main.py`. It mounts both unversioned routers and `/api/v1` aliases. The backend delegates execution to `PipelineService`; endpoints do not run model adapters directly.

## Base Paths

| Scope | Base Path |
|---|---|
| Root | `/` |
| Versioned API | `/api/v1` |
| Health alias | `/api/v1/health` |
| Models alias | `/api/v1/models` |
| Pipeline alias | `/api/v1/pipeline` |
| Data/provider alias | `/api/v1/data` |
| Stream alias | `/api/v1/stream` |

## Endpoints

| Method | Path | Request | Response | Status Codes | Error Cases |
|---|---|---|---|---|---|
| GET | `/` | none | service, version, status | 200 | none expected |
| GET | `/api/v1/health/` | none | health status, provider summary, run counters, health audit data | 200 | dependency failure may surface as 500 |
| GET | `/api/v1/models/` | none | `{ "models": [...] }` from registry with artifact presence | 200 | dependency failure may surface as 500 |
| GET | `/api/v1/data/sources` | none | `{ "sources": ... }` provider availability map | 200 | dependency failure may surface as 500 |
| POST | `/api/v1/pipeline/run` | `PipelineRunRequest` | `PipelineRunResult` | 200, 422, 502 | validation or service exception -> 422; fatal run failure -> 502 |
| POST | `/api/v1/pipeline/validate` | `PipelineRunRequest` | `{ "valid": true, "storm_id": ... }` | 200, 422 | schema validation errors |
| GET | `/api/v1/assessment/{request_id}` | path `request_id` | stored `PipelineRunResult` | 200, 404 | unknown request id |
| GET | `/api/v1/hazards/{hazard}/{request_id}` | hazard slug and request id | request id, pipeline status, hazard status, prediction | 200, 400, 404 | unknown hazard -> 400; missing run or unassessed hazard -> 404 |
| GET | `/api/v1/genesis` | none | genesis module availability and POST hint | 200 | dependency failure may surface as 500 |
| POST | `/api/v1/genesis` | `PipelineRunRequest` | request id, run id, pipeline status, per-hazard status, genesis prediction | 200, 422/502 via service behavior | validation, fatal run failure |
| GET | `/api/v1/cyclone/path` | none | trajectory module availability and POST hint | 200 | dependency failure may surface as 500 |
| POST | `/api/v1/cyclone/path` | `PipelineRunRequest` | request id, run id, pipeline status, per-hazard status, genesis and cyclone path prediction | 200, 422/502 via service behavior | validation, fatal run failure |
| GET | `/api/v1/stream/pipeline_events` | none | server-sent events stream | 200 | client disconnect cancels stream |
| WebSocket | `/api/v1/ws/assessment/{event_id}` | WebSocket connection | optional `assessment_snapshot`, then matching lifecycle events | WebSocket accept/close | disconnect closes normally |

Unversioned equivalents also exist for health, models, pipeline, data, and stream routers: `/health`, `/models`, `/pipeline`, `/data`, and `/stream`.

## Request Schema

`PipelineRunRequest` fields:

```json
{
  "storm_id": "FANI-2019",
  "basin": "BOB",
  "reference_time": "2019-04-30T00:00:00Z",
  "latitude": 12.0,
  "longitude": 88.0,
  "modules": null,
  "mode": "full",
  "request_id": "optional-client-id",
  "max_workers": 4,
  "labels": {}
}
```

`latitude` and `longitude` are optional request fields; state assembly still comes from the backend `CycloneStateBuilder`.

## Hazard Slugs

Accepted hazard slugs include `genesis`, `trajectory`, `cyclone`, `track`, `intensity`, `ri`, `recurvature`, `rain`, `rainfall`, `wind`, `flood`, and `landslide`. Slugs map to `UnifiedForecastState` fields. `rain` maps to `rainfall`, `ri` maps to `rapid_intensification`, and `cyclone`/`track` map to `track`.

## Versioned Aliases

`/api/v1/health`, `/api/v1/models`, `/api/v1/pipeline`, `/api/v1/data`, `/api/v1/stream`, and the assessment router under `/api/v1` are the versioned API surface covered by integration tests.

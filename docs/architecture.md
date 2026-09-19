# TOOFAN Architecture

TOOFAN is a research engineering tropical-cyclone forecasting stack. The backend is the single orchestration boundary: it owns provider access, state assembly, DAG execution, status propagation, hazard aggregation, and API/WebSocket exposure. The React frontend is presentation/demo-first and does not contain ML orchestration logic.

## System Flow

```mermaid
flowchart TD
    P[Real-time data providers<br/>IMD/IBTrACS, ERA5, IMERG, satellite, CMEMS, terrain,<br/>explicit missing U10/V10 provider]
    I[Ingestion layer<br/>src.core.ingestion + src.providers]
    H[Preprocessing / harmonization<br/>CycloneStateBuilder + harmonizer]
    G[Genesis]
    T[Cyclone trajectory]
    INT[Intensity]
    RI[Rapid intensification]
    REC[Recurvature]
    RAIN[Rainfall]
    WIND[Wind]
    FLOOD[Flood]
    LAND[Landslide]
    HE[Hazard engine<br/>final aggregation]
    API[FastAPI backend<br/>PipelineService orchestration boundary]
    REST[REST API]
    WS[WebSocket/SSE event streams]
    UI[Frontend/dashboard<br/>presentation and demo views]

    P --> I --> H --> G --> T
    G --> INT
    G --> RI
    T --> REC
    T --> RAIN
    INT --> RAIN
    T --> WIND
    INT --> WIND
    RAIN --> FLOOD
    WIND --> FLOOD
    RAIN --> LAND
    G --> HE
    T --> HE
    INT --> HE
    RI --> HE
    REC --> HE
    RAIN --> HE
    WIND --> HE
    FLOOD --> HE
    LAND --> HE
    HE --> API
    API --> REST
    API --> WS
    REST --> UI
    WS --> UI
```

## Boundaries

The backend entry point is `backend/app/main.py`. It builds a `PipelineService`, a provider registry, and a `PipelineOrchestrator` from `configs/pipeline.yaml`. Request handlers in `backend/app/routers/*` delegate to that service instead of loading models directly.

`PipelineService.run()` is the production run boundary. It validates `PipelineRunRequest`, builds a `CycloneState`, snapshots providers, executes the DAG through `execute_parallel(...)`, composes per-hazard statuses, stores the run in memory, and emits lifecycle events.

Model adapters live under `src/models/**/adapter.py` and `src/models/adapters/*.py`. They translate `CycloneState` and upstream prediction objects into the legacy model contracts while preserving honest runtime statuses.

The frontend under `frontend/` is intentionally demo-first. It can display API output, mock dashboard data, and status labels, but it does not execute the ML DAG, talk to providers, or fabricate backend predictions.

## Dependency Modes

Synchronous dependencies are enforced by the DAG. Genesis gates trajectory, intensity, and RI. Rainfall and wind require trajectory plus intensity. Flood requires rainfall plus wind. Landslide requires rainfall.

Parallel branches execute concurrently once their dependencies are satisfied. After genesis, trajectory, intensity, and RI are independent. After trajectory and intensity complete, rainfall and wind are independent. Hazard aggregation waits for all requested modules to settle with either success, unavailable, or failure status.

The serial `execute()` path remains a legacy path with intentionally different gating semantics. Production service code uses `execute_parallel(...)`.

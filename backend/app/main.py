"""TOOFAN Backend — FastAPI application.

Thin orchestration boundary: exposes pipeline execution, model catalog, and
provider health over HTTP.  All business logic lives in ``src.*``; this layer
adds no duplicate adapters, orchestrators, or providers.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.core.runtime import configure_runtime
from src.pipeline.service import PipelineService
from src.providers.registry import ProviderRegistry, create_provider_layer
from src.pipeline.orchestrator import create_orchestrator
from src.core.registry import get_registry

# ---------------------------------------------------------------------------
# Shared application state (lifespan-managed, injected via dependencies)
# ---------------------------------------------------------------------------
_config: dict | None = None
_service: PipelineService | None = None
_event_bus: list[dict] = []
_metrics: dict = {
    "runs": 0,
    "errors": 0,
    "run_latencies": [],
    "health_checks": 0,
    "last_health_check": None,
}


def get_service() -> PipelineService:
    assert _service is not None, "PipelineService not initialised"
    return _service


def get_config() -> dict:
    assert _config is not None, "Config not loaded"
    return _config


def get_event_bus() -> list[dict]:
    return _event_bus


def get_metrics() -> dict:
    return _metrics


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _config, _service
    import yaml
    _config = yaml.safe_load(open("configs/pipeline.yaml"))

    configure_runtime()

    orch = create_orchestrator(_config)
    provider_layer = create_provider_layer(_config)
    _service = PipelineService(
        _config, orchestrator=orch, provider_layer=provider_layer,
        event_sink=_event_bus.append,
    )

    # Scheduler: periodic model/provider health audit (every 15 min)
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        _scheduler = AsyncIOScheduler()
        _scheduler.add_job(_run_health_audit, "interval", minutes=15,
                           id="health_audit", kwargs={"service": _service})
        _scheduler.start()
        app.state.scheduler = _scheduler
    except Exception:
        pass  # APScheduler unavailable in test envs

    yield

    scheduler = getattr(app.state, "scheduler", None)
    if scheduler is not None:
        scheduler.shutdown(wait=False)


async def _run_health_audit(service: PipelineService):
    """Background job: snapshot provider health and model artifact presence."""
    t0 = time.time()
    av = service.provider_availability()
    _metrics["health_checks"] += 1
    _metrics["last_health_check"] = time.time()
    _metrics["health_latency_ms"] = (time.time() - t0) * 1000


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="TOOFAN Pipeline API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
from backend.app.routers import health, models, pipeline, providers, realtime, assessment  # noqa: E402
# Unversioned mount (existing clients / tests).
app.include_router(health.router,   prefix="/health",   tags=["health"])
app.include_router(models.router,   prefix="/models",   tags=["models"])
app.include_router(pipeline.router, prefix="/pipeline", tags=["pipeline"])
app.include_router(providers.router, prefix="/data",    tags=["providers"])
app.include_router(realtime.router, prefix="/stream",   tags=["realtime"])
# Versioned mount (spec Phase 18/20 contract: /api/v1/...).
app.include_router(health.router,     prefix="/api/v1/health",   tags=["health"])
app.include_router(models.router,     prefix="/api/v1/models",   tags=["models"])
app.include_router(pipeline.router,   prefix="/api/v1/pipeline", tags=["pipeline"])
app.include_router(providers.router,  prefix="/api/v1/data",     tags=["providers"])
app.include_router(realtime.router,   prefix="/api/v1/stream",   tags=["realtime"])
app.include_router(assessment.router, prefix="/api/v1",          tags=["assessment"])


@app.get("/", tags=["root"])
async def root():
    return {
        "service": "TOOFAN Pipeline API",
        "version": "0.1.0",
        "status": "running",
    }

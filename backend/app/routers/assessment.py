"""Assessment, hazard, genesis and cyclone-path endpoints (spec Phase 18/20).

All run execution is delegated to :class:`PipelineService` — this router adds
no model logic. Runs started here are stored in the service run store and can
be retrieved later via ``GET /api/v1/assessment/{request_id}``.
"""

from __future__ import annotations

import json
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from backend.app.main import get_event_bus, get_service
from src.core.schema import PipelineRunRequest, UnifiedForecastState
from src.pipeline.service import PipelineService

router = APIRouter()

# Hazard slug -> unified-state attribute. The spec uses "rain"; the module name
# is "rainfall". Accept both (and the canonical module names).
_HAZARD_FIELD = {
    "genesis": "genesis",
    "trajectory": "track",
    "cyclone": "track",
    "track": "track",
    "intensity": "intensity",
    "ri": "rapid_intensification",
    "recurvature": "recurvature",
    "rain": "rainfall",
    "rainfall": "rainfall",
    "wind": "wind",
    "flood": "flood",
    "landslide": "landslide",
}


def _nearest_module(hazard: str) -> Optional[str]:
    """Map the hazard slug to the module-level name used for status lookups."""
    if hazard in ("rain",):
        return "rainfall"
    if hazard == "ri":
        return "ri"
    field = _HAZARD_FIELD.get(hazard)
    if field == "rapid_intensification":
        return "ri"
    return field


def _run_for(request_id: str, service: PipelineService):
    result = service.get_run(request_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"assessment {request_id!r} not found")
    return result


def _hazard_outcome(assessment: "UnifiedForecastState | None", hazard: str):
    if assessment is None:
        raise HTTPException(status_code=404, detail="assessment has no state (run failed)")
    field = _HAZARD_FIELD.get(hazard)
    if field is None:
        raise HTTPException(status_code=400, detail=f"unknown hazard {hazard!r}")
    prediction = getattr(assessment, field, None)
    module = _nearest_module(hazard)
    status = assessment.module_status.get(module or "") or "NOT_RUN"
    reason = assessment.module_reasons.get(module or "")
    return prediction, status, reason


@router.get("/assessment/{request_id}", summary="Retrieve a completed assessment")
async def get_assessment(request_id: str,
                         service: PipelineService = Depends(get_service)):
    """Full normalized pipeline result for a previously run request."""
    result = _run_for(request_id, service)
    return result


@router.get("/hazards/{hazard}/{request_id}", summary="Retrieve one hazard result")
async def get_hazard(request_id: str, hazard: str,
                     service: PipelineService = Depends(get_service)):
    """Per-hazard prediction for a run, e.g. ``/hazards/rain/{id}``."""
    result = _run_for(request_id, service)
    prediction, status, reason = _hazard_outcome(result.assessment, hazard)
    if prediction is None:
        detail = f"hazard {hazard!r} not assessed: {reason or status}"
        raise HTTPException(status_code=404, detail=detail)
    return {
        "request_id": result.request_id,
        "pipeline_status": result.pipeline_status,
        "hazard_status": status,
        "prediction": prediction,
    }


@router.get("/genesis", summary="Genesis model availability")
async def genesis_status(service: PipelineService = Depends(get_service)):
    """Availability of the genesis branch (run it with POST /genesis)."""
    return {"module": "genesis", "registered": _available(service, "genesis"),
            "run_with": "POST /api/v1/genesis"}


@router.post("/genesis", summary="Run genesis-only prediction")
async def run_genesis(request: PipelineRunRequest,
                      service: PipelineService = Depends(get_service)):
    """Execute the DAG restricted to genesis and return its prediction."""
    req = request.model_copy(update={"mode": "genesis_only", "modules": ["genesis"]})
    result = service.run(req)
    prediction = getattr(result.assessment, "genesis", None) if result.assessment else None
    return {
        "request_id": result.request_id,
        "run_id": result.run_id,
        "pipeline_status": result.pipeline_status,
        "per_hazard_status": result.per_hazard_status,
        "genesis": prediction,
    }


@router.get("/cyclone/path", summary="Cyclone path model availability")
async def cyclone_path_status(service: PipelineService = Depends(get_service)):
    """Availability of the track branch (run it with POST /cyclone/path)."""
    return {"module": "trajectory", "registered": _available(service, "trajectory"),
            "run_with": "POST /api/v1/cyclone/path"}


@router.post("/cyclone/path", summary="Run genesis + cyclone path prediction")
async def run_cyclone_path(request: PipelineRunRequest,
                           service: PipelineService = Depends(get_service)):
    """Genesis MUST precede cyclone path, so track_only resolves both and the
    response carries genesis inputs alongside the track prediction."""
    req = request.model_copy(update={"mode": "track_only", "modules": ["genesis", "trajectory"]})
    result = service.run(req)
    assessment = result.assessment
    track = getattr(assessment, "track", None) if assessment else None
    genesis = getattr(assessment, "genesis", None) if assessment else None
    return {
        "request_id": result.request_id,
        "run_id": result.run_id,
        "pipeline_status": result.pipeline_status,
        "per_hazard_status": result.per_hazard_status,
        "genesis": genesis,
        "cyclone_path": track,
    }


def _available(service: PipelineService, module: str) -> bool:
    for model in service.list_models():
        if model["name"] == module or model["model_type"] == module:
            return bool(model["artifact_present"])
    return False


@router.websocket("/ws/assessment/{event_id}")
async def ws_assessment(websocket: WebSocket, event_id: str):
    """Live assessment events for a run.

    Streams pipeline lifecycle events (``pipeline_started``,
    ``genesis_completed``, ``cyclone_path_completed``,
    ``hazard_branch_completed``, ``pipeline_completed`` /
    ``pipeline_degraded`` / ``pipeline_failed``) whose ``run_id`` matches the
    requested event id, plus any requested assessment snapshot at connect time.
    """
    await websocket.accept()
    service = get_service()
    snapshot = service.get_run(event_id)
    if snapshot is not None:
        await websocket.send_text(json.dumps({
            "kind": "assessment_snapshot",
            "event_id": event_id,
            "run_id": snapshot.run_id,
            "pipeline_status": snapshot.pipeline_status,
            "per_hazard_status": snapshot.per_hazard_status,
            "timestamp": time.time(),
        }))

    last_index = 0
    try:
        while True:
            bus = get_event_bus()
            for event in bus[last_index:]:
                if event.get("run_id") == event_id or event.get("data", {}).get("run_id") == event_id:
                    await websocket.send_text(json.dumps(event))
            last_index = len(bus)
            await _sleep(0.5)
    except WebSocketDisconnect:
        return


async def _sleep(seconds: float):
    import asyncio
    await asyncio.sleep(seconds)
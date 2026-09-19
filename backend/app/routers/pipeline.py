from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException

from backend.app.main import get_service, get_metrics
from src.core.schema import PipelineRunRequest, PipelineRunResult
from src.pipeline.service import PipelineService

router = APIRouter()


@router.post("/run", response_model=PipelineRunResult,
             summary="Run the full DAG for a storm")
async def run_pipeline(request: PipelineRunRequest,
                       service: PipelineService = Depends(get_service)):
    """Execute the pipeline DAG in parallel waves and return the result
    envelope (per-hazard status, providers, latency). No fabricated inputs."""
    metrics = get_metrics()
    t0 = time.time()
    try:
        result = service.run(request)
    except Exception as e:  # pydantic validation already done by FastAPI
        metrics["errors"] += 1
        raise HTTPException(status_code=422, detail=str(e))
    metrics["runs"] += 1
    metrics["run_latencies"].append((time.time() - t0) * 1000)
    if result.pipeline_status == "FAILED":
        raise HTTPException(
            status_code=502,
            detail={
                "pipeline_status": result.pipeline_status,
                "warnings": result.warnings,
            },
        )
    return result


@router.post("/validate")
async def validate_request(request: PipelineRunRequest,
                           service: PipelineService = Depends(get_service)):
    """Validate a request body without executing the DAG."""
    return {"valid": True, "storm_id": request.storm_id}
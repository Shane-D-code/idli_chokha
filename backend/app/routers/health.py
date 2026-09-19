from backend.app.main import get_service, get_metrics
from fastapi import APIRouter, Depends
from src.pipeline.service import PipelineService

router = APIRouter()


@router.get("/")
async def health_check(service: PipelineService = Depends(get_service)):
    metrics = get_metrics()
    av = service.provider_availability()
    healthy = all(
        (v.get("available") or v.get("status") not in ("ERROR",))
        for v in av.values()
    ) if av else True
    return {
        "status": "healthy" if healthy else "degraded",
        "provider_summary": {k: v.get("available", False) for k, v in av.items()},
        "runs_completed": metrics["runs"],
        "last_health_audit": metrics["last_health_check"],
        "health_audit_count": metrics["health_checks"],
    }

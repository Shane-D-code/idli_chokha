from backend.app.main import get_service
from fastapi import APIRouter, Depends
from src.pipeline.service import PipelineService

router = APIRouter()


@router.get("/")
async def list_models(service: PipelineService = Depends(get_service)):
    """Registered model artifacts with runtime artifact presence."""
    return {"models": service.list_models()}
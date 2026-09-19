from backend.app.main import get_service
from fastapi import APIRouter, Depends
from src.pipeline.service import PipelineService

router = APIRouter()


@router.get("/sources")
async def data_sources(service: PipelineService = Depends(get_service)):
    """Real-time provider availability snapshot."""
    return {"sources": service.provider_availability()}
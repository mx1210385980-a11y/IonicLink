from fastapi import APIRouter

from services.agent_runtime_service import get_agent_runtime
from services.usage_metrics_service import get_usage_metrics_service


router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("/status")
async def get_agent_status():
    return get_agent_runtime().agent_status()


@router.get("/usage")
async def get_usage_metrics():
    return get_usage_metrics_service().snapshot()

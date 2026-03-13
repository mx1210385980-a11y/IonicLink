from fastapi import APIRouter, Depends

from security import AuthPrincipal, get_current_principal
from services.agent_runtime_service import get_agent_runtime
from services.usage_metrics_service import get_usage_metrics_service


router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("/status")
async def get_agent_status(_principal: AuthPrincipal = Depends(get_current_principal)):
    return get_agent_runtime().agent_status()


@router.get("/usage")
async def get_usage_metrics(_principal: AuthPrincipal = Depends(get_current_principal)):
    return get_usage_metrics_service().snapshot()

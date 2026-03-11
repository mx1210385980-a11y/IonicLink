from fastapi import APIRouter

from services.agent_runtime_service import get_agent_runtime


router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("/status")
async def get_agent_status():
    return get_agent_runtime().agent_status()

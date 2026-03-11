from __future__ import annotations

from functools import lru_cache
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agents.contracts import AgentTask
from agents.bus import InMemoryAgentBus
from agents.insight_agent import InsightAgent
from agents.media_agent import MediaAgent
from agents.moderator_agent import ModeratorAgent
from agents.query_agent import QueryAgent
from agents.registry import AgentRegistry
from services.media_workflow_service import MediaWorkflowService


class AgentRuntimeService:
    def __init__(self):
        self.registry = AgentRegistry()
        self.bus = InMemoryAgentBus(self.registry)
        self._media_workflow = MediaWorkflowService()

        self.registry.register(QueryAgent())
        self.registry.register(MediaAgent(self._media_workflow))
        self.registry.register(InsightAgent())
        self.registry.register(ModeratorAgent(self.bus))

    async def run_extraction_workflow(
        self,
        *,
        file_id: int,
        force: bool = False,
        profile: str = "high_accuracy",
        strict_cof_mode: bool | None = None,
    ) -> dict[str, Any]:
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_extraction",
                payload={
                    "file_id": file_id,
                    "force": force,
                    "profile": profile,
                    "strict_cof_mode": strict_cof_mode,
                },
            )
        )
        return result.data or {}

    async def search_records(
        self,
        *,
        session: AsyncSession,
        filter_params: Any,
        skip: int = 0,
        limit: int = 20,
    ) -> dict[str, Any]:
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_search",
                payload={
                    "session": session,
                    "filter_params": filter_params,
                    "skip": skip,
                    "limit": limit,
                },
            )
        )
        return result.data or {}

    async def get_filter_options(self, *, session: AsyncSession) -> dict[str, Any]:
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_filter_options",
                payload={"session": session},
            )
        )
        return result.data or {}

    async def reprocess_literature(
        self,
        *,
        literature_id: int,
        db: AsyncSession,
        file_content: str | None = None,
    ) -> dict[str, Any]:
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_reprocess",
                payload={
                    "literature_id": literature_id,
                    "db": db,
                    "file_content": file_content,
                },
            )
        )
        return result.data or {}

    async def get_stats(self, *, session: AsyncSession) -> dict[str, Any]:
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_stats",
                payload={"session": session},
            )
        )
        return result.data or {}

    def agent_status(self) -> dict[str, Any]:
        return {
            "agents": self.registry.statuses(),
            "recent_messages": self.bus.get_history(),
        }


@lru_cache(maxsize=1)
def get_agent_runtime() -> AgentRuntimeService:
    return AgentRuntimeService()

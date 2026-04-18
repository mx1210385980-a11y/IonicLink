from __future__ import annotations

import logging
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
from services.usage_metrics_service import get_usage_metrics_service

logger = logging.getLogger(__name__)


class AgentRuntimeService:
    def __init__(self):
        self.registry = AgentRegistry()
        self.bus = InMemoryAgentBus(self.registry)
        self._media_workflow = MediaWorkflowService()
        self._usage_metrics = get_usage_metrics_service()

        self.registry.register(QueryAgent())
        self.registry.register(MediaAgent(self._media_workflow))
        self.registry.register(InsightAgent())
        self.registry.register(ModeratorAgent(self.bus))
        logger.info("Agent runtime initialized with %s agents", len(self.registry.statuses()))

    async def run_extraction_workflow(
        self,
        *,
        file_id: int,
        force: bool = False,
        profile: str = "high_accuracy",
        extractor_type: str = "tribology",
        strict_cof_mode: bool | None = None,
    ) -> dict[str, Any]:
        logger.info(
            "Starting extraction workflow for literature_id=%s force=%s profile=%s extractor_type=%s",
            file_id,
            force,
            profile,
            extractor_type,
        )
        self._usage_metrics.record_api_call(endpoint="/api/extract/{file_id}")
        self._usage_metrics.record_agent_call(
            receiver="moderator",
            task_type="orchestrate_extraction",
            sender="runtime",
            via="runtime.direct",
        )
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_extraction",
                payload={
                    "file_id": file_id,
                    "force": force,
                    "profile": profile,
                    "extractor_type": extractor_type,
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
        scope_filter_values: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        logger.info(
            "Searching records skip=%s limit=%s scope=%s",
            skip,
            limit,
            scope_filter_values,
        )
        self._usage_metrics.record_api_call(endpoint="/api/records/search")
        self._usage_metrics.record_agent_call(
            receiver="moderator",
            task_type="orchestrate_search",
            sender="runtime",
            via="runtime.direct",
        )
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_search",
                payload={
                    "session": session,
                    "filter_params": filter_params,
                    "skip": skip,
                    "limit": limit,
                    "scope_filter_values": scope_filter_values,
                },
            )
        )
        return result.data or {}

    async def get_filter_options(
        self,
        *,
        session: AsyncSession,
        scope_filter_values: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        logger.debug("Loading filter options for scope=%s", scope_filter_values)
        self._usage_metrics.record_api_call(endpoint="/api/records/options")
        self._usage_metrics.record_agent_call(
            receiver="moderator",
            task_type="orchestrate_filter_options",
            sender="runtime",
            via="runtime.direct",
        )
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_filter_options",
                payload={"session": session, "scope_filter_values": scope_filter_values},
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
        logger.info("Starting reprocess workflow for literature_id=%s", literature_id)
        self._usage_metrics.record_api_call(endpoint="/api/sync/literature/{literature_id}/reprocess")
        self._usage_metrics.record_agent_call(
            receiver="moderator",
            task_type="orchestrate_reprocess",
            sender="runtime",
            via="runtime.direct",
        )
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

    async def get_stats(
        self,
        *,
        session: AsyncSession,
        scope_filter_values: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        logger.debug("Loading stats for scope=%s", scope_filter_values)
        self._usage_metrics.record_api_call(endpoint="/api/records/stats")
        self._usage_metrics.record_agent_call(
            receiver="moderator",
            task_type="orchestrate_stats",
            sender="runtime",
            via="runtime.direct",
        )
        result = await self.registry.get("moderator").handle_task(
            AgentTask(
                task_type="orchestrate_stats",
                payload={"session": session, "scope_filter_values": scope_filter_values},
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

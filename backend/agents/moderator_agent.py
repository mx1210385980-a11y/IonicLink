from __future__ import annotations

from .base import BaseAgent
from .bus import InMemoryAgentBus
from .contracts import AgentExecutionResult, AgentTask


class ModeratorAgent(BaseAgent):
    def __init__(self, bus: InMemoryAgentBus):
        super().__init__(
            name="moderator",
            capabilities=["workflow_orchestration", "agent_coordination"],
        )
        self._bus = bus

    async def execute_task(self, task: AgentTask) -> AgentExecutionResult:
        if task.task_type == "orchestrate_extraction":
            media_result = await self._bus.request(
                sender=self.name,
                receiver="media",
                task_type="extract_document",
                payload=task.payload,
                task_id=task.task_id,
            )
            media_payload = media_result.data or {}
            extraction_summary = media_payload.get("extraction_summary") or {}

            if (extraction_summary.get("dropped_by_reason") or {}).get("in_progress"):
                return AgentExecutionResult(
                    agent=self.name,
                    task_id=task.task_id,
                    status="processing",
                    data={
                        **media_payload,
                        "agent_workflow": {
                            "messages": self._bus.get_history(task.task_id),
                        },
                    },
                )

            validation_result = await self._bus.request(
                sender=self.name,
                receiver="query",
                task_type="validate_extraction",
                payload={
                    "records": media_payload.get("data") or [],
                    "extraction_summary": extraction_summary,
                    "extractor_type": media_payload.get("extractor_type") or task.payload.get("extractor_type") or "tribology",
                },
                task_id=task.task_id,
            )
            insight_result = await self._bus.request(
                sender=self.name,
                receiver="insight",
                task_type="summarize_extraction",
                payload={
                    "metadata": media_payload.get("metadata") or {},
                    "records": media_payload.get("data") or [],
                    "validation": validation_result.data or {},
                    "extractor_type": media_payload.get("extractor_type") or task.payload.get("extractor_type") or "tribology",
                },
                task_id=task.task_id,
            )

            return AgentExecutionResult(
                agent=self.name,
                task_id=task.task_id,
                data={
                    **media_payload,
                    "agent_workflow": {
                        "validation": validation_result.data,
                        "insight": insight_result.data,
                        "messages": self._bus.get_history(task.task_id),
                    },
                },
            )

        if task.task_type == "orchestrate_search":
            result = await self._bus.request(
                sender=self.name,
                receiver="query",
                task_type="search_records",
                payload=task.payload,
                task_id=task.task_id,
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result.data)

        if task.task_type == "orchestrate_reprocess":
            result = await self._bus.request(
                sender=self.name,
                receiver="media",
                task_type="reprocess_document",
                payload=task.payload,
                task_id=task.task_id,
            )
            return AgentExecutionResult(
                agent=self.name,
                task_id=task.task_id,
                data={
                    **(result.data or {}),
                    "agent_workflow": {
                        "messages": self._bus.get_history(task.task_id),
                    },
                },
            )

        if task.task_type == "orchestrate_filter_options":
            result = await self._bus.request(
                sender=self.name,
                receiver="query",
                task_type="get_filter_options",
                payload=task.payload,
                task_id=task.task_id,
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result.data)

        if task.task_type == "orchestrate_stats":
            result = await self._bus.request(
                sender=self.name,
                receiver="insight",
                task_type="get_stats",
                payload=task.payload,
                task_id=task.task_id,
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result.data)

        raise ValueError(f"Unsupported moderator task '{task.task_type}'")

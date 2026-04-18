from __future__ import annotations

from .base import BaseAgent
from .contracts import AgentExecutionResult, AgentTask
from services import insight_service


class InsightAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="insight",
            capabilities=["dashboard_stats", "extraction_summary"],
        )

    async def execute_task(self, task: AgentTask) -> AgentExecutionResult:
        if task.task_type == "get_stats":
            session = task.payload["session"]
            result = await insight_service.get_stats(
                session,
                scope_filter_values=task.payload.get("scope_filter_values"),
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        if task.task_type == "summarize_extraction":
            result = insight_service.summarize_extraction(
                metadata=task.payload.get("metadata") or {},
                records=task.payload.get("records") or [],
                validation=task.payload.get("validation") or {},
                extractor_type=task.payload.get("extractor_type") or "tribology",
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        raise ValueError(f"Unsupported insight task '{task.task_type}'")

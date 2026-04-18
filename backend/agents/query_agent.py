from __future__ import annotations

from .base import BaseAgent
from .contracts import AgentExecutionResult, AgentTask
from services import query_service


class QueryAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="query",
            capabilities=["record_search", "filter_options", "extraction_validation"],
        )

    async def execute_task(self, task: AgentTask) -> AgentExecutionResult:
        if task.task_type == "search_records":
            session = task.payload["session"]
            result = await query_service.search_records(
                session=session,
                filter_params=task.payload["filter_params"],
                skip=task.payload.get("skip", 0),
                limit=task.payload.get("limit", 20),
                scope_filter_values=task.payload.get("scope_filter_values"),
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        if task.task_type == "get_filter_options":
            session = task.payload["session"]
            result = await query_service.get_filter_options(
                session,
                scope_filter_values=task.payload.get("scope_filter_values"),
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        if task.task_type == "validate_extraction":
            result = query_service.validate_extraction_result(
                records=task.payload.get("records") or [],
                extraction_summary=task.payload.get("extraction_summary") or {},
                extractor_type=task.payload.get("extractor_type") or "tribology",
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        raise ValueError(f"Unsupported query task '{task.task_type}'")

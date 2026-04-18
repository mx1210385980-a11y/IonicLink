from __future__ import annotations

from .base import BaseAgent
from .contracts import AgentExecutionResult, AgentTask
from services.media_workflow_service import MediaWorkflowService


class MediaAgent(BaseAgent):
    def __init__(self, workflow_service: MediaWorkflowService):
        super().__init__(
            name="media",
            capabilities=["document_extraction", "document_reprocessing"],
        )
        self._workflow_service = workflow_service

    async def execute_task(self, task: AgentTask) -> AgentExecutionResult:
        if task.task_type == "extract_document":
            result = await self._workflow_service.extract_document(
                file_id=task.payload["file_id"],
                force=task.payload.get("force", False),
                profile=task.payload.get("profile", "high_accuracy"),
                extractor_type=task.payload.get("extractor_type", "tribology"),
                strict_cof_mode=task.payload.get("strict_cof_mode"),
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        if task.task_type == "reprocess_document":
            result = await self._workflow_service.reprocess_document(
                literature_id=task.payload["literature_id"],
                db=task.payload["db"],
                file_content=task.payload.get("file_content"),
            )
            return AgentExecutionResult(agent=self.name, task_id=task.task_id, data=result)

        raise ValueError(f"Unsupported media task '{task.task_type}'")

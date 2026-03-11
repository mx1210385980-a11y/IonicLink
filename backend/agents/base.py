from __future__ import annotations

from abc import ABC, abstractmethod
from time import perf_counter
from typing import Any

from .contracts import AgentExecutionResult, AgentTask


class BaseAgent(ABC):
    def __init__(self, name: str, capabilities: list[str] | None = None):
        self.name = name
        self.capabilities = capabilities or []
        self._handled_tasks = 0
        self._last_task_type: str | None = None
        self._last_task_at: str | None = None

    async def handle_task(self, task: AgentTask) -> AgentExecutionResult:
        started = perf_counter()
        result = await self.execute_task(task)
        result.agent = self.name
        result.task_id = task.task_id
        result.metrics.setdefault("duration_ms", round((perf_counter() - started) * 1000.0, 2))

        self._handled_tasks += 1
        self._last_task_type = task.task_type
        self._last_task_at = task.context.get("started_at")
        return result

    @abstractmethod
    async def execute_task(self, task: AgentTask) -> AgentExecutionResult:
        raise NotImplementedError

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "capabilities": list(self.capabilities),
            "handled_tasks": self._handled_tasks,
            "last_task_type": self._last_task_type,
            "last_task_at": self._last_task_at,
        }

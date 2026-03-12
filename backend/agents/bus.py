from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any

from .contracts import AgentExecutionResult, AgentMessage, AgentTask
from .registry import AgentRegistry
from services.usage_metrics_service import get_usage_metrics_service


class InMemoryAgentBus:
    def __init__(self, registry: AgentRegistry, history_limit: int = 200):
        self._registry = registry
        self._history: deque[AgentMessage] = deque(maxlen=history_limit)
        self._usage_metrics = get_usage_metrics_service()

    async def request(
        self,
        *,
        sender: str,
        receiver: str,
        task_type: str,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
        task_id: str | None = None,
    ) -> AgentExecutionResult:
        started_at = datetime.now(timezone.utc).isoformat()
        task = AgentTask(
            task_type=task_type,
            payload=payload or {},
            context={**(context or {}), "started_at": started_at},
            task_id=task_id or AgentTask(task_type=task_type).task_id,
        )
        self._usage_metrics.record_agent_call(
            receiver=receiver,
            task_type=task_type,
            sender=sender,
            via="agent_bus.request",
        )
        self._history.append(
            AgentMessage(
                sender=sender,
                receiver=receiver,
                task_id=task.task_id,
                message_type=task_type,
                payload=task.payload,
            )
        )

        result = await self._registry.get(receiver).handle_task(task)
        self._history.append(
            AgentMessage(
                sender=receiver,
                receiver=sender,
                task_id=task.task_id,
                message_type=f"{task_type}.completed",
                payload={"status": result.status, "metrics": result.metrics},
            )
        )
        return result

    def get_history(self, task_id: str | None = None) -> list[dict[str, Any]]:
        items = list(self._history)
        if task_id:
            items = [message for message in items if message.task_id == task_id]
        return [
            {
                "sender": message.sender,
                "receiver": message.receiver,
                "task_id": message.task_id,
                "message_type": message.message_type,
                "payload": message.payload,
                "timestamp": message.timestamp.isoformat(),
            }
            for message in items
        ]

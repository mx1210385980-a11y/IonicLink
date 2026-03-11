from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _task_id() -> str:
    return uuid4().hex


@dataclass(slots=True)
class AgentTask:
    task_type: str
    payload: dict[str, Any] = field(default_factory=dict)
    context: dict[str, Any] = field(default_factory=dict)
    task_id: str = field(default_factory=_task_id)


@dataclass(slots=True)
class AgentMessage:
    sender: str
    receiver: str
    task_id: str
    message_type: str
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=_utcnow)


@dataclass(slots=True)
class AgentExecutionResult:
    agent: str
    task_id: str
    status: str = "completed"
    data: Any = None
    metrics: dict[str, Any] = field(default_factory=dict)

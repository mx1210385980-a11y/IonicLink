from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timezone
from functools import lru_cache
from threading import Lock
from typing import Any


class UsageMetricsService:
    """In-memory runtime metrics for user behavior analytics."""

    def __init__(self, history_limit: int = 300):
        self._lock = Lock()
        self._started_at = datetime.now(timezone.utc)
        self._recent_events: deque[dict[str, Any]] = deque(maxlen=history_limit)

        self._totals = Counter()
        self._agent_calls_by_receiver = Counter()
        self._agent_calls_by_task = Counter()
        self._db_queries_by_operation = Counter()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _append_event(self, *, category: str, action: str, detail: dict[str, Any] | None = None):
        self._recent_events.append(
            {
                "timestamp": self._now_iso(),
                "category": category,
                "action": action,
                "detail": detail or {},
            }
        )

    def record_agent_call(
        self,
        *,
        receiver: str,
        task_type: str,
        sender: str | None = None,
        via: str | None = None,
    ):
        receiver_name = str(receiver or "unknown").strip() or "unknown"
        task_name = str(task_type or "unknown").strip() or "unknown"
        sender_name = str(sender or "").strip() or None
        via_name = str(via or "").strip() or None

        with self._lock:
            self._totals["agent_calls"] += 1
            self._agent_calls_by_receiver[receiver_name] += 1
            self._agent_calls_by_task[task_name] += 1
            self._append_event(
                category="agent",
                action=task_name,
                detail={
                    "receiver": receiver_name,
                    "sender": sender_name,
                    "via": via_name,
                },
            )

    def record_db_query(self, *, operation: str, count: int = 1):
        op = str(operation or "unknown").strip() or "unknown"
        safe_count = max(1, int(count or 1))

        with self._lock:
            self._totals["db_queries"] += safe_count
            self._db_queries_by_operation[op] += safe_count
            self._append_event(
                category="database",
                action=op,
                detail={"count": safe_count},
            )

    def record_api_call(self, *, endpoint: str):
        ep = str(endpoint or "unknown").strip() or "unknown"
        with self._lock:
            self._totals["api_calls"] += 1
            self._append_event(category="api", action=ep)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            uptime_seconds = round((datetime.now(timezone.utc) - self._started_at).total_seconds(), 1)
            return {
                "started_at": self._started_at.isoformat(),
                "uptime_seconds": uptime_seconds,
                "totals": {
                    "agent_calls": int(self._totals.get("agent_calls", 0)),
                    "db_queries": int(self._totals.get("db_queries", 0)),
                    "api_calls": int(self._totals.get("api_calls", 0)),
                },
                "agent_calls_by_receiver": {k: int(v) for k, v in self._agent_calls_by_receiver.items()},
                "agent_calls_by_task": {k: int(v) for k, v in self._agent_calls_by_task.items()},
                "db_queries_by_operation": {k: int(v) for k, v in self._db_queries_by_operation.items()},
                "recent_events": list(self._recent_events),
            }


@lru_cache(maxsize=1)
def get_usage_metrics_service() -> UsageMetricsService:
    return UsageMetricsService()

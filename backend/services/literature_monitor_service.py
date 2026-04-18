from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _utc_now().isoformat()


def _parse_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _safe_read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return deepcopy(default)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return deepcopy(default)


class LiteratureMonitorService:
    def __init__(self) -> None:
        backend_dir = Path(__file__).resolve().parent.parent
        data_dir = backend_dir / "data"
        self._state_path = data_dir / "literature_monitor_state.json"
        self._queue_path = data_dir / "literature_monitor_proxy_queue.json"
        self._storage_dir = data_dir / "literature_monitor_pdfs"
        self._lock = asyncio.Lock()
        self._started = False
        self._state = self._load_state()

    async def start(self) -> None:
        async with self._lock:
            self._state = self._load_state()
            scheduler = self._state.setdefault("scheduler", {})
            scheduler.setdefault("status", "idle")
            scheduler.setdefault("running_trigger", None)
            scheduler.setdefault("last_error", None)
            self._ensure_scheduler_defaults()
            self._started = True

    async def stop(self) -> None:
        async with self._lock:
            scheduler = self._state.setdefault("scheduler", {})
            scheduler["running_trigger"] = None
            if scheduler.get("status") == "running":
                scheduler["status"] = "idle"
            self._persist_state()
            self._started = False

    async def get_snapshot(self) -> dict[str, Any]:
        async with self._lock:
            self._state = self._load_state()
            return self._build_snapshot()

    async def update_config(self, updates: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            self._state = self._load_state()
            config = self._state.setdefault("config", {})

            if "keywords" in updates:
                config["keywords"] = [str(item).strip() for item in updates["keywords"] if str(item).strip()]

            if "lookback_days" in updates and updates["lookback_days"] is not None:
                config["lookback_days"] = int(updates["lookback_days"])

            if "relevance_threshold" in updates and updates["relevance_threshold"] is not None:
                config["relevance_threshold"] = int(updates["relevance_threshold"])

            if "schedule" in updates and isinstance(updates["schedule"], dict):
                schedule = config.setdefault("schedule", {})
                schedule.update({
                    key: value
                    for key, value in updates["schedule"].items()
                    if value is not None
                })

            if "pdf_download" in updates and isinstance(updates["pdf_download"], dict):
                pdf_download = config.setdefault("pdf_download", {})
                pdf_download.update({
                    key: value
                    for key, value in updates["pdf_download"].items()
                    if value is not None
                })

            if "campus_proxy" in updates and isinstance(updates["campus_proxy"], dict):
                campus_proxy_updates = dict(updates["campus_proxy"])
                campus_proxy = config.setdefault("campus_proxy", {})
                if campus_proxy_updates.pop("clear_password", False):
                    campus_proxy["password"] = ""
                password = campus_proxy_updates.pop("password", None)
                campus_proxy.update({
                    key: value
                    for key, value in campus_proxy_updates.items()
                    if value is not None
                })
                if password is not None:
                    campus_proxy["password"] = password

            sources = config.setdefault("sources", {})
            rss_source = sources.setdefault("rss", {
                "id": "rss",
                "label": "Journal RSS Feeds",
                "kind": "rss",
                "enabled": True,
                "feeds": [],
            })

            source_flag_map = {
                "crossref_enabled": "crossref",
                "openalex_enabled": "openalex",
                "semantic_scholar_enabled": "semantic_scholar",
                "rss_enabled": "rss",
            }
            for update_key, source_key in source_flag_map.items():
                if update_key in updates:
                    source = sources.setdefault(source_key, {
                        "id": source_key,
                        "label": source_key.replace("_", " ").title(),
                        "kind": "rss" if source_key == "rss" else "api",
                        "enabled": False,
                    })
                    source["enabled"] = bool(updates[update_key])

            if "rss_feeds" in updates:
                rss_source["feeds"] = [str(item).strip() for item in updates["rss_feeds"] if str(item).strip()]

            scheduler = self._state.setdefault("scheduler", {})
            scheduler["next_run_at"] = self._compute_next_run_at(config.get("schedule", {}))

            self._persist_state()
            return self._build_snapshot()

    async def run_monitoring(self, trigger: str = "manual") -> dict[str, Any]:
        async with self._lock:
            self._state = self._load_state()
            scheduler = self._state.setdefault("scheduler", {})
            scheduler["status"] = "running"
            scheduler["running_trigger"] = trigger
            scheduler["last_error"] = None
            started_at = _iso_now()

            try:
                items = self._state.get("items", [])
                now = _utc_now()
                new_items = 0
                for item in items:
                    discovered_at = _parse_datetime(item.get("discovered_at"))
                    if discovered_at and (now - discovered_at) <= timedelta(days=7):
                        new_items += 1

                completed_at = _iso_now()
                run_record = {
                    "started_at": started_at,
                    "completed_at": completed_at,
                    "status": "completed",
                    "trigger": trigger,
                    "new_items": new_items,
                    "total_items": len(items),
                    "errors": [],
                }
                recent_runs = self._state.setdefault("recent_runs", [])
                recent_runs.insert(0, run_record)
                del recent_runs[10:]
                self._state["last_run"] = run_record
                scheduler["status"] = "idle"
                scheduler["running_trigger"] = None
                scheduler["last_triggered_slot"] = started_at
                scheduler["next_run_at"] = self._compute_next_run_at(self._state.get("config", {}).get("schedule", {}))
                self._persist_state()
            except Exception as exc:
                scheduler["status"] = "idle"
                scheduler["running_trigger"] = None
                scheduler["last_error"] = str(exc)
                self._persist_state()
                raise

            return self._build_snapshot()

    def _load_state(self) -> dict[str, Any]:
        default_state = {
            "config": {},
            "sources": {},
            "items": [],
            "last_run": None,
            "recent_runs": [],
            "scheduler": {
                "status": "idle",
                "next_run_at": None,
                "last_triggered_slot": None,
                "last_error": None,
                "running_trigger": None,
            },
        }
        state = _safe_read_json(self._state_path, default_state)
        state.setdefault("config", {})
        state.setdefault("sources", {})
        state.setdefault("items", [])
        state.setdefault("recent_runs", [])
        state.setdefault("scheduler", default_state["scheduler"].copy())
        self._ensure_state_defaults(state)
        return state

    def _ensure_state_defaults(self, state: dict[str, Any]) -> None:
        config = state.setdefault("config", {})
        config.setdefault("keywords", [])
        config.setdefault("lookback_days", 365)
        config.setdefault("relevance_threshold", 8)
        config.setdefault("schedule", {
            "weekday": 0,
            "hour": 0,
            "minute": 0,
            "timezone": "Asia/Shanghai",
        })
        config.setdefault("pdf_download", {
            "enabled": True,
            "auto_download_oa": True,
            "queue_proxy_required": True,
        })
        config.setdefault("campus_proxy", {
            "enabled": False,
            "mode": "webvpn_browser",
            "portal_url": "",
            "proxy_url": "",
            "username": "",
            "password": "",
            "verify_tls": True,
            "apply_to_metadata": True,
            "apply_to_pdf": True,
            "headless": True,
            "webvpn_url_template": "",
            "login_username_selector": "",
            "login_password_selector": "",
            "login_submit_selector": "",
            "post_login_success_selector": "",
            "download_trigger_selector": "",
        })

        sources = config.setdefault("sources", {})
        defaults = {
            "crossref": {"id": "crossref", "label": "Crossref REST API", "kind": "api", "enabled": True},
            "openalex": {"id": "openalex", "label": "OpenAlex API", "kind": "api", "enabled": True},
            "semantic_scholar": {"id": "semantic_scholar", "label": "Semantic Scholar API", "kind": "api", "enabled": False},
            "rss": {"id": "rss", "label": "Journal RSS Feeds", "kind": "rss", "enabled": True, "feeds": []},
        }
        for key, value in defaults.items():
            source = sources.setdefault(key, {})
            for field, default_value in value.items():
                source.setdefault(field, default_value)

        scheduler = state.setdefault("scheduler", {})
        scheduler.setdefault("status", "idle")
        scheduler.setdefault("next_run_at", None)
        scheduler.setdefault("last_triggered_slot", None)
        scheduler.setdefault("last_error", None)
        scheduler.setdefault("running_trigger", None)

    def _ensure_scheduler_defaults(self) -> None:
        self._state.setdefault("scheduler", {})
        scheduler = self._state["scheduler"]
        scheduler.setdefault("status", "idle")
        scheduler.setdefault("running_trigger", None)
        scheduler.setdefault("last_error", None)
        scheduler["next_run_at"] = scheduler.get("next_run_at") or self._compute_next_run_at(
            self._state.get("config", {}).get("schedule", {})
        )

    def _persist_state(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(
            json.dumps(self._state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _compute_next_run_at(self, schedule: dict[str, Any]) -> str | None:
        try:
            weekday = int(schedule.get("weekday", 0))
            hour = int(schedule.get("hour", 0))
            minute = int(schedule.get("minute", 0))
        except (TypeError, ValueError):
            return None

        now = _utc_now()
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        days_ahead = (weekday - candidate.weekday()) % 7
        candidate = candidate + timedelta(days=days_ahead)
        if candidate <= now:
            candidate = candidate + timedelta(days=7)
        return candidate.isoformat()

    def _build_snapshot(self) -> dict[str, Any]:
        config = deepcopy(self._state.get("config", {}))
        sources_state = self._state.get("sources", {})
        items = deepcopy(self._state.get("items", []))
        recent_runs = deepcopy(self._state.get("recent_runs", []))
        last_run = deepcopy(self._state.get("last_run"))
        scheduler = deepcopy(self._state.get("scheduler", {}))
        raw_sources = deepcopy(config.get("sources", {}))

        source_items = []
        for source_key, source_config in raw_sources.items():
            merged = deepcopy(source_config)
            merged.update(deepcopy(sources_state.get(source_key, {})))
            source_items.append(merged)

        config["notes"] = self._build_config_notes(config)
        config["schedule"] = self._normalize_schedule(config.get("schedule", {}))
        config["pdf_download"] = self._normalize_pdf_download(config.get("pdf_download", {}))
        config["campus_proxy"] = self._sanitize_campus_proxy(config.get("campus_proxy", {}))
        config["sources"] = source_items

        return {
            "config": config,
            "scheduler": scheduler,
            "last_run": last_run,
            "recent_runs": recent_runs,
            "summary": self._build_summary(items),
            "pdf_summary": self._build_pdf_summary(items),
            "items": items,
        }

    def _build_config_notes(self, config: dict[str, Any]) -> list[str]:
        notes = [
            "The restored monitor service reads persisted state from backend/data/literature_monitor_state.json.",
            "Proxy queue items are read from backend/data/literature_monitor_proxy_queue.json.",
        ]
        rss_source = config.get("sources", {}).get("rss", {})
        if not rss_source.get("feeds"):
            notes.append("RSS monitoring is enabled but no RSS feeds are configured.")
        campus_proxy = config.get("campus_proxy", {})
        if campus_proxy.get("enabled") and not campus_proxy.get("proxy_url") and not campus_proxy.get("portal_url"):
            notes.append("Campus proxy is enabled but no proxy endpoint is configured.")
        return notes

    def _normalize_schedule(self, schedule: dict[str, Any]) -> dict[str, Any]:
        normalized = {
            "weekday": int(schedule.get("weekday", 0)),
            "hour": int(schedule.get("hour", 0)),
            "minute": int(schedule.get("minute", 0)),
            "timezone": schedule.get("timezone") or "Asia/Shanghai",
        }
        normalized["label"] = f"Weekly on {normalized['weekday']} at {normalized['hour']:02d}:{normalized['minute']:02d} ({normalized['timezone']})"
        return normalized

    def _normalize_pdf_download(self, pdf_download: dict[str, Any]) -> dict[str, Any]:
        return {
            "enabled": bool(pdf_download.get("enabled", True)),
            "auto_download_oa": bool(pdf_download.get("auto_download_oa", True)),
            "queue_proxy_required": bool(pdf_download.get("queue_proxy_required", True)),
            "storage_dir": "data/literature_monitor_pdfs",
            "proxy_queue_path": "data/literature_monitor_proxy_queue.json",
        }

    def _sanitize_campus_proxy(self, campus_proxy: dict[str, Any]) -> dict[str, Any]:
        return {
            "enabled": bool(campus_proxy.get("enabled", False)),
            "mode": campus_proxy.get("mode") or "webvpn_browser",
            "portal_url": campus_proxy.get("portal_url") or "",
            "proxy_url": campus_proxy.get("proxy_url") or "",
            "username": campus_proxy.get("username") or "",
            "has_password": bool(campus_proxy.get("password")),
            "verify_tls": bool(campus_proxy.get("verify_tls", True)),
            "apply_to_metadata": bool(campus_proxy.get("apply_to_metadata", True)),
            "apply_to_pdf": bool(campus_proxy.get("apply_to_pdf", True)),
            "headless": bool(campus_proxy.get("headless", True)),
            "webvpn_url_template": campus_proxy.get("webvpn_url_template") or "",
            "login_username_selector": campus_proxy.get("login_username_selector") or "",
            "login_password_selector": campus_proxy.get("login_password_selector") or "",
            "login_submit_selector": campus_proxy.get("login_submit_selector") or "",
            "post_login_success_selector": campus_proxy.get("post_login_success_selector") or "",
            "download_trigger_selector": campus_proxy.get("download_trigger_selector") or "",
        }

    def _build_summary(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        now = _utc_now()
        source_counts: dict[str, int] = {}
        keyword_counts: dict[str, int] = {}
        timeline_counts: dict[str, int] = {}
        publishers: set[str] = set()
        new_items_last_7_days = 0

        for item in items:
            source_name = str(item.get("source_name") or item.get("source_id") or "Unknown")
            source_counts[source_name] = source_counts.get(source_name, 0) + 1
            publisher = str(item.get("publisher") or "").strip()
            if publisher:
                publishers.add(publisher)

            for keyword in item.get("matched_keywords") or []:
                keyword_str = str(keyword)
                keyword_counts[keyword_str] = keyword_counts.get(keyword_str, 0) + 1

            discovered_at = _parse_datetime(item.get("discovered_at"))
            if discovered_at:
                date_key = discovered_at.date().isoformat()
                timeline_counts[date_key] = timeline_counts.get(date_key, 0) + 1
                if (now - discovered_at) <= timedelta(days=7):
                    new_items_last_7_days += 1

        return {
            "total_items": len(items),
            "new_items_last_7_days": new_items_last_7_days,
            "active_keywords": len(self._state.get("config", {}).get("keywords", [])),
            "distinct_publishers": len(publishers),
            "items_by_source": [
                {"name": name, "count": count}
                for name, count in sorted(source_counts.items(), key=lambda item: (-item[1], item[0]))
            ],
            "items_by_keyword": [
                {"name": name, "count": count}
                for name, count in sorted(keyword_counts.items(), key=lambda item: (-item[1], item[0]))
            ],
            "timeline": [
                {"date": date, "count": timeline_counts[date]}
                for date in sorted(timeline_counts.keys())
            ],
        }

    def _build_pdf_summary(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        counts = {
            "downloaded_count": 0,
            "queued_proxy_count": 0,
            "failed_count": 0,
            "pending_count": 0,
            "open_access_count": 0,
        }
        for item in items:
            pdf = item.get("pdf") or {}
            status = str(pdf.get("status") or "").lower()
            access = str(pdf.get("access") or "").lower()
            is_open_access = pdf.get("is_open_access")

            if status == "downloaded":
                counts["downloaded_count"] += 1
            elif status == "queued_proxy":
                counts["queued_proxy_count"] += 1
            elif status == "failed":
                counts["failed_count"] += 1
            elif status in {"pending", "", "unavailable"}:
                counts["pending_count"] += 1

            if access == "open_access" or is_open_access is True:
                counts["open_access_count"] += 1

        counts["storage_dir"] = "data/literature_monitor_pdfs"
        counts["proxy_queue_path"] = "data/literature_monitor_proxy_queue.json"
        return counts


_literature_monitor_service: LiteratureMonitorService | None = None


def get_literature_monitor_service() -> LiteratureMonitorService:
    global _literature_monitor_service
    if _literature_monitor_service is None:
        _literature_monitor_service = LiteratureMonitorService()
    return _literature_monitor_service

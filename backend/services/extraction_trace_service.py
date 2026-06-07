"""Persistence helpers for extraction runs and candidate traces."""

from __future__ import annotations

import copy
import json
from typing import Any, Iterable, Optional

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import ExtractionCandidate, ExtractionRun, Literature


CANCELLED_EXTRACTION_MESSAGE = "Extraction cancelled by user."
TERMINAL_EXTRACTION_STATUSES = {"completed", "failed", "error", "cancelled", "no_data"}

# Ordered pipeline stages mapped to a percent band. The bar moves through real
# milestones instead of jumping finished/total, and the candidate-extraction
# stage interpolates page-by-page so a single paper still advances smoothly.
_STAGE_BANDS: list[tuple[str, float, float]] = [
    ("stage_a", 2.0, 8.0),    # queued / start
    ("stage_b", 8.0, 30.0),   # PDF scan
    ("stage_c", 30.0, 78.0),  # candidate extraction (page-by-page)
    ("stage_d", 78.0, 90.0),  # validation
    ("stage_e", 90.0, 99.0),  # finalize / review queue
]

# User-facing labels for each pipeline stage prefix (for the progress stepper).
EXTRACTION_STAGE_LABELS: list[tuple[str, str]] = [
    ("stage_a", "Queued"),
    ("stage_b", "Scanning PDF"),
    ("stage_c", "Extracting"),
    ("stage_d", "Validating"),
    ("stage_e", "Finalizing"),
]


def compute_extraction_progress_percent(
    current_stage: str | None,
    *,
    page_coverage: dict[str, Any] | None = None,
    page_candidate_counts: dict[str, Any] | None = None,
) -> int:
    """Map a run's current stage (+ page coverage) to a monotonic 1–99 percent.

    Returns a running percentage only; terminal states (completed/no_data) are
    rendered as 100 by the caller based on run status, never here.
    """
    stage = str(current_stage or "").strip().lower()
    band = next(((lo, hi) for prefix, lo, hi in _STAGE_BANDS if stage.startswith(prefix)), None)
    if band is None:
        return 3
    lo, hi = band
    frac = 0.0
    # Interpolate within the extraction stage by how many pages have been processed.
    if stage.startswith("stage_c"):
        try:
            total_pages = int((page_coverage or {}).get("total_pages") or 0)
        except (TypeError, ValueError):
            total_pages = 0
        processed_pages = len(page_candidate_counts or {})
        if total_pages > 0:
            frac = max(0.0, min(1.0, processed_pages / total_pages))
    return max(1, min(99, int(round(lo + (hi - lo) * frac))))


class ExtractionCancelledError(Exception):
    """Raised inside extraction workers when a persisted cancel request is observed."""


def _json_dumps(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return json.dumps(str(value), ensure_ascii=False)


async def create_extraction_run(
    db: AsyncSession,
    *,
    run_id: str,
    literature_id: int,
    profile: str,
    extractor_type: str = "tribology",
    status: str = "running",
    page_coverage: Optional[dict[str, Any]] = None,
    summary: Optional[dict[str, Any]] = None,
) -> ExtractionRun:
    run = ExtractionRun(
        run_id=run_id,
        literature_id=literature_id,
        extractor_type=extractor_type,
        profile=profile,
        status=status,
        page_coverage=_json_dumps(page_coverage),
        summary_json=_json_dumps(summary),
    )
    db.add(run)
    await db.flush()
    return run


async def add_extraction_candidates(
    db: AsyncSession,
    *,
    run_id: str,
    candidates: Iterable[dict[str, Any]],
) -> int:
    rows: list[ExtractionCandidate] = []
    for item in candidates:
        rows.append(
            ExtractionCandidate(
                run_id=run_id,
                stage=str(item.get("stage") or "stage_c"),
                modality=str(item.get("modality") or "unknown"),
                page=item.get("page"),
                source_figure=item.get("source_figure"),
                panel_label=item.get("panel_label"),
                raw_json=_json_dumps(item.get("raw") or item.get("raw_json") or item),
                normalized_json=_json_dumps(item.get("normalized") or item.get("normalized_json")),
                drop_reason=item.get("drop_reason"),
                merged_into=item.get("merged_into"),
            )
        )

    if rows:
        db.add_all(rows)
    return len(rows)


async def finalize_extraction_run(
    db: AsyncSession,
    *,
    run_id: str,
    status: str,
    candidate_count: int,
    final_count: int,
    dropped_by_reason: Optional[dict[str, Any]] = None,
    page_coverage: Optional[dict[str, Any]] = None,
    summary: Optional[dict[str, Any]] = None,
    error_message: Optional[str] = None,
) -> None:
    stmt: Select[tuple[ExtractionRun]] = select(ExtractionRun).where(ExtractionRun.run_id == run_id)
    row = await db.execute(stmt)
    run = row.scalar_one_or_none()
    if not run:
        return
    if run.status == "cancelled" and status != "cancelled":
        return

    run.status = status
    run.candidate_count = int(candidate_count)
    run.final_count = int(final_count)
    run.dropped_by_reason = _json_dumps(dropped_by_reason)
    if page_coverage is not None:
        run.page_coverage = _json_dumps(page_coverage)
    elif isinstance(summary, dict) and summary.get("page_coverage") is not None:
        run.page_coverage = _json_dumps(summary.get("page_coverage"))
    run.summary_json = _json_dumps(summary)
    run.error_message = error_message


async def update_extraction_run_progress(
    db: AsyncSession,
    *,
    run_id: str,
    candidate_count: Optional[int] = None,
    dropped_by_reason: Optional[dict[str, Any]] = None,
    page_coverage: Optional[dict[str, Any]] = None,
    summary_patch: Optional[dict[str, Any]] = None,
) -> None:
    """
    Lightweight progress update for RUNNING extraction jobs.
    Updates summary_json incrementally so frontend can poll live progress.
    """
    stmt: Select[tuple[ExtractionRun]] = select(ExtractionRun).where(ExtractionRun.run_id == run_id)
    row = await db.execute(stmt)
    run = row.scalar_one_or_none()
    if not run:
        return

    if run.status == "cancelled":
        return

    if run.status not in TERMINAL_EXTRACTION_STATUSES:
        run.status = "running"

    if candidate_count is not None:
        try:
            run.candidate_count = int(candidate_count)
        except Exception:
            pass

    if dropped_by_reason is not None:
        run.dropped_by_reason = _json_dumps(dropped_by_reason)

    if page_coverage is not None:
        run.page_coverage = _json_dumps(page_coverage)

    current_summary: dict[str, Any] = {}
    if run.summary_json:
        try:
            loaded = json.loads(run.summary_json)
            if isinstance(loaded, dict):
                current_summary = loaded
        except Exception:
            current_summary = {}

    if summary_patch:
        merged = copy.deepcopy(current_summary)
        for k, v in (summary_patch or {}).items():
            merged[k] = v
        run.summary_json = _json_dumps(merged)
    elif current_summary:
        run.summary_json = _json_dumps(current_summary)


async def get_extraction_run(db: AsyncSession, run_id: str) -> Optional[ExtractionRun]:
    stmt = select(ExtractionRun).where(ExtractionRun.run_id == run_id)
    row = await db.execute(stmt)
    return row.scalar_one_or_none()


async def mark_extraction_run_started(
    db: AsyncSession,
    *,
    run_id: str,
    extractor_type: str,
    profile: str,
    message: str | None = None,
) -> None:
    run = await get_extraction_run(db, run_id)
    if not run or str(run.status or "").strip().lower() == "cancelled":
        return

    label = "Diffusion" if extractor_type == "diffusion" else "Tribology"
    started_message = message or f"{label} extraction is running."
    summary: dict[str, Any] = {}
    if run.summary_json:
        try:
            loaded = json.loads(run.summary_json)
            if isinstance(loaded, dict):
                summary = loaded
        except Exception:
            summary = {}

    progress_log = summary.get("progress_log")
    if not isinstance(progress_log, list):
        progress_log = []
    if not any(
        isinstance(item, dict)
        and str(item.get("stage") or "").strip() == "stage_a.start"
        and str(item.get("message") or "").strip() == started_message
        for item in progress_log
    ):
        progress_log = [*progress_log, {"stage": "stage_a.start", "message": started_message}]

    summary = {
        **summary,
        "run_id": run_id,
        "extractor_type": extractor_type,
        "profile": profile,
        "current_stage": "stage_a.start",
        "current_message": started_message,
        "progress_log": progress_log,
    }
    run.status = "running"
    run.profile = profile
    run.error_message = None
    run.summary_json = _json_dumps(summary)


async def get_latest_extraction_run_by_literature(
    db: AsyncSession,
    literature_id: int,
    extractor_type: str | None = None,
) -> Optional[ExtractionRun]:
    stmt = select(ExtractionRun).where(ExtractionRun.literature_id == literature_id)
    if extractor_type:
        stmt = stmt.where(ExtractionRun.extractor_type == extractor_type)
    stmt = stmt.order_by(ExtractionRun.id.desc()).limit(1)
    row = await db.execute(stmt)
    return row.scalar_one_or_none()


async def is_extraction_cancelled(
    db: AsyncSession,
    *,
    run_id: str | None = None,
    literature_id: int | None = None,
) -> bool:
    if run_id:
        run = (
            await db.execute(select(ExtractionRun).where(ExtractionRun.run_id == run_id))
        ).scalar_one_or_none()
        if run:
            return str(run.status or "").strip().lower() == "cancelled"

    if literature_id:
        literature = await db.get(Literature, literature_id)
        if literature and str(literature.status or "").strip().lower() == "cancelled":
            return True

    return False


async def cancel_latest_extraction_run(
    db: AsyncSession,
    *,
    literature_id: int,
    extractor_type: str | None = None,
    message: str = CANCELLED_EXTRACTION_MESSAGE,
) -> ExtractionRun | None:
    run = await get_latest_extraction_run_by_literature(db, literature_id, extractor_type=extractor_type)
    if not run:
        return None

    if str(run.status or "").strip().lower() in {"completed", "no_data"}:
        return run

    summary: dict[str, Any] = {}
    if run.summary_json:
        try:
            loaded = json.loads(run.summary_json)
            if isinstance(loaded, dict):
                summary = loaded
        except Exception:
            summary = {}

    progress_log = summary.get("progress_log")
    if not isinstance(progress_log, list):
        progress_log = []
    progress_log = [
        *progress_log,
        {"stage": "cancelled", "message": message},
    ]

    dropped_by_reason: dict[str, Any] = {}
    if run.dropped_by_reason:
        try:
            loaded = json.loads(run.dropped_by_reason)
            if isinstance(loaded, dict):
                dropped_by_reason = loaded
        except Exception:
            dropped_by_reason = {}
    dropped_by_reason["cancelled"] = int(dropped_by_reason.get("cancelled") or 0) + 1

    summary = {
        **summary,
        "current_stage": "cancelled",
        "current_message": message,
        "progress_log": progress_log,
        "dropped_by_reason": dropped_by_reason,
    }

    run.status = "cancelled"
    run.error_message = message
    run.dropped_by_reason = _json_dumps(dropped_by_reason)
    run.summary_json = _json_dumps(summary)
    return run


async def list_extraction_candidates(
    db: AsyncSession,
    run_id: str,
    *,
    skip: int = 0,
    limit: int = 200,
) -> tuple[int, list[ExtractionCandidate]]:
    total_stmt = select(func.count(ExtractionCandidate.id)).where(ExtractionCandidate.run_id == run_id)
    total = (await db.execute(total_stmt)).scalar() or 0

    stmt = (
        select(ExtractionCandidate)
        .where(ExtractionCandidate.run_id == run_id)
        .order_by(ExtractionCandidate.id)
        .offset(skip)
        .limit(limit)
    )
    rows = await db.execute(stmt)
    return int(total), list(rows.scalars().all())

"""Persistence helpers for extraction runs and candidate traces."""

from __future__ import annotations

import copy
import json
from typing import Any, Iterable, Optional

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import ExtractionCandidate, ExtractionRun


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
    page_coverage: Optional[dict[str, Any]] = None,
    summary: Optional[dict[str, Any]] = None,
) -> ExtractionRun:
    run = ExtractionRun(
        run_id=run_id,
        literature_id=literature_id,
        profile=profile,
        status="running",
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

    if run.status not in {"completed", "failed"}:
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


async def get_latest_extraction_run_by_literature(
    db: AsyncSession,
    literature_id: int,
) -> Optional[ExtractionRun]:
    stmt = (
        select(ExtractionRun)
        .where(ExtractionRun.literature_id == literature_id)
        .order_by(ExtractionRun.id.desc())
        .limit(1)
    )
    row = await db.execute(stmt)
    return row.scalar_one_or_none()


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

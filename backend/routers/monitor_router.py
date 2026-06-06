"""
监控API路由

提供用户活动监控、使用统计等功能，仅管理员可访问
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from models.db_models import DiffusionCandidate, DiffusionRecord, Literature, RecordCandidate, TribologyData
from security import AuthPrincipal, get_current_principal, is_admin
from services.activity_logging_service import (
    ACTION_TYPES,
    get_all_users_statistics,
    get_group_activity_summary,
    get_user_activity_summary,
    get_user_activity_timeline,
)
from services.literature_monitor_service import get_literature_monitor_service
from services.llm_service import llm_service

router = APIRouter(prefix="/api/monitor", tags=["monitoring"])

APPROVED_REVIEW_STATUSES = {"approved", "accepted"}
NEGATIVE_REVIEW_STATUSES = {"flagged", "needs_evidence", "rejected"}


def _assert_admin(principal: AuthPrincipal) -> None:
    """检查管理员权限"""
    if not is_admin(principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin permission required"
        )


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _review_completion_rate(
    approved_records: int,
    flagged_or_rejected_records: int,
    unpromoted_candidates: int,
) -> float:
    denominator = approved_records + flagged_or_rejected_records + unpromoted_candidates
    if denominator <= 0:
        return 0.0
    return round(approved_records / denominator, 4)


async def build_extraction_review_progress(db: AsyncSession, group_id: int) -> dict[str, Any]:
    """Build a compact review-progress snapshot for the Monitor page.

    The main progress value is not a scientific accuracy score. It is a
    completion rate for the current review surface: approved records divided by
    approved records plus unresolved candidates plus explicitly negative review
    outcomes.
    """
    library_filter = (
        Literature.group_id == group_id,
        Literature.scope_type == "group_library",
        Literature.scope_key == "group_library",
    )
    approved_statuses = tuple(APPROVED_REVIEW_STATUSES)
    negative_statuses = tuple(NEGATIVE_REVIEW_STATUSES)

    library_literature = int(
        (
            await db.execute(
                select(func.count(Literature.id)).where(*library_filter)
            )
        ).scalar()
        or 0
    )
    reviewed_literature = int(
        (
            await db.execute(
                select(func.count(Literature.id)).where(
                    *library_filter,
                    (Literature.reviewed_at.is_not(None)) | (func.lower(Literature.submission_status).in_(approved_statuses)),
                )
            )
        ).scalar()
        or 0
    )

    async def _record_count(model: Any, statuses: tuple[str, ...]) -> int:
        return int(
            (
                await db.execute(
                    select(func.count(model.id))
                    .join(Literature, Literature.id == model.literature_id)
                    .where(*library_filter, func.lower(model.review_status).in_(statuses))
                )
            ).scalar()
            or 0
        )

    approved_tribology = await _record_count(TribologyData, approved_statuses)
    approved_diffusion = await _record_count(DiffusionRecord, approved_statuses)
    flagged_tribology = await _record_count(TribologyData, negative_statuses)
    flagged_diffusion = await _record_count(DiffusionRecord, negative_statuses)
    approved_records = approved_tribology + approved_diffusion
    flagged_or_rejected_records = flagged_tribology + flagged_diffusion

    async def _unpromoted_candidate_count(model: Any) -> int:
        return int(
            (
                await db.execute(
                    select(func.count(model.id))
                    .join(Literature, Literature.id == model.literature_id)
                    .where(*library_filter, model.promoted_record_id.is_(None))
                )
            ).scalar()
            or 0
        )

    unpromoted_tribology_candidates = await _unpromoted_candidate_count(RecordCandidate)
    unpromoted_diffusion_candidates = await _unpromoted_candidate_count(DiffusionCandidate)
    unpromoted_candidates = unpromoted_tribology_candidates + unpromoted_diffusion_candidates

    reviewed_by_day_rows = (
        await db.execute(
            select(func.date(Literature.reviewed_at).label("day"), func.count(Literature.id))
            .where(*library_filter, Literature.reviewed_at.is_not(None))
            .group_by(func.date(Literature.reviewed_at))
            .order_by(func.date(Literature.reviewed_at))
        )
    ).all()
    trend_map: dict[str, dict[str, Any]] = {
        str(day): {
            "date": str(day),
            "reviewedLiterature": int(count or 0),
            "approvedRecords": 0,
            "unpromotedCandidates": unpromoted_candidates,
            "reviewCompletionRate": 0.0,
        }
        for day, count in reviewed_by_day_rows
        if day
    }

    async def _approved_records_by_day(model: Any) -> list[tuple[Any, int]]:
        return (
            await db.execute(
                select(func.date(model.extracted_at).label("day"), func.count(model.id))
                .join(Literature, Literature.id == model.literature_id)
                .where(*library_filter, func.lower(model.review_status).in_(approved_statuses))
                .group_by(func.date(model.extracted_at))
                .order_by(func.date(model.extracted_at))
            )
        ).all()

    for rows in [await _approved_records_by_day(TribologyData), await _approved_records_by_day(DiffusionRecord)]:
        for day, count in rows:
            if not day:
                continue
            key = str(day)
            trend_map.setdefault(
                key,
                {
                    "date": key,
                    "reviewedLiterature": 0,
                    "approvedRecords": 0,
                    "unpromotedCandidates": unpromoted_candidates,
                    "reviewCompletionRate": 0.0,
                },
            )
            trend_map[key]["approvedRecords"] += int(count or 0)

    running_approved = 0
    for item in sorted(trend_map.values(), key=lambda entry: entry["date"]):
        running_approved += int(item["approvedRecords"])
        item["reviewCompletionRate"] = _review_completion_rate(
            running_approved,
            flagged_or_rejected_records,
            unpromoted_candidates,
        )

    recent_literature_rows = (
        await db.execute(
            select(Literature)
            .where(
                *library_filter,
                (Literature.reviewed_at.is_not(None)) | (func.lower(Literature.submission_status).in_(approved_statuses)),
            )
            .order_by(Literature.reviewed_at.desc().nullslast(), Literature.created_at.desc())
            .limit(8)
        )
    ).scalars().all()

    async def _counts_by_literature(model: Any, *, unpromoted_only: bool = False) -> dict[int, int]:
        stmt = (
            select(model.literature_id, func.count(model.id))
            .join(Literature, Literature.id == model.literature_id)
            .where(*library_filter)
            .group_by(model.literature_id)
        )
        if unpromoted_only:
            stmt = stmt.where(model.promoted_record_id.is_(None))
        return {int(lit_id): int(count or 0) for lit_id, count in (await db.execute(stmt)).all()}

    tribology_by_literature = await _counts_by_literature(TribologyData)
    diffusion_by_literature = await _counts_by_literature(DiffusionRecord)
    tribology_backlog_by_literature = await _counts_by_literature(RecordCandidate, unpromoted_only=True)
    diffusion_backlog_by_literature = await _counts_by_literature(DiffusionCandidate, unpromoted_only=True)

    recent_reviewed_literature = [
        {
            "id": literature.id,
            "title": literature.title,
            "doi": literature.doi,
            "journal": literature.journal,
            "year": literature.year,
            "reviewedAt": _iso(literature.reviewed_at),
            "reviewNote": literature.review_note,
            "submissionStatus": literature.submission_status,
            "approvedRecords": tribology_by_literature.get(literature.id, 0)
            + diffusion_by_literature.get(literature.id, 0),
            "unpromotedCandidates": tribology_backlog_by_literature.get(literature.id, 0)
            + diffusion_backlog_by_literature.get(literature.id, 0),
        }
        for literature in recent_literature_rows
    ]

    backlog_rows = (
        await db.execute(
            select(Literature)
            .where(*library_filter)
            .order_by(Literature.created_at.desc())
        )
    ).scalars().all()
    candidate_backlog = []
    for literature in backlog_rows:
        backlog = tribology_backlog_by_literature.get(literature.id, 0) + diffusion_backlog_by_literature.get(
            literature.id, 0
        )
        if backlog <= 0:
            continue
        candidate_backlog.append(
            {
                "id": literature.id,
                "title": literature.title,
                "doi": literature.doi,
                "journal": literature.journal,
                "year": literature.year,
                "unpromotedCandidates": backlog,
            }
        )
    candidate_backlog.sort(key=lambda item: (-item["unpromotedCandidates"], item["id"]))

    denominator = approved_records + flagged_or_rejected_records + unpromoted_candidates
    return {
        "summary": {
            "libraryLiterature": library_literature,
            "reviewedLiterature": reviewed_literature,
            "approvedRecords": approved_records,
            "approvedTribologyRecords": approved_tribology,
            "approvedDiffusionRecords": approved_diffusion,
            "flaggedOrRejectedRecords": flagged_or_rejected_records,
            "unpromotedCandidates": unpromoted_candidates,
            "unpromotedTribologyCandidates": unpromoted_tribology_candidates,
            "unpromotedDiffusionCandidates": unpromoted_diffusion_candidates,
            "reviewCompletionRate": _review_completion_rate(
                approved_records,
                flagged_or_rejected_records,
                unpromoted_candidates,
            ),
            "reviewCompletionNumerator": approved_records,
            "reviewCompletionDenominator": denominator,
            "reviewCompletionLabel": "Approved final records / review work surface",
        },
        "trend": sorted(trend_map.values(), key=lambda entry: entry["date"]),
        "recentReviewedLiterature": recent_reviewed_literature,
        "candidateBacklog": candidate_backlog[:8],
    }


class UserUsageStatsResponse(BaseModel):
    """用户使用统计响应"""
    user_id: int
    username: str
    display_name: str
    role: str
    is_active: bool
    created_at: Optional[str]
    login_count: int
    upload_count: int
    extraction_count: int
    record_view_count: int
    record_edit_count: int
    sync_count: int
    model_training_count: int
    total_activities: int
    last_activity_at: Optional[str]


class ActivityLogEntryResponse(BaseModel):
    """活动日志条目响应"""
    id: int
    action_type: str
    action_label: str
    action_detail: Optional[dict]
    resource_type: Optional[str]
    resource_id: Optional[int]
    ip_address: Optional[str]
    created_at: Optional[str]


class LiteratureMonitorSchedulePayload(BaseModel):
    weekday: int = Field(ge=0, le=6)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    timezone: str = "Asia/Shanghai"


class LiteratureMonitorCampusProxyPayload(BaseModel):
    enabled: bool | None = None
    mode: str | None = None
    portal_url: str | None = None
    proxy_url: str | None = None
    username: str | None = None
    password: str | None = None
    clear_password: bool | None = None
    verify_tls: bool | None = None
    apply_to_metadata: bool | None = None
    apply_to_pdf: bool | None = None
    headless: bool | None = None
    webvpn_url_template: str | None = None
    login_username_selector: str | None = None
    login_password_selector: str | None = None
    login_submit_selector: str | None = None
    post_login_success_selector: str | None = None
    download_trigger_selector: str | None = None


class LLMRuntimeConfigPayload(BaseModel):
    provider: str | None = None
    openai_base_url: str | None = None
    openai_api_key: str | None = None
    clear_openai_api_key: bool | None = None
    openrouter_base_url: str | None = None
    openrouter_api_key: str | None = None
    clear_openrouter_api_key: bool | None = None
    openrouter_site_url: str | None = None
    openrouter_app_name: str | None = None
    text_model: str | None = None
    vision_model: str | None = None
    fast_table_model: str | None = None
    vision_api_key: str | None = None
    clear_vision_api_key: bool | None = None


class LiteratureMonitorConfigPayload(BaseModel):
    keywords: list[str] | None = None
    rss_feeds: list[str] | None = None
    crossref_enabled: bool | None = None
    openalex_enabled: bool | None = None
    semantic_scholar_enabled: bool | None = None
    rss_enabled: bool | None = None
    lookback_days: int | None = Field(default=None, ge=7, le=3650)
    relevance_threshold: int | None = Field(default=None, ge=4, le=20)
    schedule: LiteratureMonitorSchedulePayload | None = None
    pdf_download: dict[str, bool] | None = None
    campus_proxy: LiteratureMonitorCampusProxyPayload | None = None


@router.get("/users")
async def get_monitor_users(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取研究组内所有用户的使用统计

    仅管理员可访问
    """
    _assert_admin(principal)

    users_stats = await get_all_users_statistics(db, principal.group.id)

    return {"items": users_stats}


@router.get("/users/{user_id}/stats")
async def get_user_stats(
    user_id: int,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取单个用户的详细统计

    仅管理员可访问
    """
    _assert_admin(principal)

    stats = await get_user_activity_summary(db, user_id)

    return stats


@router.get("/users/{user_id}/timeline")
async def get_user_timeline(
    user_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取用户活动时间线（分页）

    仅管理员可访问
    """
    _assert_admin(principal)

    timeline = await get_user_activity_timeline(db, user_id, skip, limit)

    return timeline


@router.get("/summary")
async def get_group_summary(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取研究组整体活动统计

    仅管理员可访问
    """
    _assert_admin(principal)

    summary = await get_group_activity_summary(db, principal.group.id)

    return summary


@router.get("/extraction-review-progress")
async def get_extraction_review_progress(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    _assert_admin(principal)
    return await build_extraction_review_progress(db, principal.group.id)


@router.get("/action-types")
async def get_action_types(
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    获取所有可用的操作类型定义

    仅管理员可访问
    """
    _assert_admin(principal)

    return {
        "action_types": [
            {"key": key, "label": label}
            for key, label in ACTION_TYPES.items()
        ]
    }


@router.get("/literature-source")
async def get_literature_source(
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _assert_admin(principal)
    service = get_literature_monitor_service()
    return await service.get_snapshot()


@router.post("/literature-source/run")
async def run_literature_source(
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _assert_admin(principal)
    service = get_literature_monitor_service()
    return await service.run_monitoring(trigger=f"manual:{principal.user.username}")


@router.put("/literature-source/config")
async def update_literature_source_config(
    payload: LiteratureMonitorConfigPayload,
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _assert_admin(principal)
    service = get_literature_monitor_service()
    data: dict[str, Any] = payload.model_dump(exclude_none=True)
    return await service.update_config(data)


@router.get("/llm-config")
async def get_llm_runtime_config(
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _assert_admin(principal)
    return llm_service.get_runtime_snapshot()


@router.put("/llm-config")
async def update_llm_runtime_config(
    payload: LLMRuntimeConfigPayload,
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _assert_admin(principal)
    data: dict[str, Any] = payload.model_dump(exclude_none=True)
    return llm_service.update_runtime_config(data)

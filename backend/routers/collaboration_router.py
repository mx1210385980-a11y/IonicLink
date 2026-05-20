from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models.db_models import (
    DiffusionCandidate,
    DiffusionFeatureSet,
    DiffusionRecord,
    Literature,
    RecordCandidate,
    TribologyData,
)
from security import AuthPrincipal, get_current_principal, is_admin, require_literature_access
from services.activity_logging_service import log_activity

router = APIRouter(prefix="/api/collaboration", tags=["collaboration"])

SUBMISSION_STATUSES = {"submitted", "returned", "approved"}
REJECTED_REVIEW_STATUSES = {"rejected", "flagged", "needs_evidence", "needs_review"}


class SubmissionNotePayload(BaseModel):
    note: str | None = None


def _clean_note(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _require_admin(principal: AuthPrincipal) -> None:
    if not is_admin(principal):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access is required")


def _submission_status(literature: Literature) -> str:
    return str(getattr(literature, "submission_status", None) or "draft").strip().lower() or "draft"


async def _record_counts(db: AsyncSession, literature_id: int) -> dict[str, int]:
    async def count(model) -> int:
        value = (
            await db.execute(select(func.count(model.id)).where(model.literature_id == literature_id))
        ).scalar()
        return int(value or 0)

    diffusion_records = await count(DiffusionRecord)
    diffusion_candidates = await count(DiffusionCandidate)
    tribology_records = await count(TribologyData)
    tribology_candidates = await count(RecordCandidate)
    return {
        "diffusionRecordCount": diffusion_records,
        "diffusionCandidateCount": diffusion_candidates,
        "tribologyRecordCount": tribology_records,
        "tribologyCandidateCount": tribology_candidates,
        "recordCount": diffusion_records + tribology_records,
        "candidateCount": diffusion_candidates + tribology_candidates,
        "totalCount": diffusion_records + diffusion_candidates + tribology_records + tribology_candidates,
    }


def _literature_submission_payload(literature: Literature, counts: dict[str, int] | None = None) -> dict[str, Any]:
    owner = getattr(literature, "created_by", None)
    workspace = getattr(literature, "workspace", None)
    reviewer = getattr(literature, "reviewed_by", None)
    submitter = getattr(literature, "submitted_by", None)
    return {
        "id": literature.id,
        "doi": literature.doi or "",
        "title": literature.title or "",
        "authors": literature.authors or "",
        "journal": literature.journal or "",
        "year": literature.year,
        "scopeType": getattr(literature, "scope_type", None),
        "scopeKey": getattr(literature, "scope_key", None),
        "workspaceId": getattr(literature, "workspace_id", None),
        "workspaceName": getattr(workspace, "name", None),
        "createdByUserId": getattr(literature, "created_by_user_id", None),
        "ownerDisplayName": getattr(owner, "display_name", None),
        "ownerUsername": getattr(owner, "username", None),
        "submissionStatus": _submission_status(literature),
        "submissionNote": getattr(literature, "submission_note", None),
        "submittedAt": getattr(literature, "submitted_at", None),
        "submittedByUserId": getattr(literature, "submitted_by_user_id", None),
        "submittedByDisplayName": getattr(submitter, "display_name", None),
        "reviewedAt": getattr(literature, "reviewed_at", None),
        "reviewedByUserId": getattr(literature, "reviewed_by_user_id", None),
        "reviewedByDisplayName": getattr(reviewer, "display_name", None),
        "reviewNote": getattr(literature, "review_note", None),
        "promotedLiteratureId": getattr(literature, "promoted_literature_id", None),
        "createdAt": getattr(literature, "created_at", None),
        **(counts or {}),
    }


def _clone_row(source: Any, target_model: type, *, literature_id: int, overrides: dict[str, Any] | None = None):
    skip = {"id", "literature_id", "promoted_record_id", "promoted_at"}
    target_columns = {column.name for column in target_model.__table__.columns}
    data = {
        column.name: getattr(source, column.name)
        for column in source.__table__.columns
        if column.name in target_columns and column.name not in skip
    }
    data["literature_id"] = literature_id
    data.update(overrides or {})
    return target_model(**data)


async def _copy_diffusion_feature_sets(
    db: AsyncSession,
    *,
    source: DiffusionRecord | DiffusionCandidate,
    target_record: DiffusionRecord,
) -> int:
    if isinstance(source, DiffusionCandidate):
        stmt = select(DiffusionFeatureSet).where(DiffusionFeatureSet.candidate_id == source.id)
    else:
        stmt = select(DiffusionFeatureSet).where(DiffusionFeatureSet.record_id == source.id)
    feature_sets = list((await db.execute(stmt)).scalars().all())
    copied = 0
    for feature_set in feature_sets:
        clone = _clone_row(
            feature_set,
            DiffusionFeatureSet,
            literature_id=target_record.literature_id,
            overrides={
                "candidate_id": None,
                "record_id": target_record.id,
            },
        )
        db.add(clone)
        copied += 1
    return copied


async def _copy_diffusion_records(db: AsyncSession, *, source_literature_id: int, target_literature_id: int) -> int:
    source_records = list(
        (
            await db.execute(
                select(DiffusionRecord)
                .where(DiffusionRecord.literature_id == source_literature_id)
                .order_by(DiffusionRecord.id.asc())
            )
        ).scalars().all()
    )
    source_rows: list[DiffusionRecord | DiffusionCandidate]
    if source_records:
        source_rows = source_records
    else:
        candidates = list(
            (
                await db.execute(
                    select(DiffusionCandidate)
                    .where(
                        DiffusionCandidate.literature_id == source_literature_id,
                        DiffusionCandidate.promoted_record_id.is_(None),
                    )
                    .order_by(DiffusionCandidate.id.asc())
                )
            ).scalars().all()
        )
        source_rows = [
            candidate
            for candidate in candidates
            if str(candidate.review_status or "").strip().lower() not in REJECTED_REVIEW_STATUSES
        ]

    copied = 0
    for row in source_rows:
        clone = _clone_row(
            row,
            DiffusionRecord,
            literature_id=target_literature_id,
            overrides={
                "review_status": "approved",
                "record_origin": "workspace_submission",
            },
        )
        db.add(clone)
        await db.flush()
        await _copy_diffusion_feature_sets(db, source=row, target_record=clone)
        copied += 1
    return copied


async def _copy_tribology_records(db: AsyncSession, *, source_literature_id: int, target_literature_id: int) -> int:
    source_records = list(
        (
            await db.execute(
                select(TribologyData)
                .where(TribologyData.literature_id == source_literature_id)
                .order_by(TribologyData.id.asc())
            )
        ).scalars().all()
    )
    source_rows: list[TribologyData | RecordCandidate]
    if source_records:
        source_rows = source_records
    else:
        candidates = list(
            (
                await db.execute(
                    select(RecordCandidate)
                    .where(
                        RecordCandidate.literature_id == source_literature_id,
                        RecordCandidate.promoted_record_id.is_(None),
                    )
                    .order_by(RecordCandidate.id.asc())
                )
            ).scalars().all()
        )
        source_rows = [
            candidate
            for candidate in candidates
            if str(candidate.review_status or "").strip().lower() not in REJECTED_REVIEW_STATUSES
        ]

    copied = 0
    for row in source_rows:
        clone = _clone_row(
            row,
            TribologyData,
            literature_id=target_literature_id,
            overrides={
                "review_status": "approved",
                "record_origin": "workspace_submission",
            },
        )
        db.add(clone)
        copied += 1
    return copied


async def _find_or_create_group_literature(
    db: AsyncSession,
    *,
    source: Literature,
    principal: AuthPrincipal,
) -> Literature:
    target = None
    if source.doi:
        target = (
            await db.execute(
                select(Literature).where(
                    Literature.group_id == source.group_id,
                    Literature.scope_type == "group_library",
                    Literature.scope_key == "group_library",
                    Literature.workspace_id.is_(None),
                    Literature.doi == source.doi,
                )
            )
        ).scalar_one_or_none()
    if target:
        return target

    target = Literature(
        doi=source.doi,
        title=source.title,
        authors=source.authors,
        journal=source.journal,
        issn=source.issn,
        year=source.year,
        volume=source.volume,
        issue=source.issue,
        pages=source.pages,
        content=source.content,
        file_path=source.file_path,
        file_hash=source.file_hash,
        group_id=source.group_id,
        workspace_id=None,
        created_by_user_id=source.created_by_user_id or principal.user.id,
        scope_type="group_library",
        scope_key="group_library",
        status=source.status,
        error_message=source.error_message,
        submission_status="approved",
        submitted_at=source.submitted_at,
        submitted_by_user_id=source.submitted_by_user_id,
        reviewed_at=datetime.utcnow(),
        reviewed_by_user_id=principal.user.id,
    )
    db.add(target)
    await db.flush()
    return target


@router.post("/literature/{literature_id}/submit")
async def submit_literature_for_review(
    literature_id: int,
    payload: SubmissionNotePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    literature = await require_literature_access(db, principal, literature_id, write=True)
    if literature.scope_type != "workspace":
        raise HTTPException(status_code=400, detail="Only workspace literature can be submitted for approval")

    counts = await _record_counts(db, literature.id)
    if counts["totalCount"] <= 0:
        raise HTTPException(status_code=400, detail="No extracted records are available for submission")

    literature.submission_status = "submitted"
    literature.submission_note = _clean_note(payload.note)
    literature.submitted_at = datetime.utcnow()
    literature.submitted_by_user_id = principal.user.id
    literature.reviewed_at = None
    literature.reviewed_by_user_id = None
    literature.review_note = None

    await db.commit()
    await db.refresh(literature)
    counts = await _record_counts(db, literature.id)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="submit_literature",
        action_detail={"literature_id": literature.id, "title": literature.title},
        resource_type="literature",
        resource_id=literature.id,
        request=request,
    )
    return {
        "success": True,
        "literature": _literature_submission_payload(literature, counts),
        "message": "Submitted for group approval",
    }


@router.get("/submissions")
async def list_literature_submissions(
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _require_admin(principal)
    stmt = (
        select(Literature)
        .options(
            selectinload(Literature.workspace),
            selectinload(Literature.created_by),
            selectinload(Literature.submitted_by),
            selectinload(Literature.reviewed_by),
        )
        .where(
            Literature.group_id == principal.group.id,
            Literature.scope_type == "workspace",
            Literature.submission_status.in_(SUBMISSION_STATUSES),
        )
        .order_by(Literature.submitted_at.desc().nullslast(), Literature.created_at.desc())
    )
    items = list((await db.execute(stmt)).scalars().all())
    payload = []
    for item in items:
        payload.append(_literature_submission_payload(item, await _record_counts(db, item.id)))
    return {"items": payload}


@router.post("/submissions/{literature_id}/approve")
async def approve_literature_submission(
    literature_id: int,
    payload: SubmissionNotePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _require_admin(principal)
    source = await require_literature_access(db, principal, literature_id, write=True)
    if source.scope_type != "workspace":
        raise HTTPException(status_code=400, detail="Only workspace submissions can be approved")
    if _submission_status(source) != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted literature can be approved")
    if source.promoted_literature_id:
        target = await db.get(Literature, source.promoted_literature_id)
        return {
            "success": True,
            "literature": _literature_submission_payload(source, await _record_counts(db, source.id)),
            "targetLiteratureId": source.promoted_literature_id,
            "copied": {"diffusion": 0, "tribology": 0},
            "message": "Submission was already approved",
        }

    source_counts = await _record_counts(db, source.id)
    if source_counts["totalCount"] <= 0:
        raise HTTPException(status_code=400, detail="No extracted records are available to promote")

    target = await _find_or_create_group_literature(db, source=source, principal=principal)
    diffusion_copied = await _copy_diffusion_records(
        db,
        source_literature_id=source.id,
        target_literature_id=target.id,
    )
    tribology_copied = await _copy_tribology_records(
        db,
        source_literature_id=source.id,
        target_literature_id=target.id,
    )
    if diffusion_copied + tribology_copied <= 0:
        raise HTTPException(status_code=400, detail="No reviewable records were copied into the group library")

    source.submission_status = "approved"
    source.review_note = _clean_note(payload.note)
    source.reviewed_at = datetime.utcnow()
    source.reviewed_by_user_id = principal.user.id
    source.promoted_literature_id = target.id
    target.reviewed_at = source.reviewed_at
    target.reviewed_by_user_id = principal.user.id
    target.review_note = source.review_note

    await db.commit()
    await db.refresh(source)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="approve_literature_submission",
        action_detail={
            "source_literature_id": source.id,
            "target_literature_id": target.id,
            "diffusion_copied": diffusion_copied,
            "tribology_copied": tribology_copied,
        },
        resource_type="literature",
        resource_id=source.id,
        request=request,
    )
    return {
        "success": True,
        "literature": _literature_submission_payload(source, await _record_counts(db, source.id)),
        "targetLiteratureId": target.id,
        "copied": {"diffusion": diffusion_copied, "tribology": tribology_copied},
        "message": "Approved and promoted into group library",
    }


@router.post("/submissions/{literature_id}/return")
async def return_literature_submission(
    literature_id: int,
    payload: SubmissionNotePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    _require_admin(principal)
    literature = await require_literature_access(db, principal, literature_id, write=True)
    if literature.scope_type != "workspace":
        raise HTTPException(status_code=400, detail="Only workspace submissions can be returned")
    if _submission_status(literature) != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted literature can be returned")

    literature.submission_status = "returned"
    literature.review_note = _clean_note(payload.note)
    literature.reviewed_at = datetime.utcnow()
    literature.reviewed_by_user_id = principal.user.id

    await db.commit()
    await db.refresh(literature)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="return_literature_submission",
        action_detail={"literature_id": literature.id, "review_note": literature.review_note},
        resource_type="literature",
        resource_id=literature.id,
        request=request,
    )
    return {
        "success": True,
        "literature": _literature_submission_payload(literature, await _record_counts(db, literature.id)),
        "message": "Returned to workspace",
    }

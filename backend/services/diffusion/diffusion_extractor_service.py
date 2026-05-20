from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select

from database import async_session_maker
from models.db_models import DiffusionCandidate, DiffusionFeatureSet, DiffusionRecord, ExtractionRun, Literature
from services.diffusion.diffusion_postprocess_service import (
    build_feature_set_payload,
    dedupe_normalized_diffusion_records,
    diffusion_drop_reason,
    json_dumps,
    normalize_diffusion_records,
    record_has_diffusion_value,
    serialize_diffusion_row_for_response,
)
from services.diffusion.pdf_ingest_service import build_diffusion_ingest_payload
from services.extraction_trace_service import (
    CANCELLED_EXTRACTION_MESSAGE,
    ExtractionCancelledError,
    add_extraction_candidates,
    create_extraction_run,
    finalize_extraction_run,
    get_extraction_run,
    is_extraction_cancelled,
    update_extraction_run_progress,
)
from services.llm.prompts_diffusion import (
    ANTI_HALLUCINATION_PROMPT,
    DIFFUSION_EXTRACTION_PROMPT,
    PROMPT_VERSION,
)
from services.llm.runtime_service import llm_service
from services.pdf_service import resolve_existing_path
from services.doi_service import DOIService
from services.fallback_extraction_service import extract_metadata_fallback
from services.file_service import _archive_completed_literature_pdf, _read_file_content, _safe_update_doi
from services.llm.utils import clean_and_parse_json
from utils.no_data_reason import build_no_data_reason
from utils.pdf_utils import validate_pdf_file

logger = logging.getLogger(__name__)

EXTRACTOR_TYPE = "diffusion"


async def _count_diffusion_artifacts(db, literature_id: int) -> tuple[int, int]:
    candidate_count = (
        await db.execute(select(func.count(DiffusionCandidate.id)).where(DiffusionCandidate.literature_id == literature_id))
    ).scalar() or 0
    record_count = (
        await db.execute(select(func.count(DiffusionRecord.id)).where(DiffusionRecord.literature_id == literature_id))
    ).scalar() or 0
    return int(candidate_count), int(record_count)


async def _get_latest_diffusion_run(db, literature_id: int) -> ExtractionRun | None:
    stmt = (
        select(ExtractionRun)
        .where(
            ExtractionRun.literature_id == literature_id,
            ExtractionRun.extractor_type == EXTRACTOR_TYPE,
        )
        .order_by(ExtractionRun.id.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


def _parse_json(value: Any, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _build_in_progress_summary(run: ExtractionRun | None) -> dict[str, Any]:
    summary_payload = _parse_json(getattr(run, "summary_json", None), {})
    return {
        "run_id": run.run_id if run else None,
        "candidate_count": int(getattr(run, "candidate_count", 0) or summary_payload.get("candidate_count") or 0),
        "final_count": int(getattr(run, "final_count", 0) or summary_payload.get("final_count") or 0),
        "dropped_by_reason": {**(summary_payload.get("dropped_by_reason") or {}), "in_progress": 1},
        "page_coverage": summary_payload.get("page_coverage") or {},
        "page_candidate_counts": summary_payload.get("page_candidate_counts") or {},
        "progress_log": summary_payload.get("progress_log") or [],
        "extractor_type": EXTRACTOR_TYPE,
    }


def _build_cancelled_summary(run_id: str | None, *, profile: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "extractor_type": EXTRACTOR_TYPE,
        "candidate_count": 0,
        "final_count": 0,
        "dropped_by_reason": {"cancelled": 1},
        "page_coverage": {},
        "page_candidate_counts": {},
        "progress_log": [{"stage": "cancelled", "message": CANCELLED_EXTRACTION_MESSAGE}],
        "current_stage": "cancelled",
        "current_message": CANCELLED_EXTRACTION_MESSAGE,
        "status": "cancelled",
        "profile": profile,
    }


async def _load_cached_diffusion_result(db, literature: Literature) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    candidate_rows = (
        await db.execute(
            select(DiffusionCandidate)
            .where(DiffusionCandidate.literature_id == literature.id)
            .order_by(DiffusionCandidate.id.asc())
        )
    ).scalars().all()
    if not candidate_rows:
        candidate_rows = (
            await db.execute(
                select(DiffusionRecord)
                .where(DiffusionRecord.literature_id == literature.id)
                .order_by(DiffusionRecord.id.asc())
            )
        ).scalars().all()

    data = []
    for row in candidate_rows:
        payload = serialize_diffusion_row_for_response(
            {
                "system_name": row.system_name,
                "confinement_material_class": row.confinement_material_class,
                "confinement_geometry_class": row.confinement_geometry_class,
                "surface_functional_groups": row.surface_functional_groups,
                "confinement_dimensionality": row.confinement_dimensionality,
                "ionic_liquid": row.ionic_liquid,
                "D_total": row.d_total,
                "D_cation": row.d_cation,
                "D_anion": row.d_anion,
                "D_unit": row.d_unit,
                "temperature_value": row.temperature_value,
                "confinement_scale_value": row.confinement_scale_value,
                "confinement_scale_unit": row.confinement_scale_unit,
                "source": row.source,
                "source_page": row.source_page,
                "source_bbox": _parse_json(row.source_bbox, None),
                "evidence": row.evidence,
                "provider": row.provider,
                "prompt_version": row.prompt_version,
                "raw_model_output": row.raw_model_output,
                "field_evidence_json": _parse_json(row.field_evidence_json, {}),
                "review_status": row.review_status,
                "record_origin": row.record_origin,
                "assembly_notes": row.assembly_notes,
                "confidence": row.confidence,
                "novel_features_json": _parse_json(row.novel_features_json, {}),
                "smiles": row.smiles,
                "rdkit_features_json": _parse_json(row.rdkit_features_json, {}),
            },
            row_id=row.id,
        )
        payload["review_entity_type"] = "candidate" if isinstance(row, DiffusionCandidate) else "record"
        data.append(payload)

    metadata = {
        "title": literature.title,
        "authors": literature.authors,
        "doi": literature.doi,
        "journal": literature.journal,
        "year": literature.year,
        "volume": literature.volume,
        "issue": literature.issue,
        "pages": literature.pages,
        "issn": literature.issn,
    }
    latest_run = await _get_latest_diffusion_run(db, literature.id)
    summary = _parse_json(getattr(latest_run, "summary_json", None), {})
    if latest_run:
        summary.setdefault("run_id", latest_run.run_id)
    summary.setdefault("extractor_type", EXTRACTOR_TYPE)
    summary.setdefault("final_count", len(data))
    return metadata, data, summary


async def _extract_diffusion_payload(
    *,
    content: str,
    pdf_path: str | None,
    profile: str,
    progress_callback=None,
) -> dict[str, Any]:
    ingest = build_diffusion_ingest_payload(content=content, pdf_path=pdf_path, profile=profile)
    text_chunks = ingest.get("text_chunks") or []
    if not text_chunks:
        text_chunks = [
            {
                "pages": ingest.get("selected_pages") or [],
                "content": ingest.get("content") or content or "",
            }
        ]
    if progress_callback:
        await progress_callback(
            {
                "stage": "stage_a.profile",
                "message": (
                    f"selected_pages={len(ingest.get('selected_pages') or [])}, "
                    f"selected_visual={len(ingest.get('images') or [])}, chunks={len(text_chunks)}"
                ),
                "candidate_count": 0,
                "page_coverage": ingest.get("page_coverage") or {},
                "page_candidate_counts": {},
                "progress_log": [{"stage": "stage_a.profile", "message": "prepared diffusion evidence context"}],
                "force": True,
            }
        )

    progress_log = [{"stage": "stage_a.profile", "message": "prepared diffusion evidence context"}]
    page_candidate_counts: dict[str, int] = {}
    reasoning_parts: list[str] = []
    new_feature_alerts: list[str] = []
    raw_rows: list[dict[str, Any]] = []
    raw_model_outputs: list[str] = []

    for chunk_index, chunk in enumerate(text_chunks, start=1):
        chunk_pages = [int(page) for page in (chunk.get("pages") or []) if str(page).isdigit()]
        chunk_text = chunk.get("content") or ""
        chunk_images: list[str] = []
        for page_num in chunk_pages:
            chunk_images.extend((ingest.get("page_images") or {}).get(page_num, []))

        if progress_callback:
            progress_log.append(
                {
                    "stage": "stage_b.chunk",
                    "message": f"chunk={chunk_index}/{len(text_chunks)} pages={chunk_pages} images={len(chunk_images)}",
                }
            )
            await progress_callback(
                {
                    "stage": "stage_b.chunk",
                    "message": f"chunk={chunk_index}/{len(text_chunks)} pages={chunk_pages} images={len(chunk_images)}",
                    "candidate_count": len(raw_rows),
                    "page_coverage": ingest.get("page_coverage") or {},
                    "page_candidate_counts": page_candidate_counts,
                    "progress_log": progress_log[-20:],
                }
            )

        if chunk_images:
            user_content: list[dict[str, Any]] = [
                {"type": "text", "text": DIFFUSION_EXTRACTION_PROMPT + "\n\n" + chunk_text},
            ]
            for image in chunk_images[:4]:
                user_content.append({"type": "image_url", "image_url": {"url": image}})
            messages = [
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user", "content": user_content},
            ]
            client = llm_service.vision_client
            model = llm_service.vision_model
        else:
            messages = [
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user", "content": DIFFUSION_EXTRACTION_PROMPT + "\n\n" + chunk_text},
            ]
            client = llm_service.text_client
            model = llm_service.text_model

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.0,
                max_tokens=8192,
            )
            raw_model_output = response.choices[0].message.content or "{}"
        except Exception as exc:
            progress_log.append(
                {
                    "stage": "stage_b.chunk_error",
                    "message": f"chunk={chunk_index} failed: {type(exc).__name__}: {exc}",
                }
            )
            continue

        payload = clean_and_parse_json(raw_model_output)
        if not isinstance(payload, dict):
            payload = {"reasoning": "Invalid model payload.", "new_feature_alerts": [], "data": []}

        raw_model_outputs.append(raw_model_output)
        reasoning = str(payload.get("reasoning") or "").strip()
        if reasoning:
            reasoning_parts.append(f"chunk {chunk_index}: {reasoning}")
        new_feature_alerts.extend([str(item) for item in (payload.get("new_feature_alerts") or []) if str(item or "").strip()])

        chunk_rows = payload.get("data") if isinstance(payload.get("data"), list) else []
        for row in chunk_rows:
            if not isinstance(row, dict):
                continue
            normalized_row = dict(row)
            if not normalized_row.get("source_page") and len(chunk_pages) == 1:
                normalized_row["source_page"] = chunk_pages[0]
            raw_rows.append(normalized_row)
            page_value = normalized_row.get("source_page")
            if page_value not in (None, ""):
                page_key = str(page_value)
                page_candidate_counts[page_key] = page_candidate_counts.get(page_key, 0) + 1

    payload = {
        "reasoning": " | ".join(reasoning_parts) if reasoning_parts else "No relevant diffusion data found.",
        "new_feature_alerts": list(dict.fromkeys(new_feature_alerts)),
        "data": raw_rows,
    }
    payload["_raw_model_output"] = "\n\n".join(raw_model_outputs) or "{}"
    payload["_page_coverage"] = ingest.get("page_coverage") or {}
    payload["_document_profile"] = ingest.get("document_profile") or {}
    payload["_page_candidate_counts"] = page_candidate_counts
    payload["_progress_log"] = progress_log
    return payload


async def process_diffusion_file_safe(
    file_id: int,
    *,
    force: bool = False,
    profile: str = "high_accuracy",
    run_id: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    profile = (profile or "high_accuracy").strip().lower()
    if profile not in {"high_accuracy", "standard"}:
        profile = "high_accuracy"

    async with async_session_maker() as db:
        run_id = run_id or uuid.uuid4().hex
        run_created = False
        literature = await db.get(Literature, file_id)
        if not literature:
            return {}, [], {}

        candidate_count, record_count = await _count_diffusion_artifacts(db, literature.id)
        if not force and (candidate_count or record_count):
            return await _load_cached_diffusion_result(db, literature)

        latest_run = await _get_latest_diffusion_run(db, literature.id)
        if not force and latest_run and str(latest_run.status or "").strip().lower() in {"completed", "no_data"}:
            metadata = {
                "title": literature.title,
                "authors": literature.authors,
                "doi": literature.doi,
                "journal": literature.journal,
                "year": literature.year,
                "volume": literature.volume,
                "issue": literature.issue,
                "pages": literature.pages,
                "issn": literature.issn,
            }
            summary = _parse_json(getattr(latest_run, "summary_json", None), {})
            summary.setdefault("run_id", latest_run.run_id)
            summary.setdefault("extractor_type", EXTRACTOR_TYPE)
            summary.setdefault("candidate_count", 0)
            summary.setdefault("final_count", 0)
            summary.setdefault("status", latest_run.status)
            if latest_run.error_message:
                summary.setdefault("current_message", latest_run.error_message)
                summary.setdefault("no_data_reason", latest_run.error_message)
            return metadata, [], summary
        if not force and latest_run and latest_run.status == "running" and latest_run.run_id != run_id:
            last_touch = latest_run.updated_at or latest_run.created_at
            if last_touch and (datetime.utcnow() - last_touch) <= timedelta(minutes=6):
                return {}, [], _build_in_progress_summary(latest_run)

        resolved_file_path = resolve_existing_path(literature.file_path)
        content = literature.content
        if not content and resolved_file_path:
            content = _read_file_content(resolved_file_path)
            literature.content = content

        existing_run = await get_extraction_run(db, run_id)

        pdf_error = None
        if not content and resolved_file_path and str(resolved_file_path).lower().endswith(".pdf"):
            pdf_error = validate_pdf_file(resolved_file_path, literature.title or os.path.basename(resolved_file_path))

        if not content and not (resolved_file_path and not pdf_error):
            message = pdf_error or "No readable content or source PDF is available. Please upload the paper again."
            summary = {
                "run_id": run_id,
                "extractor_type": EXTRACTOR_TYPE,
                "profile": profile,
                "status": "failed",
                "candidate_count": 0,
                "final_count": 0,
                "dropped_by_reason": {"unreadable_pdf" if pdf_error else "missing_content": 1},
                "page_coverage": {},
                "page_candidate_counts": {},
                "current_stage": "failed",
                "current_message": message,
                "progress_log": [{"stage": "failed", "message": message}],
            }
            literature.status = "failed"
            literature.error_message = message
            if existing_run:
                await finalize_extraction_run(
                    db,
                    run_id=run_id,
                    status="failed",
                    candidate_count=0,
                    final_count=0,
                    dropped_by_reason=summary["dropped_by_reason"],
                    summary=summary,
                    error_message=message,
                )
            await db.commit()
            return {}, [], summary

        if not content:
            content = ""

        literature.status = "extracting"
        await db.commit()
        if existing_run:
            existing_run.status = "running"
            existing_run.profile = profile
            existing_run.error_message = None
        else:
            await create_extraction_run(
                db,
                run_id=run_id,
                literature_id=literature.id,
                extractor_type=EXTRACTOR_TYPE,
                profile=profile,
            )
        run_created = True
        await db.commit()

        last_progress_flush = 0.0

        async def _finish_cancelled() -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
            summary = _build_cancelled_summary(run_id, profile=profile)
            literature.status = "cancelled"
            literature.error_message = CANCELLED_EXTRACTION_MESSAGE
            await finalize_extraction_run(
                db,
                run_id=run_id,
                status="cancelled",
                candidate_count=0,
                final_count=0,
                dropped_by_reason=summary["dropped_by_reason"],
                summary=summary,
                error_message=CANCELLED_EXTRACTION_MESSAGE,
            )
            await db.commit()
            return {}, [], summary

        async def _raise_if_cancelled() -> None:
            if await is_extraction_cancelled(db, run_id=run_id, literature_id=literature.id):
                raise ExtractionCancelledError(CANCELLED_EXTRACTION_MESSAGE)

        async def _persist_run_progress(progress_event: dict[str, Any]) -> None:
            nonlocal last_progress_flush
            async with async_session_maker() as cancel_db:
                if await is_extraction_cancelled(cancel_db, run_id=run_id, literature_id=file_id):
                    raise ExtractionCancelledError(CANCELLED_EXTRACTION_MESSAGE)

            now_mono = time.monotonic()
            if not progress_event.get("force") and (now_mono - last_progress_flush) < 3.0:
                return

            summary_patch = {
                "candidate_count": int(progress_event.get("candidate_count") or 0),
                "final_count": int(progress_event.get("final_count") or 0),
                "dropped_by_reason": progress_event.get("dropped_by_reason") or {},
                "page_coverage": progress_event.get("page_coverage") or {},
                "page_candidate_counts": progress_event.get("page_candidate_counts") or {},
                "progress_log": progress_event.get("progress_log") or [],
                "current_stage": progress_event.get("stage"),
                "current_message": progress_event.get("message"),
                "extractor_type": EXTRACTOR_TYPE,
            }
            await update_extraction_run_progress(
                db,
                run_id=run_id,
                candidate_count=summary_patch["candidate_count"],
                dropped_by_reason=summary_patch["dropped_by_reason"],
                page_coverage=summary_patch["page_coverage"],
                summary_patch=summary_patch,
            )
            await db.commit()
            last_progress_flush = now_mono

        try:
            payload = await asyncio.wait_for(
                _extract_diffusion_payload(
                    content=content,
                    pdf_path=resolved_file_path,
                    profile=profile,
                    progress_callback=_persist_run_progress,
                ),
                timeout=720 if profile == "high_accuracy" else 420,
            )
        except asyncio.TimeoutError:
            payload = {
                "reasoning": "Diffusion extraction timed out.",
                "new_feature_alerts": [],
                "data": [],
                "_raw_model_output": "{}",
                "_page_coverage": {},
                "_document_profile": {},
            }
        except ExtractionCancelledError:
            logger.info("Diffusion extraction cancelled for literature_id=%s", file_id)
            return await _finish_cancelled()

        try:
            await _raise_if_cancelled()
        except ExtractionCancelledError:
            logger.info("Diffusion extraction cancelled before persistence literature_id=%s", file_id)
            return await _finish_cancelled()

        raw_rows = payload.get("data") if isinstance(payload.get("data"), list) else []
        trace_candidates: list[dict[str, Any]] = []
        raw_drop_reasons: dict[str, int] = {}
        for row in raw_rows:
            drop_reason = diffusion_drop_reason(row, require_evidence_measure=True)
            if drop_reason:
                raw_drop_reasons[drop_reason] = raw_drop_reasons.get(drop_reason, 0) + 1
            trace_candidates.append(
                {
                    "stage": "stage_c",
                    "modality": "diffusion",
                    "page": row.get("source_page"),
                    "source_figure": row.get("source"),
                    "raw": row,
                    "normalized": None,
                    "drop_reason": drop_reason,
                }
            )

        normalized_rows = normalize_diffusion_records(
            raw_rows,
            pdf_path=resolved_file_path,
            provider=llm_service.provider,
            prompt_version=PROMPT_VERSION,
            raw_model_output=str(payload.get("_raw_model_output") or "{}"),
        )
        normalized_rows = dedupe_normalized_diffusion_records(normalized_rows)

        dropped_by_reason: dict[str, int] = dict(raw_drop_reasons)
        if raw_rows and not normalized_rows:
            if not dropped_by_reason:
                dropped_by_reason["no_valid_normalized_rows"] = len(raw_rows)

        try:
            await _raise_if_cancelled()
        except ExtractionCancelledError:
            logger.info("Diffusion extraction cancelled before database write literature_id=%s", file_id)
            return await _finish_cancelled()

        await db.execute(delete(DiffusionFeatureSet).where(DiffusionFeatureSet.literature_id == literature.id))
        await db.execute(delete(DiffusionCandidate).where(DiffusionCandidate.literature_id == literature.id))
        await db.execute(delete(DiffusionRecord).where(DiffusionRecord.literature_id == literature.id))

        response_rows: list[dict[str, Any]] = []
        feature_rows: list[DiffusionFeatureSet] = []
        candidate_rows: list[DiffusionCandidate] = []
        for row in normalized_rows:
            candidate = DiffusionCandidate(
                literature_id=literature.id,
                system_name=row.get("system_name"),
                confinement_material_class=row.get("confinement_material_class"),
                confinement_geometry_class=row.get("confinement_geometry_class"),
                surface_functional_groups=row.get("surface_functional_groups"),
                confinement_dimensionality=row.get("confinement_dimensionality"),
                ionic_liquid=row.get("ionic_liquid"),
                d_total=row.get("D_total"),
                d_cation=row.get("D_cation"),
                d_anion=row.get("D_anion"),
                d_unit=row.get("D_unit"),
                temperature_value=row.get("temperature_value"),
                confinement_scale_value=row.get("confinement_scale_value"),
                confinement_scale_unit=row.get("confinement_scale_unit"),
                source=row.get("source"),
                source_page=row.get("source_page"),
                source_bbox=json_dumps(row.get("source_bbox")),
                evidence=row.get("evidence"),
                provider=row.get("provider"),
                prompt_version=row.get("prompt_version"),
                raw_model_output=row.get("raw_model_output"),
                field_evidence_json=json_dumps(row.get("field_evidence_json") or {}),
                review_status=row.get("review_status"),
                record_origin=row.get("record_origin"),
                assembly_notes=row.get("assembly_notes"),
                confidence=float(row.get("confidence") or 0.9),
                novel_features_json=json_dumps(row.get("novel_features_json") or {}),
                smiles=row.get("smiles"),
                rdkit_features_json=json_dumps(row.get("rdkit_features_json") or {}),
            )
            candidate_rows.append(candidate)

        if candidate_rows:
            db.add_all(candidate_rows)
            await db.flush()

        for candidate, row in zip(candidate_rows, normalized_rows):
            feature_payload = build_feature_set_payload(row)
            if feature_payload.get("smiles") or feature_payload.get("rdkit_features_json"):
                feature_rows.append(
                    DiffusionFeatureSet(
                        literature_id=literature.id,
                        candidate_id=candidate.id,
                        ionic_liquid=feature_payload.get("ionic_liquid"),
                        smiles=feature_payload.get("smiles"),
                        rdkit_features_json=json_dumps(feature_payload.get("rdkit_features_json") or {}),
                        feature_version=row.get("feature_version"),
                    )
                )
            response_rows.append(serialize_diffusion_row_for_response(row, row_id=candidate.id))

        if feature_rows:
            db.add_all(feature_rows)

        metadata = await llm_service._extract_metadata_only(content)
        fallback_metadata = extract_metadata_fallback(content)
        if fallback_metadata:
            metadata = {**fallback_metadata, **(metadata or {})}
        if metadata.get("doi"):
            metadata["doi"] = DOIService()._normalize_doi(metadata["doi"]) or metadata["doi"]

        if metadata:
            literature.title = metadata.get("title") or literature.title
            literature.authors = metadata.get("authors") or literature.authors
            if metadata.get("doi"):
                await _safe_update_doi(db, literature, metadata["doi"])
            literature.journal = metadata.get("journal") or literature.journal
            literature.year = metadata.get("year") or literature.year
            literature.volume = metadata.get("volume") or literature.volume
            literature.issue = metadata.get("issue") or literature.issue
            literature.pages = metadata.get("pages") or literature.pages
            literature.issn = metadata.get("issn") or literature.issn

        try:
            await _raise_if_cancelled()
        except ExtractionCancelledError:
            logger.info("Diffusion extraction cancelled before finalize literature_id=%s", file_id)
            return await _finish_cancelled()

        no_data_message = None
        if not response_rows:
            no_data_message = build_no_data_reason(
                literature=literature,
                metadata=metadata,
                content=content or getattr(literature, "content", None),
                summary=payload,
                fallback="No extractable diffusion records found",
            )
        literature.status = "completed" if response_rows else "no_data"
        literature.error_message = None if response_rows else no_data_message
        if response_rows:
            _archive_completed_literature_pdf(literature, resolved_file_path)

        await add_extraction_candidates(
            db,
            run_id=run_id,
            candidates=[
                *trace_candidates,
                *[
                    {
                        "stage": "stage_d",
                        "modality": "diffusion",
                        "page": row.get("source_page"),
                        "source_figure": row.get("source"),
                        "raw": raw_rows[idx] if idx < len(raw_rows) else row,
                        "normalized": row,
                        "drop_reason": None,
                    }
                    for idx, row in enumerate(normalized_rows)
                ],
            ],
        )

        extraction_summary = {
            "run_id": run_id,
            "extractor_type": EXTRACTOR_TYPE,
            "candidate_count": len(trace_candidates) + len(normalized_rows),
            "final_count": len(response_rows),
            "dropped_by_reason": dropped_by_reason,
            "page_coverage": payload.get("_page_coverage") or {},
            "page_candidate_counts": payload.get("_page_candidate_counts") or {},
            "progress_log": [
                *(payload.get("_progress_log") or []),
                {"stage": "stage_d.normalize", "message": f"normalized_records={len(normalized_rows)}"},
            ],
            "reasoning": payload.get("reasoning"),
            "new_feature_alerts": payload.get("new_feature_alerts") or [],
            "document_profile": payload.get("_document_profile") or {},
        }
        if no_data_message:
            extraction_summary["current_stage"] = "stage_e.finalize"
            extraction_summary["current_message"] = no_data_message
            extraction_summary["no_data_reason"] = no_data_message
            extraction_summary["progress_log"] = [
                *extraction_summary["progress_log"],
                {"stage": "stage_e.finalize", "message": no_data_message},
            ]
        await finalize_extraction_run(
            db,
            run_id=run_id,
            status="completed" if response_rows else "no_data",
            candidate_count=extraction_summary["candidate_count"],
            final_count=extraction_summary["final_count"],
            dropped_by_reason=extraction_summary["dropped_by_reason"],
            summary=extraction_summary,
            error_message=None if response_rows else no_data_message,
        )
        await db.commit()
        return metadata, response_rows, extraction_summary


async def process_diffusion_file_background(
    file_id: int,
    *,
    force: bool = False,
    profile: str = "high_accuracy",
    run_id: str | None = None,
) -> None:
    logger.info("Starting background diffusion extraction for literature_id=%s", file_id)
    await process_diffusion_file_safe(file_id=file_id, force=force, profile=profile, run_id=run_id)

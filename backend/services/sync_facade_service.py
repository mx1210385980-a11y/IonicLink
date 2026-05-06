from __future__ import annotations

import io
import logging
import os
import re
from typing import Any

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import RecordCandidate, TribologyData
from schemas import SyncPayload
from security import AuthPrincipal, RequestScope, scope_filters
from services.agent_runtime_service import get_agent_runtime
from services.data_sync_service import (
    delete_literature,
    get_all_literature,
    get_literature_by_doi,
    get_literature_by_id,
    get_records_by_literature,
    sync_batch_data,
    sync_batch_data_with_replacement,
)
from services.doi_service import DOIService
from services.fallback_extraction_service import extract_metadata_fallback
from services.file_service import _read_file_content, _resolve_existing_path, _safe_update_doi
from services.il_resolver_service import resolve_il
from services.llm_service import llm_service
from services.score_service import calculate_confidence_details
from utils.tribopair import compose_tribopair_label, composite_roughness_label
from utils.cof_extraction import derive_cof_extracted, normalize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import (
    compact_lubricant_label,
    components_for_record,
    format_lubricant_tooltip,
)
from utils.structured_conditions import (
    derive_load_conditions,
    derive_tribological_system,
    normalize_load_conditions,
    normalize_tribological_system,
)
from utils.speed_conditions import derive_speed_conditions, normalize_speed_conditions
from utils.no_data_reason import build_no_data_reason

logger = logging.getLogger(__name__)


def _safe_year(year: int | None) -> int | None:
    return year if (year and year >= 1900) else None


def _present_text(value: Any) -> str:
    text = str(value or "").strip()
    if text.lower() in {"", "-", "--", "n/a", "na", "none", "null", "unknown", "untitled"}:
        return ""
    return text


def _is_temporary_identifier(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return bool(text and (text.startswith("temp-") or text.startswith("temporary-")))


def _is_filename_like_title(value: Any) -> bool:
    text = _present_text(value)
    if not text:
        return True
    lowered = text.lower()
    return lowered.endswith(".pdf") or bool(re.match(r"^(19|20)\d{2}[-_\s]+[a-z]", lowered))


def _literature_missing_metadata(literature) -> bool:
    return (
        not _present_text(getattr(literature, "title", ""))
        or not _present_text(getattr(literature, "authors", ""))
        or not _present_text(getattr(literature, "journal", ""))
        or not _safe_year(getattr(literature, "year", None))
        or not _present_text(getattr(literature, "doi", ""))
        or _is_temporary_identifier(getattr(literature, "doi", ""))
    )


def _metadata_payload_from_doi(metadata) -> dict[str, Any]:
    if not metadata:
        return {}
    return {
        "title": metadata.title,
        "authors": metadata.authors,
        "doi": metadata.doi,
        "journal": metadata.journal,
        "issn": metadata.issn,
        "year": metadata.year,
        "volume": metadata.volume,
        "issue": metadata.issue,
        "pages": metadata.pages,
    }


def _merge_metadata(*items: dict[str, Any] | None) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for item in items:
        if not item:
            continue
        for key, value in item.items():
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            merged[key] = value
    return merged


def _literature_to_payload(
    literature,
    *,
    record_count: int | None = None,
    candidate_count: int | None = None,
) -> dict[str, Any]:
    status = getattr(literature, "status", None)
    error_message = getattr(literature, "error_message", None)
    if str(status or "").strip().lower() == "no_data":
        error_message = build_no_data_reason(
            literature=literature,
            content=getattr(literature, "content", None),
            fallback=error_message,
        )
    return {
        "id": literature.id,
        "doi": literature.doi or "",
        "title": literature.title,
        "authors": literature.authors,
        "journal": literature.journal,
        "issn": literature.issn,
        "year": _safe_year(literature.year),
        "volume": literature.volume,
        "issue": literature.issue,
        "pages": literature.pages,
        "filePath": literature.file_path or "",
        "groupId": getattr(literature, "group_id", None),
        "workspaceId": getattr(literature, "workspace_id", None),
        "createdByUserId": getattr(literature, "created_by_user_id", None),
        "scopeType": getattr(literature, "scope_type", None),
        "status": status,
        "errorMessage": error_message,
        "recordCount": record_count,
        "candidateCount": candidate_count,
        "hasPdf": bool(getattr(literature, "file_path", None)),
        "created_at": literature.created_at,
    }


def _record_to_payload(record) -> dict[str, Any]:
    review_entity_type = "candidate" if isinstance(record, RecordCandidate) else "record"
    lubricant_components = components_for_record(record)
    lubricant_alias = getattr(record, "lubricant_alias", None)
    cof_extracted = normalize_cof_extracted(getattr(record, "cof_extracted_json", None)) or derive_cof_extracted(
        record.cof_raw,
        record.cof_value,
        load=record.load_raw or record.load_value,
        speed=record.speed_value,
    )
    load_conditions = normalize_load_conditions(getattr(record, "load_conditions_json", None)) or derive_load_conditions(record.load_raw or record.load_value)
    speed_conditions = normalize_speed_conditions(getattr(record, "speed_conditions_json", None)) or derive_speed_conditions(record.speed_value)
    tribological_system = normalize_tribological_system(getattr(record, "tribological_system_json", None)) or derive_tribological_system(getattr(record, "regime", None))
    experiment_profile = build_experiment_profile(
        {
            "tribological_system": tribological_system,
            "cof": record.cof_raw,
            "cof_value": record.cof_value,
            "load": record.load_raw or record.load_value,
            "speed": record.speed_value,
            "probe_geometry": record.probe_geometry,
            "probe_radius": record.probe_radius,
            "regime": getattr(record, "regime", None),
            "source": getattr(record, "source", None),
            "source_figure": getattr(record, "source_figure", None),
            "evidence": getattr(record, "evidence", None),
        }
    )
    if tribological_system:
        tribological_system = {**tribological_system, **experiment_profile}
    payload = {
        "id": record.id,
        "literatureId": record.literature_id,
        "materialName": record.material_name,
        "lubricant": record.lubricant,
        "lubricantComponents": lubricant_components,
        "lubricantAlias": lubricant_alias,
        "ionicLiquidDisplay": compact_lubricant_label(record.lubricant, lubricant_components, lubricant_alias),
        "lubricantTooltip": format_lubricant_tooltip(record.lubricant, lubricant_components, lubricant_alias),
        "cofExtracted": cof_extracted,
        "cofValue": record.cof_value,
        "cofOperator": record.cof_operator,
        "cofRaw": record.cof_raw,
        "loadValue": record.load_value,
        "loadRaw": record.load_raw,
        "loadConditions": load_conditions,
        "speedValue": record.speed_value,
        "speedConditions": speed_conditions,
        "shearRate": getattr(record, "shear_rate", None),
        "temperature": record.temperature,
        "potential": record.potential,
        "waterContent": record.water_content,
        "probeMaterial": record.probe_material,
        "probeGeometry": record.probe_geometry,
        "probeRadius": record.probe_radius,
        "probeRoughness": record.probe_roughness,
        "substrateMaterial": record.substrate_material,
        "substrateCoating": record.substrate_coating,
        "substrateRoughness": record.substrate_roughness,
        "tribopairLabel": compose_tribopair_label(
            record.probe_material,
            record.substrate_material,
            record.substrate_coating,
        ),
        "surfaceRoughness": composite_roughness_label(
            record.probe_roughness,
            record.substrate_roughness,
            method="rms",
            legacy_surface_roughness=record.surface_roughness,
        ),
        "residualFilmThicknessD": record.residual_film_thickness_d,
        "layerSpacingDelta": record.layer_spacing_delta,
        "filmThickness": record.film_thickness,
        "regime": getattr(record, "regime", None),
        "tribologicalSystem": tribological_system,
        "experimentProfile": experiment_profile,
        "experimentScale": experiment_profile["scale"],
        "experimentMethod": experiment_profile["method"],
        "measurementType": experiment_profile["measurement_type"],
        "trainingView": experiment_profile["training_view"],
        "molRatio": record.mol_ratio,
        "cation": record.cation,
        "anion": record.anion,
        "cationSmiles": record.cation_smiles,
        "anionSmiles": record.anion_smiles,
        "ilSmiles": record.il_smiles,
        "ilInchikey": record.il_inchikey,
        "alkylChainLength": record.alkyl_chain_length,
        "evidence": record.evidence,
        "source": record.source,
        "sourcePage": record.source_page,
        "sourceFigure": record.source_figure,
        "sampleId": record.sample_id,
        "seriesId": record.series_id,
        "fieldEvidenceJson": record.field_evidence_json,
        "reviewStatus": record.review_status,
        "recordOrigin": record.record_origin,
        "reviewEntityType": review_entity_type,
        "assemblyNotes": record.assembly_notes,
        "confidence": record.confidence,
        "extractedAt": record.extracted_at,
    }
    confidence_details = calculate_confidence_details(
        {
            **payload,
            "model_confidence": getattr(record, "confidence", None),
        }
    )
    payload["confidence"] = float(confidence_details.get("score") or 0.0)
    payload["confidenceDetails"] = confidence_details
    return payload


async def sync_payload(
    db: AsyncSession,
    payload: SyncPayload,
    *,
    principal: AuthPrincipal,
    scope: RequestScope,
    replace: bool = False,
):
    logger.info(
        "Sync facade invoked replace=%s scope=%s records=%s",
        replace,
        scope.scope_key,
        len(payload.records),
    )
    result = await (
        sync_batch_data_with_replacement(db, payload, principal=principal, scope=scope)
        if replace
        else sync_batch_data(db, payload, principal=principal, scope=scope)
    )
    if not result.success:
        raise HTTPException(status_code=500, detail=result.message)
    return result


async def list_literature_payload(
    db: AsyncSession,
    *,
    scope: RequestScope,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    logger.debug("Listing literature skip=%s limit=%s scope=%s", skip, limit, scope.scope_key)
    literature_list = await get_all_literature(db, skip=skip, limit=limit, scope_filter_values=scope_filters(scope))
    payload: list[dict[str, Any]] = []
    for item in literature_list:
        record_count = (
            await db.execute(select(func.count(TribologyData.id)).where(TribologyData.literature_id == item.id))
        ).scalar() or 0
        candidate_count = (
            await db.execute(select(func.count(RecordCandidate.id)).where(RecordCandidate.literature_id == item.id))
        ).scalar() or 0
        payload.append(
            _literature_to_payload(
                item,
                record_count=int(record_count or 0),
                candidate_count=int(candidate_count or 0),
            )
        )
    return payload


async def get_literature_detail_payload(db: AsyncSession, literature_id: int, *, scope: RequestScope) -> dict[str, Any]:
    logger.debug("Loading literature detail literature_id=%s scope=%s", literature_id, scope.scope_key)
    filters = scope_filters(scope)
    literature = await get_literature_by_id(db, literature_id, scope_filter_values=filters)
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")

    records = await get_records_by_literature(db, literature_id, scope_filter_values=filters)
    if not records:
        candidate_result = await db.execute(
            select(RecordCandidate)
            .where(RecordCandidate.literature_id == literature_id)
            .order_by(RecordCandidate.id.asc())
        )
        records = list(candidate_result.scalars().all())
    detail_records_are_candidates = bool(records and isinstance(records[0], RecordCandidate))
    payload = _literature_to_payload(
        literature,
        record_count=0 if detail_records_are_candidates else len(records),
        candidate_count=len(records) if detail_records_are_candidates else 0,
    )
    payload["tribologyData"] = [_record_to_payload(record) for record in records]
    return payload


async def get_literature_by_doi_payload(db: AsyncSession, doi: str, *, scope: RequestScope) -> dict[str, Any]:
    literature = await get_literature_by_doi(db, doi, scope_filter_values=scope_filters(scope))
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature with DOI={doi} not found")
    return _literature_to_payload(literature)


async def delete_literature_payload(db: AsyncSession, literature_id: int, *, scope: RequestScope) -> dict[str, Any]:
    logger.info("Deleting literature via facade literature_id=%s scope=%s", literature_id, scope.scope_key)
    deleted = await delete_literature(db, literature_id, scope_filter_values=scope_filters(scope))
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")
    return {"success": True, "message": f"Deleted Literature ID={literature_id} and all related data"}


async def patch_il_resolution_payload(db: AsyncSession) -> dict[str, Any]:
    try:
        logger.info("Starting IL re-resolution patch")
        query = select(TribologyData).where(TribologyData.lubricant.is_not(None))
        result = await db.execute(query)
        records = list(result.scalars().all())

        updated_count = 0
        skipped_count = 0

        for record in records:
            if record.cation and record.anion:
                skipped_count += 1
                continue

            resolved = resolve_il(record.lubricant or "")
            changed = False
            if resolved.get("cation") and not record.cation:
                record.cation = resolved["cation"]
                changed = True
            if resolved.get("anion") and not record.anion:
                record.anion = resolved["anion"]
                changed = True
            if resolved.get("cation_smiles") and not record.cation_smiles:
                record.cation_smiles = resolved["cation_smiles"]
                changed = True
            if resolved.get("anion_smiles") and not record.anion_smiles:
                record.anion_smiles = resolved["anion_smiles"]
                changed = True
            if resolved.get("il_smiles") and not record.il_smiles:
                record.il_smiles = resolved["il_smiles"]
                changed = True
            if resolved.get("il_inchikey") and not record.il_inchikey:
                record.il_inchikey = resolved["il_inchikey"]
                changed = True
            if resolved.get("alkyl_chain_length") is not None and record.alkyl_chain_length is None:
                record.alkyl_chain_length = resolved["alkyl_chain_length"]
                changed = True

            if changed:
                updated_count += 1

        await db.commit()
        logger.info(
            "IL re-resolution patch completed scanned=%s updated=%s skipped=%s",
            len(records),
            updated_count,
            skipped_count,
        )
        return {
            "success": True,
            "total_scanned": len(records),
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "message": f"Patched {updated_count} records, skipped {skipped_count} (already resolved)",
        }
    except Exception as exc:
        await db.rollback()
        logger.exception("IL re-resolution patch failed")
        raise HTTPException(status_code=500, detail=f"Patch failed: {str(exc)}") from exc


async def get_tribology_records_payload(db: AsyncSession, literature_id: int, *, scope: RequestScope) -> list[dict[str, Any]]:
    logger.debug("Loading tribology records literature_id=%s scope=%s", literature_id, scope.scope_key)
    filters = scope_filters(scope)
    literature = await get_literature_by_id(db, literature_id, scope_filter_values=filters)
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")
    records = await get_records_by_literature(db, literature_id, scope_filter_values=filters)
    return [_record_to_payload(record) for record in records]


async def backfill_literature_metadata_payload(
    db: AsyncSession,
    *,
    literature_id: int,
    force: bool = False,
) -> dict[str, Any]:
    logger.info("Backfilling literature metadata literature_id=%s force=%s", literature_id, force)
    literature = await get_literature_by_id(db, literature_id)
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")

    if not force and not _literature_missing_metadata(literature):
        return {
            "success": True,
            "literatureId": literature_id,
            "updated": False,
            "updatedFields": [],
            "message": "Metadata is already complete.",
            "metadata": _literature_to_payload(literature),
        }

    doi_service = DOIService()
    current_doi = _present_text(getattr(literature, "doi", ""))
    metadata: dict[str, Any] = {}
    source = "none"

    if current_doi and not _is_temporary_identifier(current_doi):
        try:
            metadata = _metadata_payload_from_doi(await doi_service.resolve_doi(current_doi))
            source = "doi"
        except Exception as exc:
            logger.warning("DOI metadata lookup failed literature_id=%s doi=%s error=%s", literature_id, current_doi, exc)

    if not metadata:
        content = str(getattr(literature, "content", "") or "").strip()
        if not content:
            resolved_path = _resolve_existing_path(getattr(literature, "file_path", None))
            if resolved_path:
                content = _read_file_content(resolved_path)
        if not content:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "No readable source content is available for metadata backfill.",
                    "needs_upload": True,
                },
            )

        fallback_metadata = extract_metadata_fallback(content)
        llm_metadata = await llm_service._extract_metadata_only(content)
        metadata = _merge_metadata(fallback_metadata, llm_metadata)
        source = "content"

        extracted_doi = _present_text(metadata.get("doi"))
        if extracted_doi:
            normalized_doi = doi_service._normalize_doi(extracted_doi) or extracted_doi
            metadata["doi"] = normalized_doi
            try:
                crossref_metadata = _metadata_payload_from_doi(await doi_service.resolve_doi(normalized_doi))
                metadata = _merge_metadata(metadata, crossref_metadata)
                source = "content+doi"
            except Exception as exc:
                logger.warning(
                    "Crossref enrichment failed during metadata backfill literature_id=%s doi=%s error=%s",
                    literature_id,
                    normalized_doi,
                    exc,
                )

    updated_fields: list[str] = []

    def apply_text_field(field: str, *, replace_filename_title: bool = False) -> None:
        new_value = _present_text(metadata.get(field))
        old_value = _present_text(getattr(literature, field, ""))
        if not new_value:
            return
        if not old_value or (replace_filename_title and _is_filename_like_title(old_value)):
            setattr(literature, field, new_value)
            updated_fields.append(field)

    apply_text_field("title", replace_filename_title=True)
    apply_text_field("authors")
    apply_text_field("journal")
    apply_text_field("issn")
    apply_text_field("volume")
    apply_text_field("issue")
    apply_text_field("pages")

    new_year = metadata.get("year")
    try:
        parsed_year = int(new_year) if new_year not in (None, "") else None
    except Exception:
        parsed_year = None
    old_year = _safe_year(getattr(literature, "year", None))
    should_replace_year = not old_year or (_is_temporary_identifier(current_doi) and old_year != parsed_year)
    if parsed_year and 1900 <= parsed_year <= 2100 and should_replace_year:
        literature.year = parsed_year
        updated_fields.append("year")

    new_doi = _present_text(metadata.get("doi"))
    if new_doi and (not current_doi or _is_temporary_identifier(current_doi)):
        if await _safe_update_doi(db, literature, new_doi):
            updated_fields.append("doi")

    if updated_fields:
        await db.commit()
        await db.refresh(literature)
    else:
        await db.flush()

    return {
        "success": True,
        "literatureId": literature_id,
        "updated": bool(updated_fields),
        "updatedFields": updated_fields,
        "message": "Metadata backfill completed." if updated_fields else "No stronger metadata was found.",
        "source": source,
        "metadata": _literature_to_payload(literature),
    }


async def read_optional_upload_text(file: UploadFile | None) -> str | None:
    if not file:
        return None

    content_bytes = await file.read()
    file_ext = os.path.splitext(file.filename or "")[1].lower()
    logger.debug("Reading optional upload content filename=%s ext=%s", file.filename, file_ext)

    if file_ext == ".pdf":
        from PyPDF2 import PdfReader

        pdf_reader = PdfReader(io.BytesIO(content_bytes))
        text_parts = []
        for page in pdf_reader.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
        return "\n\n".join(text_parts)

    if file_ext in [".txt", ".md"]:
        return content_bytes.decode("utf-8")

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported file type: {file_ext}. Supported: .pdf, .txt, .md",
    )


async def reprocess_literature_payload(
    db: AsyncSession,
    *,
    literature_id: int,
    file_content: str | None = None,
) -> dict[str, Any]:
    logger.info("Reprocessing literature via facade literature_id=%s", literature_id)
    result = await get_agent_runtime().reprocess_literature(
        literature_id=literature_id,
        db=db,
        file_content=file_content,
    )

    if not result.get("success"):
        message = result.get("message", "Reprocessing failed")
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        if result.get("needs_upload"):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": message,
                    "needs_upload": True,
                    "hint": "Please upload the original file to reprocess this literature record.",
                },
            )
        raise HTTPException(status_code=500, detail=message)

    return {
        "success": True,
        "literatureId": result.get("literature_id", literature_id),
        "reprocessedCount": result.get("reprocessed_count", 0),
        "message": result.get("message"),
        "metadata": result.get("metadata"),
        "needs_upload": False,
        "agent_workflow": result.get("agent_workflow") or {},
    }

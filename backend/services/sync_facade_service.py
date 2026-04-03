from __future__ import annotations

import io
import logging
import os
from typing import Any

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import TribologyData
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
from services.il_resolver_service import resolve_il
from utils.tribopair import compose_tribopair_label

logger = logging.getLogger(__name__)


def _safe_year(year: int | None) -> int | None:
    return year if (year and year >= 1900) else None


def _literature_to_payload(literature) -> dict[str, Any]:
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
        "created_at": literature.created_at,
    }


def _record_to_payload(record) -> dict[str, Any]:
    return {
        "id": record.id,
        "literatureId": record.literature_id,
        "materialName": record.material_name,
        "lubricant": record.lubricant,
        "cofValue": record.cof_value,
        "cofOperator": record.cof_operator,
        "cofRaw": record.cof_raw,
        "loadValue": record.load_value,
        "loadRaw": record.load_raw,
        "speedValue": record.speed_value,
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
        "surfaceRoughness": record.surface_roughness,
        "residualFilmThicknessD": record.residual_film_thickness_d,
        "layerSpacingDelta": record.layer_spacing_delta,
        "filmThickness": record.film_thickness,
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
        "confidence": record.confidence,
        "extractedAt": record.extracted_at,
    }


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
    return [_literature_to_payload(item) for item in literature_list]


async def get_literature_detail_payload(db: AsyncSession, literature_id: int, *, scope: RequestScope) -> dict[str, Any]:
    logger.debug("Loading literature detail literature_id=%s scope=%s", literature_id, scope.scope_key)
    filters = scope_filters(scope)
    literature = await get_literature_by_id(db, literature_id, scope_filter_values=filters)
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")

    records = await get_records_by_literature(db, literature_id, scope_filter_values=filters)
    payload = _literature_to_payload(literature)
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

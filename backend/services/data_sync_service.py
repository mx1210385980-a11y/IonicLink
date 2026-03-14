"""
Data Sync Service for IonicLink.

Implements scoped batch sync logic:
- Literature is deduplicated within the active scope only
- Personal workspaces are isolated by workspace id
- Shared group library is isolated by group id and shared scope key
"""

from __future__ import annotations

import re
import traceback
from typing import List, Optional, Tuple

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_base import normalize_ionic_liquid
from models.db_models import Literature, TribologyData
from schemas import LiteratureCreate, SyncPayload, SyncResult, TribologyDataCreate
from security import (
    AuthPrincipal,
    RequestScope,
    build_scope_key,
    can_manage_literature,
    literature_scope_conditions,
)
from services.doi_service import DOIService
from services.il_resolver_service import is_supported_ionic_liquid_name
from utils.tribopair import derive_legacy_material_name, derive_legacy_surface_roughness

_doi_service = DOIService()


def _is_unknown_il(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"", "unknown", "unknown il", "n/a", "none", "-", "--"}


def _canonicalize_il(value: Optional[str]) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text_l = text.lower()
    if "ethylammonium nitrate" in text_l or re.search(r"\bean\b", text_l):
        return "EAN"
    if "ethaline" in text_l:
        return "Ethaline"
    match = re.search(r"(\[[^\[\]]+?\]\s*(?:i\s*)?\[[^\[\]]+?\])", text)
    if match:
        return re.sub(r"\s+", "", match.group(1)).replace("]i[", "][")
    if len(text) > 80:
        return ""
    return text


def _format_thickness_nm(value: float) -> str:
    if float(value).is_integer():
        return f"{int(value)} nm"
    return f"{value:.3f}".rstrip("0").rstrip(".") + " nm"


def _normalize_quantitative_thickness(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    if not text or text.lower() in {"-", "--", "n/a", "none", "unknown"}:
        return None

    match = re.search(
        r"([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    magnitude = float(match.group(1))
    unit = match.group(2).lower()
    if unit in {"μm", "µm", "um"}:
        magnitude *= 1000.0
    elif unit == "pm":
        magnitude /= 1000.0
    elif unit in {"å", "a", "angstrom", "angstroms"}:
        magnitude /= 10.0

    return _format_thickness_nm(magnitude)


def _infer_lubricant(record: TribologyDataCreate) -> str:
    current = _canonicalize_il(getattr(record, "lubricant", ""))
    if current and not _is_unknown_il(current):
        return current

    candidate_spaces = [
        str(getattr(record, "evidence", "") or ""),
        str(getattr(record, "source", "") or ""),
        str(getattr(record, "source_figure", "") or ""),
    ]
    for text in candidate_spaces:
        candidate = _canonicalize_il(normalize_ionic_liquid(text))
        if candidate and not _is_unknown_il(candidate):
            return candidate
    return current


async def get_or_create_literature(
    db: AsyncSession,
    metadata: LiteratureCreate,
    *,
    principal: AuthPrincipal,
    scope: RequestScope,
) -> Tuple[Literature, bool]:
    raw_doi = metadata.doi.strip() if metadata.doi else ""
    normalized_doi = _doi_service._normalize_doi(raw_doi) if raw_doi else ""
    final_doi = normalized_doi if normalized_doi else None
    scope_key = build_scope_key(scope.scope_type, scope.workspace.id if scope.workspace else None)

    if final_doi:
        query = select(Literature).where(
            Literature.group_id == principal.group.id,
            Literature.scope_key == scope_key,
            Literature.doi == final_doi,
        )
        existing = (await db.execute(query)).scalar_one_or_none()
        if existing:
            return existing, False

    if not final_doi:
        import time

        final_doi = f"temp-{int(time.time() * 1000)}"

    literature = Literature(
        doi=final_doi,
        title=metadata.title,
        authors=metadata.authors,
        journal=metadata.journal,
        issn=getattr(metadata, "issn", None),
        year=metadata.year,
        volume=getattr(metadata, "volume", None),
        issue=getattr(metadata, "issue", None),
        pages=getattr(metadata, "pages", None),
        file_path=getattr(metadata, "file_path", None),
        group_id=principal.group.id,
        workspace_id=scope.workspace.id if scope.workspace else None,
        created_by_user_id=principal.user.id,
        scope_type=scope.scope_type,
        scope_key=scope_key,
    )
    db.add(literature)
    await db.flush()
    return literature, True


async def sync_batch_data(
    db: AsyncSession,
    payload: SyncPayload,
    *,
    principal: AuthPrincipal,
    scope: RequestScope,
) -> SyncResult:
    try:
        literature, is_new = await get_or_create_literature(db, payload.metadata, principal=principal, scope=scope)

        if not is_new:
            if not can_manage_literature(principal, literature):
                return SyncResult(
                    success=True,
                    literature_id=literature.id,
                    synced_count=0,
                    message="Literature already exists in this scope and is read-only for your role.",
                )
            await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))

        new_records: List[TribologyData] = []
        dropped_non_il = 0
        for record in payload.records:
            lubricant = _infer_lubricant(record)
            if not is_supported_ionic_liquid_name(lubricant):
                dropped_non_il += 1
                continue
            film_thickness = _normalize_quantitative_thickness(getattr(record, "film_thickness", None))
            residual_film_thickness_d = _normalize_quantitative_thickness(
                getattr(record, "residual_film_thickness_d", None)
            )
            layer_spacing_delta = _normalize_quantitative_thickness(getattr(record, "layer_spacing_delta", None))
            probe_material = getattr(record, "probe_material", None)
            probe_geometry = getattr(record, "probe_geometry", None)
            probe_radius = getattr(record, "probe_radius", None)
            probe_roughness = getattr(record, "probe_roughness", None)
            substrate_material = getattr(record, "substrate_material", None)
            substrate_coating = getattr(record, "substrate_coating", None)
            substrate_roughness = getattr(record, "substrate_roughness", None)
            new_records.append(
                TribologyData(
                    literature_id=literature.id,
                    material_name=derive_legacy_material_name(
                        probe_material=probe_material,
                        substrate_material=substrate_material,
                        legacy_material_name=record.material_name,
                    ),
                    lubricant=lubricant,
                    cof_value=record.cof_value,
                    cof_operator=record.cof_operator,
                    cof_raw=record.cof_raw,
                    load_value=record.load_value,
                    load_raw=record.load_raw,
                    speed_value=getattr(record, "speed_raw", None) or record.speed_value,
                    temperature=getattr(record, "temperature", None),
                    potential=getattr(record, "potential", None),
                    water_content=getattr(record, "water_content", None),
                    probe_material=probe_material,
                    probe_geometry=probe_geometry,
                    probe_radius=probe_radius,
                    probe_roughness=probe_roughness,
                    substrate_material=substrate_material,
                    substrate_coating=substrate_coating,
                    substrate_roughness=substrate_roughness,
                    surface_roughness=derive_legacy_surface_roughness(
                        probe_roughness=probe_roughness,
                        substrate_roughness=substrate_roughness,
                        legacy_surface_roughness=getattr(record, "surface_roughness", None),
                    ),
                    residual_film_thickness_d=residual_film_thickness_d,
                    layer_spacing_delta=layer_spacing_delta,
                    film_thickness=film_thickness,
                    mol_ratio=getattr(record, "mol_ratio", None),
                    cation=getattr(record, "cation", None),
                    anion=getattr(record, "anion", None),
                    cation_smiles=getattr(record, "cation_smiles", None),
                    anion_smiles=getattr(record, "anion_smiles", None),
                    il_smiles=getattr(record, "il_smiles", None),
                    il_inchikey=getattr(record, "il_inchikey", None),
                    alkyl_chain_length=getattr(record, "alkyl_chain_length", None),
                    evidence=getattr(record, "evidence", None),
                    source=getattr(record, "source", None),
                    source_page=getattr(record, "source_page", None),
                    source_figure=getattr(record, "source_figure", None),
                    confidence=record.confidence,
                )
            )

        db.add_all(new_records)
        await db.commit()
        return SyncResult(
            success=True,
            literature_id=literature.id,
            synced_count=len(new_records),
            message=(
                f"Scoped sync completed: {len(new_records)} records saved to literature ID={literature.id}, "
                f"filtered out {dropped_non_il} non-ionic-liquid records."
            ),
        )
    except Exception as exc:
        print(f"[Sync] ERROR: {exc}")
        traceback.print_exc()
        await db.rollback()
        return SyncResult(
            success=False,
            literature_id=0,
            synced_count=0,
            message=f"Sync failed: {str(exc)}",
        )


async def sync_batch_data_with_replacement(
    db: AsyncSession,
    payload: SyncPayload,
    *,
    principal: AuthPrincipal,
    scope: RequestScope,
) -> SyncResult:
    return await sync_batch_data(db, payload, principal=principal, scope=scope)


async def get_literature_by_id(
    db: AsyncSession,
    literature_id: int,
    *,
    scope_filter_values: dict | None = None,
) -> Optional[Literature]:
    query = select(Literature).where(Literature.id == literature_id)
    if scope_filter_values:
        query = query.where(*literature_scope_conditions(scope_filter_values))
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_literature_by_doi(
    db: AsyncSession,
    doi: str,
    *,
    scope_filter_values: dict | None = None,
) -> Optional[Literature]:
    query = select(Literature).where(Literature.doi == doi)
    if scope_filter_values:
        query = query.where(*literature_scope_conditions(scope_filter_values))
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_records_by_literature(
    db: AsyncSession,
    literature_id: int,
    *,
    scope_filter_values: dict | None = None,
) -> List[TribologyData]:
    query = select(TribologyData).join(TribologyData.literature).where(TribologyData.literature_id == literature_id)
    if scope_filter_values:
        query = query.where(*literature_scope_conditions(scope_filter_values))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_all_literature(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    *,
    scope_filter_values: dict | None = None,
) -> List[Literature]:
    query = select(Literature)
    if scope_filter_values:
        query = query.where(*literature_scope_conditions(scope_filter_values))
    query = query.order_by(Literature.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def delete_literature(
    db: AsyncSession,
    literature_id: int,
    *,
    scope_filter_values: dict | None = None,
) -> bool:
    literature = await get_literature_by_id(db, literature_id, scope_filter_values=scope_filter_values)
    if not literature:
        return False
    await db.delete(literature)
    await db.commit()
    return True

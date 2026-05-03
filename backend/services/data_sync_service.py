"""
Data Sync Service for IonicLink.

Implements scoped batch sync logic:
- Literature is deduplicated within the active scope only
- Personal workspaces are isolated by workspace id
- Shared group library is isolated by group id and shared scope key
"""

from __future__ import annotations

import json
import logging
import re
import traceback
from typing import List, Optional, Tuple

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_base import normalize_ionic_liquid
from models.db_models import Literature, RecordCandidate, TribologyData
from schemas import LiteratureCreate, SyncPayload, SyncResult, TribologyDataCreate
from security import (
    AuthPrincipal,
    RequestScope,
    build_scope_key,
    can_manage_literature,
    literature_scope_conditions,
)
from services.doi_service import DOIService
from services.il_resolver_service import is_supported_ionic_liquid_name, resolve_il
from utils.cof_extraction import derive_cof_extracted, normalize_cof_extracted, serialize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import (
    normalize_lubricant_components,
    parse_lubricant_components,
    serialize_lubricant_components,
)
from utils.structured_conditions import (
    derive_load_conditions,
    derive_tribological_system,
    normalize_load_conditions,
    normalize_tribological_system,
    serialize_load_conditions,
    serialize_tribological_system,
)
from utils.speed_conditions import (
    derive_speed_conditions,
    normalize_speed_conditions,
    serialize_speed_conditions,
    speed_value_from_conditions,
)
from utils.tribopair import derive_legacy_material_name, derive_legacy_surface_roughness

_doi_service = DOIService()
logger = logging.getLogger(__name__)


def _is_unknown_il(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"", "unknown", "unknown il", "n/a", "none", "-", "--"}


def _strip_charge_symbols(text: str) -> str:
    """Strip charge symbols and extra whitespace from bracket notation.

    Converts formats like ``[BMIm]+ [BF4]-`` → ``[BMIm][BF4]``
    and ``[P4,4,4,1 ]+ [TFSI]-`` → ``[P4,4,4,1][TFSI]``.
    """
    # Remove charge symbols adjacent to brackets: ]+ → ], ]- → ], ]2+ → ]
    text = re.sub(r"\]\s*\d*[+\-]", "]", text)
    # Remove spaces between ][
    text = re.sub(r"\]\s+\[", "][", text)
    # Remove leading/trailing spaces inside brackets: [ X ] → [X]
    text = re.sub(r"\[\s+", "[", text)
    text = re.sub(r"\s+\]", "]", text)
    return text.strip()


def _canonicalize_il(value: Optional[str]) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text_l = text.lower()
    if "ethylammonium nitrate" in text_l or re.search(r"\bean\b", text_l):
        return "EAN"
    if "ethaline" in text_l:
        return "Ethaline"

    # Strip charge symbols first
    text = _strip_charge_symbols(text)

    # Handle mixture notation: [X][Y] / carrier
    mixture_match = re.match(r"(\[.+?\]\s*\[.+?\])\s*/\s*(.+)", text)
    if mixture_match:
        il_part = mixture_match.group(1).strip()
        carrier = mixture_match.group(2).strip()
        resolved = resolve_il(il_part)
        canonical = resolved.get("canonical_name")
        if canonical:
            return f"{canonical} / {carrier}"
        # Compact whitespace in the IL part even if unresolved
        il_part = re.sub(r"\s+", "", il_part).replace("]i[", "][")
        return f"{il_part} / {carrier}"

    # Try full resolve_il() pipeline
    resolved = resolve_il(text)
    if resolved.get("canonical_name"):
        return resolved["canonical_name"]

    # Fallback: compact bracket notation
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

    uncertainty_match = re.search(
        r"([-+]?\d*\.?\d+)\s*(?:±|\+/-|\+∕-)\s*([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)",
        text,
        flags=re.IGNORECASE,
    )
    if uncertainty_match:
        magnitude = float(uncertainty_match.group(1))
        uncertainty = float(uncertainty_match.group(2))
        unit = uncertainty_match.group(3).lower()
        if unit in {"μm", "µm", "um"}:
            magnitude *= 1000.0
            uncertainty *= 1000.0
        elif unit == "pm":
            magnitude /= 1000.0
            uncertainty /= 1000.0
        elif unit in {"å", "a", "angstrom", "angstroms"}:
            magnitude /= 10.0
            uncertainty /= 10.0
        return f"{_format_thickness_nm(magnitude).removesuffix(' nm')} ± {_format_thickness_nm(uncertainty)}"

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
    logger.debug(
        "Resolving literature for scope_key=%s doi=%s",
        build_scope_key(scope.scope_type, scope.workspace.id if scope.workspace else None),
        metadata.doi,
    )
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
        file_hash=getattr(metadata, "file_hash", None),
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
        logger.info(
            "Syncing %s records into scope=%s replace=%s",
            len(payload.records),
            scope.scope_key,
            False,
        )
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
            lubricant_components = normalize_lubricant_components(getattr(record, "lubricant_components", None))
            if not lubricant_components:
                lubricant_components = parse_lubricant_components(
                    lubricant,
                    getattr(record, "mol_ratio", None),
                    getattr(record, "cation", None),
                    getattr(record, "anion", None),
                )
            component_supported = bool(lubricant_components) and all(
                is_supported_ionic_liquid_name(component.get("compound")) for component in lubricant_components
            )
            if not is_supported_ionic_liquid_name(lubricant) and not component_supported:
                dropped_non_il += 1
                continue
            cof_extracted = normalize_cof_extracted(getattr(record, "cof_extracted", None))
            if not cof_extracted:
                cof_extracted = derive_cof_extracted(
                    record.cof_raw,
                    record.cof_value,
                    load=record.load_raw or record.load_value,
                    speed=record.speed_value,
                )
            load_conditions = normalize_load_conditions(getattr(record, "load_conditions", None)) or derive_load_conditions(
                record.load_raw or record.load_value
            )
            speed_conditions = normalize_speed_conditions(getattr(record, "speed_conditions", None))
            if not speed_conditions:
                speed_conditions = derive_speed_conditions(
                    getattr(record, "speed_raw", None) or record.speed_value,
                    context=getattr(record, "evidence", None),
                )
            speed_value = speed_value_from_conditions(speed_conditions) or getattr(record, "speed_raw", None) or record.speed_value
            if speed_conditions.get("scan_rate_hz") is not None and speed_conditions.get("sliding_velocity_um_s") is None:
                speed_value = None
            tribological_system = normalize_tribological_system(getattr(record, "tribological_system", None)) or derive_tribological_system(
                getattr(record, "regime", None)
            )
            experiment_profile = build_experiment_profile(
                {
                    "tribological_system": tribological_system,
                    "experiment_scale": getattr(record, "experiment_scale", None),
                    "experiment_method": getattr(record, "experiment_method", None),
                    "measurement_type": getattr(record, "measurement_type", None),
                    "cof": record.cof_raw or record.cof_value,
                    "load": record.load_raw or record.load_value,
                    "speed": speed_value,
                    "probe_geometry": getattr(record, "probe_geometry", None),
                    "probe_radius": getattr(record, "probe_radius", None),
                    "regime": getattr(record, "regime", None),
                    "source": getattr(record, "source", None),
                    "source_figure": getattr(record, "source_figure", None),
                    "evidence": getattr(record, "evidence", None),
                }
            )
            tribological_system = {**tribological_system, **experiment_profile} if tribological_system else experiment_profile

            # Resolve IL chemistry to backfill cation/anion/SMILES
            resolved = resolve_il(lubricant)
            rec_cation = getattr(record, "cation", None) or resolved.get("cation")
            rec_anion = getattr(record, "anion", None) or resolved.get("anion")
            rec_cation_smiles = getattr(record, "cation_smiles", None) or resolved.get("cation_smiles")
            rec_anion_smiles = getattr(record, "anion_smiles", None) or resolved.get("anion_smiles")
            rec_il_smiles = getattr(record, "il_smiles", None) or resolved.get("il_smiles")
            rec_il_inchikey = getattr(record, "il_inchikey", None) or resolved.get("il_inchikey")
            rec_alkyl_chain = getattr(record, "alkyl_chain_length", None)
            if rec_alkyl_chain is None:
                rec_alkyl_chain = resolved.get("alkyl_chain_length")

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
                    lubricant_components_json=serialize_lubricant_components(lubricant_components),
                    lubricant_alias=getattr(record, "lubricant_alias", None),
                    cof_value=record.cof_value,
                    cof_operator=record.cof_operator,
                    cof_raw=record.cof_raw,
                    cof_extracted_json=serialize_cof_extracted(cof_extracted),
                    load_value=record.load_value,
                    load_raw=record.load_raw,
                    load_conditions_json=serialize_load_conditions(load_conditions),
                    speed_value=speed_value,
                    speed_conditions_json=serialize_speed_conditions(speed_conditions),
                    shear_rate=getattr(record, "shear_rate", None),
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
                    regime=getattr(record, "regime", None),
                    tribological_system_json=serialize_tribological_system(tribological_system),
                    mol_ratio=getattr(record, "mol_ratio", None),
                    cation=rec_cation,
                    anion=rec_anion,
                    cation_smiles=rec_cation_smiles,
                    anion_smiles=rec_anion_smiles,
                    il_smiles=rec_il_smiles,
                    il_inchikey=rec_il_inchikey,
                    alkyl_chain_length=rec_alkyl_chain,
                    evidence=getattr(record, "evidence", None),
                    source=getattr(record, "source", None),
                    source_page=getattr(record, "source_page", None),
                    source_figure=getattr(record, "source_figure", None),
                    sample_id=getattr(record, "sample_id", None),
                    series_id=getattr(record, "series_id", None),
                    field_evidence_json=json.dumps(getattr(record, "field_evidence_json", {}) or {}, ensure_ascii=False),
                    review_status=getattr(record, "review_status", None),
                    record_origin=getattr(record, "record_origin", None),
                    assembly_notes=getattr(record, "assembly_notes", None),
                    confidence=record.confidence,
                )
            )

        db.add_all(new_records)
        await db.commit()
        logger.info(
            "Sync completed for literature_id=%s saved=%s dropped_non_il=%s",
            literature.id,
            len(new_records),
            dropped_non_il,
        )
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
        logger.exception("Sync failed")
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
    logger.info("Running replacement sync for scope=%s", scope.scope_key)
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
    literature_list = list(result.scalars().all())

    changed = False
    for literature in literature_list:
        status = str(literature.status or "").strip().lower()
        if status not in {"failed", "no_data"}:
            continue
        candidate_count = (
            await db.execute(select(func.count(RecordCandidate.id)).where(RecordCandidate.literature_id == literature.id))
        ).scalar() or 0
        record_count = (
            await db.execute(select(func.count(TribologyData.id)).where(TribologyData.literature_id == literature.id))
        ).scalar() or 0
        if int(candidate_count or 0) > 0 or int(record_count or 0) > 0:
            literature.status = "completed"
            literature.error_message = None
            changed = True

    if changed:
        await db.commit()

    return literature_list


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
    logger.info("Deleted literature_id=%s", literature_id)
    return True

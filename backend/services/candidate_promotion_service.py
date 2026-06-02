from __future__ import annotations

from datetime import datetime
from pathlib import Path

import fitz

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import (
    DiffusionCandidate,
    DiffusionFeatureSet,
    DiffusionRecord,
    Literature,
    RecordCandidate,
    TribologyData,
)
from services.normalization import normalize_extraction_row
from utils.document_context import apply_experimental_document_context, extract_experimental_document_context


def _filled_text(value: object) -> bool:
    return bool(str(value or "").strip())


def _probe_value_is_missing(value: object) -> bool:
    return str(value or "").strip().lower() in {
        "",
        "-",
        "--",
        "n/a",
        "na",
        "none",
        "null",
        "unknown",
        "unknown material",
        "probe n/a",
        "not specified",
    }


def _tribology_record_context_item(record: TribologyData) -> dict[str, object]:
    return {
        "material_name": record.material_name,
        "ionic_liquid": record.lubricant,
        "cof": record.cof_raw if record.cof_raw else (str(record.cof_value) if record.cof_value is not None else None),
        "load": record.load_raw or record.load_value,
        "speed": record.speed_value,
        "shear_rate": record.shear_rate,
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "film_thickness": record.film_thickness,
        "residual_film_thickness_d": record.residual_film_thickness_d,
        "layer_spacing_delta": record.layer_spacing_delta,
        "regime": record.regime,
        "surface_roughness": record.surface_roughness,
        "probe_material": record.probe_material,
        "probe_geometry": record.probe_geometry,
        "probe_radius": record.probe_radius,
        "probe_roughness": record.probe_roughness,
        "substrate_material": record.substrate_material,
        "substrate_coating": record.substrate_coating,
        "substrate_roughness": record.substrate_roughness,
        "evidence": record.evidence,
        "source": record.source,
        "source_page": record.source_page,
        "source_figure": record.source_figure,
        "sample_id": record.sample_id,
        "series_id": record.series_id,
    }


def _resolve_literature_file_path(raw_path: object) -> Path | None:
    text = str(raw_path or "").strip()
    if not text:
        return None
    normalized = text.replace("\\", "/")
    backend_root = Path(__file__).resolve().parents[1]
    workspace_root = backend_root.parent
    candidates = [Path(normalized)]
    if not Path(normalized).is_absolute():
        candidates.extend([backend_root / normalized, workspace_root / normalized])
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _load_literature_context_text(literature: Literature | None) -> str:
    if literature is None:
        return ""
    content = str(getattr(literature, "content", "") or "").strip()
    if content:
        return content

    pdf_path = _resolve_literature_file_path(getattr(literature, "file_path", None))
    if not pdf_path:
        return ""
    try:
        with fitz.open(pdf_path) as doc:
            return "\n".join(doc[page_index].get_text("text") or "" for page_index in range(len(doc))).strip()
    except Exception:
        return ""


async def _apply_literature_context_to_tribology_record(
    db: AsyncSession,
    record: TribologyData,
) -> None:
    literature = await db.get(Literature, record.literature_id)
    literature_content = _load_literature_context_text(literature)
    if not literature_content:
        return
    if literature is not None and not str(getattr(literature, "content", "") or "").strip():
        literature.content = literature_content

    document_context = extract_experimental_document_context({0: literature_content})
    if not document_context:
        return

    item = apply_experimental_document_context(
        _tribology_record_context_item(record),
        document_context,
    )
    item = normalize_extraction_row(
        item,
        getattr(record, "source_page", None),
        page_context=literature_content,
    )

    for item_key, column_name in (
        ("probe_material", "probe_material"),
        ("probe_geometry", "probe_geometry"),
        ("probe_radius", "probe_radius"),
        ("probe_roughness", "probe_roughness"),
        ("substrate_material", "substrate_material"),
        ("substrate_coating", "substrate_coating"),
        ("substrate_roughness", "substrate_roughness"),
        ("material_name", "material_name"),
    ):
        value = item.get(item_key)
        if not _filled_text(value):
            continue

        current = getattr(record, column_name, None)
        if column_name == "probe_material":
            should_update = _probe_value_is_missing(current)
        elif column_name == "probe_geometry":
            value_l = str(value or "").strip().lower()
            probe_l = str(item.get("probe_material") or "").strip().lower()
            should_update = (
                (not _filled_text(current) and (value_l != "surface pair" or probe_l == "mica"))
                or (
                    str(current or "").strip().lower() == "colloid probe"
                    and value_l == "tip"
                    and probe_l == "silicon nitride"
                )
            )
        else:
            should_update = not _filled_text(current)

        if should_update:
            setattr(record, column_name, value)


def copy_tribology_candidate_to_final_record(
    candidate: RecordCandidate,
    record: TribologyData | None = None,
) -> TribologyData:
    target = record or TribologyData(literature_id=candidate.literature_id)
    target.literature_id = candidate.literature_id
    target.material_name = candidate.material_name
    target.lubricant = candidate.lubricant
    target.lubricant_components_json = candidate.lubricant_components_json
    target.lubricant_alias = candidate.lubricant_alias
    target.cof_value = candidate.cof_value
    target.cof_operator = candidate.cof_operator
    target.cof_raw = candidate.cof_raw
    target.cof_extracted_json = candidate.cof_extracted_json
    target.load_value = candidate.load_value
    target.load_raw = candidate.load_raw
    target.load_conditions_json = candidate.load_conditions_json
    target.speed_value = candidate.speed_value
    target.speed_conditions_json = candidate.speed_conditions_json
    target.shear_rate = candidate.shear_rate
    target.temperature = candidate.temperature
    target.potential = candidate.potential
    target.water_content = candidate.water_content
    target.probe_material = candidate.probe_material
    target.probe_geometry = candidate.probe_geometry
    target.probe_radius = candidate.probe_radius
    target.probe_roughness = candidate.probe_roughness
    target.substrate_material = candidate.substrate_material
    target.substrate_coating = candidate.substrate_coating
    target.substrate_roughness = candidate.substrate_roughness
    target.surface_roughness = candidate.surface_roughness
    target.residual_film_thickness_d = candidate.residual_film_thickness_d
    target.layer_spacing_delta = candidate.layer_spacing_delta
    target.film_thickness = candidate.film_thickness
    target.regime = candidate.regime
    target.tribological_system_json = candidate.tribological_system_json
    target.mol_ratio = candidate.mol_ratio
    target.cation = candidate.cation
    target.anion = candidate.anion
    target.cation_smiles = candidate.cation_smiles
    target.anion_smiles = candidate.anion_smiles
    target.il_smiles = candidate.il_smiles
    target.il_inchikey = candidate.il_inchikey
    target.alkyl_chain_length = candidate.alkyl_chain_length
    target.confidence = candidate.confidence
    target.sample_id = candidate.sample_id
    target.series_id = candidate.series_id
    target.field_evidence_json = candidate.field_evidence_json
    target.review_status = candidate.review_status
    target.record_origin = (
        "review_secondary_promoted"
        if str(candidate.record_origin or "").strip().lower() == "review_secondary"
        else "review_promoted_candidate"
    )
    target.assembly_notes = candidate.assembly_notes
    target.evidence = candidate.evidence
    target.evidence_page = candidate.evidence_page
    target.evidence_bbox = candidate.evidence_bbox
    target.source = candidate.source
    target.source_page = candidate.source_page
    target.source_figure = candidate.source_figure
    return target


async def promote_tribology_candidate(
    db: AsyncSession,
    candidate: RecordCandidate,
) -> TribologyData:
    promoted_record = None
    if candidate.promoted_record_id:
        promoted_record = await db.get(TribologyData, candidate.promoted_record_id)

    if promoted_record is None:
        promoted_record = copy_tribology_candidate_to_final_record(candidate)
        db.add(promoted_record)
        await db.flush()
        candidate.promoted_record_id = promoted_record.id
    else:
        copy_tribology_candidate_to_final_record(candidate, promoted_record)

    await _apply_literature_context_to_tribology_record(db, promoted_record)
    candidate.promoted_at = datetime.utcnow()
    return promoted_record


def copy_diffusion_candidate_to_final_record(
    candidate: DiffusionCandidate,
    record: DiffusionRecord | None = None,
) -> DiffusionRecord:
    target = record or DiffusionRecord(literature_id=candidate.literature_id)
    target.literature_id = candidate.literature_id
    target.system_name = candidate.system_name
    target.confinement_material_class = candidate.confinement_material_class
    target.confinement_geometry_class = candidate.confinement_geometry_class
    target.surface_functional_groups = candidate.surface_functional_groups
    target.confinement_dimensionality = candidate.confinement_dimensionality
    target.ionic_liquid = candidate.ionic_liquid
    target.d_total = candidate.d_total
    target.d_cation = candidate.d_cation
    target.d_anion = candidate.d_anion
    target.d_unit = candidate.d_unit
    target.temperature_value = candidate.temperature_value
    target.confinement_scale_value = candidate.confinement_scale_value
    target.confinement_scale_unit = candidate.confinement_scale_unit
    target.source = candidate.source
    target.source_page = candidate.source_page
    target.source_bbox = candidate.source_bbox
    target.evidence = candidate.evidence
    target.provider = candidate.provider
    target.prompt_version = candidate.prompt_version
    target.raw_model_output = candidate.raw_model_output
    target.field_evidence_json = candidate.field_evidence_json
    target.review_status = candidate.review_status
    target.record_origin = "review_promoted_candidate"
    target.assembly_notes = candidate.assembly_notes
    target.confidence = candidate.confidence
    target.novel_features_json = candidate.novel_features_json
    target.smiles = candidate.smiles
    target.rdkit_features_json = candidate.rdkit_features_json
    return target


async def promote_diffusion_candidate(
    db: AsyncSession,
    candidate: DiffusionCandidate,
) -> DiffusionRecord:
    promoted_record = None
    if candidate.promoted_record_id:
        promoted_record = await db.get(DiffusionRecord, candidate.promoted_record_id)

    if promoted_record is None:
        promoted_record = copy_diffusion_candidate_to_final_record(candidate)
        db.add(promoted_record)
        await db.flush()
        candidate.promoted_record_id = promoted_record.id
    else:
        copy_diffusion_candidate_to_final_record(candidate, promoted_record)

    await db.execute(
        update(DiffusionFeatureSet)
        .where(DiffusionFeatureSet.candidate_id == candidate.id)
        .values(record_id=promoted_record.id)
    )
    candidate.promoted_at = datetime.utcnow()
    return promoted_record

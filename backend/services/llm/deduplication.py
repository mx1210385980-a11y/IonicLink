from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from models.tribology import TribologyData
from services.llm.utils import has_core_quantitative_signal, normalize_record_value
from services.unit_converter import parse_force_to_newtons, parse_speed_to_mps


def _norm_text(value: Any) -> str:
    return normalize_record_value(value).replace("μ", "u").replace("µ", "u")


def _norm_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _norm_cof(value: Any) -> Optional[float]:
    v = _norm_float(value)
    if v is None:
        return None
    if not (0.0 <= v <= 5.0):
        return None
    return round(v, 6)


def _condition_signature(record: TribologyData) -> Tuple[str, ...]:
    return (
        _norm_text(record.temperature),
        _norm_text(record.potential),
        _norm_text(record.water_content),
        _norm_text(record.surface_roughness),
        _norm_text(record.film_thickness),
        _norm_text(record.residual_film_thickness_d),
        _norm_text(record.layer_spacing_delta),
        _norm_text(record.speed),
        _norm_text(record.shear_rate),
        _norm_text(record.normal_load or record.load),
        _norm_text(record.mol_ratio),
    )


def _entity_key(record: TribologyData) -> Tuple[str, ...]:
    sample_id = _norm_text(getattr(record, "sample_id", None))
    series_id = _norm_text(getattr(record, "series_id", None))
    source_figure = _norm_text(getattr(record, "source_figure", None))
    source_page = str(getattr(record, "source_page", None) or "")
    source = _norm_text(getattr(record, "source", None))

    cof = _norm_cof(record.cof)
    friction = _norm_text(record.friction_force)

    outcome = f"cof:{cof}" if cof is not None else f"friction:{friction}"

    return (
        _norm_text(record.material_name),
        _norm_text(record.ionic_liquid),
        sample_id,
        series_id,
        outcome,
        source,
        source_page,
        source_figure,
    )


def _value_compatible(field_name: str, left: Any, right: Any) -> bool:
    l = _norm_text(left)
    r = _norm_text(right)
    if not l or not r:
        return True

    if field_name == "speed":
        l_speed = parse_speed_to_mps(l)
        r_speed = parse_speed_to_mps(r)
        if l_speed is not None and r_speed is not None:
            tol = max(1e-10, abs(l_speed) * 0.01)
            return abs(l_speed - r_speed) <= tol

    if field_name in {"load", "normal_load"}:
        l_load = parse_force_to_newtons(l)
        r_load = parse_force_to_newtons(r)
        if l_load is not None and r_load is not None:
            return abs(l_load - r_load) <= 1e-12

    l_num = _norm_float(l)
    r_num = _norm_float(r)
    if l_num is not None and r_num is not None:
        return abs(l_num - r_num) <= 1e-6

    return l == r


def _are_compatible(left: TribologyData, right: TribologyData) -> bool:
    checks = [
        ("temperature", left.temperature, right.temperature),
        ("potential", left.potential, right.potential),
        ("water_content", left.water_content, right.water_content),
        ("surface_roughness", left.surface_roughness, right.surface_roughness),
        ("film_thickness", left.film_thickness, right.film_thickness),
        ("residual_film_thickness_d", left.residual_film_thickness_d, right.residual_film_thickness_d),
        ("layer_spacing_delta", left.layer_spacing_delta, right.layer_spacing_delta),
        ("speed", left.speed, right.speed),
        ("shear_rate", left.shear_rate, right.shear_rate),
        ("normal_load", left.normal_load or left.load, right.normal_load or right.load),
        ("mol_ratio", left.mol_ratio, right.mol_ratio),
    ]

    for field_name, l, r in checks:
        if not _value_compatible(field_name, l, r):
            return False

    return True


def _merge_missing(target: TribologyData, source: TribologyData) -> TribologyData:
    for field in (
        "base_oil",
        "concentration",
        "load",
        "normal_load",
        "speed",
        "shear_rate",
        "temperature",
        "wear_rate",
        "test_duration",
        "contact_type",
        "potential",
        "water_content",
        "surface_roughness",
        "residual_film_thickness_d",
        "layer_spacing_delta",
        "film_thickness",
        "mol_ratio",
        "cation",
        "anion",
        "cation_smiles",
        "anion_smiles",
        "il_smiles",
        "il_inchikey",
        "alkyl_chain_length",
        "source",
        "source_page",
        "source_figure",
        "notes",
        "friction_force",
        "value_origin",
        "evidence",
        "sample_id",
        "series_id",
        "review_status",
        "record_origin",
        "assembly_notes",
    ):
        current = getattr(target, field, None)
        incoming = getattr(source, field, None)
        if (current is None or str(current).strip() == "") and incoming not in (None, ""):
            setattr(target, field, incoming)

    target_field_evidence = getattr(target, "field_evidence_json", None) or {}
    source_field_evidence = getattr(source, "field_evidence_json", None) or {}
    if not target_field_evidence and source_field_evidence:
        setattr(target, "field_evidence_json", source_field_evidence)
    elif isinstance(target_field_evidence, dict) and isinstance(source_field_evidence, dict) and source_field_evidence:
        merged_field_evidence = dict(target_field_evidence)
        merged_field_evidence.update({k: v for k, v in source_field_evidence.items() if k not in merged_field_evidence})
        setattr(target, "field_evidence_json", merged_field_evidence)

    target_conf = getattr(target, "confidence", None)
    source_conf = getattr(source, "confidence", None)
    if target_conf is not None or source_conf is not None:
        try:
            setattr(target, "confidence", max(float(target_conf or 0), float(source_conf or 0)))
        except Exception:
            pass
    return target


@dataclass
class DedupReport:
    input_count: int
    output_count: int
    merged_count: int
    dropped_count: int
    dropped_by_reason: Dict[str, int]
    trace: List[Dict[str, Any]]


def deduplicate_records_with_report(records: List[TribologyData]) -> Tuple[List[TribologyData], DedupReport]:
    if not records:
        return [], DedupReport(0, 0, 0, 0, {}, [])

    kept: List[Tuple[int, TribologyData]] = []
    dropped_by_reason: Dict[str, int] = {}
    trace: List[Dict[str, Any]] = []
    next_merged_id = 0

    for idx, record in enumerate(records):
        if record is None:
            dropped_by_reason["empty_record"] = dropped_by_reason.get("empty_record", 0) + 1
            trace.append(
                {
                    "input_index": idx,
                    "status": "dropped",
                    "drop_reason": "empty_record",
                    "merged_into": None,
                }
            )
            continue

        if _norm_cof(record.cof) is None and not has_core_quantitative_signal(record.model_dump()):
            dropped_by_reason["no_core_quant_signal"] = dropped_by_reason.get("no_core_quant_signal", 0) + 1
            trace.append(
                {
                    "input_index": idx,
                    "status": "dropped",
                    "drop_reason": "no_core_quant_signal",
                    "merged_into": None,
                }
            )
            continue

        if not record.material_name:
            record.material_name = "Unknown Material"
        if not record.ionic_liquid:
            record.ionic_liquid = "Unknown IL"

        kept.append((idx, record))

    grouped: Dict[Tuple[str, ...], List[Tuple[int, TribologyData]]] = {}
    for input_idx, record in kept:
        key = _entity_key(record)
        grouped.setdefault(key, []).append((input_idx, record))

    merged_results: List[TribologyData] = []
    merged_count = 0

    for _, group in grouped.items():
        merged_group: List[Tuple[int, TribologyData]] = []

        for input_idx, candidate in group:
            placed = False
            for i, (merged_id, base) in enumerate(merged_group):
                if _are_compatible(base, candidate):
                    merged_group[i] = (merged_id, _merge_missing(base, candidate))
                    merged_count += 1
                    trace.append(
                        {
                            "input_index": input_idx,
                            "status": "merged",
                            "drop_reason": "merged_duplicate",
                            "merged_into": f"m{merged_id}",
                        }
                    )
                    placed = True
                    break
            if not placed:
                merged_id = next_merged_id
                next_merged_id += 1
                merged_group.append((merged_id, candidate))
                trace.append(
                    {
                        "input_index": input_idx,
                        "status": "kept",
                        "drop_reason": None,
                        "merged_into": f"m{merged_id}",
                    }
                )

        merged_results.extend([record for _, record in merged_group])

    report = DedupReport(
        input_count=len(records),
        output_count=len(merged_results),
        merged_count=merged_count,
        dropped_count=sum(dropped_by_reason.values()),
        dropped_by_reason=dropped_by_reason,
        trace=trace,
    )
    return merged_results, report


def deduplicate_records(records: List[TribologyData]) -> List[TribologyData]:
    final_records, _ = deduplicate_records_with_report(records)
    return final_records

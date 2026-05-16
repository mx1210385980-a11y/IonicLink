from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import Literature, TribologyData
from security import literature_scope_conditions
from utils.experiment_profile import build_experiment_profile, canonical_scale


EMPTY_VALUES = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "nan",
    "not available",
    "not reported",
    "not specified",
    "unknown",
    "unknown/unclear",
}

REJECTED_REVIEW_STATUSES = {"rejected", "discarded", "excluded"}
REVIEWED_STATUSES = {
    "accepted",
    "approved",
    "confirmed",
    "corrected",
    "discarded",
    "excluded",
    "flagged",
    "modified",
    "needs_evidence",
    "rejected",
    "verified",
}

CORE_FIELD_GROUPS = [
    {
        "category": "材料结构",
        "fields": [
            {"key": "ionic_liquid", "label": "离子液体名称", "attributes": ["lubricant", "lubricant_alias"]},
            {"key": "cation", "label": "阳离子", "attributes": ["cation", "cation_smiles"]},
            {"key": "anion", "label": "阴离子", "attributes": ["anion", "anion_smiles"]},
        ],
    },
    {
        "category": "界面材料",
        "fields": [
            {"key": "substrate", "label": "基底", "attributes": ["substrate_material", "material_name"]},
            {"key": "probe", "label": "探针", "attributes": ["probe_material", "probe_geometry"]},
            {"key": "system", "label": "测试体系", "attributes": ["tribological_system_json", "regime"]},
        ],
    },
    {
        "category": "工况参数",
        "fields": [
            {"key": "load", "label": "载荷", "attributes": ["load_value", "load_raw", "load_conditions_json"]},
            {"key": "speed", "label": "速度", "attributes": ["speed_value", "speed_conditions_json", "shear_rate"]},
            {"key": "temperature", "label": "温度", "attributes": ["temperature"]},
            {"key": "potential", "label": "电位", "attributes": ["potential"]},
        ],
    },
    {
        "category": "性能指标",
        "fields": [
            {"key": "cof", "label": "摩擦系数", "attributes": ["cof_value", "cof_raw", "cof_extracted_json"]},
        ],
    },
    {
        "category": "证据来源",
        "fields": [
            {"key": "source_page", "label": "页码", "attributes": ["source_page", "evidence_page"]},
            {"key": "source_figure", "label": "图号", "attributes": ["source_figure", "source"]},
            {"key": "evidence", "label": "原文片段", "attributes": ["evidence", "field_evidence_json"]},
        ],
    },
]

UNIT_RULES = [
    {
        "key": "load",
        "label": "载荷",
        "attributes": ["load_value", "load_raw"],
        "unit_pattern": r"(?:^|[\d\s/~<>=±+\-])(?:n|u|µ|μ|m|k)?n\b|newton|kgf?\b|gf\b",
        "qualitative_pattern": r"\b(?:low|high|light|heavy|normal load|load range|not reported|unknown)\b|低载荷|高载荷",
    },
    {
        "key": "speed",
        "label": "速度",
        "attributes": ["speed_value"],
        "unit_pattern": r"(?:m|cm|mm|um|µm|μm|nm)\s*/\s*s|rpm|rev\s*/\s*min|hz\b",
        "qualitative_pattern": r"\b(?:sliding|scan|varied|not reported|unknown)\b|扫描|滑动",
    },
    {
        "key": "shear_rate",
        "label": "剪切率",
        "attributes": ["shear_rate"],
        "unit_pattern": r"s\s*(?:\^-?\s*1|\(-?1\)|[-⁻]1)|1\s*/\s*s",
        "qualitative_pattern": r"\b(?:varied|not reported|unknown)\b",
    },
    {
        "key": "temperature",
        "label": "温度",
        "attributes": ["temperature"],
        "unit_pattern": r"(?:°\s*c|℃|\bc\b|\bk\b|kelvin|celsius)",
        "qualitative_pattern": r"\b(?:room temperature|ambient|rt|not reported|unknown)\b|室温|常温",
    },
    {
        "key": "potential",
        "label": "电位",
        "attributes": ["potential"],
        "unit_pattern": r"\b(?:m?v|volt|ocp|open circuit)\b",
        "qualitative_pattern": r"\b(?:positive|negative|neutral|open circuit|not reported|unknown)\b|开路|正电位|负电位",
    },
    {
        "key": "water_content",
        "label": "水含量",
        "attributes": ["water_content"],
        "unit_pattern": r"%|ppm|ppb|wt|mol|molar|water|humidity|rh\b",
        "qualitative_pattern": r"\b(?:dry|wet|anhydrous|ambient|saturated|trace|not reported|unknown)\b|干燥|含水|无水|湿度",
    },
]


def _flatten_core_fields() -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for group in CORE_FIELD_GROUPS:
        for field in group["fields"]:
            fields.append({**field, "category": group["category"]})
    return fields


CORE_FIELDS = _flatten_core_fields()


def _filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    if isinstance(value, (list, tuple, set)):
        return any(_filled(item) for item in value)
    if isinstance(value, dict):
        return any(_filled(item) for item in value.values())

    text = str(value).strip()
    if not text:
        return False
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    if normalized in EMPTY_VALUES:
        return False
    if text.startswith("{") or text.startswith("["):
        try:
            return _filled(json.loads(text))
        except Exception:
            return True
    return True


def _record_has_any(record: TribologyData, attributes: Iterable[str]) -> bool:
    return any(_filled(getattr(record, attribute, None)) for attribute in attributes)


def _review_status(record: TribologyData) -> str:
    return str(getattr(record, "review_status", None) or "").strip().lower()


def _is_rejected(record: TribologyData) -> bool:
    return _review_status(record) in REJECTED_REVIEW_STATUSES


def _first_filled(record: TribologyData, attributes: Iterable[str]) -> str:
    for attribute in attributes:
        value = getattr(record, attribute, None)
        if _filled(value):
            return str(value).strip()
    return ""


def _has_number(text: str) -> bool:
    return bool(re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text))


def _unit_issue(text: str, rule: dict[str, Any]) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return False
    if re.search(rule["qualitative_pattern"], normalized, flags=re.IGNORECASE):
        return False
    if re.search(rule["unit_pattern"], normalized, flags=re.IGNORECASE):
        return False
    return _has_number(normalized)


def _normalize_doi(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text or text in EMPTY_VALUES:
        return ""
    text = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", text)
    text = re.sub(r"^doi:\s*", "", text)
    text = re.sub(r"\s+", "", text)
    return text.rstrip(".,;")


def _field_evidence_map(record: TribologyData) -> dict[str, Any]:
    raw = getattr(record, "field_evidence_json", None)
    if not _filled(raw):
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(str(raw))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _has_field_evidence_entry(entry: Any) -> bool:
    if not isinstance(entry, dict):
        return False
    status = str(entry.get("status") or (entry.get("evidence") or {}).get("status") or "").lower()
    if status in {"grounded", "partial"}:
        return True
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    return any(
        _filled(candidate)
        for candidate in (
            entry.get("quote"),
            entry.get("page"),
            entry.get("matched_text"),
            evidence.get("quote"),
            evidence.get("page"),
            evidence.get("matched_text"),
        )
    )


def _has_any_field_evidence(record: TribologyData) -> bool:
    evidence = _field_evidence_map(record)
    return any(_has_field_evidence_entry(entry) for entry in evidence.values())


def _field_has_evidence(record: TribologyData, field: dict[str, Any]) -> bool:
    evidence = _field_evidence_map(record)
    keys = [field["key"], *field["attributes"]]
    return any(_has_field_evidence_entry(evidence.get(key)) for key in keys)


def _missing_evidence(record: TribologyData) -> bool:
    return not any(
        (
            _filled(getattr(record, "source_page", None)),
            _filled(getattr(record, "evidence_page", None)),
            _filled(getattr(record, "source_figure", None)),
            _filled(getattr(record, "evidence", None)),
            _filled(getattr(record, "source", None)),
            _has_any_field_evidence(record),
        )
    )


def _quantile(values: list[float], probability: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return values[int(position)]
    weight = position - lower
    return values[lower] * (1 - weight) + values[upper] * weight


def _cof_outlier_reason(value: float, q1: float | None, q3: float | None, iqr: float | None) -> str | None:
    if value < 0:
        return "COF 小于 0"
    if value > 2:
        return "COF 大于 2，建议核对单位或图表读取"
    if q1 is None or q3 is None or iqr is None or iqr <= 0:
        return None
    lower = max(0.0, q1 - 1.5 * iqr)
    upper = q3 + 1.5 * iqr
    if value < lower or value > upper:
        return f"IQR 异常值（正常范围约 {lower:.3g}–{upper:.3g}）"
    return None


def _is_trainable_record(record: TribologyData) -> bool:
    has_target = isinstance(record.cof_value, (int, float)) and math.isfinite(float(record.cof_value))
    has_lubricant = _record_has_any(record, ["lubricant", "cation", "anion", "il_smiles", "il_inchikey"])
    has_tribopair = _record_has_any(record, ["material_name", "probe_material", "substrate_material"])
    has_condition = _record_has_any(record, ["load_value", "speed_value", "shear_rate", "temperature", "potential"])
    return has_target and has_lubricant and has_tribopair and has_condition and not _is_rejected(record)


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def _coverage_tone(rate: float | None) -> str:
    if rate is None:
        return "slate"
    if rate >= 0.8:
        return "emerald"
    if rate >= 0.6:
        return "sky"
    if rate >= 0.35:
        return "amber"
    return "rose"


def _risk_tone(rate: float | None) -> str:
    if rate is None:
        return "slate"
    if rate <= 0.05:
        return "emerald"
    if rate <= 0.15:
        return "sky"
    if rate <= 0.35:
        return "amber"
    return "rose"


def _metric(
    *,
    key: str,
    label: str,
    numerator: int,
    denominator: int,
    detail: str,
    formula: str,
    tone: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "numerator": int(numerator),
        "denominator": int(denominator),
        "rate": _ratio(int(numerator), int(denominator)),
        "detail": detail,
        "formula": formula,
        "tone": tone,
    }


SCALE_LABELS = {
    "all": "全部",
    "macroscale": "宏观摩擦",
    "nanoscale": "纳米摩擦",
    "microscale": "微观摩擦",
    "unknown": "未识别尺度",
}

SCALE_TRAINING_VIEWS = {
    "all": "all",
    "macroscale": "macro_performance",
    "nanoscale": "afm_surface_response",
    "microscale": "cross_scale",
    "unknown": "all",
}

SCALE_SAMPLE_TARGETS = {
    "all": 150,
    "macroscale": 30,
    "nanoscale": 100,
    "microscale": 30,
    "unknown": 30,
}

SOURCE_DIVERSITY_TARGETS = {
    "all": 10,
    "macroscale": 5,
    "nanoscale": 8,
    "microscale": 5,
    "unknown": 5,
}

BLOCKER_LABELS = {
    "missingTarget": "缺 COF",
    "missingLubricant": "缺润滑剂/离子结构",
    "missingTribopair": "缺摩擦副",
    "missingCondition": "缺工况",
    "missingEvidence": "缺证据",
}


def _json_object(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _record_experiment_profile(record: TribologyData) -> dict[str, Any]:
    system = _json_object(getattr(record, "tribological_system_json", None))
    return build_experiment_profile(
        {
            "tribological_system": system,
            "raw_text": system.get("raw_text") or getattr(record, "regime", None),
            "cof": getattr(record, "cof_raw", None),
            "cof_value": getattr(record, "cof_value", None),
            "load": getattr(record, "load_raw", None) or getattr(record, "load_value", None),
            "speed": getattr(record, "speed_value", None),
            "probe_geometry": getattr(record, "probe_geometry", None),
            "probe_radius": getattr(record, "probe_radius", None),
            "regime": getattr(record, "regime", None),
            "source": getattr(record, "source", None),
            "source_figure": getattr(record, "source_figure", None),
            "evidence": getattr(record, "evidence", None),
        }
    )


def _record_scale_key(record: TribologyData) -> str:
    system = _json_object(getattr(record, "tribological_system_json", None))
    explicit = canonical_scale(system.get("scale") or system.get("experiment_scale") or system.get("experimentScale"))
    if explicit:
        return explicit
    profile = _record_experiment_profile(record)
    return str(profile.get("scale") or "unknown")


def _scale_label(key: str) -> str:
    return SCALE_LABELS.get(key, key or "未记录")


def _record_literature_title(record: TribologyData) -> str:
    literature = getattr(record, "literature", None)
    return str(getattr(literature, "title", "") or f"Literature {getattr(record, 'literature_id', '')}").strip()


def _record_literature_doi(record: TribologyData) -> str:
    literature = getattr(record, "literature", None)
    return str(getattr(literature, "doi", "") or "").strip()


def _record_tribopair(record: TribologyData) -> str:
    probe = str(getattr(record, "probe_material", "") or "").strip()
    substrate = str(getattr(record, "substrate_material", "") or getattr(record, "material_name", "") or "").strip()
    coating = str(getattr(record, "substrate_coating", "") or "").strip()
    pieces = [piece for piece in (probe, substrate, coating) if piece]
    return " / ".join(pieces)


def _record_preview(record: TribologyData, reason: str) -> dict[str, Any]:
    scale_key = _record_scale_key(record)
    return {
        "recordId": record.id,
        "literatureId": record.literature_id,
        "title": _record_literature_title(record),
        "doi": _record_literature_doi(record),
        "lubricant": str(getattr(record, "lubricant", "") or "").strip(),
        "tribopair": _record_tribopair(record),
        "cofValue": getattr(record, "cof_value", None),
        "reviewStatus": _review_status(record) or "unreviewed",
        "scale": scale_key,
        "scaleLabel": _scale_label(scale_key),
        "reason": reason,
    }


def _unique_literature_for_records(records: list[TribologyData]) -> list[Literature]:
    seen: dict[int, Literature] = {}
    for record in records:
        literature = getattr(record, "literature", None)
        literature_id = getattr(record, "literature_id", None)
        if literature is not None:
            seen[int(literature.id)] = literature
        elif literature_id is not None:
            placeholder = Literature(id=int(literature_id), doi="", title=f"Literature {literature_id}")
            seen[int(literature_id)] = placeholder
    return list(seen.values())


def _source_literature_rows(records: list[TribologyData], trainable_records: list[TribologyData]) -> list[dict[str, Any]]:
    trainable_ids = {int(record.id) for record in trainable_records if getattr(record, "id", None) is not None}
    rows: dict[int, dict[str, Any]] = {}
    for record in records:
        literature_id = int(getattr(record, "literature_id", 0) or 0)
        if not literature_id:
            continue
        row = rows.setdefault(
            literature_id,
            {
                "literatureId": literature_id,
                "title": _record_literature_title(record),
                "doi": _record_literature_doi(record),
                "recordCount": 0,
                "trainableCount": 0,
            },
        )
        row["recordCount"] += 1
        if int(record.id) in trainable_ids:
            row["trainableCount"] += 1
    return sorted(rows.values(), key=lambda item: (-int(item["trainableCount"]), -int(item["recordCount"]), str(item["title"])))


def _record_combined_text(record: TribologyData) -> str:
    fields = [
        _record_literature_title(record),
        getattr(record, "regime", None),
        getattr(record, "source", None),
        getattr(record, "source_figure", None),
        getattr(record, "evidence", None),
        getattr(record, "load_value", None),
        getattr(record, "load_raw", None),
        getattr(record, "speed_value", None),
        getattr(record, "probe_geometry", None),
        getattr(record, "probe_material", None),
        getattr(record, "substrate_material", None),
    ]
    return " | ".join(str(field).strip() for field in fields if str(field or "").strip())


def _looks_like_macro_candidate(record: TribologyData) -> bool:
    if _record_scale_key(record) != "unknown":
        return False
    text = _record_combined_text(record).lower()
    return bool(re.search(r"\b(?:tribometer|ball[-\s]*on|pin[-\s]*on|four[-\s]*ball|macroscopic|macroscale)\b", text))


def _action_item(*, key: str, label: str, count: int, detail: str, tone: str) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "count": int(count),
        "detail": detail,
        "tone": tone,
    }


def _build_replenishment_plan(
    *,
    scale_key: str,
    label: str,
    records: list[TribologyData],
    active_records: list[TribologyData],
    trainable_records: list[TribologyData],
    missing_evidence_records: list[TribologyData],
    blockers: dict[str, int],
) -> dict[str, Any]:
    target = SCALE_SAMPLE_TARGETS.get(scale_key, 30)
    source_target = SOURCE_DIVERSITY_TARGETS.get(scale_key, 5)
    trainable_count = len(trainable_records)
    sample_gap = max(0, target - trainable_count)
    source_rows = _source_literature_rows(active_records, trainable_records)
    source_gap = max(0, source_target - len(source_rows))

    record_groups = {
        "missingTarget": [
            _record_preview(record, BLOCKER_LABELS["missingTarget"])
            for record in active_records
            if record.cof_value is None
        ][:12],
        "missingLubricant": [
            _record_preview(record, BLOCKER_LABELS["missingLubricant"])
            for record in active_records
            if not _record_has_any(record, ["lubricant", "cation", "anion", "il_smiles", "il_inchikey"])
        ][:12],
        "missingTribopair": [
            _record_preview(record, BLOCKER_LABELS["missingTribopair"])
            for record in active_records
            if not _record_has_any(record, ["material_name", "probe_material", "substrate_material"])
        ][:12],
        "missingCondition": [
            _record_preview(record, BLOCKER_LABELS["missingCondition"])
            for record in active_records
            if not _record_has_any(record, ["load_value", "speed_value", "shear_rate", "temperature", "potential"])
        ][:12],
        "missingEvidence": [
            _record_preview(record, BLOCKER_LABELS["missingEvidence"])
            for record in missing_evidence_records
        ][:12],
    }

    unknown_macro_candidates = [
        _record_preview(record, "未归类但疑似宏观摩擦")
        for record in records
        if _looks_like_macro_candidate(record)
    ][:12]

    action_items: list[dict[str, Any]] = []
    if sample_gap:
        action_items.append(
            _action_item(
                key="sample_gap",
                label=f"补 {sample_gap} 条{label}记录",
                count=sample_gap,
                detail=f"当前可训练 {trainable_count} 条，建议门槛 {target} 条；优先补同尺度、含 COF 和工况的记录。",
                tone="amber",
            )
        )
    if source_gap and scale_key != "all":
        action_items.append(
            _action_item(
                key="source_diversity",
                label=f"扩展 {source_gap} 篇来源文献",
                count=source_gap,
                detail=f"当前{label}样本来自 {len(source_rows)} 篇文献，建议至少覆盖 {source_target} 篇，降低单篇文献偏置。",
                tone="sky" if sample_gap == 0 else "amber",
            )
        )

    for blocker_key, count in blockers.items():
        if count <= 0:
            continue
        action_items.append(
            _action_item(
                key=blocker_key,
                label=BLOCKER_LABELS.get(blocker_key, blocker_key),
                count=count,
                detail=f"{count} 条记录因“{BLOCKER_LABELS.get(blocker_key, blocker_key)}”未进入训练池，优先回到 Review 修正。",
                tone="rose",
            )
        )

    if missing_evidence_records:
        action_items.append(
            _action_item(
                key="missingEvidence",
                label=BLOCKER_LABELS["missingEvidence"],
                count=len(missing_evidence_records),
                detail=f"{len(missing_evidence_records)} 条记录缺少页码、图号、原文或字段级证据，建议先补证据再训练。",
                tone="amber",
            )
        )

    if unknown_macro_candidates:
        action_items.append(
            _action_item(
                key="unknown_macro_candidates",
                label="核查疑似宏观未归类记录",
                count=len(unknown_macro_candidates),
                detail="这些记录含 tribometer / ball-on / pin-on 等线索，可能应该归入宏观摩擦训练池。",
                tone="amber",
            )
        )

    if not action_items:
        action_items.append(
            _action_item(
                key="ready",
                label="当前训练池无需补数",
                count=trainable_count,
                detail="样本数量和关键字段已经满足当前门槛，下一步适合进入训练视图分流或抽查证据质量。",
                tone="emerald",
            )
        )

    if sample_gap:
        recommended = f"优先补 {sample_gap} 条{label}可训练记录。"
    elif any(blockers.values()):
        recommended = "优先修正字段阻断记录，让现有样本进入训练池。"
    elif source_gap and scale_key != "all":
        recommended = f"训练样本已够，建议再扩展 {source_gap} 篇来源文献提升代表性。"
    else:
        recommended = "当前训练池已达到门槛，可进入训练视图分流。"

    return {
        "currentTrainableCount": trainable_count,
        "minimumSampleTarget": target,
        "sampleGap": sample_gap,
        "sourceLiteratureCount": len(source_rows),
        "sourceLiteratureTarget": source_target,
        "sourceLiteratureGap": source_gap,
        "recommendedAction": recommended,
        "actionItems": action_items,
        "recordGroups": record_groups,
        "sourceLiterature": source_rows[:10],
        "unknownMacroCandidates": unknown_macro_candidates,
    }


def _training_readiness(
    *,
    scale_key: str,
    active_count: int,
    trainable_count: int,
    trainable_rate: float | None,
    blockers: dict[str, int],
) -> dict[str, Any]:
    target = SCALE_SAMPLE_TARGETS.get(scale_key, 30)
    label = _scale_label(scale_key)
    if active_count <= 0:
        return {
            "state": "empty",
            "tone": "slate",
            "label": f"{label}暂无样本",
            "detail": "当前范围没有可评估的活跃记录。",
            "minimumSampleTarget": target,
        }
    if trainable_count <= 0:
        return {
            "state": "blocked",
            "tone": "rose",
            "label": f"{label}暂不可训练",
            "detail": "没有记录同时具备 COF、润滑剂/材料和至少一个工况字段。",
            "minimumSampleTarget": target,
        }
    if trainable_count < target:
        return {
            "state": "limited",
            "tone": "amber",
            "label": f"{label}训练池偏小",
            "detail": f"已有 {trainable_count} 条可训练样本，建议至少达到 {target} 条后再做稳定建模。",
            "minimumSampleTarget": target,
        }
    if trainable_rate is not None and trainable_rate < 0.7:
        dominant_blocker = max(blockers.items(), key=lambda item: item[1], default=("", 0))
        reason = f"主要短板是 {dominant_blocker[0]}（{dominant_blocker[1]} 条）" if dominant_blocker[1] else "仍有较多记录缺少关键字段"
        return {
            "state": "needs_review",
            "tone": "amber",
            "label": f"{label}需要先清洗",
            "detail": f"样本数量已达到门槛，但可训练比例不足 70%；{reason}。",
            "minimumSampleTarget": target,
        }
    return {
        "state": "ready",
        "tone": "emerald",
        "label": f"{label}可进入训练",
        "detail": f"{trainable_count} 条记录满足训练字段要求，可作为当前训练视图的候选数据池。",
        "minimumSampleTarget": target,
    }


def _build_quality_slice(
    *,
    key: str,
    label: str,
    records: list[TribologyData],
    literature: list[Literature],
) -> dict[str, Any]:
    active_records = [record for record in records if not _is_rejected(record)]

    field_category_rows = []
    missing_slots = 0
    total_slots = len(active_records) * len(CORE_FIELDS)
    for group in CORE_FIELD_GROUPS:
        group_fields = group["fields"]
        filled = 0
        for record in active_records:
            filled += sum(1 for field in group_fields if _record_has_any(record, field["attributes"]))
        denominator = len(active_records) * len(group_fields)
        missing = denominator - filled
        missing_slots += missing
        field_category_rows.append(
            {
                "category": group["category"],
                "filled": filled,
                "missing": missing,
                "denominator": denominator,
                "rate": _ratio(filled, denominator),
                "fields": "、".join(field["label"] for field in group_fields),
            }
        )

    unit_denominator = 0
    unit_issue_count = 0
    unit_breakdown = []
    unit_examples = []
    for rule in UNIT_RULES:
        filled = 0
        issues = 0
        for record in active_records:
            text = _first_filled(record, rule["attributes"])
            if not text:
                continue
            filled += 1
            if _unit_issue(text, rule):
                issues += 1
                if len(unit_examples) < 8:
                    scale_key = _record_scale_key(record)
                    unit_examples.append(
                        {
                            "recordId": record.id,
                            "literatureId": record.literature_id,
                            "field": rule["label"],
                            "value": text,
                            "title": getattr(record.literature, "title", "") if record.literature else "",
                            "scale": scale_key,
                            "scaleLabel": _scale_label(scale_key),
                        }
                    )
        unit_denominator += filled
        unit_issue_count += issues
        unit_breakdown.append(
            {
                "key": rule["key"],
                "label": rule["label"],
                "issues": issues,
                "denominator": filled,
                "rate": _ratio(issues, filled),
            }
        )

    doi_groups: dict[str, list[Literature]] = defaultdict(list)
    for item in literature:
        normalized_doi = _normalize_doi(item.doi)
        if normalized_doi:
            doi_groups[normalized_doi].append(item)
    duplicate_groups = {doi: items for doi, items in doi_groups.items() if len(items) > 1}
    duplicate_literature_count = sum(len(items) for items in duplicate_groups.values())
    duplicate_doi_excess = sum(len(items) - 1 for items in duplicate_groups.values())
    doi_denominator = sum(1 for item in literature if _normalize_doi(item.doi))
    duplicate_rows = [
        {
            "doi": doi,
            "count": len(items),
            "literatureIds": [item.id for item in items],
            "titles": [item.title for item in items[:3]],
        }
        for doi, items in sorted(duplicate_groups.items(), key=lambda row: (-len(row[1]), row[0]))
    ]

    cof_values = sorted(float(record.cof_value) for record in active_records if record.cof_value is not None and math.isfinite(float(record.cof_value)))
    q1 = q3 = iqr = None
    if len(cof_values) >= 8:
        q1 = _quantile(cof_values, 0.25)
        q3 = _quantile(cof_values, 0.75)
        iqr = q3 - q1
    cof_outliers = []
    for record in active_records:
        if record.cof_value is None:
            continue
        value = float(record.cof_value)
        if not math.isfinite(value):
            continue
        reason = _cof_outlier_reason(value, q1, q3, iqr)
        if reason:
            scale_key = _record_scale_key(record)
            cof_outliers.append(
                {
                    "recordId": record.id,
                    "literatureId": record.literature_id,
                    "title": getattr(record.literature, "title", "") if record.literature else "",
                    "cofValue": value,
                    "reason": reason,
                    "scale": scale_key,
                    "scaleLabel": _scale_label(scale_key),
                }
            )

    missing_evidence_records = [record for record in active_records if _missing_evidence(record)]
    page_evidence_count = sum(
        1 for record in active_records
        if _filled(getattr(record, "source_page", None)) or _filled(getattr(record, "evidence_page", None))
    )
    figure_evidence_count = sum(1 for record in active_records if _filled(getattr(record, "source_figure", None)))
    text_evidence_count = sum(
        1 for record in active_records
        if _filled(getattr(record, "evidence", None)) or _filled(getattr(record, "source", None))
    )
    field_evidence_record_count = sum(1 for record in active_records if _has_any_field_evidence(record))
    field_evidence_slots = len(active_records) * len(CORE_FIELDS)
    field_evidence_covered_slots = sum(
        1
        for record in active_records
        for field in CORE_FIELDS
        if _field_has_evidence(record, field)
    )
    trainable_records = [record for record in active_records if _is_trainable_record(record)]

    status_counts = Counter(_review_status(record) or "unreviewed" for record in records)
    reviewed_count = sum(count for status, count in status_counts.items() if status in REVIEWED_STATUSES)
    unreviewed_count = len(records) - reviewed_count

    missing_field_rate = _ratio(missing_slots, total_slots)
    unit_issue_rate = _ratio(unit_issue_count, unit_denominator)
    duplicate_rate = _ratio(duplicate_doi_excess, doi_denominator)
    cof_outlier_rate = _ratio(len(cof_outliers), len(cof_values))
    missing_evidence_rate = _ratio(len(missing_evidence_records), len(active_records))
    trainable_rate = _ratio(len(trainable_records), len(active_records))
    reviewed_rate = _ratio(reviewed_count, len(records))

    metrics = [
        _metric(
            key="missing_fields",
            label="缺失字段率",
            numerator=missing_slots,
            denominator=total_slots,
            detail=f"{missing_slots} / {total_slots} 个核心字段槽位为空",
            formula="空核心字段槽位 / 活跃记录数 × 核心字段数",
            tone=_risk_tone(missing_field_rate),
        ),
        _metric(
            key="unit_issues",
            label="单位混乱率",
            numerator=unit_issue_count,
            denominator=unit_denominator,
            detail=f"{unit_issue_count} / {unit_denominator} 个已填工况字段疑似缺少单位或单位不可识别",
            formula="疑似单位问题字段 / 已填工况字段",
            tone=_risk_tone(unit_issue_rate),
        ),
        _metric(
            key="duplicate_doi",
            label="DOI 重复率",
            numerator=duplicate_doi_excess,
            denominator=doi_denominator,
            detail=f"{duplicate_literature_count} 篇文献落在 {len(duplicate_groups)} 个重复 DOI 组",
            formula="重复 DOI 超额文献数 / 有 DOI 文献数",
            tone=_risk_tone(duplicate_rate),
        ),
        _metric(
            key="cof_outliers",
            label="COF 异常值率",
            numerator=len(cof_outliers),
            denominator=len(cof_values),
            detail=f"{len(cof_outliers)} / {len(cof_values)} 条 COF 记录触发硬阈值或 IQR 检查",
            formula="异常 COF 记录 / 有 COF 数值记录",
            tone=_risk_tone(cof_outlier_rate),
        ),
        _metric(
            key="missing_evidence",
            label="证据缺失率",
            numerator=len(missing_evidence_records),
            denominator=len(active_records),
            detail=f"{len(missing_evidence_records)} / {len(active_records)} 条活跃记录缺少页码、图号、原文或字段级证据",
            formula="无证据记录 / 活跃记录数",
            tone=_risk_tone(missing_evidence_rate),
        ),
        _metric(
            key="trainable_samples",
            label="可训练样本数量",
            numerator=len(trainable_records),
            denominator=len(active_records),
            detail=f"{len(trainable_records)} / {len(active_records)} 条活跃记录具备 COF、材料/润滑剂和至少一个工况字段",
            formula="可训练记录 / 活跃记录数",
            tone=_coverage_tone(trainable_rate),
        ),
        _metric(
            key="reviewed_records",
            label="已审阅比例",
            numerator=reviewed_count,
            denominator=len(records),
            detail=f"{reviewed_count} 条已有人类审阅状态，{unreviewed_count} 条仍未审阅",
            formula="有明确 Review 状态的记录 / 全部记录数",
            tone=_coverage_tone(reviewed_rate),
        ),
    ]

    blockers = {
        "missingTarget": sum(1 for record in active_records if record.cof_value is None),
        "missingLubricant": sum(1 for record in active_records if not _record_has_any(record, ["lubricant", "cation", "anion", "il_smiles", "il_inchikey"])),
        "missingTribopair": sum(1 for record in active_records if not _record_has_any(record, ["material_name", "probe_material", "substrate_material"])),
        "missingCondition": sum(1 for record in active_records if not _record_has_any(record, ["load_value", "speed_value", "shear_rate", "temperature", "potential"])),
    }

    return {
        "key": key,
        "label": label,
        "trainingView": SCALE_TRAINING_VIEWS.get(key, "all"),
        "summary": {
            "literatureCount": len(literature),
            "recordCount": len(records),
            "activeRecordCount": len(active_records),
            "coreFieldCount": len(CORE_FIELDS),
            "coreFieldSlots": total_slots,
            "missingFieldSlots": missing_slots,
            "missingFieldRate": missing_field_rate,
            "unitIssueCount": unit_issue_count,
            "unitFieldSlots": unit_denominator,
            "unitIssueRate": unit_issue_rate,
            "duplicateDoiGroups": len(duplicate_groups),
            "duplicateDoiExcess": duplicate_doi_excess,
            "duplicateDoiLiteratureCount": duplicate_literature_count,
            "doiLiteratureCount": doi_denominator,
            "cofOutlierCount": len(cof_outliers),
            "cofValueCount": len(cof_values),
            "missingEvidenceCount": len(missing_evidence_records),
            "missingEvidenceRate": missing_evidence_rate,
            "pageEvidenceCount": page_evidence_count,
            "figureEvidenceCount": figure_evidence_count,
            "textEvidenceCount": text_evidence_count,
            "fieldEvidenceRecordCount": field_evidence_record_count,
            "fieldEvidenceCoveredSlots": field_evidence_covered_slots,
            "fieldEvidenceSlots": field_evidence_slots,
            "trainableSampleCount": len(trainable_records),
            "trainableSampleRate": trainable_rate,
            "reviewedCount": reviewed_count,
            "unreviewedCount": unreviewed_count,
            "reviewedRate": reviewed_rate,
        },
        "metrics": metrics,
        "fieldCategories": field_category_rows,
        "unitIssues": {
            "fieldBreakdown": unit_breakdown,
            "examples": unit_examples,
        },
        "doiDuplicates": duplicate_rows,
        "cofOutliers": cof_outliers[:20],
        "evidence": {
            "missingRecordIds": [record.id for record in missing_evidence_records[:50]],
        },
        "training": {
            "trainableRecordIds": [record.id for record in trainable_records[:50]],
            "blockers": blockers,
            "readiness": _training_readiness(
                scale_key=key,
                active_count=len(active_records),
                trainable_count=len(trainable_records),
                trainable_rate=trainable_rate,
                blockers=blockers,
            ),
            "replenishment": _build_replenishment_plan(
                scale_key=key,
                label=label,
                records=records,
                active_records=active_records,
                trainable_records=trainable_records,
                missing_evidence_records=missing_evidence_records,
                blockers=blockers,
            ),
        },
        "review": {
            "statuses": [{"status": status, "count": count} for status, count in sorted(status_counts.items())],
        },
    }


async def get_quality_asset_summary(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scoped_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []

    literature_stmt = select(Literature).order_by(Literature.id)
    if scoped_conditions:
        literature_stmt = literature_stmt.where(*scoped_conditions)
    literature = (await session.execute(literature_stmt)).scalars().all()

    records_stmt = (
        select(TribologyData)
        .join(TribologyData.literature)
        .options(selectinload(TribologyData.literature))
        .order_by(TribologyData.id)
    )
    if scoped_conditions:
        records_stmt = records_stmt.where(*scoped_conditions)
    records = (await session.execute(records_stmt)).scalars().all()

    all_slice = _build_quality_slice(
        key="all",
        label=_scale_label("all"),
        records=list(records),
        literature=list(literature),
    )

    scale_records: dict[str, list[TribologyData]] = defaultdict(list)
    for record in records:
        scale_records[_record_scale_key(record)].append(record)

    preferred_scale_order = ["macroscale", "nanoscale", "microscale", "unknown"]
    ordered_scale_keys = [
        *[key for key in preferred_scale_order if key in scale_records],
        *sorted(key for key in scale_records if key not in preferred_scale_order),
    ]
    scale_breakdown = [
        _build_quality_slice(
            key=scale_key,
            label=_scale_label(scale_key),
            records=scale_records[scale_key],
            literature=_unique_literature_for_records(scale_records[scale_key]),
        )
        for scale_key in ordered_scale_keys
    ]

    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "scope": scope_filter_values or {"scope_type": "all"},
        "summary": all_slice["summary"],
        "metrics": all_slice["metrics"],
        "fieldCategories": all_slice["fieldCategories"],
        "unitIssues": all_slice["unitIssues"],
        "doiDuplicates": all_slice["doiDuplicates"],
        "cofOutliers": all_slice["cofOutliers"],
        "evidence": all_slice["evidence"],
        "training": all_slice["training"],
        "review": all_slice["review"],
        "scaleBreakdown": scale_breakdown,
    }

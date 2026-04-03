from __future__ import annotations

from collections import Counter, defaultdict
import logging
from typing import Any, Optional
import hashlib
import re

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import TribologyData
from security import literature_scope_conditions
from services.file_service import _normalize_record_chemistry
from services.query_service import _build_conditions, _load_matches_filter, _record_to_payload
from utils.tribopair import compose_tribopair_label

logger = logging.getLogger(__name__)

MAX_NODES_PER_TYPE = 8
MIN_SUPPORT = 2

GRAPH_DIMENSIONS = [
    {"type": "cation", "label": "Cation"},
    {"type": "anion", "label": "Anion"},
    {"type": "tribopair", "label": "Tribopair"},
    {"type": "temperature", "label": "Temperature"},
    {"type": "load", "label": "Load"},
    {"type": "speed", "label": "Speed"},
    {"type": "waterContent", "label": "Water Content"},
    {"type": "potential", "label": "Potential"},
    {"type": "filmThickness", "label": "Film Thickness"},
]

EMPTY_MARKERS = {"", "null", "none", "n/a", "na", "-", "--", "unknown"}
MOJIBAKE_REPLACEMENTS = {
    "¦Ě": "μ",
    "Âμ": "μ",
    "Î¼": "μ",
    "â‰¤": "≤",
    "â‰¥": "≥",
    "âˆ’": "-",
    "鈮も墺": "≥",
}


def _node_id(node_type: str, label: str) -> str:
    digest = hashlib.md5(f"{node_type}::{label}".encode("utf-8")).hexdigest()[:12]
    return f"{node_type}:{digest}"


def _normalize_free_text(value: object) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None

    for bad, good in MOJIBAKE_REPLACEMENTS.items():
        text = text.replace(bad, good)
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower() in EMPTY_MARKERS:
        return None
    return text


def _cof_stats(records: list[dict[str, Any]]) -> dict[str, Optional[float]]:
    cof_values = [
        float(item["record"].cof_value)
        for item in records
        if getattr(item["record"], "cof_value", None) is not None
    ]
    if not cof_values:
        return {"avgCof": None, "minCof": None, "maxCof": None}

    avg_value = sum(cof_values) / len(cof_values)
    return {
        "avgCof": round(avg_value, 4),
        "minCof": round(min(cof_values), 4),
        "maxCof": round(max(cof_values), 4),
    }


def _normalize_record_dimensions(record: TribologyData) -> dict[str, Optional[str]]:
    normalized_payload = {
        "lubricant": record.lubricant,
        "ionic_liquid": record.lubricant,
        "cation": record.cation,
        "anion": record.anion,
        "film_thickness": record.film_thickness,
        "evidence": record.evidence,
    }
    _normalize_record_chemistry([normalized_payload])

    return {
        "lubricant": _normalize_free_text(normalized_payload.get("lubricant") or record.lubricant),
        "cation": _normalize_free_text(normalized_payload.get("cation") or record.cation),
        "anion": _normalize_free_text(normalized_payload.get("anion") or record.anion),
        "tribopair": _normalize_free_text(
            compose_tribopair_label(
                record.probe_material,
                record.substrate_material,
                record.substrate_coating,
            )
        ),
        "temperature": _normalize_free_text(record.temperature),
        "load": _normalize_free_text(record.load_value or record.load_raw),
        "speed": _normalize_free_text(record.speed_value),
        "waterContent": _normalize_free_text(record.water_content),
        "potential": _normalize_free_text(record.potential),
        "filmThickness": _normalize_free_text(normalized_payload.get("film_thickness") or record.film_thickness),
    }


async def _fetch_filtered_records(
    session: AsyncSession,
    filter_params: Any,
    *,
    scope_filter_values: dict[str, Any] | None = None,
) -> list[TribologyData]:
    stmt = (
        select(TribologyData)
        .join(TribologyData.literature)
        .options(selectinload(TribologyData.literature))
        .order_by(TribologyData.id)
    )
    scope_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []
    conditions = _build_conditions(filter_params)
    if scope_conditions:
        stmt = stmt.where(*scope_conditions)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    result = await session.execute(stmt)
    records = list(result.scalars().all())

    load_min = getattr(filter_params, "load_min", None)
    load_max = getattr(filter_params, "load_max", None)
    if load_min is None and load_max is None:
        return records

    return [
        record
        for record in records
        if _load_matches_filter(record.load_value or record.load_raw, load_min, load_max)
    ]


def _prepare_records(records: list[TribologyData]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for record in records:
        values = _normalize_record_dimensions(record)
        prepared.append(
            {
                "record": record,
                "values": values,
                "graphValues": {"lubricant": values.get("lubricant")},
            }
        )
    return prepared


def _summarize_dimensions(
    prepared_records: list[dict[str, Any]],
    *,
    total_records: int,
    max_nodes_per_type: int = MAX_NODES_PER_TYPE,
    min_support: int = MIN_SUPPORT,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    active_dimensions: list[dict[str, Any]] = []
    hidden_dimensions: list[dict[str, Any]] = []
    dimension_state: dict[str, dict[str, Any]] = {}

    for dimension in GRAPH_DIMENSIONS:
        dim_type = dimension["type"]
        dim_label = dimension["label"]
        raw_values = [
            item["values"].get(dim_type)
            for item in prepared_records
            if item["values"].get(dim_type)
        ]
        counter = Counter(raw_values)
        non_empty_count = sum(counter.values())
        distinct_count = len(counter)

        if non_empty_count < 3 or distinct_count < 2:
            hidden_dimensions.append(
                {
                    "type": dim_type,
                    "label": dim_label,
                    "reason": "insufficient_coverage",
                    "nonEmptyCount": non_empty_count,
                    "distinctCount": distinct_count,
                }
            )
            continue

        retained_values = [
            value
            for value, count in counter.most_common()
            if count >= min_support
        ][:max_nodes_per_type]
        value_map = {value: value for value in retained_values}

        other_values = [value for value in counter.keys() if value not in value_map]
        other_count = sum(counter[value] for value in other_values)
        if other_count >= min_support:
            for value in other_values:
                value_map[value] = "Other"

        node_labels = list(dict.fromkeys(value_map.values()))
        if not node_labels:
            hidden_dimensions.append(
                {
                    "type": dim_type,
                    "label": dim_label,
                    "reason": "below_min_support",
                    "nonEmptyCount": non_empty_count,
                    "distinctCount": distinct_count,
                }
            )
            continue

        dimension_state[dim_type] = {
            "type": dim_type,
            "label": dim_label,
            "coveragePct": round((non_empty_count / total_records) * 100.0, 1) if total_records else 0.0,
            "nonEmptyCount": non_empty_count,
            "distinctCount": distinct_count,
            "valueMap": value_map,
            "nodeLabels": node_labels,
            "rawCounter": counter,
        }
        active_dimensions.append(
            {
                "type": dim_type,
                "label": dim_label,
                "nodeCount": len(node_labels),
                "coveragePct": round((non_empty_count / total_records) * 100.0, 1) if total_records else 0.0,
            }
        )

    for item in prepared_records:
        for dim_type, state in dimension_state.items():
            raw_value = item["values"].get(dim_type)
            item["graphValues"][dim_type] = state["valueMap"].get(raw_value)

    return dimension_state, active_dimensions, hidden_dimensions


def _selection_matches(
    item: dict[str, Any],
    selection: dict[str, Any],
) -> bool:
    kind = str(selection.get("kind") or "").strip().lower()
    graph_values = item.get("graphValues") or {}

    if kind == "node":
        node_type = str(selection.get("nodeType") or "").strip()
        node_value = str(selection.get("nodeValue") or "").strip()
        if not node_type or not node_value:
            return False
        return str(graph_values.get(node_type) or "") == node_value

    if kind == "edge":
        source_type = str(selection.get("sourceType") or "").strip()
        source_value = str(selection.get("sourceValue") or "").strip()
        target_type = str(selection.get("targetType") or "").strip()
        target_value = str(selection.get("targetValue") or "").strip()
        if not all([source_type, source_value, target_type, target_value]):
            return False
        return (
            str(graph_values.get(source_type) or "") == source_value
            and str(graph_values.get(target_type) or "") == target_value
        )

    return False


def _selection_title(selection: dict[str, Any]) -> str:
    kind = str(selection.get("kind") or "").strip().lower()
    if kind == "node":
        return str(selection.get("nodeValue") or "Selection")

    if kind == "edge":
        source = str(selection.get("sourceValue") or "Selection")
        target = str(selection.get("targetValue") or "")
        return f"{source} → {target}".strip()

    return "Selection"


async def build_relationship_graph(
    session: AsyncSession,
    filter_params: Any,
    *,
    scope_filter_values: dict[str, Any] | None = None,
    max_nodes_per_type: int = MAX_NODES_PER_TYPE,
    min_support: int = MIN_SUPPORT,
) -> dict[str, Any]:
    logger.debug("Building relationship graph scope=%s", scope_filter_values)
    records = await _fetch_filtered_records(
        session,
        filter_params,
        scope_filter_values=scope_filter_values,
    )
    prepared_records = _prepare_records(records)
    total_records = len(prepared_records)
    total_literature = len({item["record"].literature_id for item in prepared_records})
    overall_stats = _cof_stats(prepared_records)

    if total_records == 0:
        return {
            "title": "当前筛选结果润滑参数关系图谱",
            "state": "empty",
            "nodes": [],
            "edges": [],
            "summary": {
                "totalRecords": 0,
                "totalLiterature": 0,
                "avgCof": None,
                "activeDimensions": [],
                "hiddenDimensions": [],
            },
        }

    dimension_state, active_dimensions, hidden_dimensions = _summarize_dimensions(
        prepared_records,
        total_records=total_records,
        max_nodes_per_type=max_nodes_per_type,
        min_support=min_support,
    )

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    node_lookup: dict[tuple[str, str], str] = {}

    lubricant_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in prepared_records:
        lubricant = item["graphValues"].get("lubricant")
        if lubricant:
            lubricant_groups[lubricant].append(item)

    for lubricant, items in sorted(lubricant_groups.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        node_id = _node_id("lubricant", lubricant)
        node_lookup[("lubricant", lubricant)] = node_id
        nodes.append(
            {
                "id": node_id,
                "type": "lubricant",
                "label": lubricant,
                "count": len(items),
                "coveragePct": round((len(items) / total_records) * 100.0, 1),
                **_cof_stats(items),
            }
        )

    for dim_type, state in dimension_state.items():
        for node_label in state["nodeLabels"]:
            matching_items = [
                item
                for item in prepared_records
                if item["graphValues"].get(dim_type) == node_label
            ]
            if not matching_items:
                continue
            node_id = _node_id(dim_type, node_label)
            node_lookup[(dim_type, node_label)] = node_id
            nodes.append(
                {
                    "id": node_id,
                    "type": dim_type,
                    "label": node_label,
                    "count": len(matching_items),
                    "coveragePct": round((len(matching_items) / total_records) * 100.0, 1),
                    **_cof_stats(matching_items),
                }
            )

    edge_groups: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in prepared_records:
        lubricant = item["graphValues"].get("lubricant")
        if not lubricant:
            continue
        for dim_type in dimension_state.keys():
            dim_value = item["graphValues"].get(dim_type)
            if not dim_value:
                continue
            edge_groups[(lubricant, dim_type, lubricant, dim_value)].append(item)

    for (_, dim_type, lubricant, dim_value), items in sorted(
        edge_groups.items(),
        key=lambda pair: (-len(pair[1]), pair[0][0], pair[0][1], pair[0][3]),
    ):
        source_id = node_lookup.get(("lubricant", lubricant))
        target_id = node_lookup.get((dim_type, dim_value))
        if not source_id or not target_id:
            continue
        edges.append(
            {
                "id": _node_id("edge", f"{source_id}:{target_id}"),
                "source": source_id,
                "target": target_id,
                "sourceType": "lubricant",
                "sourceLabel": lubricant,
                "targetType": dim_type,
                "targetLabel": dim_value,
                "count": len(items),
                **_cof_stats(items),
            }
        )

    title = "当前筛选结果润滑参数关系图谱"
    if len(lubricant_groups) == 1:
        title = f"{next(iter(lubricant_groups.keys()))} 专属润滑参数关系图谱"

    state = "ready"
    if total_records > 0 and not edges:
        state = "insufficient_data"

    return {
        "title": title,
        "state": state,
        "nodes": nodes,
        "edges": edges,
        "summary": {
            "totalRecords": total_records,
            "totalLiterature": total_literature,
            "avgCof": overall_stats["avgCof"],
            "activeDimensions": active_dimensions,
            "hiddenDimensions": hidden_dimensions,
        },
    }


async def drilldown_relationship_graph(
    session: AsyncSession,
    filter_params: Any,
    selection: dict[str, Any],
    *,
    skip: int = 0,
    limit: int = 20,
    scope_filter_values: dict[str, Any] | None = None,
    max_nodes_per_type: int = MAX_NODES_PER_TYPE,
    min_support: int = MIN_SUPPORT,
) -> dict[str, Any]:
    logger.debug("Drilling down relationship graph scope=%s selection=%s", scope_filter_values, selection)
    records = await _fetch_filtered_records(
        session,
        filter_params,
        scope_filter_values=scope_filter_values,
    )
    prepared_records = _prepare_records(records)
    _dimension_state, _active_dimensions, _hidden_dimensions = _summarize_dimensions(
        prepared_records,
        total_records=len(prepared_records),
        max_nodes_per_type=max_nodes_per_type,
        min_support=min_support,
    )

    matched = [
        item
        for item in prepared_records
        if _selection_matches(item, selection)
    ]
    page_items = matched[skip: skip + limit]
    literature_groups: dict[int, dict[str, Any]] = {}
    for item in matched:
        literature = item["record"].literature
        if not literature:
            continue
        existing = literature_groups.get(literature.id)
        if not existing:
            literature_groups[literature.id] = {
                "id": literature.id,
                "doi": literature.doi or "",
                "title": literature.title or "",
                "journal": literature.journal or "",
                "year": literature.year,
                "hitCount": 1,
            }
        else:
            existing["hitCount"] += 1

    literature_summaries = sorted(
        literature_groups.values(),
        key=lambda item: (-item["hitCount"], item["id"]),
    )
    matched_stats = _cof_stats(matched)

    return {
        "selection": selection,
        "summary": {
            "label": _selection_title(selection),
            "count": len(matched),
            "avgCof": matched_stats["avgCof"],
            "minCof": matched_stats["minCof"],
            "maxCof": matched_stats["maxCof"],
        },
        "total": len(matched),
        "skip": skip,
        "limit": limit,
        "items": [_record_to_payload(item["record"]) for item in page_items],
        "literatureSummaries": literature_summaries,
    }

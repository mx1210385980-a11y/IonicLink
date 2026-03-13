from __future__ import annotations

from collections import Counter
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import Literature, TribologyData
from security import literature_scope_conditions
from services.query_service import summarize_confidence_buckets, top_entities


async def get_stats(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scoped_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []

    total_records_stmt = select(func.count(TribologyData.id)).join(TribologyData.literature)
    if scoped_conditions:
        total_records_stmt = total_records_stmt.where(*scoped_conditions)
    total_records = await session.execute(total_records_stmt)
    total = total_records.scalar() or 0

    total_lit_stmt = select(func.count(Literature.id))
    if scoped_conditions:
        total_lit_stmt = total_lit_stmt.where(*scoped_conditions)
    total_lit = await session.execute(total_lit_stmt)
    literature_count = total_lit.scalar() or 0

    cof_stmt = select(
        func.min(TribologyData.cof_value),
        func.max(TribologyData.cof_value),
        func.avg(TribologyData.cof_value),
    ).join(TribologyData.literature)
    if scoped_conditions:
        cof_stmt = cof_stmt.where(*scoped_conditions)
    cof_stats = await session.execute(cof_stmt)
    cof_row = cof_stats.one()

    year_stmt = (
        select(Literature.year, func.count("*"))
        .group_by(Literature.year)
        .order_by(Literature.year)
        .where(Literature.year.is_not(None))
    )
    if scoped_conditions:
        year_stmt = year_stmt.where(*scoped_conditions)
    year_res = await session.execute(year_stmt)

    journal_stmt = (
        select(Literature.journal, func.count("*"))
        .group_by(Literature.journal)
        .order_by(func.count("*").desc())
        .where(Literature.journal.is_not(None))
        .where(Literature.journal != "")
        .limit(5)
    )
    if scoped_conditions:
        journal_stmt = journal_stmt.where(*scoped_conditions)
    journal_res = await session.execute(journal_stmt)

    distinct_il_count_stmt = (
        select(func.count(func.distinct(TribologyData.lubricant)))
        .join(TribologyData.literature)
        .where(TribologyData.lubricant.is_not(None))
        .where(TribologyData.lubricant != "")
        .where(~func.lower(TribologyData.lubricant).like("%ethaline%"))
        .where(~func.lower(TribologyData.lubricant).like("%chcl%"))
    )
    if scoped_conditions:
        distinct_il_count_stmt = distinct_il_count_stmt.where(*scoped_conditions)
    distinct_il_count_res = await session.execute(distinct_il_count_stmt)

    cof_range_stmt = (
        select(
            TribologyData.material_name,
            func.min(TribologyData.cof_value),
            func.max(TribologyData.cof_value),
        )
        .join(TribologyData.literature)
        .group_by(TribologyData.material_name)
        .where(TribologyData.material_name.is_not(None))
        .where(TribologyData.material_name != "")
        .where(TribologyData.cof_value.is_not(None))
    )
    if scoped_conditions:
        cof_range_stmt = cof_range_stmt.where(*scoped_conditions)
    cof_range_res = await session.execute(cof_range_stmt)

    entity_summary = await top_entities(session, scope_filter_values=scope_filter_values)
    confidence_stats = await summarize_confidence_buckets(session, scope_filter_values=scope_filter_values)

    return {
        "total_records": total,
        "literature_count": literature_count,
        "distinct_il_count": distinct_il_count_res.scalar() or 0,
        "cof_stats": {
            "min": cof_row[0],
            "max": cof_row[1],
            "avg": float(cof_row[2]) if cof_row[2] else None,
        },
        "confidence_stats": confidence_stats,
        "materials_ratio": entity_summary["materials_ratio"],
        "top_liquids": entity_summary["top_liquids"],
        "publication_trend": [{"year": row[0], "count": row[1]} for row in year_res.all() if row[0]],
        "top_journals": [{"name": row[0], "count": row[1]} for row in journal_res.all() if row[0]],
        "cof_ranges": [
            {"name": row[0], "min": row[1], "max": row[2]}
            for row in cof_range_res.all()
            if row[0] and row[1] is not None and row[2] is not None
        ],
    }


def summarize_extraction(
    metadata: dict[str, Any],
    records: list[dict[str, Any]],
    validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    material_counter = Counter()
    lubricant_counter = Counter()

    for record in records or []:
        material = str(record.get("material_name") or "").strip()
        lubricant = str(record.get("ionic_liquid") or record.get("lubricant") or "").strip()
        if material:
            material_counter[material] += 1
        if lubricant:
            lubricant_counter[lubricant] += 1

    return {
        "title": metadata.get("title") or "Untitled",
        "record_count": len(records or []),
        "top_materials": [{"name": name, "count": count} for name, count in material_counter.most_common(3)],
        "top_lubricants": [{"name": name, "count": count} for name, count in lubricant_counter.most_common(3)],
        "warnings": list((validation or {}).get("warnings") or []),
    }

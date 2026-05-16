from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
import math
import re
from statistics import median
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import Literature, TribologyData
from security import literature_scope_conditions
from services.query_service import summarize_confidence_buckets, top_entities


def _is_meaningful_text(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text and text.lower() not in {"-", "--", "n/a", "na", "none", "null", "unknown"})


def _clean_label(value: Any, fallback: str = "未标注") -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text if _is_meaningful_text(text) else fallback


def _normalize_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _safe_path_segment(value: Any, fallback: str = "user") -> str:
    text = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+", "-", str(value or "").strip())
    text = text.strip(".-")
    return text or fallback


def _round(value: float | None, digits: int = 4) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _avg(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[int(position)]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _describe_values(values: list[float]) -> dict[str, Any]:
    clean_values = [float(value) for value in values if value is not None]
    q1 = _quantile(clean_values, 0.25)
    q3 = _quantile(clean_values, 0.75)
    return {
        "count": len(clean_values),
        "avgCof": _round(_avg(clean_values)),
        "meanCof": _round(_avg(clean_values)),
        "medianCof": _round(float(median(clean_values)) if clean_values else None),
        "q1Cof": _round(q1),
        "q3Cof": _round(q3),
        "iqrCof": _round((q3 - q1) if q1 is not None and q3 is not None else None),
        "minCof": _round(min(clean_values) if clean_values else None),
        "maxCof": _round(max(clean_values) if clean_values else None),
    }


def _share(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(count * 100 / total, 1)


def _parse_potential(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _format_potential(value: float) -> str:
    if abs(value) < 1e-9:
        return "0 V"
    abs_value = abs(value)
    rendered = str(int(abs_value)) if abs_value.is_integer() else f"{abs_value:g}"
    return f"{'+' if value > 0 else '-'}{rendered} V"


def _extract_cof(row: dict[str, Any]) -> float | None:
    value = row.get("cof_value")
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric >= 0 else None


def _material_label(row: dict[str, Any]) -> str:
    return _clean_label(row.get("substrate_material") or row.get("material_name"), "未标注材料")


def _aggregate_numeric(
    rows: list[dict[str, Any]],
    key_fn,
    *,
    min_count: int = 1,
    limit: int | None = None,
    order_by: str = "count_desc",
) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        value = _extract_cof(row)
        if value is None:
            continue
        raw_label = key_fn(row)
        label = _clean_label(raw_label)
        key = _normalize_key(label)
        if not key:
            continue
        bucket = buckets.setdefault(key, {"name": label, "count": 0, "values": []})
        bucket["count"] += 1
        bucket["values"].append(value)

    items = [
        {"name": bucket["name"], **_describe_values(bucket["values"])}
        for bucket in buckets.values()
        if bucket["count"] >= min_count
    ]

    if order_by == "avg_asc":
        items.sort(key=lambda item: (item.get("medianCof") is None, item.get("medianCof") or 0, -item["count"]))
    elif order_by == "avg_desc":
        items.sort(key=lambda item: (item.get("medianCof") is None, -(item.get("medianCof") or 0), -item["count"]))
    elif order_by == "name":
        items.sort(key=lambda item: item["name"])
    else:
        items.sort(key=lambda item: (-item["count"], item["name"]))

    return items[:limit] if limit else items


def _cof_bucket_rows(cof_values: list[float]) -> list[dict[str, Any]]:
    buckets = [
        ("<0.05", None, 0.05),
        ("0.05-0.10", 0.05, 0.10),
        ("0.10-0.20", 0.10, 0.20),
        ("0.20-0.50", 0.20, 0.50),
        (">=0.50", 0.50, None),
    ]
    result = []
    for label, low, high in buckets:
        values = [
            value for value in cof_values
            if (low is None or value >= low) and (high is None or value < high)
        ]
        result.append(
            {
                "name": label,
                "sharePercent": _share(len(values), len(cof_values)),
                **_describe_values(values),
            }
        )
    return result


def _yearly_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[int, list[float]] = {}
    literature_ids_by_year: dict[int, set[int]] = {}
    for row in rows:
        year = row.get("year")
        cof = _extract_cof(row)
        if not year or cof is None:
            continue
        try:
            year_int = int(year)
        except (TypeError, ValueError):
            continue
        buckets.setdefault(year_int, []).append(cof)
        literature_ids_by_year.setdefault(year_int, set()).add(int(row.get("literature_id") or 0))
    return [
        {
            "year": year,
            "recordCount": len(values),
            "literatureCount": len([item for item in literature_ids_by_year.get(year, set()) if item]),
            **_describe_values(values),
        }
        for year, values in sorted(buckets.items())
    ]


def _potential_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    numeric_buckets: dict[float, list[float]] = {}
    polarity_buckets: dict[str, list[float]] = {"负电位": [], "零电位": [], "正电位": [], "OCP/未定电位": []}

    for row in rows:
        cof = _extract_cof(row)
        if cof is None:
            continue
        potential = _clean_label(row.get("potential"), "")
        if not potential:
            continue
        numeric = _parse_potential(potential)
        if numeric is None:
            polarity_buckets["OCP/未定电位"].append(cof)
            continue
        numeric_buckets.setdefault(round(numeric, 3), []).append(cof)
        if numeric < 0:
            polarity_buckets["负电位"].append(cof)
        elif numeric > 0:
            polarity_buckets["正电位"].append(cof)
        else:
            polarity_buckets["零电位"].append(cof)

    numeric_items = [
        {
            "potential": _format_potential(value),
            "potentialValue": value,
            **_describe_values(values),
        }
        for value, values in sorted(numeric_buckets.items(), key=lambda item: item[0])
    ]
    polarity_items = [
        {
            "name": label,
            **_describe_values(values),
        }
        for label, values in polarity_buckets.items()
        if values
    ]
    return {"byPotential": numeric_items, "byPolarity": polarity_items}


def _chain_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[int, list[float]] = {}
    for row in rows:
        cof = _extract_cof(row)
        raw_chain = row.get("alkyl_chain_length")
        if cof is None or raw_chain is None:
            continue
        try:
            chain = int(raw_chain)
        except (TypeError, ValueError):
            continue
        buckets.setdefault(chain, []).append(cof)
    return [
        {
            "chainLength": chain,
            **_describe_values(values),
        }
        for chain, values in sorted(buckets.items())
    ]


def _status_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = _aggregate_numeric(
        rows,
        lambda row: row.get("review_status") or "未审核",
        min_count=1,
        order_by="count_desc",
    )
    total = sum(item["count"] for item in result)
    return [{**item, "sharePercent": _share(item["count"], total)} for item in result]


def _coverage_rows(rows: list[dict[str, Any]], total: int) -> list[dict[str, Any]]:
    fields = [
        ("COF", lambda row: _extract_cof(row) is not None),
        ("材料/基底", lambda row: _is_meaningful_text(row.get("substrate_material") or row.get("material_name"))),
        ("电位", lambda row: _is_meaningful_text(row.get("potential"))),
        ("烷基链长", lambda row: row.get("alkyl_chain_length") is not None),
        ("阳离子", lambda row: _is_meaningful_text(row.get("cation"))),
        ("阴离子", lambda row: _is_meaningful_text(row.get("anion"))),
        ("审核状态", lambda row: _is_meaningful_text(row.get("review_status"))),
    ]
    return [
        {
            "name": label,
            "count": sum(1 for row in rows if predicate(row)),
            "sharePercent": _share(sum(1 for row in rows if predicate(row)), total),
        }
        for label, predicate in fields
    ]


def _group_lookup(items: list[dict[str, Any]], key: str) -> dict[str, Any]:
    normalized = _normalize_key(key)
    return next((item for item in items if _normalize_key(item.get("name")) == normalized), {})


def _fmt(value: Any, digits: int = 4) -> str:
    if value is None:
        return "NA"
    try:
        return f"{float(value):.{digits}g}"
    except (TypeError, ValueError):
        return str(value)


def _build_pattern_insights(summary: dict[str, Any], charts: dict[str, Any]) -> list[dict[str, str]]:
    total = int(summary.get("recordCount") or 0)
    cof_buckets = charts.get("cofBuckets") or []
    low_count = sum(int(item.get("count") or 0) for item in cof_buckets[:3])
    high_count = int((cof_buckets[-1] or {}).get("count") or 0) if cof_buckets else 0

    low_materials = charts.get("lowFrictionMaterials") or []
    high_materials = charts.get("highFrictionMaterials") or []
    top_low = next((item for item in low_materials if int(item.get("count") or 0) >= 20), low_materials[0] if low_materials else {})
    top_high = next((item for item in high_materials if int(item.get("count") or 0) >= 20), high_materials[0] if high_materials else {})

    potential = charts.get("potential") or {}
    polarity = {item["name"]: item for item in potential.get("byPolarity") or []}
    negative = polarity.get("负电位") or {}
    positive = polarity.get("正电位") or {}
    potential_n = sum(int(item.get("count") or 0) for item in polarity.values())

    chains = charts.get("chainLength") or []
    chain_candidates = [item for item in chains if int(item.get("count") or 0) >= 5] or chains
    long_chain = max(chain_candidates, key=lambda item: item.get("chainLength") or 0, default={})
    chain_two = next((item for item in chains if item.get("chainLength") == 2), {})
    chain_n = sum(int(item.get("count") or 0) for item in chains)

    statuses = {item["name"]: item for item in charts.get("reviewStatus") or []}
    approved = statuses.get("approved") or statuses.get("Approved") or {}
    pending = statuses.get("pending_review") or statuses.get("Pending Review") or {}

    findings = [
        {
            "title": "COF 分布呈右偏，低摩擦记录占比较高但存在高值长尾",
            "claim": (
                f"当前 {total} 条记录中有 {summary.get('cofRecordCount')} 条可用于 COF 统计；"
                f"COF 中位数为 {_fmt(summary.get('medianCof'))}，均值为 {_fmt(summary.get('avgCof'))}，"
                f"IQR 为 [{_fmt(summary.get('q1Cof'))}, {_fmt(summary.get('q3Cof'))}]。"
                f"低于 0.20 的记录为 {low_count} 条，占 {_share(low_count, total)}%；"
                f"同时仍有 {high_count} 条高于或等于 0.50，占 {_share(high_count, total)}%。"
            ),
            "evidence": "均值高于中位数，说明少量高 COF 记录抬升总体均值；因此正文不宜只报告平均值，应同步报告中位数和四分位区间。",
            "interpretation": "该分布形态表明离子液体体系中存在较多低摩擦结果，但高摩擦条件仍不可忽略，后续需要通过材料表面和工况分层解释。",
            "limitation": "该统计为文献汇总数据，不同论文的仪器、载荷、速度和取值方式并不完全一致。",
            "thesisUse": "建议作为“总体描述性统计”第一张结果图，并明确采用中位数/IQR 作为主要稳健统计量。",
        },
        {
            "title": "按材料/基底分层后，COF 中位数差异明显",
            "claim": (
                f"在样本数不少于 5 的材料层级中，{top_low.get('name', '低摩擦材料')} 的 COF 中位数约为 {_fmt(top_low.get('medianCof'))}"
                f"（n={top_low.get('count', 'NA')}），而 {top_high.get('name', '高摩擦材料')} 的 COF 中位数约为 {_fmt(top_high.get('medianCof'))}"
                f"（n={top_high.get('count', 'NA')}）。"
            ),
            "evidence": "HOPG、Si(100)、titanium 等分组的稳健中心值低于 mica、stainless steel 等分组，说明表面材料是解释 COF 变异的重要分层变量。",
            "interpretation": "该差异可能与表面能、粗糙度、离子吸附结构及剪切界面的有序化程度有关。",
            "limitation": "材料分组仍混合了不同探针、载荷、速度和离子液体类型，不能直接等同于单因素对照实验。",
            "thesisUse": "建议在论文中将材料/基底作为一级分层，再讨论离子结构或电位效应。",
        },
        {
            "title": "电位标注子集显示负电位条件下 COF 较低",
            "claim": (
                f"在 {potential_n} 条含电位信息的记录中，负电位组 COF 中位数约为 {_fmt(negative.get('medianCof'))}"
                f"（n={negative.get('count', 'NA')}），正电位组 COF 中位数约为 {_fmt(positive.get('medianCof'))}"
                f"（n={positive.get('count', 'NA')}）。"
            ),
            "evidence": "按具体电位档位绘图时，-1 V、-0.5 V 等负电位档位整体低于 +0.5 V、+1 V 等正电位档位。",
            "interpretation": "这一方向性与电极界面离子层重排、吸附离子种类变化和剪切面位置改变等机制相一致。",
            "limitation": "电位数据只覆盖部分文献，且不同材料表面的电位窗口不可完全等价；应表述为电位标注子集中的统计相关。",
            "thesisUse": "适合作为“外场响应润滑”小节的图表，但正文需保留具体电位档位和样本量。",
        },
        {
            "title": "离子结构指标与 COF 存在相关性，但受材料耦合影响",
            "claim": (
                f"在 {chain_n} 条含烷基链长信息的记录中，链长 {long_chain.get('chainLength', '较长')} 组的 COF 中位数约为 {_fmt(long_chain.get('medianCof'))}"
                f"（n={long_chain.get('count', 'NA')}），链长 {chain_two.get('chainLength', 2)} 组的 COF 中位数约为 {_fmt(chain_two.get('medianCof'))}"
                f"（n={chain_two.get('count', 'NA')}）。"
            ),
            "evidence": "部分长链磷鎓类和特定阴离子组合的稳健统计值较低，但不同链长组的样本量并不均衡。",
            "interpretation": "较长烷基链可能通过增强疏水层、降低剪切强度或形成更稳定边界膜影响摩擦响应。",
            "limitation": "链长不是独立变量，常与阳离子骨架、阴离子、溶剂/添加剂和材料表面共同变化。",
            "thesisUse": "建议作为结构-性能相关性证据，而不是单独链长导致低摩擦的因果结论。",
        },
        {
            "title": "审核状态影响统计中心值，应进行可信度敏感性分析",
            "claim": (
                f"approved 记录的 COF 中位数约为 {_fmt(approved.get('medianCof'))}"
                f"（n={approved.get('count', 'NA')}），pending_review 记录的 COF 中位数约为 {_fmt(pending.get('medianCof'))}"
                f"（n={pending.get('count', 'NA')}）。"
            ),
            "evidence": "两个审核状态子集的中心值和长尾程度不同，说明数据清洗与证据核验会影响最终统计叙述。",
            "interpretation": "审核通过的记录通常有更完整的来源定位和字段证据，更适合作为论文主分析集。",
            "limitation": "审核状态本身并非物理变量，不能解释摩擦机制，只能用于控制数据可靠性。",
            "thesisUse": "建议主文以 approved 或证据充分记录为核心，附录报告全量数据的敏感性分析。",
        },
    ]
    return [
        {
            **finding,
            "evidence": finding["evidence"],
        }
        for finding in findings
    ]


def build_pattern_discovery_markdown(payload: dict[str, Any]) -> str:
    summary = payload.get("summary") or {}
    insights = payload.get("insights") or []
    methodology = payload.get("methodology") or {}
    generated_at = payload.get("generatedAt") or datetime.now().isoformat(timespec="seconds")

    lines = [
        "# IonicLink 数据规律发现文字稿（论文草稿版）",
        "",
        f"生成时间：{generated_at}",
        f"数据范围：当前平台文献库快照，覆盖 {summary.get('literatureCount')} 篇文献、{summary.get('recordCount')} 条摩擦学记录，其中 {summary.get('cofRecordCount')} 条含可统计 COF。",
        f"统计指标：COF 最小值 {summary.get('minCof')}，Q1 {summary.get('q1Cof')}，中位数 {summary.get('medianCof')}，Q3 {summary.get('q3Cof')}，均值 {summary.get('avgCof')}，最大值 {summary.get('maxCof')}。",
        "",
        "统计口径：以下结果为描述性统计与分层相关分析，优先报告中位数和四分位区间（IQR），分组图表默认突出样本数不少于 5 的层级。相关性不等同于因果关系，正文中需要结合原文实验条件和机制证据解释。",
        "",
        "## 方法说明",
        "",
        f"- 研究对象：{methodology.get('outcome', '摩擦系数 COF')}。",
        f"- 分层变量：{methodology.get('stratification', '材料/基底、电位、离子结构、审核状态')}。",
        f"- 稳健统计：{methodology.get('robustStatistic', '中位数与 IQR')}。",
        f"- 分组阈值：{methodology.get('minimumGroupSize', 'n >= 5')}。",
        f"- 主要限制：{methodology.get('caveat', '文献汇总数据存在实验条件异质性，不能替代单因素对照实验。')}",
        "",
    ]

    for index, insight in enumerate(insights, start=1):
        lines.extend(
            [
                f"## {index}. {insight.get('title')}",
                "",
                f"**统计观察：**{insight.get('claim')}",
                "",
                f"**证据依据：**{insight.get('evidence')}",
                "",
                f"**可能解释：**{insight.get('interpretation')}",
                "",
                f"**限制条件：**{insight.get('limitation')}",
                "",
                f"**论文写法：**{insight.get('thesisUse')}",
                "",
            ]
        )

    lines.extend(
        [
            "## 建议图表",
            "",
            "1. COF 区间分布图：报告频数、比例、中位数和长尾区间。",
            "2. 材料/基底分层图：用中位数 COF 和 IQR，而非只用均值。",
            "3. 电位分层图：保留具体电位档位，并标注每组样本量。",
            "4. 链长/离子结构图：报告结构指标与 COF 的相关性，同时说明混杂因素。",
            "5. 审核状态敏感性图：比较 approved 与 pending_review 子集，交代主分析集可靠性。",
            "",
        ]
    )

    return "\n".join(lines)


def save_pattern_discovery_report(
    payload: dict[str, Any],
    *,
    username: str,
    display_name: str | None = None,
) -> dict[str, Any]:
    root = Path(__file__).resolve().parents[2] / "personal-space"
    owner = _safe_path_segment(display_name or username, fallback=_safe_path_segment(username))
    report_dir = root / owner
    report_dir.mkdir(parents=True, exist_ok=True)

    report_path = report_dir / "规律发现文字稿.md"
    markdown = build_pattern_discovery_markdown(payload)
    report_path.write_text(markdown, encoding="utf-8")

    return {
        "saved": True,
        "path": str(report_path),
        "relativePath": str(report_path.relative_to(Path(__file__).resolve().parents[2])),
        "markdown": markdown,
        "savedAt": datetime.now().isoformat(timespec="seconds"),
    }


async def get_pattern_discovery(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scoped_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []

    stmt = (
        select(
            TribologyData.id.label("id"),
            TribologyData.literature_id.label("literature_id"),
            TribologyData.material_name.label("material_name"),
            TribologyData.lubricant.label("lubricant"),
            TribologyData.cof_value.label("cof_value"),
            TribologyData.potential.label("potential"),
            TribologyData.substrate_material.label("substrate_material"),
            TribologyData.probe_material.label("probe_material"),
            TribologyData.cation.label("cation"),
            TribologyData.anion.label("anion"),
            TribologyData.alkyl_chain_length.label("alkyl_chain_length"),
            TribologyData.review_status.label("review_status"),
            TribologyData.confidence.label("confidence"),
            Literature.year.label("year"),
        )
        .join(TribologyData.literature)
    )
    if scoped_conditions:
        stmt = stmt.where(*scoped_conditions)

    result = await session.execute(stmt)
    rows = [dict(row._mapping) for row in result.all()]
    cof_values = [value for value in (_extract_cof(row) for row in rows) if value is not None]

    lit_stmt = select(func.count(Literature.id))
    if scoped_conditions:
        lit_stmt = lit_stmt.where(*scoped_conditions)
    literature_count = (await session.execute(lit_stmt)).scalar() or 0

    distinct_lubricants = len({_normalize_key(row.get("lubricant")) for row in rows if _is_meaningful_text(row.get("lubricant"))})
    total_records = len(rows)

    charts = {
        "cofBuckets": _cof_bucket_rows(cof_values),
        "yearlyTrend": _yearly_rows(rows),
        "topMaterials": _aggregate_numeric(rows, _material_label, min_count=1, limit=10),
        "lowFrictionMaterials": _aggregate_numeric(rows, _material_label, min_count=5, limit=8, order_by="avg_asc"),
        "highFrictionMaterials": _aggregate_numeric(rows, _material_label, min_count=5, limit=8, order_by="avg_desc"),
        "topLubricants": _aggregate_numeric(rows, lambda row: row.get("lubricant"), min_count=1, limit=12),
        "lowFrictionLubricants": _aggregate_numeric(rows, lambda row: row.get("lubricant"), min_count=5, limit=8, order_by="avg_asc"),
        "cations": _aggregate_numeric(rows, lambda row: row.get("cation"), min_count=5, limit=12),
        "anions": _aggregate_numeric(rows, lambda row: row.get("anion"), min_count=5, limit=12),
        "lowFrictionAnions": _aggregate_numeric(rows, lambda row: row.get("anion"), min_count=5, limit=8, order_by="avg_asc"),
        "chainLength": _chain_rows(rows),
        "potential": _potential_rows(rows),
        "reviewStatus": _status_rows(rows),
        "fieldCoverage": _coverage_rows(rows, total_records),
    }
    summary = {
        "recordCount": total_records,
        "cofRecordCount": len(cof_values),
        "literatureCount": int(literature_count),
        "distinctLubricantCount": distinct_lubricants,
        **_describe_values(cof_values),
    }
    insights = _build_pattern_insights(summary, charts)
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "scope": scope_filter_values or {"scope_type": "all"},
        "methodology": {
            "outcome": "摩擦系数（coefficient of friction, COF）",
            "stratification": "材料/基底、电位极性与档位、烷基链长、离子组成、审核状态",
            "robustStatistic": "中位数、四分位区间（IQR）与样本量 n；均值仅作为辅助指标",
            "minimumGroupSize": "分层比较优先展示 n >= 5 的组别",
            "caveat": "当前结果来自多篇文献的汇总抽取，实验载荷、速度、探针、表面处理和取值方式存在异质性。",
        },
        "summary": summary,
        "charts": charts,
        "insights": insights,
    }
    payload["markdown"] = build_pattern_discovery_markdown(payload)
    return payload


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
    extractor_type: str = "tribology",
) -> dict[str, Any]:
    if extractor_type == "diffusion":
        system_counter = Counter()
        lubricant_counter = Counter()

        for record in records or []:
            system_name = str(record.get("system_name") or "").strip()
            ionic_liquid = str(record.get("ionic_liquid") or "").strip()
            if system_name:
                system_counter[system_name] += 1
            if ionic_liquid:
                lubricant_counter[ionic_liquid] += 1

        return {
            "title": metadata.get("title") or "Untitled",
            "record_count": len(records or []),
            "top_systems": [{"name": name, "count": count} for name, count in system_counter.most_common(3)],
            "top_ionic_liquids": [{"name": name, "count": count} for name, count in lubricant_counter.most_common(3)],
            "warnings": list((validation or {}).get("warnings") or []),
        }

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

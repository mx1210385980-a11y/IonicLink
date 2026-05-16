from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import Literature, TribologyData
from security import literature_scope_conditions

MAX_SEARCH_TERMS = 14
MAX_CONTEXT_CHARS = 7200
MAX_SNIPPET_CHARS = 720

_STOPWORDS = {
    "about",
    "after",
    "and",
    "are",
    "can",
    "data",
    "does",
    "for",
    "from",
    "how",
    "into",
    "literature",
    "paper",
    "papers",
    "show",
    "study",
    "that",
    "the",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "哪些",
    "什么",
    "如何",
    "文献",
    "论文",
    "材料",
    "研究",
    "总结",
    "对比",
}
_CJK_STOP_PHRASES = {
    "哪些",
    "什么",
    "如何",
    "文献",
    "论文",
    "材料",
    "研究",
    "总结",
    "对比",
    "找出",
    "相关",
    "影响",
}
_CJK_STOP_CHARS = set("的了和与在对中及等")


@dataclass(slots=True)
class LiteratureChatSource:
    index: int
    source_type: str
    literature_id: int
    record_id: int | None
    title: str
    doi: str | None
    journal: str | None
    year: int | None
    page: int | None
    summary: str
    snippet: str
    score: int

    def to_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("score", None)
        return payload


def extract_chat_search_terms(message: str) -> list[str]:
    text = str(message or "").strip().lower()
    terms: list[str] = []

    def add_term(value: str) -> None:
        term = value.strip().lower()
        if len(term) < 2 or term in _STOPWORDS or term in terms:
            return
        terms.append(term)

    for token in re.findall(r"[a-z0-9][a-z0-9_\-+\[\]()./]{1,}", text):
        add_term(token)

    for block in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        prepared = block
        for phrase in _CJK_STOP_PHRASES:
            prepared = prepared.replace(phrase, " ")
        prepared = "".join(" " if char in _CJK_STOP_CHARS else char for char in prepared)

        for segment in [item for item in prepared.split() if len(item) >= 2]:
            if len(segment) <= 8:
                add_term(segment)
            for width in (2, 3, 4):
                if len(segment) < width:
                    continue
                for index in range(0, len(segment) - width + 1):
                    add_term(segment[index : index + width])
                    if len(terms) >= MAX_SEARCH_TERMS:
                        return terms

    return terms[:MAX_SEARCH_TERMS]


def _clean_text(value: Any, *, max_chars: int | None = None) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if max_chars is not None and len(text) > max_chars:
        return text[: max_chars - 1].rstrip() + "..."
    return text


def _best_snippet(value: Any, terms: list[str], *, max_chars: int = MAX_SNIPPET_CHARS) -> str:
    text = _clean_text(value)
    if not text:
        return ""

    lower = text.lower()
    hit_positions = [lower.find(term.lower()) for term in terms if term and lower.find(term.lower()) >= 0]
    if hit_positions:
        center = min(hit_positions)
        start = max(0, center - max_chars // 3)
        end = min(len(text), start + max_chars)
        snippet = text[start:end].strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(text):
            snippet = snippet.rstrip() + "..."
        return snippet

    return _clean_text(text, max_chars=max_chars)


def _score_text(value: Any, terms: list[str]) -> int:
    haystack = str(value or "").lower()
    return sum(1 for term in terms if term and term.lower() in haystack)


def _source_score(source: LiteratureChatSource, terms: list[str]) -> int:
    score = source.score
    weighted_text = " ".join(
        [
            source.title,
            source.doi or "",
            source.journal or "",
            source.summary,
            source.snippet,
        ]
    )
    return score + _score_text(weighted_text, terms)


def _record_summary(record: TribologyData) -> str:
    cof = record.cof_raw or (str(record.cof_value) if record.cof_value is not None else "")
    fields = [
        ("Material", record.material_name),
        ("Lubricant", record.lubricant),
        ("COF", cof),
        ("Load", record.load_raw or record.load_value),
        ("Speed", record.speed_value),
        ("Temperature", record.temperature),
        ("Potential", record.potential),
        ("Water", record.water_content),
        ("Probe", record.probe_material),
        ("Substrate", record.substrate_material),
    ]
    return "; ".join(f"{label}: {_clean_text(value, max_chars=120)}" for label, value in fields if _clean_text(value))


def _source_from_record(record: TribologyData, terms: list[str]) -> LiteratureChatSource:
    literature = record.literature
    evidence_text = record.evidence or getattr(literature, "content", "")
    snippet = _best_snippet(evidence_text, terms)
    score = 5
    score += _score_text(record.material_name, terms) * 3
    score += _score_text(record.lubricant, terms) * 3
    score += _score_text(getattr(literature, "title", ""), terms) * 4
    score += _score_text(evidence_text, terms)

    return LiteratureChatSource(
        index=0,
        source_type="record",
        literature_id=record.literature_id,
        record_id=record.id,
        title=_clean_text(getattr(literature, "title", "") or f"Literature {record.literature_id}", max_chars=220),
        doi=_clean_text(getattr(literature, "doi", ""), max_chars=120) or None,
        journal=_clean_text(getattr(literature, "journal", ""), max_chars=160) or None,
        year=getattr(literature, "year", None),
        page=record.source_page or record.evidence_page,
        summary=_record_summary(record),
        snippet=snippet,
        score=score,
    )


def _source_from_literature(literature: Literature, terms: list[str]) -> LiteratureChatSource:
    snippet = _best_snippet(literature.content, terms)
    score = 2 + _score_text(literature.title, terms) * 4 + _score_text(literature.content, terms)

    return LiteratureChatSource(
        index=0,
        source_type="literature",
        literature_id=literature.id,
        record_id=None,
        title=_clean_text(literature.title or f"Literature {literature.id}", max_chars=220),
        doi=_clean_text(literature.doi, max_chars=120) or None,
        journal=_clean_text(literature.journal, max_chars=160) or None,
        year=literature.year,
        page=None,
        summary=_clean_text(
            " ".join(part for part in [literature.authors, literature.journal, str(literature.year or "")] if part),
            max_chars=420,
        ),
        snippet=snippet,
        score=score,
    )


def _like_conditions(terms: list[str], columns: list[Any]) -> list[Any]:
    conditions: list[Any] = []
    for term in terms:
        pattern = f"%{term.lower()}%"
        conditions.extend(func.lower(column).like(pattern) for column in columns)
    return conditions


async def retrieve_literature_chat_sources(
    session: AsyncSession,
    message: str,
    *,
    scope_filter_values: dict[str, Any] | None = None,
    limit: int = 6,
) -> tuple[list[LiteratureChatSource], list[str]]:
    terms = extract_chat_search_terms(message)
    scope_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []
    sources: list[LiteratureChatSource] = []

    record_stmt = (
        select(TribologyData)
        .join(TribologyData.literature)
        .options(selectinload(TribologyData.literature))
    )
    if scope_conditions:
        record_stmt = record_stmt.where(*scope_conditions)
    if terms:
        record_stmt = record_stmt.where(
            or_(
                *_like_conditions(
                    terms,
                    [
                        Literature.title,
                        Literature.doi,
                        Literature.authors,
                        Literature.journal,
                        Literature.content,
                        TribologyData.material_name,
                        TribologyData.lubricant,
                        TribologyData.cation,
                        TribologyData.anion,
                        TribologyData.probe_material,
                        TribologyData.substrate_material,
                        TribologyData.substrate_coating,
                        TribologyData.evidence,
                        TribologyData.source,
                    ],
                )
            )
        )
    record_stmt = record_stmt.order_by(desc(TribologyData.confidence), desc(TribologyData.extracted_at)).limit(max(limit * 5, 20))
    record_rows = (await session.execute(record_stmt)).scalars().all()
    sources.extend(_source_from_record(record, terms) for record in record_rows)

    literature_stmt = select(Literature)
    if scope_conditions:
        literature_stmt = literature_stmt.where(*scope_conditions)
    if terms:
        literature_stmt = literature_stmt.where(
            or_(
                *_like_conditions(
                    terms,
                    [
                        Literature.title,
                        Literature.doi,
                        Literature.authors,
                        Literature.journal,
                        Literature.content,
                    ],
                )
            )
        )
    literature_stmt = literature_stmt.order_by(desc(Literature.created_at)).limit(max(limit * 3, 12))
    literature_rows = (await session.execute(literature_stmt)).scalars().all()
    sources.extend(_source_from_literature(literature, terms) for literature in literature_rows)

    deduped: dict[tuple[int, int | None], LiteratureChatSource] = {}
    for source in sources:
        key = (source.literature_id, source.record_id)
        existing = deduped.get(key)
        if existing is None or _source_score(source, terms) > _source_score(existing, terms):
            deduped[key] = source

    ranked = sorted(deduped.values(), key=lambda item: _source_score(item, terms), reverse=True)[:limit]
    for index, source in enumerate(ranked, start=1):
        source.index = index
    return ranked, terms


def build_literature_chat_context(
    sources: list[LiteratureChatSource],
    *,
    user_context: str | None = None,
) -> str:
    lines: list[str] = [
        "You are answering inside IonicLink for students and materials researchers.",
        "Use the retrieved literature context below. Cite relevant sources with bracket numbers such as [1].",
        "If the retrieved context is insufficient, say so clearly and suggest the next database search.",
    ]

    if user_context:
        lines.extend(["", "User-provided context:", _clean_text(user_context, max_chars=1400)])

    if not sources:
        lines.extend(["", "Retrieved literature context: no matching literature or extracted records were found."])
        return "\n".join(lines)

    lines.append("")
    lines.append("Retrieved literature context:")
    for source in sources:
        meta = f"[{source.index}] {source.title}"
        if source.year:
            meta += f" ({source.year})"
        if source.journal:
            meta += f", {source.journal}"
        if source.doi:
            meta += f", DOI: {source.doi}"
        if source.page:
            meta += f", page {source.page}"
        lines.append(meta)
        if source.summary:
            lines.append(f"Key extracted data: {source.summary}")
        if source.snippet:
            lines.append(f"Evidence/context: {source.snippet}")
        lines.append("")

    context = "\n".join(lines).strip()
    return context[:MAX_CONTEXT_CHARS]


def build_retrieval_fallback_answer(message: str, sources: list[LiteratureChatSource]) -> str:
    if not sources:
        return (
            "I could not find matching literature records in the current scope, and the LLM request did not complete. "
            "Try a more specific material, ionic liquid, substrate, DOI, or performance metric."
        )

    lines = [
        "The LLM request did not complete, but IonicLink retrieved these likely relevant sources:",
        "",
    ]
    for source in sources[:4]:
        detail = f"[{source.index}] {source.title}"
        if source.year:
            detail += f" ({source.year})"
        if source.doi:
            detail += f", DOI: {source.doi}"
        lines.append(detail)
        if source.summary:
            lines.append(f"- {source.summary}")
        elif source.snippet:
            lines.append(f"- {source.snippet}")
    lines.append("")
    lines.append(f"Question: {_clean_text(message, max_chars=220)}")
    return "\n".join(lines)

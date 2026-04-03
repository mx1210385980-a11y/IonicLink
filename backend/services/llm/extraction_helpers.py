from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

from services.llm.prompts import ABBREV_MAPPING_PROMPT, ANTI_HALLUCINATION_PROMPT
from services.llm.utils import clean_and_parse_json
from services.normalization import normalize_extraction_row
from utils.cof_guard import unsupported_figure_cof_reason


async def extract_abbrev_map(service: Any, page_texts: dict[int, str]) -> dict[str, dict[str, Any]]:
    chunks = []
    code_re = re.compile(r"\b[A-Z]{2,}\d*(?:-\d+)+(?:-[A-Z])?\b")
    for pidx, text in sorted(page_texts.items()):
        if code_re.search(text or "") or "table" in (text or "").lower():
            chunks.append(f"[Page {pidx + 1}]\\n{(text or '')[:2200]}")
        if len(chunks) >= 8:
            break
    if not chunks:
        return {}

    try:
        resp = await service.text_client.chat.completions.create(
            model=service.text_model,
            messages=[
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user", "content": ABBREV_MAPPING_PROMPT + "\\n\\n" + "\\n\\n".join(chunks)},
            ],
            temperature=0.0,
            max_tokens=4096,
        )
        parsed = clean_and_parse_json(resp.choices[0].message.content)
        rows = parsed.get("sample_map") if isinstance(parsed, dict) else None
        if not isinstance(rows, list):
            return {}
        out = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sid = str(row.get("sample_id") or "").strip()
            if sid:
                mapped = {
                    "ionic_liquid": row.get("ionic_liquid"),
                    "material_name": row.get("material_name"),
                    "condition": row.get("condition"),
                }
                out[sid] = mapped
                sid_trim = sid.rstrip("%")
                if sid_trim and sid_trim != sid:
                    out[sid_trim] = mapped
        return out
    except Exception as exc:
        service._logger.warning("Abbreviation extraction failed: %s", exc)
        return {}


def apply_abbrev(record: dict[str, Any], abbrev_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not abbrev_map:
        return record
    sample_re = re.compile(r"\b[A-Z]{2,}\d*(?:-\d+)+(?:-[A-Z])?\b")
    space = " ".join(
        [
            str(record.get("sample") or ""),
            str(record.get("condition") or ""),
            str(record.get("evidence") or ""),
            str(record.get("notes") or ""),
            str(record.get("film_thickness") or ""),
            str(record.get("source") or ""),
            str(record.get("source_figure") or ""),
        ]
    )

    if not record.get("ionic_liquid"):
        sample_field = str(record.get("sample") or "")
        il_match = re.search(r"(\[[A-Za-z0-9,+\-]+?\]\[[A-Za-z0-9,+\-]+?\])", sample_field)
        if il_match:
            record["ionic_liquid"] = il_match.group(1)

    matched_sid: Optional[str] = None
    for sid in sorted(abbrev_map.keys(), key=len, reverse=True):
        if not sid:
            continue
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(sid)}(?![A-Za-z0-9])", space, flags=re.IGNORECASE):
            matched_sid = sid
            break

    if not matched_sid:
        for sid in sample_re.findall(space):
            sid_norm = sid.strip().rstrip(".,;:%)]")
            if sid_norm in abbrev_map:
                matched_sid = sid_norm
                break

    if matched_sid:
        mapped = abbrev_map.get(matched_sid, {})
        if not record.get("ionic_liquid") and mapped.get("ionic_liquid"):
            record["ionic_liquid"] = mapped["ionic_liquid"]
        if not record.get("material_name") and mapped.get("material_name"):
            record["material_name"] = mapped["material_name"]
    return record


def split_legend_entries(row: dict[str, Any]) -> List[dict[str, Any]]:
    base = dict(row or {})
    text_space = " ".join(
        [
            str(base.get("evidence") or ""),
            str(base.get("notes") or ""),
            str(base.get("source") or ""),
            str(base.get("source_figure") or ""),
        ]
    )
    text_norm = re.sub(r"\s+", " ", text_space.replace("µ", "μ").replace("渭", "μ").replace("碌", "μ")).strip()
    if not text_norm:
        return [base]

    legend_re = re.compile(
        r"(?P<label>in\s+air|[+-]?\d+(?:\.\d+)?\s*V|OCP)\s*[,;:]?\s*"
        r"(?:μ|u|mu|cof)\s*[:=~]?\s*(?P<cof>\d+(?:\.\d+)?)",
        re.IGNORECASE,
    )
    hits = list(legend_re.finditer(text_norm))
    if not hits:
        return [base]

    if len(hits) == 1 and not base.get("cof"):
        match = hits[0]
        base["cof"] = match.group("cof")
        label = re.sub(r"\s+", " ", match.group("label")).strip()
        if re.search(r"\b(?:[+-]?\d+(?:\.\d+)?\s*V|OCP)\b", label, re.IGNORECASE):
            base.setdefault("potential", label)
        else:
            base.setdefault("water_content", label)
        base.setdefault("evidence", match.group(0))
        return [base]

    out: List[dict[str, Any]] = []
    for match in hits:
        label = re.sub(r"\s+", " ", match.group("label")).strip()
        rec = dict(base)
        rec["cof"] = match.group("cof")
        if re.search(r"\b(?:[+-]?\d+(?:\.\d+)?\s*V|OCP)\b", label, re.IGNORECASE):
            rec["potential"] = label
        else:
            rec["water_content"] = label
        rec["evidence"] = match.group(0)
        out.append(rec)
    return out or [base]


def normalize_row(row: dict[str, Any], fallback_page: Optional[int], page_context: Optional[str] = None) -> dict[str, Any]:
    return normalize_extraction_row(row, fallback_page, page_context)


def drop_reason_for_candidate(item: dict[str, Any], modality: str) -> Optional[str]:
    modality_l = str(modality or "").lower()
    evidence = str(item.get("evidence") or "").strip()
    notes = str(item.get("notes") or "").strip()
    source = str(item.get("source") or "")
    source_figure = str(item.get("source_figure") or "")
    cof = str(item.get("cof") or "").strip()

    is_figure_like = "figure" in modality_l or "legend" in modality_l

    if is_figure_like:
        has_source_label = bool(re.search(r"\b(fig(?:ure)?|table)\b", f"{source} {source_figure}", re.IGNORECASE))
        if not has_source_label:
            return "figure_missing_source_label"

        unsupported_reason = unsupported_figure_cof_reason(item)
        if unsupported_reason:
            return unsupported_reason

        support_text = " ".join(part for part in (evidence, notes) if part).strip()
        if cof and support_text and not re.search(
            r"(?:\bcof\b|friction coefficient|[μµu]\s*=|\bmu\s*=|\d|linear fit|slope)",
            support_text,
            re.IGNORECASE,
        ):
            return "weak_evidence_no_numeric"

    return None


def build_document_profile(pdf_path: str, page_texts: dict[int, str]) -> dict[str, Any]:
    total_pages = len(page_texts or {})
    profile: dict[str, Any] = {
        "pdf_name": os.path.basename(pdf_path) if pdf_path else "",
        "total_pages": total_pages,
        "text_chars": 0,
        "avg_text_chars_per_page": 0.0,
        "sparse_text_pages": [],
        "caption_pages": [],
    }
    if not total_pages:
        return profile

    caption_re = re.compile(r"\b(fig(?:ure)?\.?\s*\d+[a-z]?)\b|\btable\s*\d+\b", re.IGNORECASE)
    for pidx, text in sorted((page_texts or {}).items()):
        text_str = (text or "").strip()
        text_len = len(text_str)
        profile["text_chars"] += text_len

        if text_len < 120:
            profile["sparse_text_pages"].append(pidx + 1)
        if caption_re.search(text_str):
            profile["caption_pages"].append(pidx + 1)

    profile["avg_text_chars_per_page"] = round(float(profile["text_chars"]) / float(total_pages), 2)
    return profile


def select_visual_pages(visual_idxs: List[int], page_texts: dict[int, str], high_accuracy: bool) -> List[int]:
    if not visual_idxs:
        return []

    limit = 18 if high_accuracy else 8
    if len(visual_idxs) <= limit:
        return visual_idxs

    must_include: list[int] = []
    if high_accuracy:
        for page_idx in visual_idxs[:6]:
            if page_idx not in must_include:
                must_include.append(page_idx)
        caption_re = re.compile(r"\bfig(?:ure)?\.?\s*\d+[a-z]?\b|\btable\s*\d+\b", re.IGNORECASE)
        for page_idx in visual_idxs:
            text = (page_texts.get(page_idx, "") or "")
            if caption_re.search(text) and page_idx not in must_include:
                must_include.append(page_idx)
    else:
        for page_idx in visual_idxs[:3]:
            if page_idx not in must_include:
                must_include.append(page_idx)
        key_figure_re = re.compile(r"\bfig(?:ure)?\.?\s*[1-3][a-z]?\b", re.IGNORECASE)
        table_re = re.compile(r"\btable\s*\d+\b", re.IGNORECASE)
        added_table = False
        for page_idx in visual_idxs:
            text = (page_texts.get(page_idx, "") or "")
            if key_figure_re.search(text):
                if page_idx not in must_include:
                    must_include.append(page_idx)
            elif (not added_table) and table_re.search(text):
                if page_idx not in must_include:
                    must_include.append(page_idx)
                added_table = True

    scored: List[tuple[int, int]] = []
    for page_idx in visual_idxs:
        text = (page_texts.get(page_idx, "") or "").lower()
        score = 0
        if "figure" in text or re.search(r"\bfig\.?\s*\d+", text):
            score += 4
        if "table" in text:
            score += 3
        if any(token in text for token in ("cof", "friction", "load", "speed", "roughness", "thickness", "nm", "um/s", "μm/s")):
            score += 3
        score += min(4, len(re.findall(r"\d+(?:\.\d+)?", text)))
        if len(text.strip()) > 120:
            score += 1
        scored.append((score, page_idx))

    scored.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    selected: set[int] = set()
    for page_idx in must_include:
        if len(selected) >= limit:
            break
        selected.add(page_idx)
    for _, page_idx in scored:
        if len(selected) >= limit:
            break
        selected.add(page_idx)
    return [page_idx for page_idx in visual_idxs if page_idx in selected]

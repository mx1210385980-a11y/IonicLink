from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import fitz

from models.db_models import TribologyData as TribologyDataDB
from services.il_resolver_service import resolve_il

logger = logging.getLogger(__name__)

MU_SYMBOL = "\u03bc"
MICRO_SIGN = "\u00b5"
OCR_MICRO_VARIANTS = ("\u6e2d", "\u788c")


def resolve_existing_path(raw_path: str | None) -> str | None:
    if not raw_path:
        return None

    candidates = [raw_path]
    if not os.path.isabs(raw_path):
        backend_root = Path(__file__).resolve().parents[1]
        workspace_root = backend_root.parent
        candidates.append(str((backend_root / raw_path).resolve()))
        candidates.append(str((workspace_root / raw_path).resolve()))

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            logger.debug("Resolved PDF path %s", candidate)
            return candidate
    return None


def normalize_term_key(value: str) -> str:
    normalized = str(value or "").lower().replace(MU_SYMBOL, "u").replace(MICRO_SIGN, "u")
    for variant in OCR_MICRO_VARIANTS:
        normalized = normalized.replace(variant, "u")
    return re.sub(
        r"[^a-z0-9]",
        "",
        normalized,
    )


def build_term_query_variants(term: str) -> list[str]:
    raw = str(term or "").strip().replace(MICRO_SIGN, MU_SYMBOL)
    for variant in OCR_MICRO_VARIANTS:
        raw = raw.replace(variant, MU_SYMBOL)
    if len(raw) < 2:
        return []

    variants: list[str] = [raw, re.sub(r"\s+", " ", raw).strip()]
    lowered = raw.lower()

    resolved_il = resolve_il(raw)
    cation = str(resolved_il.get("cation") or "").strip()
    anion = str(resolved_il.get("anion") or "").strip()
    canonical_name = str(resolved_il.get("canonical_name") or "").strip()
    if cation and anion:
        variants.extend(
            [
                canonical_name,
                f"{cation} {anion}",
                f"[{cation}][{anion}]",
                f"{cation}{anion}",
                f"{cation} / {anion}",
            ]
        )

    if "m/s" in lowered or "m s" in lowered:
        unit_swaps = [(MU_SYMBOL, "u"), (MU_SYMBOL, MICRO_SIGN), (MICRO_SIGN, "u"), ("u", MU_SYMBOL)]
        expanded = set(variants)
        for base in list(expanded):
            for source, target in unit_swaps:
                expanded.add(base.replace(source, target))
            if re.search(r"\d", base):
                expanded.add(re.sub(r"(\d)\s*m\s*/\s*s", rf"\1 {MU_SYMBOL}m/s", base, flags=re.IGNORECASE))
                expanded.add(re.sub(r"(\d)\s*m\s*/\s*s", r"\1 um/s", base, flags=re.IGNORECASE))
        with_rate_forms = set()
        for base in expanded:
            with_rate_forms.add(base.replace("/s", " s-1"))
            with_rate_forms.add(base.replace(" s-1", "/s"))
            with_rate_forms.add(base.replace(" / ", "/"))
        variants.extend(list(expanded))
        variants.extend(list(with_rate_forms))

    range_match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*([A-Za-z\u03bc\u00b5/]+)\s*$", raw)
    if range_match:
        start_num, end_num, unit = range_match.groups()
        variants.extend(
            [
                f"{start_num}-{end_num} {unit}",
                f"{start_num} - {end_num} {unit}",
                f"{start_num}–{end_num} {unit}",
                f"{start_num} to {end_num} {unit}",
                f"{start_num} {unit} to {end_num} {unit}",
            ]
        )

    kelvin_match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*[kK]\s*$", raw)
    if kelvin_match:
        num = kelvin_match.group(1)
        variants.extend([f"{num}K", f"{num} K"])
        try:
            kelvin_value = float(num)
            if 293.0 <= kelvin_value <= 300.0:
                variants.extend(["room temperature", "ambient temperature"])
        except Exception:
            pass

    deduped: list[str] = []
    seen: set[str] = set()
    for item in variants:
        candidate = re.sub(r"\s+", " ", str(item or "")).strip()
        if len(candidate) < 2:
            continue
        key = normalize_term_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def extract_numeric_values(text: str) -> list[float]:
    values: list[float] = []
    for token in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(text or "")):
        try:
            values.append(float(token))
        except Exception:
            continue
    return values


def numeric_term_matches(term: str, matched_text: str) -> bool:
    term_values = extract_numeric_values(term)
    matched_values = extract_numeric_values(matched_text)
    if not term_values or not matched_values:
        return False
    for term_value in term_values:
        for matched_value in matched_values:
            tolerance = max(1e-6, abs(term_value) * 0.01)
            if abs(term_value - matched_value) <= tolerance:
                return True
    return False


def build_visual_focus_queries(record: TribologyDataDB) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()

    def _add(raw: str | None):
        text = str(raw or "").strip()
        if len(text) < 2:
            return
        key = normalize_term_key(text)
        if not key or key in seen:
            return
        seen.add(key)
        terms.append(text)

    cof_raw = str(getattr(record, "cof_raw", "") or "").strip()
    cof_value = getattr(record, "cof_value", None)
    potential = str(getattr(record, "potential", "") or "").strip()
    water = str(getattr(record, "water_content", "") or "").strip()

    _add(cof_raw)
    if cof_value is not None:
        try:
            value = float(cof_value)
            for formatted in (f"{value:.1f}", f"{value:.2f}", f"{value:.3f}", f"{value:.4f}"):
                _add(formatted.rstrip("0").rstrip("."))
        except Exception:
            pass

    number_candidates = []
    match = re.search(r"-?\d+(?:\.\d+)?", cof_raw)
    if match:
        number_candidates.append(match.group(0))
    if cof_value is not None:
        try:
            value = float(cof_value)
            number_candidates.extend(
                [
                    f"{value:.1f}".rstrip("0").rstrip("."),
                    f"{value:.2f}".rstrip("0").rstrip("."),
                    f"{value:.3f}".rstrip("0").rstrip("."),
                ]
            )
        except Exception:
            pass
    for number in number_candidates:
        _add(f"{MU_SYMBOL}={number}")
        _add(f"{MU_SYMBOL} = {number}")
        _add(f"mu={number}")
        _add(f"mu = {number}")
        _add(f"cof={number}")
        _add(f"cof = {number}")

    _add(potential)
    _add(water)

    queries: list[str] = []
    query_seen: set[str] = set()
    for term in terms:
        for query in build_term_query_variants(term):
            if len(query.strip()) < 2:
                continue
            key = normalize_term_key(query)
            if not key or key in query_seen:
                continue
            query_seen.add(key)
            queries.append(query)
    return queries


def tighten_table_bbox_by_row(
    pdf_path: str,
    page_num: int | None,
    bbox: list | None,
    record: TribologyDataDB,
) -> list | None:
    if not pdf_path or not os.path.exists(pdf_path) or not page_num or not bbox or len(bbox) != 4:
        return bbox

    from utils.pdf_coords import find_text_coordinates

    cof_raw = str(getattr(record, "cof_raw", "") or "").strip()
    cof_value = getattr(record, "cof_value", None)
    lubricant = str(getattr(record, "lubricant", "") or "").strip()

    query_items: list[dict] = []
    cof_queries: list[str] = []
    if cof_raw:
        cof_queries.extend(build_term_query_variants(cof_raw))
    if cof_value is not None:
        try:
            value = float(cof_value)
            for formatted in (f"{value:.1f}", f"{value:.2f}", f"{value:.3f}", f"{value:.4f}"):
                cof_queries.extend(build_term_query_variants(formatted.rstrip("0").rstrip(".")))
        except Exception:
            pass
    cof_queries = list(dict.fromkeys(query for query in cof_queries if query and len(query.strip()) >= 2))
    if cof_queries:
        query_items.append(
            {
                "id": "cof",
                "queries": cof_queries,
                "semantic_type": "cof",
                "page_hint": int(page_num),
                "restrict_to_page_hint": True,
                "anchor_bbox": bbox,
                "restrict_to_anchor_bbox": True,
            }
        )

    lubricant_queries: list[str] = []
    if lubricant:
        for candidate in [lubricant, lubricant.strip("()[]"), re.sub(r"[\[\]\(\)]", "", lubricant)]:
            lubricant_queries.extend(build_term_query_variants(candidate))
    lubricant_queries = list(dict.fromkeys(query for query in lubricant_queries if query and len(query.strip()) >= 2))
    if lubricant_queries:
        query_items.append(
            {
                "id": "lubricant",
                "queries": lubricant_queries,
                "page_hint": int(page_num),
                "restrict_to_page_hint": True,
                "anchor_bbox": bbox,
                "restrict_to_anchor_bbox": True,
            }
        )

    if not query_items:
        return bbox

    hits = find_text_coordinates(pdf_path, query_items)
    hit_map: dict[str, dict] = {}
    for hit in hits:
        if (hit.get("w") or 0) <= 0 or (hit.get("h") or 0) <= 0:
            continue
        hit_map.setdefault(str(hit.get("id") or ""), hit)

    cof_hit = hit_map.get("cof")
    lubricant_hit = hit_map.get("lubricant")

    def _to_rect(hit: dict) -> list[float]:
        x0 = float(hit.get("x") or 0)
        y0 = float(hit.get("y") or 0)
        w = float(hit.get("w") or 0)
        h = float(hit.get("h") or 0)
        return [x0, y0, x0 + w, y0 + h]

    if cof_hit and lubricant_hit:
        cx0, cy0, cx1, cy1 = _to_rect(cof_hit)
        lx0, ly0, lx1, ly1 = _to_rect(lubricant_hit)
        cof_cy = (cy0 + cy1) / 2.0
        lub_cy = (ly0 + ly1) / 2.0
        same_row_tol = max(10.0, max(cy1 - cy0, ly1 - ly0) * 2.2)
        if abs(cof_cy - lub_cy) <= same_row_tol:
            return [
                round(max(0.0, min(cx0, lx0) - 10.0), 2),
                round(max(0.0, min(cy0, ly0) - 6.0), 2),
                round(max(cx1, lx1) + 10.0, 2),
                round(max(cy1, ly1) + 6.0, 2),
            ]

    if cof_hit:
        x0, y0, x1, y1 = _to_rect(cof_hit)
        return [
            round(max(0.0, x0 - 8.0), 2),
            round(max(0.0, y0 - 6.0), 2),
            round(x1 + 8.0, 2),
            round(y1 + 6.0, 2),
        ]

    return bbox


def pick_visual_source_label(source: str | None, source_figure: str | None) -> str:
    source_text = str(source or "").strip()
    source_figure_text = str(source_figure or "").strip()

    def _has_panel(text: str) -> bool:
        text = str(text or "").strip()
        if not text:
            return False
        return bool(
            re.search(r"\([a-z]\)", text, re.IGNORECASE)
            or re.search(r"\d+\s*[a-z]\b", text, re.IGNORECASE)
            or re.fullmatch(r"\d+\s*[a-z]", text, re.IGNORECASE)
        )

    label = source_text
    if _has_panel(source_figure_text):
        label = source_figure_text
    elif _has_panel(source_text):
        label = source_text
    elif source_figure_text and len(source_figure_text) > len(source_text):
        label = source_figure_text

    label = str(label or "").strip()
    if re.fullmatch(r"\d+\s*[a-z]", label, re.IGNORECASE):
        label = f"Fig. {label}"
    elif re.fullmatch(r"\d+", label):
        label = f"Fig. {label}"
    return label


def extract_panel_letter(source_label: str | None) -> str | None:
    text = str(source_label or "").strip()
    if not text:
        return None
    match = re.search(
        r"\bfig(?:ure)?\.?\s*\d+\s*(?:\(\s*([a-z])\s*\)|([a-z]))\b",
        text,
        re.IGNORECASE,
    )
    if match:
        return ((match.group(1) or match.group(2) or "").strip().lower() or None)
    match = re.fullmatch(r"\d+\s*([a-z])", text, re.IGNORECASE)
    if match:
        return (match.group(1) or "").strip().lower() or None
    return None


def tighten_visual_bbox_by_panel(
    pdf_path: str,
    page_num: int | None,
    bbox: list | None,
    panel_letter: str | None,
) -> list | None:
    if not pdf_path or not os.path.exists(pdf_path) or not page_num or not bbox or len(bbox) != 4 or not panel_letter:
        return bbox
    try:
        x0, y0, x1, y1 = map(float, bbox[:4])
        bw = max(0.0, x1 - x0)
        bh = max(0.0, y1 - y0)
        if bw <= 1.0 or bh <= 1.0:
            return bbox

        doc = fitz.open(pdf_path)
        page = doc[int(page_num) - 1]
        page_w = float(page.rect.width)
        page_h = float(page.rect.height)
        doc.close()

        if (bw / max(page_w, 1.0) <= 0.55) and (bh / max(page_h, 1.0) <= 0.35):
            return bbox

        coarse = (
            (bh / max(page_h, 1.0) > 0.42)
            or (bw / max(page_w, 1.0) > 0.72)
            or (bh / max(bw, 1.0) > 1.3)
        )
        if not coarse:
            return bbox

        idx = max(0, ord(panel_letter[0]) - ord("a"))
        if bw / max(page_w, 1.0) <= 0.55:
            cols = 1
            rows = 3 if idx >= 1 else 2
            col = 0
            row = min(rows - 1, idx)
        else:
            cols = 2
            rows = 3 if idx >= 3 else 2
            col = min(cols - 1, idx % 2)
            row = min(rows - 1, idx // 2)

        cell_w = bw / max(1, cols)
        cell_h = bh / max(1, rows)
        rx0 = x0 + col * cell_w
        rx1 = x0 + (col + 1) * cell_w
        ry0 = y0 + row * cell_h
        ry1 = y0 + (row + 1) * cell_h
        padx = max(4.0, min(16.0, cell_w * 0.08))
        pady = max(4.0, min(14.0, cell_h * 0.1))
        return [
            round(max(0.0, rx0 - padx), 2),
            round(max(0.0, ry0 - pady), 2),
            round(min(page_w, rx1 + padx), 2),
            round(min(page_h, ry1 + pady), 2),
        ]
    except Exception:
        return bbox


def extract_text_snippet(
    pdf_path: str,
    page_num: int,
    bbox: list | None = None,
    fallback_term: str | None = None,
    prefer_term_context: bool = False,
) -> str | None:
    if not pdf_path or not os.path.exists(pdf_path) or page_num < 1:
        return None

    def _clean_pdf_text(text: str) -> str:
        replacements = {
            "\ufb00": "ff",
            "\ufb01": "fi",
            "\ufb02": "fl",
            "\ufb03": "ffi",
            "\ufb04": "ffl",
            "\u00ad": "",
        }
        for key, value in replacements.items():
            text = text.replace(key, value)
        text = text.replace(MICRO_SIGN, MU_SYMBOL)
        for variant in OCR_MICRO_VARIANTS:
            text = text.replace(variant, MU_SYMBOL)
        text = re.sub(r"(?i)(friction\s+coefficient[^.;:\n]{0,80}?)\bm\s*=\s*(\d)", rf"\1{MU_SYMBOL} = \2", text)
        text = re.sub(r"(?i)(coefficient\s+of\s+friction[^.;:\n]{0,80}?)\bm\s*=\s*(\d)", rf"\1{MU_SYMBOL} = \2", text)
        text = re.sub(r"\(\s*m\s*=\s*(\d)", rf"({MU_SYMBOL} = \1", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _sentence_context_from_page(full_text: str, term: str, max_chars: int = 420) -> str | None:
        cleaned_full = _clean_pdf_text(full_text)
        if not cleaned_full or not term:
            return None

        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?;:])\s+", cleaned_full)
            if sentence and sentence.strip()
        ]
        if not sentences:
            return None

        term_lower = term.lower().strip()
        hit_idx = next((idx for idx, sentence in enumerate(sentences) if term_lower in sentence.lower()), None)
        if hit_idx is None:
            return None

        start = hit_idx
        end = hit_idx
        snippet = sentences[hit_idx]

        while len(snippet) < max_chars:
            can_left = start > 0
            can_right = end < len(sentences) - 1
            if not can_left and not can_right:
                break

            if can_right and len(snippet) + 1 + len(sentences[end + 1]) <= max_chars:
                end += 1
                snippet = snippet + " " + sentences[end]
                continue
            if can_left and len(snippet) + 1 + len(sentences[start - 1]) <= max_chars:
                start -= 1
                snippet = sentences[start] + " " + snippet
                continue
            break

        return snippet

    def _trim_snippet(text: str, max_chars: int = 420) -> str:
        snippet = _clean_pdf_text(text)
        if not snippet:
            return snippet
        if len(snippet) > max_chars:
            snippet = snippet[:max_chars]
        if re.search(r"[A-Za-z0-9]$", snippet):
            snippet = re.sub(r"\s+\S*$", "", snippet).strip()
        matches = list(re.finditer(r"[.!?;:]", snippet))
        if matches:
            last_end = matches[-1].end()
            if last_end >= 50:
                snippet = snippet[:last_end].strip()
        return snippet

    try:
        doc = fitz.open(pdf_path)
        page_idx = page_num - 1
        if page_idx >= len(doc):
            doc.close()
            return None

        page = doc[page_idx]
        page_text = page.get_text("text") or ""
        snippet = ""

        if prefer_term_context and fallback_term and page_text:
            term = str(fallback_term).strip()
            if term:
                sentence_context = _sentence_context_from_page(page_text, term, max_chars=420)
                if sentence_context:
                    snippet = sentence_context

        if not snippet and bbox and len(bbox) == 4:
            x0, y0, x1, y1 = [float(value) for value in bbox]
            clip = fitz.Rect(
                max(0, x0 - 140),
                max(0, y0 - 45),
                min(page.rect.width, x1 + 220),
                min(page.rect.height, y1 + 45),
            )
            snippet = page.get_text("text", clip=clip).strip()

        if (not snippet or len(snippet) < 24) and fallback_term and page_text:
            term = str(fallback_term).strip()
            if term:
                sentence_context = _sentence_context_from_page(page_text, term, max_chars=420)
                if sentence_context:
                    snippet = sentence_context

        if not snippet and page_text:
            snippet = page_text[:500].strip()

        doc.close()
        if not snippet:
            return None
        return _trim_snippet(snippet, max_chars=420)
    except Exception as exc:
        print(f"[EvidenceSnippet] extract error: {exc}")
        return None


def visual_hit_prefers_figure_preview(
    pdf_path: str,
    page_num: int,
    figure_bbox: list | None,
    hit_bbox: list | None,
) -> bool:
    if (
        not pdf_path
        or not os.path.exists(pdf_path)
        or not page_num
        or not figure_bbox
        or len(figure_bbox) != 4
        or not hit_bbox
        or len(hit_bbox) != 4
    ):
        return False

    try:
        fx0, fy0, fx1, fy1 = [float(value) for value in figure_bbox]
        tx0, ty0, tx1, ty1 = [float(value) for value in hit_bbox]
        intersects_figure = not (tx1 < fx0 or tx0 > fx1 or ty1 < fy0 or ty0 > fy1)
        if not intersects_figure:
            return False

        doc = fitz.open(pdf_path)
        page = doc[int(page_num) - 1]
        clip = fitz.Rect(
            max(0.0, tx0 - 120.0),
            max(0.0, ty0 - 48.0),
            min(float(page.rect.width), tx1 + 120.0),
            min(float(page.rect.height), ty1 + 48.0),
        )
        local_text = re.sub(r"\s+", " ", page.get_text("text", clip=clip) or "").strip()
        doc.close()

        alpha_words = re.findall(r"[A-Za-z]{2,}", local_text)
        has_sentence_punctuation = bool(re.search(r"[.;:!?]", local_text))
        return len(local_text) <= 100 and len(alpha_words) <= 14 and not has_sentence_punctuation
    except Exception:
        return False




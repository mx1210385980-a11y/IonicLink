"""
PDF Coordinate Finder
Uses PyMuPDF (fitz) to search for text and evidence coordinates in PDF files.
Coordinates are returned in PDF points (72 DPI), 1-based page index.
"""

import os
import re
from difflib import SequenceMatcher
from typing import Optional

import fitz  # PyMuPDF


def _normalize_term_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower().replace("μ", "u").replace("µ", "u"))


def _extract_number_tokens(text: str) -> list[str]:
    return re.findall(r"\d+(?:\.\d+)?", str(text or ""))


def _word_level_find_rect(page: fitz.Page, query: str):
    """
    Fallback matcher for tricky PDF text tokenization:
    - μ/µ/u symbol differences
    - punctuation attachment (e.g., "μm/s.")
    - split tokens across words
    Returns first robust bbox match or None.
    """
    words = page.get_text("words") or []
    if not words:
        return None

    # words tuple: (x0, y0, x1, y1, "word", block_no, line_no, word_no)
    words = sorted(words, key=lambda w: (w[5], w[6], w[7]))
    texts = [str(w[4]) for w in words]
    q_key = _normalize_term_key(query)
    if len(q_key) < 2:
        return None
    q_nums = _extract_number_tokens(query)

    max_window = min(6, max(2, len(query.split()) + 2))
    for i in range(len(words)):
        for win in range(1, max_window + 1):
            j = i + win
            if j > len(words):
                break
            seg_text = " ".join(texts[i:j]).strip()
            seg_key = _normalize_term_key(seg_text)
            if len(seg_key) < 2:
                continue

            # numeric consistency reduces false positives
            if q_nums:
                seg_nums = _extract_number_tokens(seg_text)
                if not all(n in seg_nums for n in q_nums):
                    continue

            if q_key in seg_key or seg_key in q_key:
                x0 = min(float(words[k][0]) for k in range(i, j))
                y0 = min(float(words[k][1]) for k in range(i, j))
                x1 = max(float(words[k][2]) for k in range(i, j))
                y1 = max(float(words[k][3]) for k in range(i, j))
                return fitz.Rect(x0, y0, x1, y1), seg_text
    return None


def _normalize_text(text: str) -> str:
    """Normalize text for robust fuzzy matching."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()


def normalize_source_label(source: Optional[str]) -> Optional[str]:
    """
    Extract a normalized figure/table label from free-form source text.

    Examples:
      "FIG. 12C" -> "Fig. 12C"
      "Figure 5a caption" -> "Fig. 5A"
      "Table S2" -> "Table S2"
    """
    if not source:
        return None

    text = str(source).strip()
    if not text:
        return None

    fig_match = re.search(r"\bfig(?:ure)?\.?\s*([a-z]?\d+[a-z]?)\b", text, re.IGNORECASE)
    if fig_match:
        idx = fig_match.group(1).upper()
        return f"Fig. {idx}"

    table_match = re.search(r"\b(?:table|tab\.?)\s*([a-z]?\d+[a-z]?)\b", text, re.IGNORECASE)
    if table_match:
        idx = table_match.group(1).upper()
        return f"Table {idx}"

    return None


def find_text_coordinates(pdf_path: str, search_terms: list[dict]) -> list[dict]:
    """
    Search for text in a PDF and return highlight bounding boxes.

    Args:
        pdf_path: Path to the PDF file on disk.
        search_terms: List of dicts with:
            - id (str): unique identifier for this highlight
            - queries (list[str]): list of text strings to search for

    Returns:
        List of dicts: [{ id, page, x, y, w, h, matched_text }]
    """
    if not os.path.exists(pdf_path):
        print(f"[PDF Coords] File not found: {pdf_path}")
        return []

    results = []

    try:
        doc = fitz.open(pdf_path)

        for term_info in search_terms:
            term_id = term_info["id"]
            queries = term_info.get("queries", [])
            page_hint = term_info.get("page_hint")
            found = False

            for query in queries:
                if not query or len(query.strip()) < 2:
                    continue

                query_clean = query.strip()
                page_order = list(range(len(doc)))
                if isinstance(page_hint, int) and 1 <= page_hint <= len(doc):
                    hinted = page_hint - 1
                    page_order = [hinted] + [p for p in page_order if p != hinted]

                for page_num in page_order:
                    page = doc[page_num]
                    rects = page.search_for(query_clean)
                    if rects:
                        rect = rects[0]
                        results.append(
                            {
                                "id": term_id,
                                "page": page_num + 1,
                                "x": round(rect.x0, 2),
                                "y": round(rect.y0, 2),
                                "w": round(rect.width, 2),
                                "h": round(rect.height, 2),
                                "matched_text": query_clean,
                            }
                        )
                        found = True
                        break

                    # Fallback for tokenization/encoding mismatches.
                    fallback = _word_level_find_rect(page, query_clean)
                    if fallback:
                        rect, matched_text = fallback
                        results.append(
                            {
                                "id": term_id,
                                "page": page_num + 1,
                                "x": round(rect.x0, 2),
                                "y": round(rect.y0, 2),
                                "w": round(rect.width, 2),
                                "h": round(rect.height, 2),
                                "matched_text": matched_text or query_clean,
                            }
                        )
                        found = True
                        break

                if found:
                    break

            if not found:
                results.append(
                    {
                        "id": term_id,
                        "page": 1,
                        "x": 0,
                        "y": 0,
                        "w": 0,
                        "h": 0,
                        "matched_text": None,
                    }
                )

        doc.close()

    except Exception as e:
        print(f"[PDF Coords] Error searching PDF: {e}")

    return results


def build_search_queries_for_record(record) -> list[str]:
    """
    Build a prioritized list of search queries from a TribologyData DB record.
    """
    queries = []

    if hasattr(record, "evidence") and record.evidence:
        evidence = record.evidence.strip()
        if len(evidence) > 80:
            evidence = evidence[:80]
        queries.append(evidence)

    if hasattr(record, "cof_raw") and record.cof_raw:
        queries.append(record.cof_raw.strip())

    if hasattr(record, "lubricant") and record.lubricant:
        queries.append(record.lubricant.strip())

    if hasattr(record, "material_name") and record.material_name:
        queries.append(record.material_name.strip())

    if hasattr(record, "material_name") and hasattr(record, "lubricant"):
        if record.material_name and record.lubricant:
            queries.append(f"{record.material_name.strip()}")

    return queries


def find_evidence_coordinates(
    pdf_path: str,
    evidence_text: str,
    page_hint: Optional[int] = None,
) -> tuple[Optional[int], Optional[list]]:
    """
    Search for evidence text in a PDF and return (page_num, [x0, y0, x1, y1]).

    Strategy:
      1) exact quote search using multiple trimmed candidates
      2) fuzzy fallback on text blocks
    """
    if not evidence_text or not os.path.exists(pdf_path):
        return None, None

    query_raw = evidence_text.strip()
    if len(query_raw) < 5:
        return None, None

    query_candidates = []
    for n in (160, 120, 80, 50):
        if len(query_raw) >= n:
            query_candidates.append(query_raw[:n].strip())
    query_candidates.append(query_raw)
    query_candidates = list(dict.fromkeys(q for q in query_candidates if len(q) >= 5))

    norm_query = _normalize_text(query_raw)
    if len(norm_query) > 240:
        norm_query = norm_query[:240]

    try:
        doc = fitz.open(pdf_path)
        total_pages = len(doc)

        if page_hint and 1 <= page_hint <= total_pages:
            search_order = [page_hint - 1]
            search_order += [i for i in range(total_pages) if i != page_hint - 1]
        else:
            search_order = list(range(total_pages))

        # 1) Exact search
        for page_idx in search_order:
            page = doc[page_idx]
            for query in query_candidates:
                rects = page.search_for(query)
                if rects:
                    rect = rects[0]
                    doc.close()
                    return page_idx + 1, [
                        round(rect.x0, 2),
                        round(rect.y0, 2),
                        round(rect.x1, 2),
                        round(rect.y1, 2),
                    ]

        # 2) Fuzzy fallback
        best_score = 0.0
        best_hit: tuple[Optional[int], Optional[list]] = (None, None)

        for page_idx in search_order:
            page = doc[page_idx]
            blocks = page.get_text("blocks")

            for block in blocks:
                if len(block) < 5:
                    continue

                x0, y0, x1, y1, block_text = block[:5]
                block_norm = _normalize_text(str(block_text))
                if len(block_norm) < 12:
                    continue

                if norm_query in block_norm or block_norm in norm_query:
                    score = 1.0
                else:
                    comp = block_norm[: max(240, len(norm_query) + 40)]
                    score = SequenceMatcher(None, norm_query, comp).ratio()

                if score > best_score:
                    best_score = score
                    best_hit = (
                        page_idx + 1,
                        [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                    )

        doc.close()

        if best_score >= 0.58 and best_hit[0] is not None:
            return best_hit

    except Exception as e:
        print(f"[PDF Coords] find_evidence_coordinates error: {e}")

    return None, None


def find_figure_bbox(pdf_path: str, figure_label: str) -> tuple[Optional[int], Optional[list]]:
    """
    Search for a figure/table label and return an expanded bbox likely covering the visual.

    Returns:
        (page_num, [x0, y0, x1, y1]) or (None, None)
    """
    if not figure_label or not os.path.exists(pdf_path):
        return None, None

    label_norm = normalize_source_label(figure_label) or figure_label.strip()
    label_clean = label_norm.strip()

    variants = [label_clean]
    if label_clean.lower().startswith("fig."):
        suffix = label_clean[4:].strip()
        variants.extend([f"Figure {suffix}", f"FIG. {suffix}", f"FIGURE {suffix}"])
    elif label_clean.lower().startswith("figure"):
        suffix = label_clean[6:].strip()
        variants.extend([f"Fig. {suffix}", f"FIG. {suffix}"])
    elif label_clean.lower().startswith("table"):
        suffix = label_clean[5:].strip()
        variants.extend([f"Tab. {suffix}", f"TABLE {suffix}"])

    try:
        doc = fitz.open(pdf_path)

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            page_height = page.rect.height
            page_width = page.rect.width

            for variant in variants:
                rects = page.search_for(variant)
                if not rects:
                    continue

                caption_rect = rects[0]

                expanded = fitz.Rect(
                    max(0, caption_rect.x0 - 20),
                    max(0, caption_rect.y0 - 360),
                    min(page_width, caption_rect.x1 + 80),
                    min(page_height, caption_rect.y1 + 20),
                )

                doc.close()
                return page_idx + 1, [
                    round(expanded.x0, 2),
                    round(expanded.y0, 2),
                    round(expanded.x1, 2),
                    round(expanded.y1, 2),
                ]

        doc.close()

    except Exception as e:
        print(f"[PDF Coords] find_figure_bbox error: {e}")

    return None, None

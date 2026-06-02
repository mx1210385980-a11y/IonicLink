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

from services.il_resolver_service import resolve_il
from utils.cof_guard import cof_search_context_is_compatible


def _normalize_term_key(text: str) -> str:
    return re.sub(
        r"[^a-z0-9]",
        "",
        str(text or "")
        .lower()
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("¦ě", "u")
        .replace("¦Ě", "u"),
    )


def _extract_number_tokens(text: str) -> list[str]:
    return re.findall(r"\d+(?:[\.:]\d+)?", str(text or ""))


def _number_token_to_float(token: str) -> Optional[float]:
    try:
        return float(str(token or "").replace(":", "."))
    except Exception:
        return None


def _normalize_pdf_signs(text: str) -> str:
    return (
        str(text or "")
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\uff0b", "+")
        .replace("\x03", "-")
        .replace("\x04", "+")
        .replace("þ", "+")
    )


def _extract_first_explicit_sign(text: str) -> Optional[str]:
    normalized = _normalize_pdf_signs(text)
    match = re.search(r"(?<![a-zA-Z0-9])([+-])\s*\d", normalized)
    return match.group(1) if match else None


def _potential_sign_matches(query: str, context_text: str) -> bool:
    query_sign = _extract_first_explicit_sign(query)
    if not query_sign:
        return True

    query_nums = _extract_number_tokens(query)
    if not query_nums:
        return True

    magnitude = query_nums[0]
    escaped = re.escape(magnitude).replace(r"\.", r"[\.:]")
    normalized_context = _normalize_pdf_signs(context_text)
    sign_pattern = re.compile(rf"(?<![a-zA-Z0-9]){re.escape(query_sign)}\s*{escaped}(?!\d)")
    return bool(sign_pattern.search(normalized_context))


def _numeric_tokens_match(query: str, matched: str) -> bool:
    query_nums = _extract_number_tokens(query)
    if not query_nums:
        return True
    matched_nums = _extract_number_tokens(matched)
    if not matched_nums:
        return False

    matched_vals: list[float] = []
    for token in matched_nums:
        value = _number_token_to_float(token)
        if value is not None:
            matched_vals.append(value)
    if not matched_vals:
        return False

    for token in query_nums:
        qv = _number_token_to_float(token)
        if qv is None:
            return False
        tol = max(1e-6, abs(qv) * 0.01)
        if not any(abs(mv - qv) <= tol for mv in matched_vals):
            return False
    return True


def _extract_alpha_tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z]{3,}", str(text or "").lower())]


def _extract_word_tokens(text: str) -> list[str]:
    normalized = (
        str(text or "")
        .lower()
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("¦ě", "u")
        .replace("¦Ě", "u")
    )
    return [t for t in re.findall(r"[a-z0-9]+", normalized) if t]


def _extract_alpha_sequences(text: str) -> list[str]:
    normalized = (
        str(text or "")
        .lower()
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("¦ě", "u")
        .replace("¦Ě", "u")
    )
    return [t for t in re.findall(r"[a-z]+", normalized) if t]


def _alpha_token_matches(token: str, matched_tokens: list[str], matched_key: str) -> bool:
    token = str(token or "").strip().lower()
    if not token:
        return False
    if token in matched_tokens:
        return True
    if len(token) <= 1:
        return False
    return token in matched_key


def _normalize_context_text(text: str) -> str:
    return (
        str(text or "")
        .lower()
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("¦ě", "u")
        .replace("¦Ě", "u")
    )


def _search_context_is_compatible(semantic_type: str, query: str, local_context: str) -> bool:
    semantic = str(semantic_type or "").strip().lower()
    if semantic in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        semantic = "roughness"
    if not semantic:
        return True

    if semantic == "cof" and _extract_number_tokens(query):
        return cof_search_context_is_compatible(local_context)

    haystack = _normalize_context_text(local_context)
    if semantic == "speed":
        query_text = _normalize_context_text(query)
        has_linear_speed = any(token in haystack for token in ("um/s", "um s-1", "um s−1"))
        has_scan_conditions = (
            "scan" in haystack
            and re.search(r"scan\s*(?:size|length|range)", haystack)
            and re.search(r"scan\s*(?:rate|frequency)|\bhz\b", haystack)
        )
        query_is_scan_conditions = (
            "scan" in query_text
            and (
                re.search(r"scan\s*(?:size|length|range)", query_text)
                or re.search(r"scan\s*(?:rate|frequency)|\bhz\b", query_text)
            )
        )
        return has_linear_speed or bool(has_scan_conditions and query_is_scan_conditions)
    if semantic == "shear_rate":
        return any(token in haystack for token in ("shear rate", "s-1", "s^-1", "s−1"))
    if semantic == "load":
        return any(token in haystack for token in ("nn", "nanonewton", "nanonewtons"))
    if semantic == "roughness" and _extract_number_tokens(query):
        return any(
            token in haystack
            for token in ("roughness", "rms", "root-mean-square", "root mean square", "nm", "um", "pm")
        )
    if semantic == "potential":
        query_lower = _normalize_context_text(query)
        if "ocp" in query_lower or "open circuit" in query_lower:
            return "ocp" in haystack or "open circuit" in haystack

        if _extract_number_tokens(query):
            if not _potential_sign_matches(query, local_context):
                return False
            voltage_number = re.search(
                r"(?<![a-z0-9])[-+\u2212]?\d+(?:[\.:]\d+)?\s*(?:v|volt|volts)\b",
                haystack,
                re.IGNORECASE,
            )
            if voltage_number:
                return True
            return any(token in haystack for token in ("potential", "voltage", "applied bias", "bias voltage"))

    return True


def _matched_text_is_compatible(semantic_type: str, query: str, matched_text: str) -> bool:
    semantic = str(semantic_type or "").strip().lower()
    if semantic in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        semantic = "roughness"
    if semantic == "roughness" and _extract_number_tokens(query):
        alpha_tokens = _extract_alpha_sequences(matched_text)
        allowed = {"roughness", "rms", "root", "mean", "square", "nm", "um", "pm"}
        if alpha_tokens and not any(token in allowed for token in alpha_tokens):
            return False
    return True


def _expand_il_search_aliases(text: str) -> list[str]:
    raw = str(text or "").strip()
    if len(raw) < 2:
        return []

    variants = [raw]
    resolved = resolve_il(raw)
    cation = str(resolved.get("cation") or "").strip()
    anion = str(resolved.get("anion") or "").strip()
    canonical_name = str(resolved.get("canonical_name") or "").strip()
    if cation and anion:
        variants.extend(
            [
                canonical_name,
                f"[{cation}][{anion}]",
                f"{cation} {anion}",
                f"{cation}{anion}",
                f"{cation} / {anion}",
            ]
        )

    deduped: list[str] = []
    seen: set[str] = set()
    for item in variants:
        candidate = str(item or "").strip()
        if len(candidate) < 2:
            continue
        key = candidate.lower().replace("μ", "u").replace("µ", "u").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _query_matches_matched_text(query: str, matched: str) -> bool:
    query_key = _normalize_term_key(query)
    matched_key = _normalize_term_key(matched)
    if not query_key or not matched_key:
        return False

    if query_key == matched_key:
        return True

    query_nums = _extract_number_tokens(query)
    if query_nums:
        if not _numeric_tokens_match(query, matched):
            return False
        alpha_sequences = _extract_alpha_sequences(query)
        if not alpha_sequences:
            return True
        matched_tokens = _extract_word_tokens(matched)
        return all(_alpha_token_matches(token, matched_tokens, matched_key) for token in alpha_sequences)

    query_tokens = _extract_word_tokens(query)
    matched_tokens = _extract_word_tokens(matched)
    if query_tokens and all(token in matched_tokens for token in query_tokens):
        return True

    query_alpha_tokens = _extract_alpha_sequences(query) if ("[" in query and "]" in query) else _extract_alpha_tokens(query)
    if query_alpha_tokens and (
        ("[" in query and "]" in query)
        or len(query_alpha_tokens) > 1
    ):
        return all(_alpha_token_matches(token, matched_tokens, matched_key) for token in query_alpha_tokens)

    return False


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
    q_alpha_tokens = _extract_alpha_tokens(query)
    is_chem_formula_like = ("[" in query and "]" in query) or (len(q_alpha_tokens) >= 2 and len(q_key) >= 8)

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
            if q_nums and not _numeric_tokens_match(query, seg_text):
                continue

            # Chemical-formula-like terms (e.g. [EMIM][TFSI]) must keep key alpha tokens.
            if is_chem_formula_like and q_alpha_tokens:
                if not all(tok in seg_key for tok in q_alpha_tokens):
                    continue

            similar = SequenceMatcher(None, q_key, seg_key).ratio()
            token_match = _query_matches_matched_text(query, seg_text)
            if token_match or similar >= 0.86:
                x0 = min(float(words[k][0]) for k in range(i, j))
                y0 = min(float(words[k][1]) for k in range(i, j))
                x1 = max(float(words[k][2]) for k in range(i, j))
                y1 = max(float(words[k][3]) for k in range(i, j))
                return fitz.Rect(x0, y0, x1, y1), seg_text
    return None


def _roughness_word_level_find_rect(page: fitz.Page, query: str):
    if not _extract_number_tokens(query):
        return None
    words = page.get_text("words") or []
    for word in sorted(words, key=lambda w: (w[5], w[6], w[7])):
        matched_text = str(word[4] or "").strip().rstrip(",;")
        if not _numeric_tokens_match(query, matched_text):
            continue
        rect = fitz.Rect(float(word[0]), float(word[1]), float(word[2]), float(word[3]))
        local_context = _extract_tight_local_context(page, rect)
        context_text = " ".join(part for part in [matched_text, local_context] if part).strip()
        if _search_context_is_compatible("roughness", query, context_text):
            return rect, matched_text
    return None


def _parse_potential_query(query: str) -> Optional[tuple[Optional[str], float]]:
    normalized = _normalize_pdf_signs(query)
    match = re.search(r"(?<![a-zA-Z0-9])([+-])?\s*(\d+(?:[\.:]\d+)?)\s*(?:v|volt|volts)\b", normalized, re.IGNORECASE)
    if not match:
        return None
    value = _number_token_to_float(match.group(2))
    if value is None:
        return None
    return match.group(1), value


def _potential_number_matches(query_value: float, candidate_token: str) -> bool:
    candidate_value = _number_token_to_float(candidate_token)
    if candidate_value is None:
        return False
    tolerance = max(1e-6, abs(query_value) * 0.01)
    if abs(candidate_value - query_value) <= tolerance:
        return True

    # PDF text often normalizes "-2 V" in nearby prose as "-2.0 V" / "-2:0 V".
    if float(candidate_value).is_integer() and abs(float(candidate_value) - query_value) <= tolerance:
        return True
    if float(query_value).is_integer() and abs(candidate_value - float(int(query_value))) <= tolerance:
        return True
    return False


def _line_text_for_word(words: list[tuple], word: tuple) -> str:
    block_no = word[5]
    line_no = word[6]
    return " ".join(str(w[4]) for w in words if w[5] == block_no and w[6] == line_no).strip()


def _candidate_raw_lines(page: fitz.Page, visible_line: str, number_token: str) -> list[str]:
    raw_lines = [line for line in (page.get_text("text") or "").splitlines() if number_token in line]
    if not raw_lines:
        return []

    visible_terms = [token for token in _extract_word_tokens(visible_line) if token]
    if not visible_terms:
        return raw_lines

    ranked: list[tuple[int, str]] = []
    for line in raw_lines:
        normalized_line = _normalize_term_key(line)
        score = sum(1 for token in visible_terms if token in normalized_line)
        ranked.append((score, line))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [line for score, line in ranked if score > 0] or raw_lines


def _sign_for_potential_candidate(page: fitz.Page, words: list[tuple], index: int, number_token: str) -> Optional[str]:
    text = _normalize_pdf_signs(str(words[index][4]))
    token_pattern = re.escape(number_token).replace(r"\:", r"[\.:]").replace(r"\.", r"[\.:]")
    same_word = re.search(rf"([+-])\s*{token_pattern}", text)
    if same_word:
        return same_word.group(1)

    if index > 0 and words[index - 1][5] == words[index][5] and words[index - 1][6] == words[index][6]:
        prev = _normalize_pdf_signs(str(words[index - 1][4])).strip("()[]{}.,;:")
        if prev in {"+", "-"}:
            return prev

    line_text = _line_text_for_word(words, words[index])
    for raw_line in _candidate_raw_lines(page, line_text, number_token):
        normalized_line = _normalize_pdf_signs(raw_line)
        sign_match = re.search(rf"([+-])\s*{token_pattern}(?!\d)", normalized_line)
        if sign_match:
            return sign_match.group(1)
    return None


def _has_nearby_voltage_unit(words: list[tuple], index: int) -> Optional[int]:
    current = _normalize_pdf_signs(str(words[index][4]))
    if re.search(r"\d+(?:[\.:]\d+)?\s*v\b", current, re.IGNORECASE):
        return index

    for offset in range(1, 4):
        j = index + offset
        if j >= len(words):
            break
        if words[j][5] != words[index][5] or words[j][6] != words[index][6]:
            break
        token = str(words[j][4]).strip()
        if re.match(r"^[vV](?:[),.;:]*)$", token):
            return j
        if offset == 1 and re.match(r"^(?:volt|volts)[),.;:]*$", token, re.IGNORECASE):
            return j
    return None


def _potential_word_level_find_rect(page: fitz.Page, query: str):
    parsed = _parse_potential_query(query)
    if not parsed:
        return None
    query_sign, query_value = parsed

    words = page.get_text("words") or []
    if not words:
        return None
    words = sorted(words, key=lambda w: (w[5], w[6], w[7]))

    best: Optional[tuple[float, fitz.Rect, str]] = None
    for index, word in enumerate(words):
        word_text = str(word[4])
        number_tokens = _extract_number_tokens(word_text)
        if not number_tokens:
            continue
        for number_token in number_tokens:
            if not _potential_number_matches(query_value, number_token):
                continue
            unit_index = _has_nearby_voltage_unit(words, index)
            if unit_index is None:
                continue
            candidate_sign = _sign_for_potential_candidate(page, words, index, number_token)
            if query_sign and candidate_sign != query_sign:
                continue

            start = index
            if candidate_sign and index > 0 and words[index - 1][5] == word[5] and words[index - 1][6] == word[6]:
                prev = _normalize_pdf_signs(str(words[index - 1][4])).strip("()[]{}.,;:")
                if prev == candidate_sign:
                    start = index - 1

            end = unit_index
            x0 = min(float(words[k][0]) for k in range(start, end + 1))
            y0 = min(float(words[k][1]) for k in range(start, end + 1))
            x1 = max(float(words[k][2]) for k in range(start, end + 1))
            y1 = max(float(words[k][3]) for k in range(start, end + 1))
            rect = fitz.Rect(x0, y0, x1, y1)
            visible_text = " ".join(str(words[k][4]) for k in range(start, end + 1)).strip()
            matched_text = visible_text
            if candidate_sign and not _extract_first_explicit_sign(visible_text):
                matched_text = f"{candidate_sign}{visible_text}"

            # Prefer compact matches with an explicit sign and closest numeric form.
            value = _number_token_to_float(number_token) or query_value
            value_penalty = abs(value - query_value)
            sign_penalty = 0.0 if candidate_sign else 10.0
            width_penalty = rect.width / 1000.0
            score = value_penalty + sign_penalty + width_penalty
            if best is None or score < best[0]:
                best = (score, rect, matched_text)

    if best:
        _, rect, matched_text = best
        return rect, matched_text
    return None


def _extract_local_context(page: fitz.Page, rect: fitz.Rect, padding: float = 28.0) -> str:
    blocks = page.get_text("blocks") or []
    if blocks:
        expanded = fitz.Rect(rect.x0 - padding, rect.y0 - padding, rect.x1 + padding, rect.y1 + padding)
        for block in blocks:
            if len(block) < 5:
                continue
            bx0, by0, bx1, by1, block_text = block[:5]
            block_rect = fitz.Rect(float(bx0), float(by0), float(bx1), float(by1))
            if expanded.intersects(block_rect):
                return " ".join(str(block_text or "").split()).strip()

    words = page.get_text("words") or []
    if not words:
        return ""

    expanded = fitz.Rect(rect.x0 - padding, rect.y0 - padding, rect.x1 + padding, rect.y1 + padding)
    nearby = []
    for word in sorted(words, key=lambda w: (w[5], w[6], w[7])):
        word_rect = fitz.Rect(float(word[0]), float(word[1]), float(word[2]), float(word[3]))
        if expanded.intersects(word_rect):
            nearby.append(str(word[4]))
    return " ".join(nearby).strip()


def _extract_tight_local_context(page: fitz.Page, rect: fitz.Rect, padding: float = 16.0) -> str:
    expanded = fitz.Rect(
        max(0.0, rect.x0 - padding),
        max(0.0, rect.y0 - padding),
        min(float(page.rect.width), rect.x1 + padding),
        min(float(page.rect.height), rect.y1 + padding),
    )
    try:
        clipped = re.sub(r"\s+", " ", (page.get_text("text", clip=expanded) or "")).strip()
        if clipped:
            return clipped
    except Exception:
        pass

    words = page.get_text("words") or []
    nearby = []
    for word in sorted(words, key=lambda w: (w[5], w[6], w[7])):
        word_rect = fitz.Rect(float(word[0]), float(word[1]), float(word[2]), float(word[3]))
        if expanded.intersects(word_rect):
            nearby.append(str(word[4]))
    return " ".join(nearby).strip()


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

    # Accept forms like:
    #   "Fig. 3b", "Fig. 3(b)", "Figure 10 C", "FIG.12C"
    fig_match = re.search(
        r"\bfig(?:ure)?\.?\s*(\d+)(?:\s*[\(\[]?\s*([a-z])\s*[\)\]]?)?\b",
        text,
        re.IGNORECASE,
    )
    if fig_match:
        num = fig_match.group(1)
        panel = (fig_match.group(2) or "").upper()
        return f"Fig. {num}{panel}"

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
            semantic_type = str(term_info.get("semantic_type") or "").strip().lower()
            page_hint = term_info.get("page_hint")
            restrict_to_page_hint = bool(term_info.get("restrict_to_page_hint"))
            max_page_distance = term_info.get("max_page_distance")
            anchor_bbox = term_info.get("anchor_bbox")
            restrict_to_anchor_bbox = bool(term_info.get("restrict_to_anchor_bbox"))
            found = False

            ax0 = ay0 = ax1 = ay1 = None
            if anchor_bbox and isinstance(anchor_bbox, (list, tuple)) and len(anchor_bbox) == 4:
                try:
                    ax0, ay0, ax1, ay1 = [float(v) for v in anchor_bbox]
                    if ax0 > ax1:
                        ax0, ax1 = ax1, ax0
                    if ay0 > ay1:
                        ay0, ay1 = ay1, ay0
                except Exception:
                    ax0 = ay0 = ax1 = ay1 = None

            def _in_anchor(rr: fitz.Rect) -> bool:
                if ax0 is None:
                    return True
                cx = (rr.x0 + rr.x1) / 2.0
                cy = (rr.y0 + rr.y1) / 2.0
                margin = 12.0
                return (ax0 - margin) <= cx <= (ax1 + margin) and (ay0 - margin) <= cy <= (ay1 + margin)

            for query in queries:
                if not query or len(query.strip()) < 2:
                    continue

                query_clean = query.strip()
                page_order = list(range(len(doc)))
                if isinstance(page_hint, int) and 1 <= page_hint <= len(doc):
                    hinted = page_hint - 1
                    if restrict_to_page_hint:
                        page_order = [hinted]
                    else:
                        remaining = [p for p in page_order if p != hinted]
                        remaining.sort(key=lambda p: (abs(p - hinted), p))
                        page_order = [hinted] + remaining
                        if isinstance(max_page_distance, int) and max_page_distance >= 0:
                            page_order = [
                                p for p in page_order
                                if abs(p - hinted) <= int(max_page_distance)
                            ]

                for page_num in page_order:
                    page = doc[page_num]
                    if semantic_type == "potential":
                        potential_fallback = _potential_word_level_find_rect(page, query_clean)
                        if potential_fallback:
                            rect, matched_text = potential_fallback
                            if restrict_to_anchor_bbox and ax0 is not None and not _in_anchor(rect):
                                continue
                            local_context = _extract_tight_local_context(page, rect)
                            context_text = " ".join(part for part in [matched_text, local_context] if part).strip()
                            if not _search_context_is_compatible(semantic_type, query_clean, context_text):
                                continue
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

                    rects = page.search_for(query_clean)
                    if rects:
                        # Validate candidates with actual extracted text to prevent
                        # substring drift (e.g. query 0.1 matching 0.116667).
                        valid_rects: list[tuple[fitz.Rect, str]] = []
                        for rect in rects:
                            matched_text = (page.get_textbox(rect) or query_clean).strip()
                            if not matched_text:
                                matched_text = query_clean
                            if not _numeric_tokens_match(query_clean, matched_text):
                                continue
                            if not _query_matches_matched_text(query_clean, matched_text):
                                continue
                            if not _matched_text_is_compatible(semantic_type, query_clean, matched_text):
                                continue
                            local_context = (
                                _extract_tight_local_context(page, rect)
                                if semantic_type in {"potential", "roughness", "surface_roughness", "probe_roughness", "substrate_roughness"}
                                else _extract_local_context(page, rect)
                            )
                            context_text = " ".join(part for part in [matched_text, local_context] if part).strip()
                            if not _search_context_is_compatible(semantic_type, query_clean, context_text):
                                continue
                            valid_rects.append((rect, matched_text))

                        if not valid_rects:
                            pass
                        else:
                            if restrict_to_anchor_bbox and ax0 is not None:
                                anchored = [(r, t) for (r, t) in valid_rects if _in_anchor(r)]
                                if anchored:
                                    valid_rects = anchored
                                else:
                                    # When strict anchor mode is requested, skip out-of-anchor matches.
                                    continue
                            if anchor_bbox and isinstance(anchor_bbox, (list, tuple)) and len(anchor_bbox) == 4:
                                try:
                                    ax0, ay0, ax1, ay1 = [float(v) for v in anchor_bbox]
                                    acx = (ax0 + ax1) / 2.0
                                    acy = (ay0 + ay1) / 2.0

                                    def _dist(item: tuple[fitz.Rect, str]) -> float:
                                        rr = item[0]
                                        rcx = (rr.x0 + rr.x1) / 2.0
                                        rcy = (rr.y0 + rr.y1) / 2.0
                                        return ((rcx - acx) ** 2 + (rcy - acy) ** 2) ** 0.5

                                    rect, matched_text = min(valid_rects, key=_dist)
                                except Exception:
                                    rect, matched_text = valid_rects[0]
                            else:
                                rect, matched_text = valid_rects[0]

                            results.append(
                                {
                                    "id": term_id,
                                    "page": page_num + 1,
                                    "x": round(rect.x0, 2),
                                    "y": round(rect.y0, 2),
                                    "w": round(rect.width, 2),
                                    "h": round(rect.height, 2),
                                    "matched_text": matched_text,
                                }
                            )
                            found = True
                            break

                    # Fallback for tokenization/encoding mismatches.
                    if semantic_type in {"roughness", "surface_roughness", "probe_roughness", "substrate_roughness"}:
                        fallback = _roughness_word_level_find_rect(page, query_clean)
                    else:
                        fallback = _word_level_find_rect(page, query_clean)
                    if fallback:
                        rect, matched_text = fallback
                        if restrict_to_anchor_bbox and ax0 is not None and not _in_anchor(rect):
                            continue
                        if not _numeric_tokens_match(query_clean, matched_text or ""):
                            continue
                        if not _query_matches_matched_text(query_clean, matched_text or ""):
                            continue
                        if not _matched_text_is_compatible(semantic_type, query_clean, matched_text or ""):
                            continue
                        local_context = (
                            _extract_tight_local_context(page, rect)
                            if semantic_type in {"potential", "roughness", "surface_roughness", "probe_roughness", "substrate_roughness"}
                            else _extract_local_context(page, rect)
                        )
                        context_text = " ".join(part for part in [matched_text, local_context] if part).strip()
                        if not _search_context_is_compatible(semantic_type, query_clean, context_text):
                            continue
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
        queries.extend(_expand_il_search_aliases(record.lubricant))

    if hasattr(record, "material_name") and record.material_name:
        queries.append(record.material_name.strip())

    if hasattr(record, "material_name") and hasattr(record, "lubricant"):
        if record.material_name and record.lubricant:
            queries.append(f"{record.material_name.strip()}")

    deduped: list[str] = []
    seen: set[str] = set()
    for item in queries:
        candidate = str(item or "").strip()
        if len(candidate) < 2:
            continue
        key = candidate.lower().replace("μ", "u").replace("µ", "u").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)

    return deduped


def find_evidence_coordinates(
    pdf_path: str,
    evidence_text: str,
    page_hint: Optional[int] = None,
    restrict_to_page_hint: bool = False,
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
            if restrict_to_page_hint:
                search_order = [page_hint - 1]
            else:
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


def find_figure_bbox(
    pdf_path: str,
    figure_label: str,
    page_hint: Optional[int] = None,
    restrict_to_page_hint: bool = False,
) -> tuple[Optional[int], Optional[list]]:
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
    is_table_label = label_clean.lower().startswith("table")
    panel_letter = None
    fig_number = None
    fig_match = re.search(
        r"\bfig(?:ure)?\.?\s*(\d+)(?:\s*[\(\[]?\s*([a-z])\s*[\)\]]?)?\b",
        label_clean,
        re.IGNORECASE,
    )
    if fig_match:
        fig_number = fig_match.group(1).strip()
        panel_letter = (fig_match.group(2) or "").strip().lower() or None
    if label_clean.lower().startswith("fig."):
        suffix = label_clean[4:].strip()
        variants.extend([f"Figure {suffix}", f"FIG. {suffix}", f"FIGURE {suffix}"])
    elif label_clean.lower().startswith("figure"):
        suffix = label_clean[6:].strip()
        variants.extend([f"Fig. {suffix}", f"FIG. {suffix}"])
    elif label_clean.lower().startswith("table"):
        suffix = label_clean[5:].strip()
        variants.extend([f"Tab. {suffix}", f"TABLE {suffix}"])
    if fig_number:
        # Panel labels like Fig. 3b should also match the parent caption "Fig. 3".
        base_fig_variants = [
            f"Fig. {fig_number}",
            f"Figure {fig_number}",
            f"FIG. {fig_number}",
            f"FIGURE {fig_number}",
        ]
        variants.extend(base_fig_variants)
    else:
        base_fig_variants = []
    variants = list(dict.fromkeys(v.strip() for v in variants if v and v.strip()))
    # For panel-level requests, prioritize parent figure caption anchor first.
    if panel_letter and base_fig_variants:
        base_order = [v for v in base_fig_variants if v in variants]
        variants = base_order + [v for v in variants if v not in base_order]

    try:
        doc = fitz.open(pdf_path)

        def _find_table_caption_rect(page: fitz.Page, label_text: str) -> Optional[fitz.Rect]:
            normalized = normalize_source_label(label_text) or label_text.strip()
            match = re.search(r"\btable\s+([a-z]?\d+[a-z]?)\b", normalized, re.IGNORECASE)
            if not match:
                return None

            table_idx = match.group(1)
            caption_re = re.compile(
                rf"^\s*(?:table|tab\.?)\s*{re.escape(table_idx)}(?:\b|[.:])",
                re.IGNORECASE,
            )

            best_rect = None
            best_score = float("-inf")
            try:
                text_dict = page.get_text("dict") or {}
                page_width = float(page.rect.width)
                page_height = float(page.rect.height)

                for block in text_dict.get("blocks", []):
                    if block.get("type") != 0:
                        continue
                    for line in block.get("lines", []):
                        spans = line.get("spans") or []
                        if not spans:
                            continue
                        line_text = "".join(str(span.get("text") or "") for span in spans).strip()
                        if not line_text or not caption_re.match(line_text):
                            continue

                        bbox = line.get("bbox") or block.get("bbox")
                        if not bbox or len(bbox) != 4:
                            continue
                        rect = fitz.Rect(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
                        if rect.width <= 0 or rect.height <= 0:
                            continue

                        score = 100.0
                        if rect.y0 <= page_height * 0.55:
                            score += 8.0
                        if rect.width <= page_width * 0.7:
                            score += 4.0
                        if any("bold" in str(span.get("font") or "").lower() for span in spans):
                            score += 24.0
                        if re.match(r"^\s*table\s", line_text, re.IGNORECASE):
                            score += 8.0

                        below_clip = fitz.Rect(
                            max(0, rect.x0 - page_width * 0.18),
                            max(0, rect.y1 + 4),
                            min(page_width, rect.x1 + page_width * 0.18),
                            min(page_height, rect.y1 + 260),
                        )
                        below_text = page.get_text("text", clip=below_clip) or ""
                        short_lines = [
                            ln.strip()
                            for ln in below_text.splitlines()
                            if 1 <= len(ln.strip()) <= 40
                        ]
                        score += min(20.0, len(short_lines) * 2.0)

                        if score > best_score:
                            best_score = score
                            best_rect = rect
            except Exception:
                return None

            return best_rect

        page_order = list(range(len(doc)))
        if isinstance(page_hint, int) and 1 <= page_hint <= len(doc):
            hinted = page_hint - 1
            if restrict_to_page_hint:
                page_order = [hinted]
            else:
                page_order = [hinted] + [p for p in page_order if p != hinted]

        for page_idx in page_order:
            page = doc[page_idx]
            page_height = page.rect.height
            page_width = page.rect.width

            for variant in variants:
                caption_rect = _find_table_caption_rect(page, variant) if is_table_label else None
                if caption_rect is None:
                    if is_table_label:
                        continue
                    rects = page.search_for(variant)
                    if not rects:
                        continue

                    # Use the lowest caption hit for this variant (figure captions are commonly below visuals).
                    caption_rect = sorted(rects, key=lambda r: r.y0)[-1]

                def _collect_visual_rects() -> list[fitz.Rect]:
                    out: list[fitz.Rect] = []
                    cap_cx = (caption_rect.x0 + caption_rect.x1) / 2.0
                    if is_table_label:
                        try:
                            for block in page.get_text("blocks") or []:
                                if len(block) < 5:
                                    continue
                                x0, y0, x1, y1, block_text = block[:5]
                                rr = fitz.Rect(float(x0), float(y0), float(x1), float(y1))
                                text = str(block_text or "").strip()
                                if not text:
                                    continue
                                if rr.y0 < caption_rect.y1 - 4 or rr.y0 > caption_rect.y1 + 340:
                                    continue
                                if rr.height < 6:
                                    continue
                                center_ok = abs(((rr.x0 + rr.x1) / 2.0) - cap_cx) <= page_width * 0.24
                                narrow_ok = rr.width <= page_width * 0.62
                                if not (center_ok or narrow_ok):
                                    continue
                                out.append(rr)
                        except Exception:
                            pass

                        try:
                            for d in page.get_drawings() or []:
                                rr = d.get("rect")
                                if not rr:
                                    continue
                                rr = fitz.Rect(rr)
                                if rr.y0 < caption_rect.y1 - 4 or rr.y0 > caption_rect.y1 + 340:
                                    continue
                                if rr.width < page_width * 0.08 or rr.height < 1.0:
                                    continue
                                center_ok = abs(((rr.x0 + rr.x1) / 2.0) - cap_cx) <= page_width * 0.28
                                wide_ok = rr.width <= page_width * 0.68
                                if not (center_ok or wide_ok):
                                    continue
                                out.append(rr)
                        except Exception:
                            pass
                        return out

                    try:
                        text_dict = page.get_text("dict") or {}
                        for b in text_dict.get("blocks", []):
                            if b.get("type") != 1:
                                continue
                            bb = b.get("bbox")
                            if not bb or len(bb) != 4:
                                continue
                            rr = fitz.Rect(float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3]))
                            if rr.width < page_width * 0.06 or rr.height < page_height * 0.04:
                                continue
                            # Visual should be near/above caption.
                            if rr.y1 > caption_rect.y0 + 24:
                                continue
                            if rr.y1 < caption_rect.y0 - 560:
                                continue
                            out.append(rr)
                    except Exception:
                        pass

                    try:
                        for d in page.get_drawings() or []:
                            rr = d.get("rect")
                            if not rr:
                                continue
                            rr = fitz.Rect(rr)
                            if rr.width < page_width * 0.06 or rr.height < page_height * 0.04:
                                continue
                            if rr.y1 > caption_rect.y0 + 24:
                                continue
                            if rr.y1 < caption_rect.y0 - 560:
                                continue
                            out.append(rr)
                    except Exception:
                        pass
                    return out

                visual_rects = _collect_visual_rects()
                if visual_rects:
                    # For panel-level labels, keep all candidate visual rects first, then refine by panel.
                    # Caption token centers (e.g., just "Fig. 3") are too narrow and can wrongly drop sibling panels.
                    if is_table_label:
                        filtered = visual_rects
                    elif panel_letter:
                        filtered = visual_rects
                    else:
                        cap_cx = (caption_rect.x0 + caption_rect.x1) / 2.0
                        filtered = []
                        for rr in visual_rects:
                            rcx = (rr.x0 + rr.x1) / 2.0
                            if abs(rcx - cap_cx) <= page_width * 0.45 or rr.intersects(
                                fitz.Rect(max(0, caption_rect.x0 - 180), 0, min(page_width, caption_rect.x1 + 180), page_height)
                            ):
                                filtered.append(rr)
                        if not filtered:
                            filtered = visual_rects

                    x0 = min(r.x0 for r in filtered)
                    y0 = min(r.y0 for r in filtered)
                    x1 = max(r.x1 for r in filtered)
                    y1 = max(r.y1 for r in filtered)
                    pad_x = 10 if is_table_label else 8
                    pad_y = 10 if is_table_label else 8
                    figure_rect = fitz.Rect(
                        max(0, x0 - pad_x),
                        max(0, y0 - pad_y),
                        min(page_width, x1 + pad_x),
                        min(page_height, y1 + pad_y),
                    )
                else:
                    if is_table_label:
                        cap_cx = (caption_rect.x0 + caption_rect.x1) / 2.0
                        figure_rect = fitz.Rect(
                            max(0, cap_cx - page_width * 0.24),
                            max(0, caption_rect.y1 + 6),
                            min(page_width, cap_cx + page_width * 0.24),
                            min(page_height, caption_rect.y1 + 280),
                        )
                    else:
                        # Fallback: caption-above region.
                        figure_rect = fitz.Rect(
                            max(0, caption_rect.x0 - 20),
                            max(0, caption_rect.y0 - 420),
                            min(page_width, caption_rect.x1 + 100),
                            min(page_height, caption_rect.y1 + 20),
                        )

                # Optional panel refinement (e.g., Fig. 3F) using nearby panel labels.
                if panel_letter:
                    try:
                        base_rect = fitz.Rect(figure_rect)

                        # Grid fallback is always prepared, then used when label-based segmentation is missing/too large.
                        cap_clip = fitz.Rect(
                            0,
                            max(0, caption_rect.y0 - 4),
                            page_width,
                            min(page_height, caption_rect.y1 + 120),
                        )
                        cap_text = (page.get_text("text", clip=cap_clip) or "").lower()
                        letters = re.findall(r"\(([a-z])\)", cap_text)
                        panel_count = 0
                        if letters:
                            panel_count = max(ord(ch) - ord("a") + 1 for ch in letters if "a" <= ch <= "z")
                        if panel_count <= 0:
                            panel_count = max(ord(panel_letter) - ord("a") + 1, 2)
                        idx_raw = max(0, ord(panel_letter) - ord("a"))
                        idx = min(idx_raw, max(0, panel_count - 1))

                        # Special-case 3-panel layouts: many papers place (a) on top and (b)/(c) at bottom.
                        # This fixes frequent C->B drift for figure structures like Fig. 10 in review articles.
                        if panel_count == 3 and base_rect.width > page_width * 0.55:
                            split_y = base_rect.y0 + base_rect.height * 0.54
                            split_x = base_rect.x0 + base_rect.width * 0.5
                            if idx <= 0:  # (a)
                                gx0, gx1 = base_rect.x0, base_rect.x1
                                gy0, gy1 = base_rect.y0, split_y
                            elif idx == 1:  # (b)
                                gx0, gx1 = base_rect.x0, split_x
                                gy0, gy1 = split_y, base_rect.y1
                            else:  # (c)
                                gx0, gx1 = split_x, base_rect.x1
                                gy0, gy1 = split_y, base_rect.y1
                        else:
                            # If the detected figure region is already a single column, split by rows only.
                            is_single_column_region = base_rect.width <= page_width * 0.52 and idx >= 1
                            if is_single_column_region:
                                cols = 1
                                rows = max(2, (panel_count + 1) // 2, (idx // 2) + 1)
                                row = min(rows - 1, idx // 2)
                                col = 0
                            else:
                                cols = 2 if panel_count > 1 else 1
                                rows = max(1, (panel_count + cols - 1) // cols)
                                row = min(rows - 1, idx // cols)
                                col = min(cols - 1, idx % cols)

                            cell_w = base_rect.width / max(1, cols)
                            cell_h = base_rect.height / max(1, rows)
                            gx0 = base_rect.x0 + col * cell_w
                            gx1 = base_rect.x0 + (col + 1) * cell_w
                            gy0 = base_rect.y0 + row * cell_h
                            gy1 = base_rect.y0 + (row + 1) * cell_h

                        grid_rect = fitz.Rect(
                            max(base_rect.x0, gx0 - 10),
                            max(base_rect.y0, gy0 - 10),
                            min(base_rect.x1, gx1 + 10),
                            min(base_rect.y1, gy1 + 10),
                        )
                        if not (
                            grid_rect.width >= base_rect.width * 0.2
                            and grid_rect.height >= base_rect.height * 0.12
                        ):
                            grid_rect = None

                        words = page.get_text("words") or []
                        panel_marks: list[tuple[str, fitz.Rect]] = []
                        for w in words:
                            if len(w) < 5:
                                continue
                            wx0, wy0, wx1, wy1, wt = float(w[0]), float(w[1]), float(w[2]), float(w[3]), str(w[4] or "")
                            wr = fitz.Rect(wx0, wy0, wx1, wy1)
                            if not wr.intersects(base_rect):
                                continue
                            t = wt.strip().lower()
                            if not re.fullmatch(r"\(?[a-z]\)?\.?", t):
                                continue
                            letter = re.sub(r"[^a-z]", "", t)
                            if not letter:
                                continue
                            panel_marks.append((letter, wr))

                        target = next((pr for pr in panel_marks if pr[0] == panel_letter), None)
                        target_rect = None
                        if target:
                            tx = (target[1].x0 + target[1].x1) / 2.0
                            ty = (target[1].y0 + target[1].y1) / 2.0
                            fw = max(1.0, base_rect.width)
                            fh = max(1.0, base_rect.height)

                            same_row = [pr for pr in panel_marks if abs(((pr[1].y0 + pr[1].y1) / 2.0) - ty) <= fh * 0.24]
                            same_col = [pr for pr in panel_marks if abs(((pr[1].x0 + pr[1].x1) / 2.0) - tx) <= fw * 0.24]

                            left = base_rect.x0
                            right = base_rect.x1
                            top = base_rect.y0
                            bottom = base_rect.y1

                            left_neighbors = [((pr[1].x0 + pr[1].x1) / 2.0) for pr in same_row if ((pr[1].x0 + pr[1].x1) / 2.0) < tx]
                            right_neighbors = [((pr[1].x0 + pr[1].x1) / 2.0) for pr in same_row if ((pr[1].x0 + pr[1].x1) / 2.0) > tx]
                            up_neighbors = [((pr[1].y0 + pr[1].y1) / 2.0) for pr in same_col if ((pr[1].y0 + pr[1].y1) / 2.0) < ty]
                            down_neighbors = [((pr[1].y0 + pr[1].y1) / 2.0) for pr in same_col if ((pr[1].y0 + pr[1].y1) / 2.0) > ty]

                            if left_neighbors:
                                left = max(left, (max(left_neighbors) + tx) / 2.0)
                            if right_neighbors:
                                right = min(right, (min(right_neighbors) + tx) / 2.0)
                            if up_neighbors:
                                top = max(top, (max(up_neighbors) + ty) / 2.0)
                            if down_neighbors:
                                bottom = min(bottom, (min(down_neighbors) + ty) / 2.0)

                            panel_rect = fitz.Rect(
                                max(base_rect.x0, left - 12),
                                max(base_rect.y0, top - 12),
                                min(base_rect.x1, right + 12),
                                min(base_rect.y1, bottom + 12),
                            )
                            if panel_rect.width >= fw * 0.16 and panel_rect.height >= fh * 0.12:
                                target_rect = panel_rect

                        if target_rect and grid_rect:
                            # If label-neighbor refinement is still too coarse (e.g., full column), trust grid split.
                            too_wide = target_rect.width > base_rect.width * 0.68
                            too_tall = target_rect.height > base_rect.height * 0.62
                            figure_rect = grid_rect if (too_wide or too_tall) else target_rect
                        elif target_rect:
                            figure_rect = target_rect
                        elif grid_rect:
                            figure_rect = grid_rect
                    except Exception:
                        pass

                doc.close()
                return page_idx + 1, [
                    round(figure_rect.x0, 2),
                    round(figure_rect.y0, 2),
                    round(figure_rect.x1, 2),
                    round(figure_rect.y1, 2),
                ]

        doc.close()

    except Exception as e:
        print(f"[PDF Coords] find_figure_bbox error: {e}")

    return None, None

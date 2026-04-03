from __future__ import annotations

import re
from typing import Any, Mapping, Optional


_STRONG_COF_CUE_RE = re.compile(
    r"(?:friction coefficient|\bcof\b|\bmu\b|[μµ]|lateral force|normal load|friction-load)",
    re.IGNORECASE,
)
_POTENTIAL_RE = re.compile(r"[+-]?\d+(?:\.\d+)?\s*V|\bOCP\b", re.IGNORECASE)
_NON_COF_CONTEXT_RE = re.compile(
    r"(?:roughness|rms|slip length|hydrodynamic force|film thickness|layer spacing|residual film thickness)",
    re.IGNORECASE,
)


def _extract_number_tokens(text: Any) -> list[float]:
    values: list[float] = []
    for token in re.findall(r"-?\d+(?:\.\d+)?", str(text or "")):
        try:
            values.append(float(token))
        except Exception:
            continue
    return values


def cof_value_supported_in_text(cof_value: Any, text: Any) -> bool:
    query_vals = _extract_number_tokens(cof_value)
    text_vals = _extract_number_tokens(text)
    if not query_vals or not text_vals:
        return False

    for qv in query_vals:
        tol = max(1e-6, abs(qv) * 0.01)
        if any(abs(tv - qv) <= tol for tv in text_vals):
            return True
    return False


def is_ambiguous_multi_condition_legend(text: Any) -> bool:
    raw = str(text or "").strip()
    if not raw:
        return False

    lowered = raw.lower()
    potential_count = len(re.findall(_POTENTIAL_RE, raw))
    env_count = sum(1 for token in ("dry", "ambient", "r.h.", "humidity", "ar") if token in lowered)
    separator_count = raw.count("/") + raw.count(";") + raw.count("|")
    bullet_like = any(symbol in raw for symbol in ("●", "○", "▲", "△", "■", "□"))

    return (
        (potential_count >= 2 and separator_count >= 1)
        or (potential_count >= 1 and env_count >= 2 and (separator_count >= 1 or bullet_like))
    )


def unsupported_figure_cof_reason(record: Mapping[str, Any]) -> Optional[str]:
    source_space = " ".join(
        [
            str(record.get("source") or ""),
            str(record.get("source_figure") or ""),
        ]
    )
    if not re.search(r"\bfig(?:ure)?\b", source_space, re.IGNORECASE):
        return None

    cof_value = record.get("cof") or record.get("cof_raw") or record.get("cof_value")
    if cof_value in (None, ""):
        return None

    evidence = str(record.get("evidence") or "").strip()
    notes = str(record.get("notes") or "").strip()
    support_text = " ".join(part for part in (evidence, notes) if part).strip()
    if not cof_value_supported_in_text(cof_value, support_text):
        if is_ambiguous_multi_condition_legend(evidence):
            return "figure_legend_without_numeric_support"
        return "figure_cof_without_numeric_support"

    if not _STRONG_COF_CUE_RE.search(support_text):
        return "figure_cof_without_metric_context"

    return None


def cof_search_context_is_compatible(context_text: Any) -> bool:
    text = str(context_text or "").strip()
    if not text:
        return True

    has_negative = bool(_NON_COF_CONTEXT_RE.search(text))
    has_positive = bool(_STRONG_COF_CUE_RE.search(text))
    if has_negative and not has_positive:
        return False
    return True

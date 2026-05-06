"""Helpers for explaining no-data extraction outcomes."""

from __future__ import annotations

import re
from typing import Any


GENERIC_NO_DATA_MESSAGES = {
    "no tribology data found",
    "no extractable records found",
    "no extractable records found.",
    "no extractable diffusion records found",
    "no extractable diffusion records found.",
    "no relevant diffusion data found",
    "no relevant diffusion data found.",
    "no relevant tribology data found",
    "no relevant tribology data found.",
}


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _first_sentence(value: str, *, max_length: int = 96) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    sentence = re.split(r"(?<=[。.!?])\s+", text, maxsplit=1)[0].strip()
    if len(sentence) <= max_length:
        return sentence
    return f"{sentence[: max_length - 1].rstrip()}…"


def is_generic_no_data_message(value: Any) -> bool:
    normalized = _clean_text(value).lower()
    return normalized in GENERIC_NO_DATA_MESSAGES


def _metadata_values(metadata: dict[str, Any] | None) -> list[str]:
    if not isinstance(metadata, dict):
        return []
    return [
        _clean_text(metadata.get(key))
        for key in ("title", "doi", "authors", "journal", "year", "abstract")
        if _clean_text(metadata.get(key))
    ]


def _literature_values(literature: Any | None) -> list[str]:
    if literature is None:
        return []
    return [
        _clean_text(getattr(literature, key, None))
        for key in ("title", "doi", "authors", "journal", "year")
        if _clean_text(getattr(literature, key, None))
    ]


def _summary_message(summary: dict[str, Any] | None) -> str:
    if not isinstance(summary, dict):
        return ""
    for key in ("no_data_reason", "current_message", "reasoning"):
        value = _clean_text(summary.get(key))
        if value:
            return value
    return ""


def _positive_count(value: Any) -> bool:
    try:
        return int(value or 0) > 0
    except Exception:
        return False


def build_no_data_reason(
    *,
    literature: Any | None = None,
    metadata: dict[str, Any] | None = None,
    content: str | None = None,
    summary: dict[str, Any] | None = None,
    fallback: str | None = None,
) -> str:
    """Return one concise, user-facing reason for a no-data literature result."""

    for candidate in (fallback, _summary_message(summary)):
        candidate_text = _clean_text(candidate)
        if candidate_text and not is_generic_no_data_message(candidate_text):
            return _first_sentence(candidate_text)

    header_values = [
        *_literature_values(literature),
        *_metadata_values(metadata),
    ]
    content_text = _clean_text(content)[:40000]
    values = [*header_values, content_text]
    header_haystack = " ".join(value for value in header_values if value).lower()
    haystack = " ".join(value for value in values if value).lower()

    ionic_liquid_signal = bool(
        re.search(r"\bionic liquid(s)?\b", haystack)
        or re.search(r"\bils?\b", haystack)
        or "离子液体" in haystack
    )
    tribology_signal = bool(
        any(marker in haystack for marker in ("tribology", "tribological", "friction", "wear", "lubrication", "nanolubrication"))
        or "摩擦" in haystack
        or "磨损" in haystack
        or "润滑" in haystack
    )
    des_header_signal = bool(
        "deep eutectic solvent" in header_haystack
        or "deep eutectic solvents" in header_haystack
        or re.search(r"\bdes\b", header_haystack)
        or any(marker in header_haystack for marker in ("choline chloride", "ethaline", "reline", "glyceline"))
    )
    des_content_signal = bool(
        "deep eutectic solvent" in haystack
        or "deep eutectic solvents" in haystack
        or any(marker in haystack for marker in ("choline chloride", "ethaline", "reline", "glyceline"))
    )
    if des_header_signal or (des_content_signal and tribology_signal and not ionic_liquid_signal):
        return "本文研究对象是深共熔溶剂（DES）而非离子液体，因此不进入当前 IL 数据集。"

    dropped_by_reason = summary.get("dropped_by_reason") if isinstance(summary, dict) else {}
    if not isinstance(dropped_by_reason, dict):
        dropped_by_reason = {}
    dropped_keys = {str(key) for key, value in dropped_by_reason.items() if _positive_count(value)}

    if {"missing_primary_metric", "no_core_quant_signal", "no_friction_or_wear"} & dropped_keys:
        return "文中相关描述缺少可结构化的摩擦系数、磨损或载荷等核心指标。"

    candidate_count = 0
    if isinstance(summary, dict):
        try:
            candidate_count = int(summary.get("candidate_count") or 0)
        except Exception:
            candidate_count = 0
    if candidate_count > 0:
        return "模型找到候选片段，但缺少可确认的离子液体、工况和性能指标组合。"

    if tribology_signal and not ionic_liquid_signal:
        return "文中没有明确的离子液体润滑体系，因此不进入当前 IL 数据集。"

    return "未找到可抽取的离子液体摩擦/磨损结构化数据。"

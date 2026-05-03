from __future__ import annotations

import re
from typing import Any, Optional


_OCP_RE = re.compile(r"\b(?:ocp|ocv|open[-\s]*circuit(?:\s+potential)?)\b", re.IGNORECASE)


def _format_voltage(value: float, explicit_plus: bool = False) -> str:
    text = f"{value:.6g}"
    if explicit_plus and value > 0:
        text = f"+{text}"
    return f"{text} V"


def _normalize_reference(reference: str) -> str:
    ref = re.sub(r"\s+", " ", str(reference or "").strip().strip(".,;:()[]"))
    ref_l = ref.lower()
    if not ref:
        return ""
    if _OCP_RE.search(ref):
        return "OCP"
    if re.fullmatch(r"ag\s*/\s*agcl", ref, flags=re.IGNORECASE):
        return "Ag/AgCl"
    if ref_l == "sce":
        return "SCE"
    if ref_l == "she":
        return "SHE"
    if ref_l == "pt":
        return "Pt"
    return ref


def _extract_reference(text: str) -> tuple[str, bool]:
    explicit_ocp = bool(_OCP_RE.search(text))
    ref_match = re.search(
        r"(?:vs\.?|versus|relative\s+to|with\s+respect\s+to)\s+"
        r"(OCP|OCV|open[-\s]*circuit(?:\s+potential)?|Ag\s*/\s*AgCl|SCE|SHE|Pt|[A-Za-z][A-Za-z0-9/+.\-]{1,18})",
        text,
        flags=re.IGNORECASE,
    )
    if ref_match:
        return _normalize_reference(ref_match.group(1)), explicit_ocp

    paren_match = re.search(
        r"\((OCP|OCV|open[-\s]*circuit(?:\s+potential)?|Ag\s*/\s*AgCl|SCE|SHE|Pt)\)",
        text,
        flags=re.IGNORECASE,
    )
    if paren_match:
        return _normalize_reference(paren_match.group(1)), explicit_ocp

    if explicit_ocp:
        return "OCP", True
    return "", False


def normalize_potential_text(value: Any) -> Optional[str]:
    """Normalize potential labels to '<value> V vs <reference>' where possible.

    OCP by itself is represented as 0 V vs OCP. A numeric value marked with
    OCP, such as '-0.16 V (OCP)', is represented as '-0.16 V vs OCP'.
    """
    if value is None:
        return None

    if isinstance(value, bool):
        return str(value)

    if isinstance(value, (int, float)):
        numeric = float(value)
        if not numeric == numeric:
            return None
        return _format_voltage(numeric)

    text = str(value).strip()
    if not text:
        return None

    text = (
        text.replace("−", "-")
        .replace("–", "-")
        .replace("—", "-")
        .replace("＋", "+")
    )
    text = re.sub(r"\s+", " ", text).strip()

    if re.fullmatch(
        r"(?:at\s+(?:the\s+)?)?(?:OCP|OCV|open[-\s]*circuit(?:\s+potential)?)",
        text,
        flags=re.IGNORECASE,
    ):
        return "0 V vs OCP"

    offset_match = re.search(
        r"([+-]?\d+(?:\.\d+)?)\s*mV\s*(below|above)\s+(?:the\s+)?"
        r"(?:OCP|OCV|open[-\s]*circuit(?:\s+potential)?)",
        text,
        flags=re.IGNORECASE,
    )
    if offset_match:
        magnitude = float(offset_match.group(1)) / 1000.0
        direction = offset_match.group(2).lower()
        signed = -abs(magnitude) if direction == "below" else abs(magnitude)
        return f"{_format_voltage(signed, explicit_plus=signed > 0)} vs OCP"

    reference, explicit_ocp = _extract_reference(text)
    voltage_match = re.search(
        r"([+-]?\d+(?:[\.:]\d+)?)\s*(mV|millivolts?|V|volts?)\b",
        text,
        flags=re.IGNORECASE,
    )
    if voltage_match:
        raw_number = voltage_match.group(1).replace(":", ".")
        unit = voltage_match.group(2).lower()
        numeric = float(raw_number)
        if unit.startswith("milli") or unit == "mv":
            numeric /= 1000.0
        potential = _format_voltage(numeric, explicit_plus=raw_number.startswith("+"))
        if reference:
            suffix = f" vs {reference}"
            if explicit_ocp and reference != "OCP":
                suffix += " (OCP)"
            return f"{potential}{suffix}"
        return potential

    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text):
        return _format_voltage(float(text), explicit_plus=text.startswith("+"))

    return text

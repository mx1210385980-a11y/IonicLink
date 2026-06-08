from __future__ import annotations

import re
from typing import Any


_VOLTAGE_UNIT_RE = re.compile(
    r"(?<![A-Za-z])[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|—)\s*[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?)?\s*V\b",
    re.IGNORECASE,
)
_MECHANICAL_LOAD_UNIT_RE = re.compile(
    r"(?<![A-Za-z])[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|—)\s*[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?)?\s*(?:mN|µN|μN|uN|nN|N|g|kgf|MPa|GPa)\b",
    re.IGNORECASE,
)
_AFM_SETPOINT_RE = re.compile(
    r"\b(?:afm\s+)?set\s*point\b|\bsetpoint\b|\bsetpoint\s+units?\b|\bload\s+control\b|\bforce\s+setpoint\b",
    re.IGNORECASE,
)


def looks_like_non_mechanical_load(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if not _VOLTAGE_UNIT_RE.search(text):
        return False
    if _MECHANICAL_LOAD_UNIT_RE.search(text):
        return False
    return True


def looks_like_afm_setpoint_voltage_load(value: Any) -> bool:
    text = str(value or "").strip()
    if not looks_like_non_mechanical_load(text):
        return False
    return bool(_AFM_SETPOINT_RE.search(text) or re.search(r"\bAFM\b", text, flags=re.IGNORECASE))


def sanitized_mechanical_load(value: Any) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "").replace("µ", "μ")).strip()
    if not text:
        return None
    if looks_like_non_mechanical_load(text):
        return None
    return text

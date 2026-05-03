from __future__ import annotations

import math
import re
from typing import Any


def clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def compose_tribopair_label(
    probe_material: Any,
    substrate_material: Any,
    substrate_coating: Any = None,
) -> str | None:
    probe = clean_text(probe_material)
    substrate = clean_text(substrate_material)
    coating = clean_text(substrate_coating)

    if not probe and not substrate:
        return None
    if probe and substrate:
        label = f"{probe} vs. {substrate}"
    else:
        label = probe or substrate

    if coating and coating.lower() not in {"none", "n/a", "na"}:
        label = f"{label} ({coating})"
    return label


def derive_legacy_material_name(
    *,
    probe_material: Any = None,
    substrate_material: Any = None,
    legacy_material_name: Any = None,
) -> str:
    substrate = clean_text(substrate_material)
    legacy = clean_text(legacy_material_name)
    probe = clean_text(probe_material)

    return substrate or legacy or probe or "Unknown Material"


def derive_legacy_surface_roughness(
    *,
    probe_roughness: Any = None,
    substrate_roughness: Any = None,
    legacy_surface_roughness: Any = None,
) -> str | None:
    legacy = clean_text(legacy_surface_roughness)
    return legacy


def parse_roughness_nm(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = (
        text.lower()
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("−", "-")
        .replace("–", "-")
        .replace("—", "-")
    )
    if "atomically flat" in normalized or "freshly cleaved" in normalized:
        return 0.1

    match = re.search(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", normalized)
    if not match:
        return None
    try:
        numeric = float(match.group(0))
    except Exception:
        return None

    if re.search(r"\bpm\b", normalized):
        return numeric * 0.001
    if re.search(r"\bum\b", normalized):
        return numeric * 1000.0
    if re.search(r"\bmm\b", normalized):
        return numeric * 1_000_000.0
    return numeric


def composite_roughness_nm(
    probe_roughness: Any,
    substrate_roughness: Any,
    *,
    method: str = "rms",
    legacy_surface_roughness: Any = None,
) -> float | None:
    probe = parse_roughness_nm(probe_roughness)
    substrate = parse_roughness_nm(substrate_roughness)
    normalized_method = str(method or "rms").strip().lower()

    if probe is not None and substrate is not None:
        if normalized_method in {"mean", "avg", "average", "arithmetic_mean"}:
            return (probe + substrate) / 2.0
        return math.sqrt(probe * probe + substrate * substrate)

    legacy = parse_roughness_nm(legacy_surface_roughness)
    if legacy is not None:
        return legacy
    return substrate if substrate is not None else probe


def format_roughness_nm(value: float | None, *, prefix: str = "RMS") -> str | None:
    if value is None:
        return None
    abs_value = abs(float(value))
    if abs_value >= 10:
        rendered = f"{value:.1f}"
    elif abs_value >= 1:
        rendered = f"{value:.2f}"
    else:
        rendered = f"{value:.2f}"
    rendered = rendered.rstrip("0").rstrip(".")
    if "." not in rendered and abs_value >= 10:
        rendered = f"{rendered}.0"
    label = clean_text(prefix) or "RMS"
    return f"{label} {rendered} nm"


def composite_roughness_label(
    probe_roughness: Any,
    substrate_roughness: Any,
    *,
    method: str = "rms",
    legacy_surface_roughness: Any = None,
) -> str | None:
    return format_roughness_nm(
        composite_roughness_nm(
            probe_roughness,
            substrate_roughness,
            method=method,
            legacy_surface_roughness=legacy_surface_roughness,
        )
    )

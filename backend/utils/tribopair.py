from __future__ import annotations

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
    substrate = clean_text(substrate_roughness)
    legacy = clean_text(legacy_surface_roughness)
    probe = clean_text(probe_roughness)
    return substrate or legacy or probe

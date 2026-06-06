from __future__ import annotations

import json
import re
from typing import Any


CANONICAL_SCALES = {"macroscale", "microscale", "nanoscale", "unknown"}
CANONICAL_METHODS = {
    "ball_on_disk",
    "ball_on_3_pins",
    "ball_on_flat",
    "ball_on_plate",
    "pin_on_disk",
    "four_ball",
    "afm_colloidal_probe",
    "afm_sharp_tip",
    "sfa",
    "unknown",
}
CANONICAL_INSTRUMENTS = {"tribometer", "afm", "sfa", "unknown"}
CANONICAL_MEASUREMENTS = {
    "cof",
    "wear_rate",
    "lateral_force",
    "friction_force",
    "adhesion_force",
    "roughness",
    "film_thickness",
    "other",
    "unknown",
}
TRAINING_VIEWS = {"all", "macro_performance", "afm_surface_response", "cross_scale"}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _parse_object(value: Any) -> dict[str, Any]:
    if value in (None, "", {}):
        return {}
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
        except Exception:
            return {"raw_text": value}
        return loaded if isinstance(loaded, dict) else {}
    return value if isinstance(value, dict) else {}


def _first_text(*values: Any) -> str:
    parts = [_clean_text(value) for value in values if _clean_text(value)]
    return " | ".join(parts)


def canonical_scale(value: Any) -> str | None:
    text = _clean_text(value).lower().replace("_", "").replace("-", "")
    if not text:
        return None
    if text in {"macro", "macroscale", "macroscopic", "macroscopicscale"}:
        return "macroscale"
    if text in {"micro", "microscale", "microscopic", "microscopicscale"}:
        return "microscale"
    if text in {"nano", "nanoscale", "nanoscopic", "nanotribology", "nanotribological"}:
        return "nanoscale"
    if text in CANONICAL_SCALES:
        return text
    return None


def canonical_method(value: Any) -> str | None:
    text = _clean_text(value).lower().replace(" ", "_").replace("-", "_")
    text = re.sub(r"_+", "_", text)
    if not text:
        return None
    aliases = {
        "ball_on_disc": "ball_on_disk",
        "ball_on_disk": "ball_on_disk",
        "ballondisk": "ball_on_disk",
        "bod": "ball_on_disk",
        "ball_on_3_pins": "ball_on_3_pins",
        "ball_on_three_pins": "ball_on_3_pins",
        "ball_on_flat": "ball_on_flat",
        "ballonflat": "ball_on_flat",
        "ball_on_plate": "ball_on_plate",
        "ballonplate": "ball_on_plate",
        "pin_on_disc": "pin_on_disk",
        "pin_on_disk": "pin_on_disk",
        "four_ball": "four_ball",
        "4_ball": "four_ball",
        "afm": "afm_colloidal_probe",
        "ffm": "afm_colloidal_probe",
        "afm_colloid_probe": "afm_colloidal_probe",
        "afm_colloidal_probe": "afm_colloidal_probe",
        "colloid_probe_afm": "afm_colloidal_probe",
        "colloidal_probe_afm": "afm_colloidal_probe",
        "afm_sharp_tip": "afm_sharp_tip",
        "sharp_tip_afm": "afm_sharp_tip",
        "sfa": "sfa",
        "surface_force_apparatus": "sfa",
    }
    if text in aliases:
        return aliases[text]
    if text in CANONICAL_METHODS:
        return text
    return None


def canonical_measurement(value: Any) -> str | None:
    text = _clean_text(value).lower().replace(" ", "_").replace("-", "_")
    text = re.sub(r"_+", "_", text)
    if not text:
        return None
    aliases = {
        "mu": "cof",
        "µ": "cof",
        "coefficient_of_friction": "cof",
        "friction_coefficient": "cof",
        "wear": "wear_rate",
        "wear_volume": "wear_rate",
        "lateral_force": "lateral_force",
        "friction_force": "friction_force",
        "pull_off_force": "adhesion_force",
        "adhesion": "adhesion_force",
        "adhesion_force": "adhesion_force",
        "surface_roughness": "roughness",
        "roughness": "roughness",
        "film_thickness": "film_thickness",
    }
    if text in aliases:
        return aliases[text]
    if text in CANONICAL_MEASUREMENTS:
        return text
    return None


def _known(value: str | None) -> str | None:
    return value if value and value != "unknown" else None


def _method_from_text(text: str) -> str | None:
    lower = text.lower()
    patterns = [
        (r"\bball[-\s]*on[-\s]*(?:3|three)[-\s]*pins?\b", "ball_on_3_pins"),
        (r"\bball[-\s]*on[-\s]*(?:disc|disk)\b", "ball_on_disk"),
        (r"\bball[-\s]*on[-\s]*flat\b", "ball_on_flat"),
        (r"\bball[-\s]*on[-\s]*(?:plate|plane)\b", "ball_on_plate"),
        (r"\bpin[-\s]*on[-\s]*(?:disc|disk)\b", "pin_on_disk"),
        (r"\b(?:four|4)[-\s]*ball\b", "four_ball"),
        (r"\bsurface\s+force\s+apparatus\b|\bsfa\b", "sfa"),
        (r"\bsharp[-\s]*tip\s+afm\b|\bafm\s+sharp[-\s]*tip\b", "afm_sharp_tip"),
        (r"\bafm\b|\bffm\b|\bcolloid(?:al)?\s+probe\b|\batomic\s+force\s+microscop", "afm_colloidal_probe"),
    ]
    for pattern, method in patterns:
        if re.search(pattern, lower):
            return method
    return None


def _scale_from_text(text: str, method: str | None = None) -> str | None:
    lower = text.lower()
    if method and method.startswith("afm"):
        return "nanoscale"
    if method in {"ball_on_disk", "ball_on_3_pins", "ball_on_flat", "ball_on_plate", "pin_on_disk", "four_ball"}:
        return "macroscale"
    if re.search(r"\b(?:nano|nanotribology|nanoscale|afm|ffm|atomic\s+force)\b", lower):
        return "nanoscale"
    if re.search(r"\b(?:micro|microscale)\b", lower):
        return "microscale"
    if re.search(r"\b(?:macro|macroscopic|macroscale|tribometer|ball[-\s]*on|pin[-\s]*on|four[-\s]*ball)\b", lower):
        return "macroscale"
    if re.search(r"\b\d+(?:\.\d+)?\s*nN\b", text, flags=re.IGNORECASE):
        return "nanoscale"
    if re.search(r"\b\d+(?:\.\d+)?\s*N\b", text, flags=re.IGNORECASE):
        return "macroscale"
    return None


def _instrument_from_method(method: str | None) -> str | None:
    if method and method.startswith("afm"):
        return "afm"
    if method == "sfa":
        return "sfa"
    if method in {"ball_on_disk", "ball_on_3_pins", "ball_on_flat", "ball_on_plate", "pin_on_disk", "four_ball"}:
        return "tribometer"
    return None


def _measurement_from_item(item: dict[str, Any], text: str) -> str | None:
    explicit = (
        canonical_measurement(item.get("measurement_type"))
        or canonical_measurement(item.get("measurementType"))
        or canonical_measurement(item.get("target_type"))
        or canonical_measurement(item.get("targetType"))
    )
    if explicit:
        return explicit
    if item.get("wear_rate") or item.get("wearRate"):
        return "wear_rate"
    if item.get("cof") or item.get("cof_value") is not None or item.get("cofValue") is not None:
        return "cof"
    if item.get("friction_force") or item.get("frictionForce"):
        return "friction_force"
    lower = text.lower()
    if "lateral force" in lower:
        return "lateral_force"
    if "pull-off" in lower or "pull off" in lower or "adhesion" in lower:
        return "adhesion_force"
    if "wear rate" in lower or "wear volume" in lower:
        return "wear_rate"
    if "cof" in lower or "coefficient of friction" in lower or "friction coefficient" in lower:
        return "cof"
    if "roughness" in lower:
        return "roughness"
    if "film thickness" in lower:
        return "film_thickness"
    return None


def normalize_training_view(value: Any) -> str:
    text = _clean_text(value).lower()
    return text if text in TRAINING_VIEWS else "all"


def profile_for_method_scale(method: str | None, scale: str | None) -> str:
    if method and method.startswith("afm"):
        return "afm"
    if scale == "nanoscale":
        return "afm" if method in {None, "unknown", "afm_colloidal_probe", "afm_sharp_tip"} else "nano"
    if scale == "macroscale" or method in {"ball_on_disk", "ball_on_3_pins", "ball_on_flat", "ball_on_plate", "pin_on_disk", "four_ball"}:
        return "macro"
    if scale == "microscale":
        return "micro"
    return "unknown"


def primary_training_view(profile: str, measurement_type: str) -> str:
    if profile == "macro" and measurement_type in {"cof", "wear_rate", "friction_force", "unknown", "other"}:
        return "macro_performance"
    if profile in {"afm", "nano"} or measurement_type in {"lateral_force", "adhesion_force", "roughness", "film_thickness"}:
        return "afm_surface_response"
    return "all"


def build_experiment_profile(item: dict[str, Any] | None = None, **context: Any) -> dict[str, Any]:
    item = dict(item or {})
    system = _parse_object(
        item.get("tribological_system")
        or item.get("tribologicalSystem")
        or context.get("tribological_system")
        or context.get("tribologicalSystem")
    )
    raw_text = _first_text(
        item.get("raw_text"),
        item.get("rawText"),
        item.get("experiment_profile"),
        item.get("experimentProfile"),
        system.get("raw_text"),
        system.get("rawText"),
        item.get("contact_type"),
        item.get("contactType"),
        item.get("material_name"),
        item.get("materialName"),
        item.get("substrate_material"),
        item.get("substrateMaterial"),
        item.get("probe_material"),
        item.get("probeMaterial"),
        item.get("probe_geometry"),
        item.get("probeGeometry"),
        item.get("regime"),
        context.get("regime"),
        item.get("source"),
        item.get("source_figure"),
        item.get("sourceFigure"),
        item.get("evidence"),
    )

    method = (
        _known(canonical_method(item.get("experiment_method")))
        or _known(canonical_method(item.get("experimentMethod")))
        or _known(canonical_method(item.get("method")))
        or _known(canonical_method(system.get("method")))
        or _known(canonical_method(system.get("contact_geometry")))
        or _known(canonical_method(system.get("contactGeometry")))
        or _method_from_text(raw_text)
    )
    scale = (
        _known(canonical_scale(item.get("experiment_scale")))
        or _known(canonical_scale(item.get("experimentScale")))
        or _known(canonical_scale(item.get("scale")))
        or _known(canonical_scale(system.get("scale")))
        or _scale_from_text(raw_text, method)
    )
    instrument = _known(_clean_text(item.get("instrument") or system.get("instrument")).lower() or None)
    if instrument not in CANONICAL_INSTRUMENTS:
        instrument = _instrument_from_method(method)
    measurement_type = _measurement_from_item({**system, **item}, raw_text) or "unknown"
    contact_geometry = (
        _known(canonical_method(system.get("contact_geometry") or system.get("contactGeometry")))
        or method
        or _clean_text(system.get("contact_geometry") or system.get("contactGeometry"))
        or None
    )
    if contact_geometry == "afm_sharp_tip":
        contact_geometry = "afm_sharp_tip"

    method = method or "unknown"
    scale = scale or "unknown"
    instrument = instrument or "unknown"
    profile = _clean_text(item.get("profile") or system.get("profile")).lower()
    if profile not in {"macro", "afm", "nano", "micro"}:
        profile = profile_for_method_scale(method, scale)
    training_view = normalize_training_view(item.get("training_view") or item.get("trainingView") or system.get("training_view") or system.get("trainingView"))
    if training_view == "all":
        training_view = primary_training_view(profile, measurement_type)
    training_views = ["cross_scale"]
    if training_view != "all":
        training_views.insert(0, training_view)

    return {
        "scale": scale,
        "method": method,
        "instrument": instrument,
        "contact_geometry": contact_geometry,
        "measurement_type": measurement_type,
        "profile": profile,
        "training_view": training_view,
        "training_views": training_views,
    }


def record_matches_training_view(record: dict[str, Any], training_view: Any) -> bool:
    view = normalize_training_view(training_view)
    if view == "all":
        return True
    profile = build_experiment_profile(record)
    if view == "cross_scale":
        return profile["profile"] in {"macro", "afm", "nano"} or profile["training_view"] in {
            "macro_performance",
            "afm_surface_response",
        }
    return profile["training_view"] == view

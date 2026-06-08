from services.flexible_field_integration import (
    extract_raw_flexible_fields,
    merge_into_field_evidence_json,
    normalize_flexible_fields,
)
from services.flexible_field_key_normalizer import KeyNormalizer


def test_normalize_flexible_fields_keeps_collisions_as_list():
    payload, review_queue = normalize_flexible_fields(
        {
            "Current": {"label": "Current", "value": "0.5", "unit": "A", "category": "condition"},
            "applied_current": {"label": "Applied current", "value": "1.0", "unit": "A", "category": "condition"},
        },
        KeyNormalizer(),
    )

    assert "current" in payload
    assert isinstance(payload["current"], list)
    assert [entry["value"] for entry in payload["current"]] == ["0.5", "1.0"]
    assert review_queue == []


def test_merge_into_field_evidence_preserves_existing_keys():
    merged = merge_into_field_evidence_json(
        {"cof": {"value": "0.04"}},
        {"current": {"value": "0.5", "unit": "A"}},
    )

    assert merged["cof"]["value"] == "0.04"
    assert merged["_flexible_fields"]["current"]["value"] == "0.5"


def test_extract_raw_flexible_fields_picks_known_extra_variables_only():
    raw = extract_raw_flexible_fields(
        {
            "material_name": "Steel",
            "ionic_liquid": "[EMIM][BF4]",
            "cof": "0.04",
            "Current": "0.5 A",
            "Fe2O3 loading": "1 wt%",
            "notes": "from table",
            "source_page": 4,
        }
    )

    assert raw["Current"]["value"] == "0.5 A"
    assert raw["Current"]["category"] == "condition"
    assert raw["Fe2O3 loading"]["category"] == "lubricant_component"
    assert "material_name" not in raw


def test_extract_raw_flexible_fields_preserves_structured_flexible_pool():
    raw = extract_raw_flexible_fields(
        {
            "material_name": "Steel",
            "_flexible_fields": {
                "interfacial_shear_strength": {
                    "label": "Interfacial shear strength",
                    "value": "12",
                    "unit": "MPa",
                    "category": "metric",
                }
            },
        }
    )

    assert raw["interfacial_shear_strength"]["value"] == "12"
    assert raw["interfacial_shear_strength"]["category"] == "metric"


def test_cof_delta_alias_normalizes_to_flexible_metric():
    raw = extract_raw_flexible_fields(
        {
            "material_name": "304 stainless steel",
            "ionic_liquid": "[EMIM][BF4]",
            "cof": None,
            "cof_delta": "0.0837",
            "baseline_current": "0 A",
            "current": "20 A",
            "Fe3O4 loading": "15 wt%",
            "source": "Fig. 9",
            "source_page": 7,
            "evidence": "The increase range of friction coefficient was 0.0837 at 20 A.",
        }
    )
    payload, review_queue = normalize_flexible_fields(raw, KeyNormalizer())

    assert review_queue == []
    assert payload["cof_delta"]["value"] == "0.0837"
    assert payload["cof_delta"]["category"] == "derived_metric"
    assert payload["current"]["value"] == "20 A"
    assert payload["baseline_current"]["value"] == "0 A"
    assert payload["iron_oxide_additive_ratio"]["value"] == "15 wt%"

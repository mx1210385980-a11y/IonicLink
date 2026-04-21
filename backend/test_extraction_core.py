import json
from types import SimpleNamespace

from models.tribology import TribologyData
from routers.extraction import _build_record_field_evidence_payload
from services.file_service import _get_drop_reason_for_final_record
from services.file_service import _build_record_uniqueness_key
from services.llm.deduplication import deduplicate_records
from services.llm.utils import has_core_quantitative_signal


def test_has_core_quantitative_signal_accepts_afm_layering_record():
    record = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.6 nm",
        "temperature": "298.15 K",
        "source": "Fig. 1c",
        "evidence": "The step period of 0.6 nm was consistent with the size of the ion pair.",
    }

    assert has_core_quantitative_signal(record) is True


def test_has_core_quantitative_signal_rejects_purely_qualitative_record():
    record = {
        "material_name": "Mica",
        "ionic_liquid": "[BMIM][PF6]",
        "notes": "friction decreases with thickness",
        "evidence": "A qualitative trend only.",
    }

    assert has_core_quantitative_signal(record) is False


def test_deduplication_preserves_non_cof_afm_record():
    records = [
        TribologyData(
            material_name="Mica",
            ionic_liquid="[C3mpyr][FSI]",
            layer_spacing_delta="0.6 nm",
            residual_film_thickness_d="3 nm",
            source="Fig. 1c",
            evidence="Five oscillations were measured and the step period was 0.6 nm.",
        )
    ]

    deduped = deduplicate_records(records)

    assert len(deduped) == 1
    assert deduped[0].layer_spacing_delta == "0.6 nm"


def test_deduplication_does_not_merge_distinct_afm_measurements():
    records = [
        TribologyData(
            material_name="Mica",
            ionic_liquid="[HMIM][NTf2]",
            surface_roughness="RMS 2 nm",
            source="Fig. 10a",
            evidence="Representative force curves with a smooth colloid probe (RMS = 2 nm).",
        ),
        TribologyData(
            material_name="Mica",
            ionic_liquid="[HMIM][NTf2]",
            surface_roughness="RMS 9 nm",
            source="Fig. 10a",
            evidence="Representative force curves with a rough colloid probe (RMS = 9 nm).",
        ),
    ]

    deduped = deduplicate_records(records)

    assert len(deduped) == 2


def test_record_uniqueness_key_includes_afm_measurements():
    left = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.6 nm",
        "source": "Fig. 1c",
    }
    right = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.7 nm",
        "source": "Fig. 1c",
    }

    assert _build_record_uniqueness_key(left) != _build_record_uniqueness_key(right)


def test_final_record_filter_keeps_non_cof_quantitative_afm_record():
    record = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.6 nm",
        "source": "Fig. 1c",
        "evidence": "Five oscillations were measured and the step period was 0.6 nm.",
    }

    assert _get_drop_reason_for_final_record(record) is None


def test_review_payload_requires_primary_metric_for_non_cof_record():
    record = SimpleNamespace(
        id=1,
        literature_id=2,
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="llm_extraction",
        assembly_notes=None,
        confidence=0.9,
        material_name="Mica",
        lubricant="[C3mpyr][FSI]",
        cof_raw=None,
        cof_value=None,
        load_raw=None,
        load_value=None,
        speed_value=None,
        temperature="298.15 K",
        source_page=3,
        field_evidence_json=json.dumps(
            {
                "material": {"value": "Mica", "evidence": {"page": 3, "quote": "Mica"}},
                "ionic_liquid": {"value": "[C3mpyr][FSI]", "evidence": {"page": 3, "quote": "[C3mpyr][FSI]"}},
                "layer_spacing_delta": {"value": "0.6 nm", "evidence": {"page": 3, "quote": "0.6 nm"}},
                "temperature": {"value": "298.15 K", "evidence": {"page": 3, "quote": "room temperature"}},
                "source_page": {"value": "Page 3", "evidence": {"page": 3, "quote": "Page 3"}},
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta="0.6 nm",
        surface_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    assert payload["required_fields"] == ["material", "ionic_liquid", "layer_spacing_delta"]

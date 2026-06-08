import json
import inspect
import io
from types import SimpleNamespace

import fitz
import pytest
from PIL import Image, ImageDraw
from models.db_models import Literature, RecordCandidate, ResearchGroup, TribologyData as TribologyDataDB, User
from models.tribology import TribologyData
from routers import extraction as extraction_router
from routers.extraction import _build_record_field_evidence_payload, _strict_core_field_missing
from security import AuthPrincipal
from services.file_service import _build_field_evidence_map
from services.file_service import _derive_grounding_metadata
from services.file_service import _field_evidence_map_looks_generic
from services.file_service import _field_query_variants
from services.file_service import _get_drop_reason_for_final_record
from services.file_service import _locate_field_evidence_for_value
from services.file_service import _merge_field_review_metadata
from services.file_service import _refine_potential_evidence_from_metric_context_with_pdf
from services.file_service import _refine_potential_evidence_from_metric_context
from services.file_service import _build_record_uniqueness_key
from services.pdf_service import build_term_query_variants
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


@pytest.mark.anyio
async def test_extracted_data_uses_final_records_when_candidates_are_promoted(db_session):
    group = ResearchGroup(name="Promoted Detail Group", slug="promoted-detail-group")
    user = User(
        username="promoted-detail-user",
        display_name="Promoted Detail User",
        password_hash="hash",
        role="researcher",
        group=group,
    )
    db_session.add_all([group, user])
    await db_session.flush()
    literature = Literature(
        doi="10.0000/promoted-detail",
        title="Promoted detail paper",
        authors="A",
        journal="J",
        year=2026,
        group_id=group.id,
        created_by_user_id=user.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    db_session.add(literature)
    await db_session.flush()
    final_record = TribologyDataDB(
        literature_id=literature.id,
        material_name="Official record",
        lubricant="[BMIM][BF4]",
        cation="BMIM",
        anion="BF4",
        substrate_material="HOPG",
        temperature="298 K",
        load_raw="30 nN",
        load_value="30 nN",
        cof_raw="0.08",
        cof_value=0.08,
        evidence="The official database row reports COF 0.08.",
        source_page=1,
        review_status="approved",
        confidence=0.9,
    )
    db_session.add(final_record)
    await db_session.flush()
    db_session.add(
        RecordCandidate(
            literature_id=literature.id,
            promoted_record_id=final_record.id,
            material_name="Promoted duplicate candidate",
            lubricant="[BMIM][BF4]",
            cation="BMIM",
            anion="BF4",
            substrate_material="HOPG",
            temperature="298 K",
            load_raw="30 nN",
            load_value="30 nN",
            cof_raw="0.08",
            cof_value=0.08,
            field_evidence_json="{}",
            review_status="approved",
            record_origin="reading_report_draft",
            confidence=0.9,
        )
    )
    await db_session.flush()
    principal = AuthPrincipal(user=user, group=group, personal_workspace=None)

    records = await extraction_router.get_extracted_data(str(literature.id), db_session, principal)

    assert len(records) == 1
    assert records[0]["material_name"] == "Official record"


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


def test_strict_core_field_gate_requires_target_schema_values():
    record = SimpleNamespace(
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature=None,
        load_raw="2 nN",
        load_value=None,
        cof_raw="0.08",
        cof_value=0.08,
    )

    assert _strict_core_field_missing(record) == ["temperature"]

    record.temperature = "298 K"
    assert _strict_core_field_missing(record) == []


def test_strict_core_field_gate_accepts_structured_load_and_cof_values():
    record = SimpleNamespace(
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature="298 K",
        load_raw=None,
        load_value=None,
        load_conditions_json=json.dumps({
            "raw_text": "2 nN",
            "value_type": "single",
            "load_min_N": 2e-9,
            "load_max_N": 2e-9,
        }),
        cof_raw=None,
        cof_value=None,
        cof_extracted_json=json.dumps({
            "raw_text": "0.08",
            "value_type": "single",
            "cof_min": 0.08,
            "cof_max": 0.08,
            "cof_average": 0.08,
        }),
    )

    assert _strict_core_field_missing(record) == []


def test_strict_core_field_gate_accepts_zero_structured_values():
    record = SimpleNamespace(
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature="298 K",
        load_raw=None,
        load_value=None,
        load_conditions_json=json.dumps({
            "raw_text": "",
            "value_type": "single",
            "load_min_N": 0,
            "load_max_N": 0,
        }),
        cof_raw=None,
        cof_value=None,
        cof_extracted_json=json.dumps({
            "raw_text": "",
            "value_type": "single",
            "cof_min": 0,
            "cof_max": 0,
            "cof_average": 0,
        }),
    )

    assert _strict_core_field_missing(record) == []


def test_record_approval_uses_strict_core_field_gate():
    source = inspect.getsource(extraction_router.approve_record_review)

    assert "_strict_core_field_missing(record)" in source
    assert "Missing core field values" in source


def test_candidate_approval_does_not_block_on_legacy_required_evidence_gate():
    source = inspect.getsource(extraction_router.approve_candidate_review)

    assert "_strict_core_field_missing(candidate)" in source
    assert "Missing core field values" in source
    assert "_required_field_missing(field_map)" not in source
    assert "Missing field evidence" not in source


def test_review_payload_includes_potential_field_and_conditions_summary():
    record = SimpleNamespace(
        id=9,
        literature_id=10,
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="llm_extraction",
        assembly_notes=None,
        confidence=0.88,
        material_name="Au(111)",
        lubricant="[Py1,4][FAP]",
        cof_raw="0.45",
        cof_value=0.45,
        load_raw="15-75 nN",
        load_value="15-75 nN",
        speed_value=None,
        temperature="298.15 K",
        potential="+1 V",
        water_content="Dry",
        source_page=4,
        field_evidence_json=json.dumps(
            {
                "material": {"value": "Au(111)", "evidence": {"page": 4, "quote": "Au(111)"}},
                "ionic_liquid": {"value": "[Py1,4][FAP]", "evidence": {"page": 4, "quote": "[Py1,4][FAP]"}},
                "cof": {"value": "0.45", "evidence": {"page": 4, "quote": "0.45"}},
                "potential": {"value": "+1 V", "evidence": {"page": 4, "quote": "+1 V"}},
                "water_content": {"value": "Dry", "evidence": {"page": 4, "quote": "dry conditions"}},
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        surface_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    assert payload["fields"]["potential"]["value"] == "+1 V"
    assert payload["fields"]["potential"]["status"] == "grounded"
    assert payload["fields"]["water_content"]["value"] == "Dry"
    assert payload["fields"]["conditions"]["value"] == "15-75 nN | 298.15 K | +1 V | Dry"


def test_review_payload_preserves_candidate_evidence_alias_keys():
    record = SimpleNamespace(
        id=12,
        literature_id=10,
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="candidate",
        assembly_notes=None,
        confidence=0.72,
        material_name="mica",
        lubricant="[BMIM][BF4]",
        cof_raw="COF was 0.08",
        cof_value=0.08,
        load_raw="2 nN",
        load_value="2 nN",
        speed_value="10 um/s",
        temperature=None,
        potential=None,
        water_content=None,
        source_page=5,
        field_evidence_json=json.dumps(
            {
                "lubricant": {"value": "[BMIM][BF4]", "evidence": {"page": 5, "quote": "[BMIM][BF4]"}},
                "cof_raw": {"value": "0.08", "evidence": {"page": 5, "quote": "COF was 0.08"}},
                "load_raw": {"value": "2 nN", "evidence": {"page": 5, "quote": "2 nN"}},
                "probe_material": {"value": "Si3N4 tip", "evidence": {"page": 5, "quote": "Si3N4 tip"}},
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        surface_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    assert payload["fields"]["lubricant"]["value"] == "[BMIM][BF4]"
    assert payload["fields"]["cof_raw"]["evidence"]["quote"] == "COF was 0.08"
    assert payload["fields"]["load"]["evidence"]["quote"] == "2 nN"


def test_review_payload_adds_long_field_evidence_context(monkeypatch):
    monkeypatch.setattr(
        extraction_router,
        "_extract_text_snippet",
        lambda *args, **kwargs: (
            "The AFM friction trace in Fig. 2 reports that the coefficient of friction "
            "decreased to 0.08 for [BMIM][BF4] on mica under the stated load."
        ),
    )
    record = SimpleNamespace(
        id=13,
        literature_id=10,
        literature=SimpleNamespace(file_path="/tmp/review-source.pdf"),
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="candidate",
        assembly_notes=None,
        confidence=0.72,
        material_name="mica",
        lubricant="[BMIM][BF4]",
        cof_raw="0.08",
        cof_value=0.08,
        load_raw=None,
        load_value=None,
        speed_value=None,
        temperature=None,
        potential=None,
        water_content=None,
        source_page=5,
        field_evidence_json=json.dumps(
            {
                "cof": {
                    "value": "0.08",
                    "evidence": {
                        "source_type": "figure",
                        "source_label": "Fig. 2",
                        "page": 5,
                        "bbox": [20, 30, 220, 180],
                        "quote": "Graph label reports COF 0.08",
                        "matched_text": "0.08",
                    },
                },
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        surface_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    assert payload["fields"]["cof"]["evidence"]["quote"] == "Graph label reports COF 0.08"
    assert "coefficient of friction decreased to 0.08" in payload["fields"]["cof"]["evidence"]["context"]


def test_review_payload_does_not_attach_unrelated_long_field_context(monkeypatch):
    monkeypatch.setattr(
        extraction_router,
        "_extract_text_snippet",
        lambda *args, **kwargs: (
            "The forward and reverse traces were transformed into a true friction force "
            "from the torsion of the cantilever. The friction coefficient is the "
            "conventional way of quantifying friction."
        ),
    )
    record = SimpleNamespace(
        id=14,
        literature_id=10,
        literature=SimpleNamespace(file_path="/tmp/review-source.pdf"),
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="candidate",
        assembly_notes=None,
        confidence=0.95,
        material_name="HOPG",
        lubricant="[BMIM][PF6]",
        cof_raw="0.08",
        cof_value=0.08,
        load_raw="~0-150 nN",
        load_value="~0-150 nN",
        speed_value="20 μm/s",
        temperature="298 K",
        potential=None,
        water_content="humidity ~55%",
        source_page=5,
        field_evidence_json=json.dumps(
            {
                "water_content": {
                    "value": "humidity ~55%",
                    "confidence": 0.95,
                    "evidence": {
                        "source_type": "text",
                        "page": 3,
                        "source_label": "Experimental conditions",
                        "quote": "Frictional experiments were performed with a humidity of ~55%.",
                        "bbox": [42.5, 73.7, 292.1, 322.1],
                        "matched_text": "humidity of ~55%",
                    },
                },
                "speed": {
                    "value": "20 μm/s",
                    "confidence": 0.98,
                    "evidence": {
                        "source_type": "calculation",
                        "page": 2,
                        "source_label": "Methods 2.3 derived from scan rate and scan size",
                        "quote": "The scan rate was 2 Hz; trace and retrace tracks of 5 μm x 5 μm under the tip.",
                        "bbox": [303.31, 362.66, 552.85, 479.17],
                        "matched_text": "scan rate was 2 Hz; trace and retrace tracks of 5 μm x 5 μm",
                        "calculation": "v = 2 x 5 μm x 2 Hz = 20 μm/s",
                    },
                    "grounding_mode": "derived",
                    "grounding_note": "Derived sliding speed from scan size and scan rate: v = 2 x 5 μm x 2 Hz = 20 μm/s.",
                },
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        surface_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    water_evidence = payload["fields"]["water_content"]["evidence"]
    speed_evidence = payload["fields"]["speed"]["evidence"]
    assert water_evidence["quote"] == "Frictional experiments were performed with a humidity of ~55%."
    assert "context" not in water_evidence
    assert speed_evidence["quote"] == "The scan rate was 2 Hz; trace and retrace tracks of 5 μm x 5 μm under the tip."
    assert "context" not in speed_evidence


def test_review_payload_exposes_grounding_mode_for_derived_temperature():
    record = SimpleNamespace(
        id=11,
        literature_id=10,
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="llm_extraction",
        assembly_notes=None,
        confidence=0.88,
        material_name="Au(111)",
        lubricant="[Py1,4][FAP]",
        cof_raw="0.45",
        cof_value=0.45,
        load_raw=None,
        load_value=None,
        speed_value=None,
        temperature="298.15 K",
        potential=None,
        water_content=None,
        source_page=4,
        field_evidence_json=json.dumps(
            {
                "material": {"value": "Au(111)", "evidence": {"page": 4, "quote": "Au(111)"}},
                "ionic_liquid": {"value": "[Py1,4][FAP]", "evidence": {"page": 4, "quote": "[Py1,4][FAP]"}},
                "cof": {"value": "0.45", "evidence": {"page": 4, "quote": "0.45"}},
                "temperature": {
                    "value": "298.15 K",
                    "grounding_mode": "derived",
                    "grounding_note": "Normalized from room-temperature wording.",
                    "evidence": {"page": 4, "quote": "room temperature"},
                },
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        surface_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    assert payload["fields"]["temperature"]["grounding_mode"] == "derived"
    assert payload["fields"]["temperature"]["grounding_note"] == "Normalized from room-temperature wording."


def test_review_payload_clears_bare_numeric_roughness_text_when_context_is_missing():
    record = SimpleNamespace(
        id=12,
        literature_id=10,
        literature=SimpleNamespace(file_path=None),
        sample_id=None,
        series_id=None,
        review_status="pending_review",
        record_origin="llm_extraction",
        assembly_notes=None,
        confidence=0.88,
        material_name="Au(111)",
        lubricant="[Py1,4][FAP]",
        cof_raw="0.45",
        cof_value=0.45,
        load_raw=None,
        load_value=None,
        speed_value=None,
        temperature="298.15 K",
        potential=None,
        water_content=None,
        source_page=4,
        field_evidence_json=json.dumps(
            {
                "probe_roughness": {
                    "value": "RMS 2 nm",
                    "evidence": {
                        "source_type": "text",
                        "page": 4,
                        "source_label": "Text",
                        "quote": "2",
                        "matched_text": "2",
                        "bbox": [10, 20, 14, 30],
                    },
                },
            }
        ),
        friction_force=None,
        wear_rate=None,
        film_thickness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        surface_roughness=None,
        probe_roughness="RMS 2 nm",
        substrate_roughness=None,
    )

    payload = _build_record_field_evidence_payload(record)

    roughness = payload["fields"]["probe_roughness"]
    assert roughness["evidence"]["quote"] is None
    assert roughness["evidence"]["matched_text"] is None
    assert roughness["evidence"]["bbox"] is None
    assert "roughness/unit context" in roughness["grounding_note"]


def test_build_field_evidence_map_prefers_field_specific_hits(monkeypatch):
    def fake_locate(**kwargs):
        field_key = kwargs["field_key"]
        if field_key == "material":
            return {
                "source_type": "text",
                "page": 3,
                "source_label": "Text",
                "quote": "Au(111) electrode surface",
                "bbox": [10.0, 10.0, 40.0, 20.0],
            }
        if field_key == "cof":
            return {
                "source_type": "figure",
                "page": 2,
                "source_label": "Fig. 2",
                "quote": "COF = 0.45",
                "bbox": [100.0, 120.0, 145.0, 130.0],
            }
        return None

    monkeypatch.setattr("services.file_service._locate_field_evidence_for_value", fake_locate)
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)

    db_record = SimpleNamespace(
        source="Fig. 2",
        source_figure="Fig. 2",
        evidence_page=2,
        source_page=2,
        evidence_bbox="[1, 2, 3, 4]",
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[Pyr14][FAP]",
        "cof": "0.45",
        "evidence": "Generic figure caption",
        "source": "Fig. 2",
        "source_page": 2,
    }

    field_map = _build_field_evidence_map(item, db_record, confidence=0.93, file_path="/tmp/fake.pdf")

    assert field_map["material"]["evidence"]["page"] == 3
    assert field_map["material"]["evidence"]["quote"] == "Au(111) electrode surface"
    assert field_map["cof"]["evidence"]["bbox"] == [100.0, 120.0, 145.0, 130.0]
    assert field_map["ionic_liquid"]["evidence"]["quote"] is None


def test_field_evidence_map_generic_detection_flags_cloned_entries():
    generic_map = {
        "material": {"value": "Au(111)", "evidence": {"page": 2, "source_label": "Fig. 2", "quote": "Generic caption", "bbox": [1, 2, 3, 4]}},
        "ionic_liquid": {"value": "[Pyr14][FAP]", "evidence": {"page": 2, "source_label": "Fig. 2", "quote": "Generic caption", "bbox": [1, 2, 3, 4]}},
        "cof": {"value": "0.45", "evidence": {"page": 2, "source_label": "Fig. 2", "quote": "Generic caption", "bbox": [1, 2, 3, 4]}},
    }

    assert _field_evidence_map_looks_generic(generic_map) is True


def test_merge_field_review_metadata_preserves_manual_annotations():
    rebuilt_map = {
        "material": {"value": "Au(111)", "evidence": {"page": 3, "quote": "Au(111) electrode surface"}},
        "cof": {"value": "0.45", "evidence": {"page": 2, "quote": "COF = 0.45"}},
    }
    existing_map = {
        "material": {"value": "Au(111)", "review_state": "confirmed"},
        "cof": {"value": "0.45", "review_state": "flagged", "review_note": "Need manual check"},
    }

    merged = _merge_field_review_metadata(rebuilt_map, existing_map)

    assert merged["material"]["review_state"] == "confirmed"
    assert merged["cof"]["review_state"] == "flagged"
    assert merged["cof"]["review_note"] == "Need manual check"


def test_locate_field_evidence_marks_text_hits_outside_figure_anchor(monkeypatch):
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)
    monkeypatch.setattr("services.pdf_service.build_term_query_variants", lambda value: [value])
    monkeypatch.setattr("utils.pdf_coords.normalize_source_label", lambda value: value)
    monkeypatch.setattr(
        "utils.pdf_coords.find_figure_bbox",
        lambda *args, **kwargs: (2, [449.24, 93.52, 593.3, 543.98]),
    )
    monkeypatch.setattr(
        "utils.pdf_coords.find_text_coordinates",
        lambda *args, **kwargs: [
            {"id": "material", "page": 2, "x": 394.98, "y": 233.46, "w": 35.4, "h": 10.46, "matched_text": "Au(111)"}
        ],
    )

    evidence = _locate_field_evidence_for_value(
        file_path="/tmp/fake.pdf",
        field_key="material",
        field_value="Au(111)",
        source_label="Fig. 2",
        page_hint=2,
        anchor_bbox=None,
        source_type="figure",
    )

    assert evidence is not None
    assert evidence["source_type"] == "text"
    assert evidence["source_label"] == "Text"


def test_locate_field_evidence_anchors_graphical_abstract_image(tmp_path, monkeypatch):
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)
    pdf_path = tmp_path / "acs_graphical_abstract.pdf"
    image = Image.new("RGB", (360, 230), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((12, 12, 348, 218), outline="black", width=3)
    draw.text((64, 160), "Normal Load, nN", fill="black")
    image_buffer = io.BytesIO()
    image.save(image_buffer, format="PNG")

    doc = fitz.open()
    page = doc.new_page(width=620, height=800)
    page.insert_text(
        (50, 280),
        "ABSTRACT: The normal load exceeds 30 nN in the transition regime.",
        fontsize=11,
    )
    image_rect = fitz.Rect(390, 250, 560, 365)
    page.insert_image(image_rect, stream=image_buffer.getvalue())
    doc.save(pdf_path)
    doc.close()

    evidence = _locate_field_evidence_for_value(
        file_path=str(pdf_path),
        field_key="load",
        field_value="30 nN",
        source_label="Graphical abstract",
        page_hint=1,
        anchor_bbox=None,
        source_type="image",
    )

    assert evidence is not None
    assert evidence["source_type"] == "image"
    assert evidence["source_label"] == "Graphical abstract"
    assert evidence["matched_text"] is None
    assert evidence["bbox"][0] >= 380
    assert evidence["bbox"][2] <= 570

    inferred = _locate_field_evidence_for_value(
        file_path=str(pdf_path),
        field_key="load",
        field_value="30 nN",
        source_label="Graphical abstract",
        page_hint=1,
        anchor_bbox=None,
        source_type=None,
    )
    assert inferred is not None
    assert inferred["source_type"] == "figure"
    assert inferred["bbox"][0] >= 380


def test_locate_load_evidence_prefers_graphical_abstract_when_source_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)
    pdf_path = tmp_path / "acs_missing_source_graphical_abstract.pdf"
    image = Image.new("RGB", (360, 230), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((12, 12, 348, 218), outline="black", width=3)
    draw.text((64, 160), "Normal Load, nN", fill="black")
    image_buffer = io.BytesIO()
    image.save(image_buffer, format="PNG")

    doc = fitz.open()
    page = doc.new_page(width=620, height=800)
    page.insert_text(
        (50, 280),
        "ABSTRACT: The friction drops once the normal load exceeds 30 nN.",
        fontsize=11,
    )
    page.insert_image(fitz.Rect(390, 250, 560, 365), stream=image_buffer.getvalue())
    doc.save(pdf_path)
    doc.close()

    evidence = _locate_field_evidence_for_value(
        file_path=str(pdf_path),
        field_key="load",
        field_value="30 nN",
        source_label=None,
        page_hint=1,
        anchor_bbox=None,
        source_type=None,
    )

    assert evidence is not None
    assert evidence["source_label"] == "Graphical abstract"
    assert evidence["matched_text"] is None
    assert evidence["bbox"][0] >= 380


def test_field_query_variants_expand_ocp_and_ionic_liquid_aliases():
    potential_queries = _field_query_variants("potential", "-0.16 V (OCP)")
    ionic_queries = _field_query_variants("ionic_liquid", "[Pyr14][FAP]")
    load_queries = _field_query_variants("load", "15-75 nN")

    assert "open circuit potential" in potential_queries
    assert "−0.16 V" in potential_queries
    assert "[Py1,4]FAP" in ionic_queries
    assert "normal load" in load_queries


def test_pdf_term_query_variants_expand_ionic_liquid_aliases_for_evidence_hits():
    variants = build_term_query_variants("[Pyr14][FAP]")

    assert "[Py1,4]FAP" in variants
    assert "[Py1;4]FAP" in variants


def test_derive_grounding_metadata_marks_temperature_normalization_as_derived():
    mode, note = _derive_grounding_metadata(
        "temperature",
        "298.15 K",
        {"quote": "Room-temperature ionic liquids were studied.", "matched_text": "Room-temperature"},
    )

    assert mode == "derived"
    assert note == "Normalized from room-temperature wording."


def test_refine_potential_evidence_prefers_metric_quote_with_exact_voltage():
    entries = {
        "cof": {
            "value": "0.20",
            "evidence": {
                "page": 2,
                "source_label": "Text",
                "quote": "Small lateral forces and low friction coefficients (0.20 for -1 V and 0.19 for -2 V).",
                "bbox": [10.0, 10.0, 40.0, 20.0],
                "matched_text": "0.20",
            },
        },
        "potential": {
            "value": "-1 V",
            "evidence": {
                "page": 2,
                "source_label": "Text",
                "quote": "friction increases strongly with potential in the range from -1.75 to -0.5 V.",
                "bbox": [50.0, 50.0, 120.0, 60.0],
                "matched_text": "-1.75 to -0.5 V",
            },
        },
    }

    refined = _refine_potential_evidence_from_metric_context(entries)

    assert refined["potential"]["evidence"]["quote"].startswith("Small lateral forces")
    assert refined["potential"]["evidence"]["bbox"] == [10.0, 10.0, 40.0, 20.0]


def test_refine_potential_evidence_uses_refined_voltage_bbox(monkeypatch):
    monkeypatch.setattr(
        "services.file_service._refine_potential_bbox_near_metric_evidence",
        lambda **kwargs: {
            "page": 2,
            "bbox": [50.0, 10.0, 70.0, 20.0],
            "matched_text": "-1 V",
            "quote": "0.20 for -1 V and 0.19 for -2 V",
        },
    )

    entries = {
        "cof": {
            "value": "0.20",
            "evidence": {
                "page": 2,
                "source_label": "Text",
                "quote": "Small lateral forces and low friction coefficients (0.20 for -1 V and 0.19 for -2 V).",
                "bbox": [10.0, 10.0, 40.0, 20.0],
                "matched_text": "0.20",
            },
        },
        "potential": {
            "value": "-1 V",
            "evidence": {
                "page": 2,
                "source_label": "Text",
                "quote": "friction increases strongly with potential in the range from -1.75 to -0.5 V.",
                "bbox": [50.0, 50.0, 120.0, 60.0],
                "matched_text": "-1.75 to -0.5 V",
            },
        },
    }

    refined = _refine_potential_evidence_from_metric_context_with_pdf(entries, "/tmp/fake.pdf")

    assert refined["potential"]["evidence"]["matched_text"] == "-1 V"
    assert refined["potential"]["evidence"]["bbox"] == [50.0, 10.0, 70.0, 20.0]

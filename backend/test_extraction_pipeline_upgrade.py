import json
from pathlib import Path
from types import SimpleNamespace

import fitz

from models.db_models import Literature, RecordCandidate, TribologyData as TribologyDataDB
from models.tribology import TribologyData
from routers.data_explorer import _record_to_response as _data_explorer_record_to_response
from routers.extraction import _build_term_query_variants, _tribology_record_api_payload
from services.query_service import _record_to_payload as _query_record_to_payload
from services.llm.deduplication import deduplicate_records_with_report
from services.file_service import _record_to_response_item
from services.llm.prompts import (
    ABBREV_MAPPING_PROMPT,
    FIGURE_TABLE_EXTRACTION_PROMPT,
    TEXT_EXTRACTION_PROMPT,
    TRIBOLOGY_EXTRACTION_PROMPT,
)
from services.data_sync_service import _normalize_quantitative_thickness
from services.llm_service import LLMService
from services.unit_converter import parse_speed_to_mps
from utils.pdf_coords import build_search_queries_for_record
from utils.speed_conditions import derive_speed_conditions, speed_value_from_conditions


def test_dedup_does_not_merge_conflicting_speed_conditions():
    records = [
        TribologyData(
            material_name="Mica",
            ionic_liquid="[EMIM][TFSI]",
            cof="0.02",
            speed="1 um/s",
            source="Fig. 3",
            source_page=5,
            source_figure="Fig. 3a",
        ),
        TribologyData(
            material_name="Mica",
            ionic_liquid="[EMIM][TFSI]",
            cof="0.02",
            speed="10 um/s",
            source="Fig. 3",
            source_page=5,
            source_figure="Fig. 3a",
        ),
    ]

    merged, report = deduplicate_records_with_report(records)

    assert len(merged) == 2
    assert report.merged_count == 0


def test_dedup_merges_missing_field_into_complete_record():
    records = [
        TribologyData(
            material_name="Mica",
            ionic_liquid="[EMIM][TFSI]",
            cof="0.02",
            source="Text",
            source_page=6,
        ),
        TribologyData(
            material_name="Mica",
            ionic_liquid="[EMIM][TFSI]",
            cof="0.02",
            speed="1 um/s",
            source="Text",
            source_page=6,
        ),
    ]

    merged, report = deduplicate_records_with_report(records)

    assert len(merged) == 1
    assert report.merged_count == 1
    assert merged[0].speed == "1 um/s"


def test_dedup_merges_same_record_across_repeated_source_pages():
    records = [
        TribologyData(
            material_name="Graphite",
            ionic_liquid="[N8,8,8,12][A4BMB]",
            probe_material="Probe N/A",
            substrate_material="Graphite",
            cof="0.0032",
            temperature="298.15 K",
            source="Plain text",
            source_page=1,
        ),
        TribologyData(
            material_name="Graphite",
            ionic_liquid="[N8,8,8,12][A4BMB]",
            probe_material="Probe N/A",
            substrate_material="Graphite",
            cof="0.0032",
            temperature="298.15 K",
            source="Plain text",
            source_page=8,
        ),
    ]

    merged, report = deduplicate_records_with_report(records)

    assert len(merged) == 1
    assert report.merged_count == 1


def test_prompts_include_required_provenance_constraints():
    required_tokens = ["source", "source_page", "source_figure", "evidence"]

    for token in required_tokens:
        assert token in TEXT_EXTRACTION_PROMPT
        assert token in FIGURE_TABLE_EXTRACTION_PROMPT

    assert "sample_id" in ABBREV_MAPPING_PROMPT
    assert "Never place sample abbreviations" in TRIBOLOGY_EXTRACTION_PROMPT
    assert "Thickness fields must stay quantitative" in FIGURE_TABLE_EXTRACTION_PROMPT
    assert "Never put scan frequency into `speed`" in TRIBOLOGY_EXTRACTION_PROMPT


def test_scan_rate_is_derived_before_becoming_speed():
    conditions = derive_speed_conditions(
        "scan rate 2 Hz",
        context="trace and retrace tracks of 5 μm x 5 μm under the tip",
    )

    assert conditions["value_type"] == "derived"
    assert conditions["scan_rate_hz"] == 2
    assert conditions["scan_length_um"] == 5
    assert conditions["sliding_velocity_um_s"] == 20
    assert speed_value_from_conditions(conditions) == "20 μm/s"
    assert parse_speed_to_mps("2 Hz") is None


def test_llm_thickness_normalizer_rejects_ionic_liquid_labels():
    assert _normalize_quantitative_thickness("(HMIM FAP)") is None
    assert _normalize_quantitative_thickness("(P6,6,6,14 TFSI)") is None
    assert _normalize_quantitative_thickness("12 nm (BB5-1-M)") == "12 nm"


def test_il_query_builders_expand_full_name_to_table_label_aliases():
    full_name = "1-hexyl-3-methylimidazolium tris(pentafluoroethyl)trifluorophosphate"

    variants = _build_term_query_variants(full_name)
    assert "HMIM FAP" in variants

    record_queries = build_search_queries_for_record(
        SimpleNamespace(
            evidence="Table 2 lists friction coefficient μ.",
            cof_raw="1.16",
            lubricant=full_name,
            material_name="Stainless steel",
        )
    )
    assert "HMIM FAP" in record_queries


def test_tribology_payload_exposes_unified_weak_candidate_metadata():
    candidate = RecordCandidate(
        id=17,
        literature_id=124,
        material_name="graphene",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.08",
        source="Text",
        source_page=4,
        evidence="COF was 0.08 for [EMIM][TFSI] on graphene.",
        confidence=0.52,
        review_status="needs_review",
        record_origin="weak_candidate",
        assembly_notes="Candidate was admitted for review, but load and sliding speed were not confirmed.",
    )

    payload = _tribology_record_api_payload(candidate)

    assert payload["entity_type"] == "candidate"
    assert payload["entity_id"] == 17
    assert payload["entityType"] == "candidate"
    assert payload["entityId"] == 17
    assert payload["review_entity_type"] == "candidate"
    assert payload["confidence_tier"] == "low"
    assert payload["confidenceTier"] == "low"
    assert payload["admission_reason"] == "weak_candidate"
    assert payload["admissionReason"] == "weak_candidate"
    assert payload["missing_fields"] == ["normal_load", "speed"]
    assert payload["missingFields"] == ["normal_load", "speed"]
    assert payload["quality_notes"].startswith("Candidate was admitted")
    assert payload["qualityNotes"].startswith("Candidate was admitted")
    assert payload["fields"]["ionic_liquid"] == "[EMIM][TFSI]"
    assert payload["fields"]["cof"] == "0.08"
    assert payload["source"] == "Text"
    assert payload["display_source"]["page"] == 4
    assert payload["displaySource"]["label"] == "Text"


def test_tribology_payload_exposes_formal_record_as_same_display_shape():
    record = TribologyDataDB(
        id=33,
        literature_id=124,
        material_name="graphene",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.08",
        source="Table 1",
        source_page=4,
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _tribology_record_api_payload(record)

    assert payload["entity_type"] == "record"
    assert payload["entity_id"] == 33
    assert payload["entityType"] == "record"
    assert payload["entityId"] == 33
    assert payload["review_entity_type"] == "record"
    assert payload["confidence_tier"] == "high"
    assert payload["confidenceTier"] == "high"
    assert payload["admission_reason"] == "strict_validated"
    assert payload["fields"]["material_name"] == "graphene"
    assert payload["fields"]["cof"] == "0.08"
    assert payload["source"] == "Table 1"
    assert payload["display_source"]["page"] == 4
    assert payload["displaySource"]["label"] == "Table 1"


def test_tribology_payload_enriches_derived_speed_for_preview_rows():
    record = TribologyDataDB(
        id=34,
        literature_id=124,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        speed_value="6",
        source="Methods",
        source_page=3,
        evidence="The scan size was 500 nm, and scan rate was 6 Hz.",
        field_evidence_json='{"speed":{"value":"6","evidence":{"quote":"The scan size was 500 nm, and scan rate was 6 Hz.","matched_text":"6","page":3,"bbox":[10,20,14,30]}}}',
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _tribology_record_api_payload(record)

    assert payload["speed"] == "6"
    assert payload["speed_conditions"]["value_type"] == "derived"
    assert payload["field_evidence_json"]["speed"]["value"] == "6 μm/s"
    assert payload["field_evidence_json"]["speed"]["grounding_mode"] == "derived"
    assert payload["field_evidence_json"]["speed"]["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in payload["field_evidence_json"]["speed"]["grounding_note"]


def test_preview_response_repairs_legacy_derived_speed_evidence():
    record = TribologyDataDB(
        id=35,
        literature_id=124,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        speed_value="6",
        source="Methods",
        source_page=3,
        evidence="The scan size was 500 nm, and scan rate was 6 Hz.",
        field_evidence_json='{"speed":{"value":"6","evidence":{"quote":"The scan size was 500 nm, and scan rate was 6 Hz.","matched_text":"6","page":3,"bbox":[10,20,14,30]}}}',
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _record_to_response_item(record)

    speed = payload["field_evidence_json"]["speed"]
    assert payload["speed"] == "6 μm/s"
    assert payload["speed_conditions"]["value_type"] == "derived"
    assert speed["value"] == "6 μm/s"
    assert speed["grounding_mode"] == "derived"
    assert speed["evidence"]["quote"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["bbox"] is None
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_database_response_uses_repaired_derived_speed_display():
    record = TribologyDataDB(
        id=37,
        literature_id=124,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        speed_value="6",
        source="Methods",
        source_page=3,
        evidence="The scan size was 500 nm, and scan rate was 6 Hz.",
        field_evidence_json='{"speed":{"value":"6","evidence":{"quote":"The scan size was 500 nm, and scan rate was 6 Hz.","matched_text":"6","page":3,"bbox":[10,20,14,30]}}}',
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _data_explorer_record_to_response(record).model_dump(by_alias=True)

    assert payload["speedValue"] == "6 μm/s"
    assert payload["speedConditions"]["value_type"] == "derived"
    assert payload["speedConditions"]["raw_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert payload["fieldEvidenceJson"]["speed"]["value"] == "6 μm/s"
    assert payload["fieldEvidenceJson"]["speed"]["grounding_mode"] == "derived"
    assert payload["fieldEvidenceJson"]["speed"]["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert payload["fieldEvidenceJson"]["speed"]["evidence"]["bbox"] is None
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in payload["fieldEvidenceJson"]["speed"]["grounding_note"]


def test_database_response_derives_speed_evidence_from_pdf_scan_context(tmp_path: Path):
    pdf_path = tmp_path / "scan-context.pdf"
    doc = fitz.open()
    page = doc.new_page(width=594, height=792)
    page.insert_text((72, 96), "2. MATERIALS AND METHODS", fontsize=11)
    page.insert_text((72, 122), "The scan size was 500 nm, and scan rate was 6 Hz.", fontsize=11)
    doc.save(pdf_path)
    doc.close()

    record = TribologyDataDB(
        id=39,
        literature_id=124,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        speed_value="6",
        source="Methods",
        source_page=1,
        evidence="AFM friction measurements were performed in the methods section.",
        field_evidence_json=json.dumps(
            {
                "speed": {
                    "value": "6",
                    "evidence": {
                        "source_type": "text",
                        "quote": "6",
                        "matched_text": "6",
                        "page": 1,
                        "bbox": [250, 114, 258, 130],
                    },
                }
            }
        ),
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )
    record.literature = Literature(
        id=124,
        doi="10.0000/scan-context",
        title="Scan context",
        authors="Tester",
        journal="Test",
        year=2026,
        file_path=str(pdf_path),
    )

    payload = _data_explorer_record_to_response(record).model_dump(by_alias=True)

    speed = payload["fieldEvidenceJson"]["speed"]
    assert payload["speedValue"] == "6 μm/s"
    assert payload["speedConditions"]["raw_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["quote"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["bbox"] is None
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_database_search_payload_uses_repaired_field_evidence():
    record = TribologyDataDB(
        id=38,
        literature_id=124,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        speed_value="6",
        source="Methods",
        source_page=3,
        evidence="The scan size was 500 nm, and scan rate was 6 Hz.",
        field_evidence_json='{"speed":{"value":"6","evidence":{"quote":"The scan size was 500 nm, and scan rate was 6 Hz.","matched_text":"6","page":3,"bbox":[10,20,14,30]}}}',
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _query_record_to_payload(record)

    assert payload["speed_value"] == "6 μm/s"
    assert payload["speed_conditions"]["value_type"] == "derived"
    assert payload["field_evidence_json"]["speed"]["value"] == "6 μm/s"
    assert payload["field_evidence_json"]["speed"]["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert payload["field_evidence_json"]["speed"]["evidence"]["bbox"] is None


def test_preview_response_clears_bare_roughness_number_evidence():
    record = TribologyDataDB(
        id=36,
        literature_id=124,
        material_name="mica",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.02",
        probe_roughness="RMS 2 nm",
        source="Methods",
        source_page=3,
        field_evidence_json='{"probe_roughness":{"value":"RMS 2 nm","evidence":{"source_type":"text","quote":"2","matched_text":"2","page":3,"bbox":[10,20,14,30]}}}',
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _record_to_response_item(record)

    roughness = payload["field_evidence_json"]["probe_roughness"]
    assert roughness["evidence"]["quote"] is None
    assert roughness["evidence"]["matched_text"] is None
    assert roughness["evidence"]["bbox"] is None
    assert "roughness/unit context" in roughness["grounding_note"]


def test_preview_response_expands_roughness_numeric_hit_to_rms_context():
    record = TribologyDataDB(
        id=40,
        literature_id=124,
        material_name="mica",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.02",
        probe_roughness="RMS 2 nm",
        source="Methods",
        source_page=3,
        field_evidence_json=(
            '{"probe_roughness":{"value":"RMS 2 nm","evidence":'
            '{"source_type":"text","quote":"The colloidal probe had RMS 2 nm roughness.",'
            '"matched_text":"2","page":3,"bbox":[10,20,14,30]}}}'
        ),
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _record_to_response_item(record)

    roughness = payload["field_evidence_json"]["probe_roughness"]
    assert roughness["evidence"]["quote"] == "The colloidal probe had RMS 2 nm roughness."
    assert roughness["evidence"]["matched_text"] == "RMS 2 nm"
    assert roughness["evidence"]["bbox"] is None


def test_drop_reason_rejects_ambiguous_figure_legend_without_numeric_support():
    service = LLMService()

    reason = service._drop_reason_for_candidate(
        {
            "cof": "0.10",
            "source": "Fig. 3f",
            "source_figure": "3f",
            "evidence": "Dry / Ambient ● / ○ 0 V ▲ / △ +0.25 V ■ / □ -1 V",
        },
        "figure",
    )

    assert reason == "figure_legend_without_numeric_support"


def test_drop_reason_rejects_plot_value_without_numeric_support():
    service = LLMService()

    reason = service._drop_reason_for_candidate(
        {
            "cof": "0.013",
            "source": "Fig. 3f",
            "source_figure": "3f",
            "evidence": "Dry / Ambient ● / ○ 0 V",
            "notes": "Friction coefficient obtained from linear fit of friction-load plot under dry (Ar) conditions at 0 V potential.",
        },
        "figure",
    )

    assert reason == "figure_legend_without_numeric_support"


def test_drop_reason_keeps_figure_cof_when_numeric_value_is_explicit():
    service = LLMService()

    reason = service._drop_reason_for_candidate(
        {
            "cof": "0.10",
            "source": "Fig. 3B",
            "source_figure": "3b",
            "evidence": "The plot shows a linear fit: F_F = 0.10 F_N + 1.51, indicating a friction coefficient of 0.10.",
        },
        "figure",
    )

    assert reason is None

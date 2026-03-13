from models.tribology import TribologyData
from services.llm.deduplication import deduplicate_records_with_report
from services.llm_service import _normalize_quantitative_thickness
from services.llm.prompts import (
    ABBREV_MAPPING_PROMPT,
    FIGURE_TABLE_EXTRACTION_PROMPT,
    TEXT_EXTRACTION_PROMPT,
    TRIBOLOGY_EXTRACTION_PROMPT,
)


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


def test_prompts_include_required_provenance_constraints():
    required_tokens = ["source", "source_page", "source_figure", "evidence"]

    for token in required_tokens:
        assert token in TEXT_EXTRACTION_PROMPT
        assert token in FIGURE_TABLE_EXTRACTION_PROMPT

    assert "sample_id" in ABBREV_MAPPING_PROMPT
    assert "Never place sample abbreviations" in TRIBOLOGY_EXTRACTION_PROMPT
    assert "Thickness fields must stay quantitative" in FIGURE_TABLE_EXTRACTION_PROMPT


def test_llm_thickness_normalizer_rejects_ionic_liquid_labels():
    assert _normalize_quantitative_thickness("(HMIM FAP)") is None
    assert _normalize_quantitative_thickness("(P6,6,6,14 TFSI)") is None
    assert _normalize_quantitative_thickness("12 nm (BB5-1-M)") == "12 nm"

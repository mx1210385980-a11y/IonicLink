from types import SimpleNamespace

from models.tribology import TribologyData
from routers.extraction import _build_term_query_variants
from services.llm.deduplication import deduplicate_records_with_report
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

from services.weak_candidate_service import build_weak_candidate_items


def test_build_weak_candidate_items_admits_metric_with_context_and_marks_missing_fields():
    trace_candidates = [
        {
            "stage": "stage_c",
            "modality": "text",
            "page": 4,
            "raw": {"cof": "0.08"},
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "source_page": 4,
                "source": "Plain text",
                "evidence": "The coefficient of friction was 0.08 for [EMIM][TFSI] on graphene.",
            },
            "drop_reason": "no_target_metric",
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert len(items) == 1
    item = items[0]
    assert item["ionic_liquid"] == "[EMIM][TFSI]"
    assert item["material_name"] == "graphene"
    assert item["cof"] == "0.08"
    assert item["record_origin"] == "weak_candidate"
    assert item["review_status"] == "needs_review"
    assert item["confidence"] == 0.52
    assert item["confidence_tier"] == "low"
    assert item["admission_reason"] == "weak_candidate"
    assert item["missing_fields"] == ["normal_load", "speed"]
    assert "load and sliding speed" in item["quality_notes"]


def test_build_weak_candidate_items_rejects_rows_without_metric_or_context_signal():
    trace_candidates = [
        {
            "stage": "stage_c",
            "modality": "text",
            "raw": {"notes": "The article discusses lubrication generally."},
            "normalized": {
                "notes": "The article discusses lubrication generally.",
                "source_page": 2,
            },
            "drop_reason": "no_core_quant_signal",
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert items == []
    assert summary == {"weak_candidate_count": 0}


def test_build_weak_candidate_items_uses_aliases_when_canonical_values_are_placeholders():
    trace_candidates = [
        {
            "modality": "table",
            "page": 7,
            "normalized": {
                "ionic_liquid": "Unknown IL",
                "lubricant": "[BMIM][PF6]",
                "material_name": "",
                "substrate_material": "steel",
                "cof": "0.12",
                "source_figure": "Table 2",
            },
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert items[0]["ionic_liquid"] == "[BMIM][PF6]"
    assert items[0]["material_name"] == "steel"
    assert items[0]["weak_candidate_source"] == {
        "page": 7,
        "label": "Table 2",
        "source_type": "table",
    }


def test_build_weak_candidate_items_recovers_il_from_context_before_using_unknown_placeholder():
    trace_candidates = [
        {
            "modality": "text",
            "page": 2,
            "normalized": {
                "ionic_liquid": "Unknown IL",
                "material_name": "1-butyl-3-methylimidazolium tetrafluoroborate ([BMIM][BF4], BB)",
                "cof": "0.08",
                "evidence": (
                    "The extensively studied 1-butyl-3-methylimidazolium "
                    "tetrafluoroborate ([BMIM][BF4], BB) was used as the IL."
                ),
            },
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert items[0]["ionic_liquid"] == "[BMIM][BF4]"


def test_build_weak_candidate_items_rejects_reference_marker_il_noise_without_recoverable_il():
    trace_candidates = [
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "[63][previously]",
                "material_name": "Unknown Material",
                "cof": "0.080",
                "speed": "1000000 μm/s",
                "evidence": (
                    "Werzer et al. [63] previously found that the friction "
                    "coefficient increased as the sliding speed increased."
                ),
            },
        },
        {
            "modality": "text",
            "page": 6,
            "normalized": {
                "ionic_liquid": "[66][beneficial]",
                "material_name": "Unknown Material",
                "cof": "0.12",
                "evidence": "A smoother structure [66] beneficial for sliding motion was discussed.",
            },
        },
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert items == []
    assert summary == {"weak_candidate_count": 0}


def test_build_weak_candidate_items_falls_back_for_blank_source_label():
    trace_candidates = [
        {
            "modality": "text",
            "page": 2,
            "normalized": {
                "ionic_liquid": "[BMIM][PF6]",
                "material_name": "steel",
                "cof": "0.12",
                "source": "",
            },
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert items[0]["source"] == "Extracted weak candidate"
    assert items[0]["weak_candidate_source"]["label"] == "Extracted weak candidate"


def test_build_weak_candidate_items_preserves_numeric_zero_values():
    trace_candidates = [
        {
            "modality": "text",
            "page": 3,
            "normalized": {
                "ionic_liquid": "[EMIM][BF4]",
                "material_name": "mica",
                "cof": 0,
                "normal_load": 0,
                "speed": 0,
                "evidence": "COF of 0 was reported on mica.",
            },
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert items[0]["cof"] == 0
    assert items[0]["normal_load"] == 0
    assert items[0]["speed"] == 0
    assert items[0]["missing_fields"] == []


def test_build_weak_candidate_items_admits_numeric_zero_metric_without_text_evidence():
    trace_candidates = [
        {
            "modality": "table",
            "page": 8,
            "normalized": {
                "ionic_liquid": "[EMIM][BF4]",
                "material_name": "mica",
                "cof": 0,
            },
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert len(items) == 1
    assert items[0]["cof"] == 0
    assert items[0]["weak_candidate_source"]["page"] == 8


def test_build_weak_candidate_items_handles_invalid_and_non_finite_confidence():
    trace_candidates = [
        {
            "modality": "text",
            "page": 1,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "confidence": "low",
            },
        },
        {
            "modality": "text",
            "page": 2,
            "normalized": {
                "ionic_liquid": "[BMIM][PF6]",
                "material_name": "steel",
                "cof": "0.14",
                "confidence": float("nan"),
            },
        },
        {
            "modality": "text",
            "page": 3,
            "normalized": {
                "ionic_liquid": "[HMIM][BF4]",
                "material_name": "mica",
                "cof": "0.03",
                "confidence": 0.91,
            },
        },
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 3}
    assert [item["confidence"] for item in items] == [0.52, 0.52, 0.52]


def test_build_weak_candidate_items_normalizes_negative_confidence():
    trace_candidates = [
        {
            "modality": "text",
            "page": 9,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "confidence": -0.4,
            },
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert items[0]["confidence"] == 0.52


def test_build_weak_candidate_items_discards_ratio_and_cof_exponent_load_noise():
    trace_candidates = [
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "C18mimBr-C12F26 composite system",
                "material_name": "AFM probe / graphite substrate",
                "cof": "0.0001",
                "normal_load": "1-50 nN",
                "load": "1-50 nN",
                "evidence": (
                    "C12F26 displays the broadest superlubricity window spanning "
                    "from 1:1 to 50:1 (IL:C12F26)."
                ),
            },
        },
        {
            "modality": "text",
            "page": 2,
            "normalized": {
                "ionic_liquid": "C18mimBr-CnF2n+2 composite system",
                "material_name": "AFM probe / graphite substrate",
                "cof": "0.0001",
                "normal_load": "10-4 nN",
                "load": "10-4 nN",
                "evidence": "The system achieves friction coefficients reaching the order of 10-4.",
            },
        },
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 2}
    assert all("normal_load" not in item for item in items)
    assert all("load" not in item for item in items)
    assert all("normal_load" in item["missing_fields"] for item in items)


def test_build_weak_candidate_items_dedupes_before_applying_limit():
    trace_candidates = [
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
            },
        },
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "evidence": "duplicate row",
            },
        },
        {
            "modality": "text",
            "page": 6,
            "normalized": {
                "ionic_liquid": "[BMIM][PF6]",
                "material_name": "steel",
                "cof": "0.14",
            },
        },
    ]

    items, summary = build_weak_candidate_items(trace_candidates, limit=1)

    assert summary == {"weak_candidate_count": 1}
    assert len(items) == 1
    assert items[0]["ionic_liquid"] == "[EMIM][TFSI]"


def test_build_weak_candidate_items_dedupes_by_cof_extracted_metric():
    trace_candidates = [
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof_extracted": "0.08",
            },
        },
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof_extracted": "0.11",
            },
        },
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 2}
    assert [item["cof_extracted"] for item in items] == ["0.08", "0.11"]


def test_build_weak_candidate_items_uses_trace_page_for_blank_source_page_before_dedupe():
    trace_candidates = [
        {
            "modality": "text",
            "page": 5,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "source_page": "",
            },
        },
        {
            "modality": "text",
            "page": 6,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "source_page": "",
            },
        },
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 2}
    assert [item["source_page"] for item in items] == [5, 6]
    assert [item["weak_candidate_source"]["page"] for item in items] == [5, 6]

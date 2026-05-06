from types import SimpleNamespace

from services.file_service import (
    _annotate_review_record_with_canonical_match,
    _build_field_evidence_map,
    _field_allows_global_context_fallback,
    _field_query_variants,
    _review_canonical_match_score,
)


def test_field_evidence_prefers_resolved_pdf_evidence_page_over_source_page():
    item = {
        "material_name": "Silicon",
        "ionic_liquid": "[HMIM][FAP]",
        "cof": "1.16",
        "source": "Fig. 1",
        "source_page": 9,
    }
    record = SimpleNamespace(
        source="Fig. 1",
        source_figure="Figure 1",
        source_page=9,
        evidence_page=10,
        evidence_bbox="[182.32, 64.0, 439.16, 312.44]",
        sample_id=None,
    )

    field_map = _build_field_evidence_map(item, record, confidence=0.9, file_path=None)

    assert field_map["cof"]["evidence"]["page"] == 10
    assert field_map["source_page"]["value"] == "Page 10"


def test_field_evidence_global_fallbacks_cover_metric_context_fields():
    assert _field_allows_global_context_fallback("cof", "1.16")
    assert _field_allows_global_context_fallback("speed", "6.5 μm/s")
    assert _field_allows_global_context_fallback("substrate_roughness", "RMS 0.89 nm")

    roughness_queries = _field_query_variants("substrate_roughness", "RMS 0.89 nm")
    assert "roughness RMS 0.89 nm" in roughness_queries


def test_review_secondary_match_links_to_canonical_source_metadata():
    review_item = {
        "material_name": "Mica",
        "ionic_liquid": "[EMIM][EtSO4]",
        "probe_material": "Mica",
        "substrate_material": "Mica",
        "cof": "0.009 ± 0.002",
        "regime": "n = 3 layers (D = 1.08 ± 0.15 nm)",
        "field_evidence_json": {
            "cof": {
                "value": "0.009 ± 0.002",
                "evidence": {"source_label": "Fig. 15d"},
            },
        },
    }
    canonical = {
        "entity_type": "candidate",
        "record_id": 141,
        "literature_id": 61,
        "title": "Layering and shear properties of an ionic liquid, 1-ethyl-3-methylimidazolium ethylsulfate, confined to nano-films between mica surfaces",
        "doi": "10.1039/b920571c",
        "lubricant": "[EMIM][EtSO4]",
        "probe_material": "Mica",
        "substrate_material": "Mica",
        "cof": "0.009 ± 0.002",
        "regime": "n = 3 layers (D = 1.08 ± 0.15 nm)",
    }

    score, fields = _review_canonical_match_score(review_item, canonical)
    _annotate_review_record_with_canonical_match(review_item, canonical, score, fields)

    assert score >= 0.78
    assert review_item["record_origin"] == "review_secondary"
    assert "canonical literature #61" in review_item["assembly_notes"]
    canonical_source = review_item["field_evidence_json"]["_canonical_source"]
    assert canonical_source["grounding_mode"] == "secondary_source"
    assert canonical_source["canonical"]["canonical_record"]["record_id"] == 141
    assert review_item["field_evidence_json"]["cof"]["canonical"]["kind"] == "review_secondary_source"

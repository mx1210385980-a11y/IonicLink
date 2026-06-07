from pathlib import Path
from types import SimpleNamespace

from routers.extraction import _sanitize_field_evidence_locations
from services.file_service import _build_field_evidence_map
from services.il_resolver_service import filter_to_supported_ionic_liquid_records, is_likely_ionic_liquid_name
from services.normalization.row_normalizer import normalize_extraction_row
from utils.document_context import extract_experimental_document_context
from utils.cof_guard import unsupported_figure_cof_reason

_PALACIO_PDF_RELATIVE = "Reference/2010-Palacio M, Bhushan B. A review of ionic liquids for green molecular lubrication in nanotechnology[J]. Tribology Letters, 2010, 40(2) 247-268.pdf"
# Resolve against the repo root (this file lives in backend/) so the fixture is
# found regardless of whether pytest runs from the repo root or from backend/.
_REPO_ROOT_PALACIO_PDF = Path(__file__).resolve().parent.parent / _PALACIO_PDF_RELATIVE
PALACIO_PDF = _REPO_ROOT_PALACIO_PDF if _REPO_ROOT_PALACIO_PDF.exists() else Path(_PALACIO_PDF_RELATIVE)


def test_coefficient_of_friction_phrase_is_valid_metric_context():
    record = {
        "source": "Fig. 10b",
        "source_figure": "Fig. 10b",
        "cof": "0.2",
        "evidence": "Bar chart in Fig. 10b shows coefficient of friction for BMIM-PF6 untreated: ~0.2.",
    }

    assert unsupported_figure_cof_reason(record) is None


def test_reference_bracket_token_does_not_override_sample_il():
    row = {
        "source": "Fig. 10b",
        "source_page": 11,
        "source_figure": "Fig. 10b",
        "sample_id": "BMIM-PF6",
        "cof": "0.2",
        "evidence": (
            "Bar chart in Fig. 10b shows coefficient of friction for Si(100) untreated: ~0.7, "
            "Z-TETRAOL untreated: ~0.15, BMIM-PF6 untreated: ~0.2. Data are from [27][Tribol]."
        ),
    }

    normalized = normalize_extraction_row(row, 11)

    assert normalized["ionic_liquid"] == "BMIM-PF6"


def test_review_article_does_not_apply_reference_page_as_global_context():
    page_texts = {
        0: "A Review of Ionic Liquids for Green Molecular Lubrication in Nanotechnology",
        20: (
            "References 67. Perkin, S., Albrecht, T., Klein, J.: Layering and shear "
            "properties of an ionic liquid confined between mica surfaces."
        ),
    }

    assert extract_experimental_document_context(page_texts) == {}


def test_si100_material_is_inferred_from_local_figure_context():
    normalized = normalize_extraction_row(
        {
            "source": "Fig. 10b",
            "source_figure": "Fig. 10b",
            "sample_id": "BMIM-PF6",
            "cof": "0.2",
            "evidence": "Coefficient of friction from ball-on-flat tests on various BMIM-PF6 coating. Data for uncoated Si(100) are shown for comparison.",
        },
        11,
    )

    assert normalized["material_name"] == "Si(100)"
    assert normalized["substrate_material"] == "Si(100)"


def test_figure_inferred_value_keeps_figure_bbox_as_field_anchor():
    record = SimpleNamespace(
        source="Fig. 10B",
        source_figure="Fig. 10b",
        evidence_page=11,
        source_page=11,
        evidence_bbox="[359.99, 49.68, 509.08, 284.66]",
    )
    field_map = _build_field_evidence_map(
        {
            "material_name": "Si(100)",
            "ionic_liquid": "BMIM-PF6",
            "cof": "0.2",
            "source": "Fig. 10B",
            "source_figure": "Fig. 10b",
            "source_page": 11,
            "evidence": "Bar chart in Fig. 10b shows coefficient of friction for BMIM-PF6 untreated.",
        },
        record,
        confidence=0.9,
        file_path=None,
    )

    cof_evidence = field_map["cof"]["evidence"]
    assert cof_evidence["page"] == 11
    assert cof_evidence["bbox"] == [359.99, 49.68, 509.08, 284.66]
    assert field_map["cof"]["grounding_mode"] == "source_anchor"


def test_review_figure_estimate_filter_keeps_known_aliases_in_strict_mode_and_controls_in_permissive_mode():
    records = [
        {"ionic_liquid": "L-F206", "cof": "0.08"},
        {"ionic_liquid": "BHPT", "cof": "0.02"},
        {"ionic_liquid": "Z-TETRAOL", "cof": "0.15"},
    ]

    strict_kept, _ = filter_to_supported_ionic_liquid_records(records)
    permissive_kept, permissive_dropped = filter_to_supported_ionic_liquid_records(records, allow_likely=True)

    assert [row["ionic_liquid"] for row in strict_kept] == ["L-F206", "BHPT"]
    assert [row["ionic_liquid"] for row in permissive_kept] == ["L-F206", "BHPT"]
    assert [row["ionic_liquid"] for row in permissive_dropped] == ["Z-TETRAOL"]
    assert is_likely_ionic_liquid_name("BHPET")


def test_review_sanitizer_keeps_ionic_liquid_alias_bbox_for_standardized_value():
    fields = {
        "ionic_liquid": {
            "value": "[EHIM][TFSI]",
            "literature_alias": "L-F206",
            "original_value": "L-F206",
            "evidence": {
                "source_type": "text",
                "page": 6,
                "bbox": [345.66, 693.84, 375.54, 703.8],
                "matched_text": "L-F206",
            },
        }
    }

    sanitized = _sanitize_field_evidence_locations(fields, pdf_path=None)

    evidence = sanitized["ionic_liquid"]["evidence"]
    assert evidence["bbox"] == [345.66, 693.84, 375.54, 703.8]
    assert evidence["matched_text"] == "L-F206"


def test_review_sanitizer_refreshes_visual_anchor_to_source_page_subfigure():
    fields = {
        "cof": {
            "value": "0.08",
            "evidence": {
                "source_type": "figure",
                "page": 7,
                "source_label": "Fig. 5A",
                "bbox": [43.02, 445.6, 180.08, 721.93],
                "matched_text": None,
            },
            "grounding_mode": "source_anchor",
        }
    }

    sanitized = _sanitize_field_evidence_locations(fields, pdf_path=str(PALACIO_PDF))

    evidence = sanitized["cof"]["evidence"]
    assert evidence["page"] == 7
    assert evidence["source_label"] == "Fig. 5A"
    assert evidence["bbox"] == [77.04, 51.24, 324.65, 385.63]

from types import SimpleNamespace

from services.file_service import _build_field_evidence_map
from services.normalization.row_normalizer import normalize_extraction_row
from utils.document_context import extract_experimental_document_context
from utils.cof_guard import unsupported_figure_cof_reason


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

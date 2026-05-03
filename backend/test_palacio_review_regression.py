from services.normalization.row_normalizer import normalize_extraction_row
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

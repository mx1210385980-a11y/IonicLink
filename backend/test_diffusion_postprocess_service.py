from services.diffusion.diffusion_postprocess_service import (
    diffusion_drop_reason,
    normalize_diffusion_records,
)


def _normalize(rows):
    return normalize_diffusion_records(
        rows,
        pdf_path=None,
        provider="test",
        prompt_version="test",
        raw_model_output="{}",
    )


def test_repairs_invalid_unit_from_named_evidence_values():
    rows = [
        {
            "system_name": "Silica nanochannel",
            "ionic_liquid": "[EMIM][BF4]",
            "D_cation": 10,
            "D_anion": 10,
            "D_unit": "shows",
            "temperature_value": 300,
            "confinement_scale_value": 1,
            "source": "Figure 10",
            "source_page": 6,
            "evidence": (
                "Figure 10 shows the diffusion coefficient of anion and cation in nanochannels. "
                "For d=1 nm, the cation diffusion coefficient is approximately 1.2 x 10^-9 m2/s "
                "and anion is 0.8 x 10^-9 m2/s."
            ),
        }
    ]

    normalized = _normalize(rows)

    assert len(normalized) == 1
    assert normalized[0]["D_cation"] == 1200
    assert normalized[0]["D_anion"] == 800
    assert normalized[0]["D_unit"] == "10\u207b\u00b9\u00b2 m\u00b2/s"


def test_rejects_invalid_unit_without_evidence_unit():
    row = {
        "system_name": "Silica nanochannel",
        "ionic_liquid": "[EMIM][BF4]",
        "D_cation": 10,
        "D_unit": "shows",
        "source_page": 6,
        "evidence": "Figure 10 shows the diffusion coefficient.",
    }

    assert diffusion_drop_reason(row) == "unsupported_diffusion_unit"
    assert _normalize([row]) == []


def test_rejects_common_non_ionic_liquid_solute_rows():
    row = {
        "system_name": "MPIL membrane",
        "ionic_liquid": "NaCl (aqueous)",
        "D_anion": 5.7,
        "D_unit": "10^-12 m2/s",
        "source": "Table 3",
        "source_page": 5,
        "evidence": "Table 3 reports the Cl- diffusion coefficient in hydrated polymer membranes.",
    }

    assert diffusion_drop_reason(row) == "non_ionic_liquid_solute"
    assert _normalize([row]) == []


def test_normalizes_general_scientific_diffusion_units():
    rows = [
        {
            "system_name": "Carbon slit pore",
            "ionic_liquid": "[BMIM][PF6]",
            "D_total": 1.25,
            "D_unit": "10^-9 m2/s",
            "source": "Table 2",
            "source_page": 4,
            "evidence": "Table 2 reports D = 1.25 x 10^-9 m2/s.",
        }
    ]

    normalized = _normalize(rows)

    assert len(normalized) == 1
    assert normalized[0]["D_total"] == 1250
    assert normalized[0]["D_unit"] == "10\u207b\u00b9\u00b2 m\u00b2/s"


def test_mvp_rejects_model_value_without_numeric_evidence():
    row = {
        "system_name": "COF nanochannel",
        "ionic_liquid": "[EMIM][TFSI]",
        "D_total": 2.3,
        "D_unit": "10^-12 m2/s",
        "source": "Table 1",
        "source_page": 3,
        "evidence": "Table 1 reports the diffusion coefficient of the confined ionic liquid.",
    }

    assert diffusion_drop_reason(row, require_evidence_measure=True) == "no_numeric_diffusion_in_evidence"
    assert _normalize([row]) == []


def test_mvp_keeps_only_coefficients_supported_by_evidence_quote():
    rows = [
        {
            "system_name": "COF nanochannel",
            "ionic_liquid": "[EMIM][TFSI]",
            "D_total": 2.3,
            "D_cation": 9.9,
            "D_unit": "10^-12 m2/s",
            "source": "Table 1",
            "source_page": 3,
            "evidence": "Table 1 reports D = 2.3 10^-12 m2/s for [EMIM][TFSI] in the COF channel.",
        }
    ]

    normalized = _normalize(rows)

    assert len(normalized) == 1
    assert normalized[0]["D_total"] == 2.3
    assert normalized[0]["D_cation"] is None
    assert normalized[0]["D_unit"] == "10\u207b\u00b9\u00b2 m\u00b2/s"

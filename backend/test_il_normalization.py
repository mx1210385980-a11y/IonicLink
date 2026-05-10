from services.file_service import _canonicalize_ionic_liquid_name, _normalize_record_chemistry
from services.il_resolver_service import resolve_il, resolve_ionic_liquid_alias
from services.normalization import normalize_extraction_row
from services.normalization.potential import normalize_potential_text
from services.data_sync_service import _normalize_quantitative_thickness


def test_resolve_il_normalizes_full_name_and_phosphonium_display():
    resolved = resolve_il("1-ethyl-3-methylimidazolium tris(pentafluoroethyl)trifluorophosphate")

    assert resolved["canonical_name"] == "[EMIM][FAP]"

    phosphonium = resolve_il("[P66614][TFSI]")
    assert phosphonium["canonical_name"] == "[P6,6,6,14][TFSI]"


def test_resolve_il_maps_palacio_sample_aliases_to_ion_forms():
    l_f206 = resolve_il("L-F206")
    assert l_f206["canonical_name"] == "[EHIM][TFSI]"
    assert l_f206["cation"] == "EHIM"
    assert l_f206["anion"] == "TFSI"
    assert l_f206["lubricant_alias"] == "L-F206"

    l_b206 = resolve_il("L-B206 (1-ethyl-3-hexylimidazolium tetrafluoroborate)")
    assert l_b206["canonical_name"] == "[EHIM][BF4]"
    assert l_b206["lubricant_alias"] == "L-B206"

    bhpt = resolve_il("BHPT")
    assert bhpt["canonical_name"] == "[BHPT][TFSI]2"
    assert bhpt["anion_stoichiometry"] == 2

    assert resolve_ionic_liquid_alias("BHPET (Dicationic IL)")["canonical_name"] == "[BHPET][TFSI]2"


def test_normalize_record_chemistry_preserves_literature_alias_for_standardized_il():
    records = [
        {"ionic_liquid": "L-F206", "cof": "0.08"},
        {"ionic_liquid": "BHPET (Dicationic IL)", "cof": "0.04"},
    ]

    _normalize_record_chemistry(records)

    assert records[0]["ionic_liquid"] == "[EHIM][TFSI]"
    assert records[0]["lubricant_alias"] == "L-F206"
    assert records[0]["cation"] == "EHIM"
    assert records[0]["anion"] == "TFSI"

    assert records[1]["ionic_liquid"] == "[BHPET][TFSI]2"
    assert records[1]["lubricant_alias"] == "BHPET"
    assert records[1]["cation"] == "BHPET"
    assert records[1]["anion"] == "TFSI"


def test_normalize_record_chemistry_clears_il_from_film_field_and_uses_bracket_notation():
    records = [
        {
            "ionic_liquid": "1-hexyl-3-methylimidazolium tris(pentafluoroethyl)trifluorophosphate",
            "film_thickness": "(HMIM FAP)",
        },
        {
            "ionic_liquid": "[P66614][TFSI]",
            "film_thickness": "(P6,6,6,14 (C8)2PO2)",
        },
        {
            "ionic_liquid": "[P4441][TFSI]",
            "film_thickness": "12 nm",
        },
    ]

    _normalize_record_chemistry(records)

    assert records[0]["ionic_liquid"] == "[HMIM][FAP]"
    assert records[0]["lubricant"] == "[HMIM][FAP]"
    assert records[0]["film_thickness"] is None
    assert records[0]["cation"] == "HMIM"
    assert records[0]["anion"] == "FAP"

    assert records[1]["ionic_liquid"] == "[P6,6,6,14][i(C8)2PO2]"
    assert records[1]["film_thickness"] is None

    assert records[2]["ionic_liquid"] == "[P4,4,4,1][TFSI]"
    assert records[2]["film_thickness"] == "12 nm"


def test_sync_thickness_normalizer_drops_non_quantitative_labels():
    assert _normalize_quantitative_thickness("(EMIM FAP)") is None
    assert _normalize_quantitative_thickness("P4,4,4,1 TFSI") is None
    assert _normalize_quantitative_thickness("0.7 nm") == "0.7 nm"


def test_normalize_potential_text_uses_consistent_reference_notation():
    assert normalize_potential_text("-0.16 V (OCP)") == "-0.16 V vs OCP"
    assert normalize_potential_text("OCP") == "0 V vs OCP"
    assert normalize_potential_text("160 mV below OCP") == "-0.16 V vs OCP"
    assert normalize_potential_text("+250 mV vs Ag/AgCl") == "+0.25 V vs Ag/AgCl"


def test_normalize_extraction_row_normalizes_potential_reference():
    row = normalize_extraction_row(
        {
            "material_name": "Au(111)",
            "ionic_liquid": "[Pyr14][FAP]",
            "cof": "0.19",
            "potential": "-0.16 V (OCP)",
        },
        fallback_page=None,
    )

    assert row["potential"] == "-0.16 V vs OCP"


def test_normalize_record_chemistry_can_recover_lubricant_from_evidence_text():
    records = [
        {
            "ionic_liquid": "[P6,6,6,14][TFSI]",
            "lubricant": "[P6,6,6,14][TFSI]",
            "evidence": "Table 2 lists friction coefficient μ for various conditions. The value for P6,6,6,14 i(C8)2PO2 is 0.40, with errors ±0.10.",
        }
    ]

    _normalize_record_chemistry(records)

    assert records[0]["ionic_liquid"] == "[P6,6,6,14][i(C8)2PO2]"
    assert records[0]["lubricant"] == "[P6,6,6,14][i(C8)2PO2]"


def test_normalize_record_chemistry_does_not_replace_with_unparsed_sentence():
    records = [
        {
            "ionic_liquid": "[HMIM][I]",
            "lubricant": "[HMIM][I]",
            "evidence": "Table 2 lists friction coefficient μ for various conditions.",
        }
    ]

    _normalize_record_chemistry(records)

    assert records[0]["ionic_liquid"] == "[HMIM][I]"
    assert records[0]["lubricant"] == "[HMIM][I]"


def test_normalize_record_chemistry_recovers_mixed_notation_embedded_in_sentence():
    canonical_name, resolved = _canonicalize_ionic_liquid_name(
        "Lateral force versus normal load for different surface potentials for [Py1,4]FAP confined between a silica colloid probe and the Au(111) electrode surface."
    )

    assert canonical_name == "[Pyr14][FAP]"
    assert resolved["cation"] == "Pyr14"
    assert resolved["anion"] == "FAP"


def test_row_normalizer_replaces_source_label_placeholder_with_il_from_sample_context():
    normalized = normalize_extraction_row(
        {
            "source": "Text",
            "source_figure": "Fig. 1",
            "ionic_liquid": "Text",
            "sample_id": "Au(111) in [Py1,4]FAP",
            "tribopair": {"coating": "[Py1,4]FAP"},
            "evidence": "Small lateral forces and low friction coefficients (0.20 for -1 V and 0.19 for -2 V).",
        },
        fallback_page=2,
        page_context="Cyclic voltammogram and friction force for Au(111) in [Py1,4]FAP.",
    )

    assert normalized["source"] == "Text"
    assert resolve_il(normalized["ionic_liquid"])["canonical_name"] == "[Pyr14][FAP]"

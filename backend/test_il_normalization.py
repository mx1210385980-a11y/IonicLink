from services.file_service import _normalize_record_chemistry
from services.il_resolver_service import resolve_il


def test_resolve_il_normalizes_full_name_and_phosphonium_display():
    resolved = resolve_il("1-ethyl-3-methylimidazolium tris(pentafluoroethyl)trifluorophosphate")

    assert resolved["canonical_name"] == "[EMIM][FAP]"

    phosphonium = resolve_il("[P66614][TFSI]")
    assert phosphonium["canonical_name"] == "[P6,6,6,14][TFSI]"


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

    assert records[1]["ionic_liquid"] == "[P6,6,6,14][(iC8)2PO2]"
    assert records[1]["film_thickness"] is None

    assert records[2]["ionic_liquid"] == "[P4,4,4,1][TFSI]"
    assert records[2]["film_thickness"] == "12 nm"

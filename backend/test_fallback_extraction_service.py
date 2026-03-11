from services.fallback_extraction_service import extract_metadata_fallback, extract_table_fallback_records


SAMPLE_TEXT = """
Friction 10(2): 268-281 (2022)
ISSN 2223-7690
https://doi.org/10.1007/s40544-021-0486-4

RESEARCH ARTICLE

Probing the nanofriction of non-halogenated phosphonium-based ionic liquid additives in glycol ether oil on titanium surface

Table 1 Nanofriction coefficients of the bare Ti substrate, neat DEGDBE oil on Ti surface, and ILs-oil mixtures (1:70, 1:10) on the Ti surface.
Molar ratio of IL to oil 1:70 1:10 -
[P6,6,6,14][BScB] 0.11 ± 0.001 0.058 ± 0.004 -
[P6,6,6,14][DCA] 0.10 ± 0.001 0.052 ± 0.001 -
"""


def test_extract_metadata_fallback_recovers_doi_and_title():
    metadata = extract_metadata_fallback(SAMPLE_TEXT)

    assert metadata["doi"] == "10.1007/s40544-021-0486-4"
    assert metadata["journal"] == "Friction"
    assert metadata["year"] == 2022
    assert "phosphonium-based ionic liquid additives" in metadata["title"].lower()


def test_extract_table_fallback_records_recovers_two_ratios_per_il():
    records, debug = extract_table_fallback_records(SAMPLE_TEXT)

    assert debug["record_count"] == 4
    assert records[0]["material_name"] == "Titanium"
    assert records[0]["mol_ratio"] == "1:70"
    assert records[1]["mol_ratio"] == "1:10"
    assert records[0]["ionic_liquid"] == "[P6,6,6,14][BScB]"

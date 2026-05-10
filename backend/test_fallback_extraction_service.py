from services.fallback_extraction_service import extract_metadata_fallback, extract_table_fallback_records
from utils.lubricant_mixture import compact_lubricant_label


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


def test_extract_metadata_fallback_handles_spaced_pdf_doi():
    metadata = extract_metadata_fallback(
        """
Article
Ionic Liquid Lubrication of Stainless Steel: Friction is Inversely Correlated with Interfacial Liquid Nanostructure
ACS Sustainable Chem. Eng., Just Accepted Manuscript - DOI: 10.1021/ acssuschemeng.7b03262
"""
    )

    assert metadata["doi"] == "10.1021/acssuschemeng.7b03262"


def test_extract_metadata_fallback_recovers_an_2022_review():
    metadata = extract_metadata_fallback(
        """
Nanoscale
Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces
https://doi.org/10.1039/d2nr02812c
"""
    )

    assert metadata["doi"] == "10.1039/d2nr02812c"
    assert metadata["journal"] == "Nanoscale"
    assert metadata["year"] == 2022


def test_extract_metadata_fallback_recovers_rutland_2013_ion_structure_velocity():
    metadata = extract_metadata_fallback(
        """
Physical Chemistry Chemical Physics
Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity
DOI: 10.1039/c3cp52638k
"""
    )

    assert metadata["doi"] == "10.1039/c3cp52638k"
    assert metadata["journal"] == "Physical Chemistry Chemical Physics"
    assert metadata["year"] == 2013
    assert "surface potential and sliding velocity" in metadata["title"].lower()


def test_extract_table_fallback_records_recovers_two_ratios_per_il():
    records, debug = extract_table_fallback_records(SAMPLE_TEXT)

    assert debug["record_count"] == 4
    assert records[0]["material_name"] == "Titanium"
    assert records[0]["mol_ratio"] == "1:70"
    assert records[1]["mol_ratio"] == "1:10"
    assert records[0]["ionic_liquid"] == "[P6,6,6,14][BScB]"
    assert records[0]["lubricant_components"] == [
        {"compound": "[P6,6,6,14][BScB]", "fraction": 1.4085, "unit": "mol%", "role": "additive"},
        {"compound": "DEGDBE oil", "fraction": 98.5915, "unit": "mol%", "role": "base_oil"},
    ]
    assert records[1]["lubricant_components"] == [
        {"compound": "[P6,6,6,14][BScB]", "fraction": 9.0909, "unit": "mol%", "role": "additive"},
        {"compound": "DEGDBE oil", "fraction": 90.9091, "unit": "mol%", "role": "base_oil"},
    ]
    assert compact_lubricant_label(records[0]["lubricant"], records[0]["lubricant_components"]) == "[P6,6,6,14][BScB] / DEGDBE oil (1:70 mol)"
    assert compact_lubricant_label(records[1]["lubricant"], records[1]["lubricant_components"]) == "[P6,6,6,14][BScB] / DEGDBE oil (1:10 mol)"


def test_extract_table_fallback_records_recovers_atkin_graphite_figure2_mu_labels():
    content = """
Potential-Dependent Superlubricity of Ionic Liquids on a Graphite Surface
The four ILs used in this study—[P6,6,6,14][i(C8)2PO2], [P6,6,6,14][BEHP],
[P6,6,6,14][TFSI], and [P4,4,4,1][TFSI]—were measured on HOPG.
The scan size was 500 nm, and scan rate was 6 Hz.
Figure 2. Lateral force vs normal load of four ILs at OCP, −1.0 V and +1.0 V on HOPG:
(a) [P6,6,6,14][i(C8)2PO2], (b) [P6,6,6,14][BEHP], (c) [P6,6,6,14][TFSI],
and (d) [P4,4,4,1][TFSI].
When the load is higher than 20 nN, the lateral force increases slowly but linearly with the load.
The friction coefficients (μ) extracted from the gradient of the lateral force vs normal load in these linear regions are listed in Figure 2.
"""

    records, debug = extract_table_fallback_records(content)

    assert debug["parser"] == "atkin_graphite_superlubricity_figure2"
    assert debug["record_count"] == 12
    by_key = {(record["ionic_liquid"], record["potential"]): record for record in records}
    assert by_key[("[P6,6,6,14][i(C8)2PO2]", "OCP")]["cof"] == "0.002"
    assert by_key[("[P6,6,6,14][i(C8)2PO2]", "+1.0 V")]["cof"] == "0.013"
    assert by_key[("[P6,6,6,14][BEHP]", "-1.0 V")]["cof"] == "0.002"
    assert by_key[("[P6,6,6,14][TFSI]", "+1.0 V")]["cof"] == "0.004"
    assert by_key[("[P4,4,4,1][TFSI]", "OCP")]["cof"] == "0.018"
    assert by_key[("[P4,4,4,1][TFSI]", "+1.0 V")]["cof"] == "0.018"
    assert by_key[("[P4,4,4,1][TFSI]", "-1.0 V")]["cof"] == "0.018"
    assert by_key[("[P6,6,6,14][TFSI]", "+1.0 V")]["speed_conditions"]["sliding_velocity_um_s"] == 6.0
    assert by_key[("[P6,6,6,14][TFSI]", "+1.0 V")]["tribological_system"]["friction_regime"] == "superlubric"


def test_extract_table_fallback_records_recovers_an_2022_review_layering_records():
    content = """
Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces
DOI: 10.1039/d2nr02812c
Fig. 15 (d) Friction coefficient (left) and slip length (right) are summarized for
1-ethyl-3-methylimidazolium ethylsulfate, [EMIM][EtSO4], confined between mica sheets.
Rq represents the root mean square roughness in the adjacent slip-length panel.
"""

    records, debug = extract_table_fallback_records(content)

    assert debug["parser"] == "an_2022_review_perkin_layering_figure15d"
    assert debug["record_count"] == 2
    assert [record["cof"] for record in records] == ["0.009 ± 0.002", "0.12 ± 0.02"]
    assert {record["ionic_liquid"] for record in records} == {"[EMIM][EtSO4]"}
    assert {record["probe_material"] for record in records} == {"Mica"}
    assert {record["substrate_material"] for record in records} == {"Mica"}
    assert all(not record.get("surface_roughness") for record in records)
    for record in records:
        cof_evidence = record["field_evidence_json"]["cof"]["evidence"]
        assert "friction coefficient" in cof_evidence["source_label"].lower()
        assert "roughness" not in cof_evidence["source_label"].lower()


def test_extract_table_fallback_records_recovers_rutland_2013_potential_velocity_tables():
    content = """
Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity
Table 2 Friction coefficients of [EMIM] FAP, [BMIM] FAP, [HMIM] FAP and [BMIM] I
on Au(111) surface at different potentials with a sliding speed of 2 μm s-1.
-2.0 V -1.0 V -0.5 V 0 V +0.5 V +1.0 V +1.5 V
[EMIM] FAP 0.12 0.16 0.20 0.23 0.28 0.35 0.38
[BMIM] FAP 0.23 0.24 0.29 0.30 0.38
[HMIM] FAP 0.10 0.15 0.20 0.28 0.30 0.36 0.41
[BMIM] I 0.24 0.20 0.17 0.12
Table 3 Friction coefficients of [EMIM] FAP at different sliding speeds and surface potentials.
2 μm/s 0.12 0.16 0.20 0.23 0.28 0.35 0.38
6 μm/s 0.13 0.17 0.22 0.26 0.30 0.35 0.39
12 μm/s 0.14 0.19 0.22 0.29 0.30 0.35 0.39
20 μm/s 0.15 0.20 0.24 0.34 0.31 0.36 0.39
"""

    records, debug = extract_table_fallback_records(content)

    assert debug["parser"] == "rutland_2013_potential_velocity_tables"
    assert debug["record_count"] == 44
    by_key = {(record["ionic_liquid"], record["potential"], record["speed"]): record for record in records}
    assert by_key[("[EMIM][FAP]", "-2.0 V", "2 μm/s")]["cof"] == "0.12"
    assert by_key[("[BMIM][FAP]", "-1.0 V", "2 μm/s")]["cof"] == "0.23"
    assert ("[BMIM][FAP]", "+1.5 V", "2 μm/s") not in by_key
    assert by_key[("[HMIM][FAP]", "+1.5 V", "2 μm/s")]["cof"] == "0.41"
    assert by_key[("[BMIM][I]", "+0.5 V", "2 μm/s")]["cof"] == "0.12"
    assert ("[BMIM][I]", "+1.0 V", "2 μm/s") not in by_key
    assert by_key[("[EMIM][FAP]", "0 V", "20 μm/s")]["cof"] == "0.34"
    assert by_key[("[EMIM][FAP]", "+1.5 V", "12 μm/s")]["cof"] == "0.39"
    assert by_key[("[EMIM][FAP]", "0 V", "20 μm/s")]["speed_conditions"]["sliding_velocity_um_s"] == 20.0
    assert by_key[("[EMIM][FAP]", "0 V", "20 μm/s")]["tribological_system"]["contact_geometry"] == "afm_colloidal_probe"

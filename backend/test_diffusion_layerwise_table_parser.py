from pathlib import Path

import fitz

from services.diffusion.diffusion_table_parser import extract_layerwise_diffusion_table_records


def test_extracts_total_and_layerwise_cation_anion_diffusion_rows(tmp_path: Path):
    pdf_path = tmp_path / "layerwise-diffusion-table.pdf"
    doc = fitz.open()
    page = doc.new_page(width=594, height=792)
    page.insert_text(
        (44, 92),
        "TABLE II. Total and layer-wise diffusion coefficients of BuPy+ and NTf2- in confinement with polarizable and non-polarizable surfaces.",
        fontsize=9,
    )
    page.insert_text((44, 118), "d (nm) D+ tot D- tot D+ I D- I D+ II D- II D+ III D- III", fontsize=9)
    page.insert_text((260, 146), "Polarizable surface", fontsize=9)
    page.insert_text((44, 166), "4.09 1.506 1.176 0.876 0.838 1.131 0.792 1.802 1.469", fontsize=9)
    page.insert_text((44, 178), "2.36 0.958 0.982 0.860 0.758 0.912 0.860 n/a n/a", fontsize=9)
    page.insert_text((44, 190), "1.65 0.410 0.418 0.411 0.375 0.604 0.419 n/a n/a", fontsize=9)
    page.insert_text((254, 210), "Non-polarizable surface", fontsize=9)
    page.insert_text((44, 228), "4.09 1.584 1.499 0.842 0.952 1.344 0.816 1.898 1.888", fontsize=9)
    page.insert_text((44, 240), "2.36 0.725 0.702 0.673 0.629 0.851 0.639 n/a n/a", fontsize=9)
    page.insert_text((44, 252), "1.65 0.215 0.215 0.201 0.214 0.283 0.244 n/a n/a", fontsize=9)
    doc.save(pdf_path)
    doc.close()

    records = extract_layerwise_diffusion_table_records(str(pdf_path))

    assert len(records) == 6
    first = records[0]
    assert first["ionic_liquid"] == "[BuPy][NTf2]"
    assert first["confinement_scale_value"] == 4.09
    assert first["surface_functional_groups"] == "polarizable surface"
    assert first["D_total"] is None
    assert first["D_cation"] == 150.6
    assert first["D_anion"] == 117.6
    assert first["D_unit"] == "10⁻¹² m²/s"
    assert first["source_page"] == 1
    assert first["source_bbox"][1] < 100
    assert first["source_bbox"][3] > 245
    assert first["novel_features_json"]["source_row_bbox"][1] > 150
    assert first["novel_features_json"]["source_row_bbox"][3] < 180
    assert first["novel_features_json"]["source_table_bbox"] == first["source_bbox"]
    assert first["novel_features_json"]["layer_diffusion_coefficients"][0] == {
        "layer": "I",
        "D_cation": 87.6,
        "D_anion": 83.8,
        "unit": "10⁻¹² m²/s",
    }
    assert first["novel_features_json"]["layer_diffusion_coefficients"][2] == {
        "layer": "III",
        "D_cation": 180.2,
        "D_anion": 146.9,
        "unit": "10⁻¹² m²/s",
    }

import json
from pathlib import Path
from types import SimpleNamespace

import fitz

from routers import extraction


def test_diffusion_table_locator_replaces_stale_group_bbox_with_metric_cell(tmp_path: Path, monkeypatch):
    pdf_path = tmp_path / "diffusion-table.pdf"
    doc = fitz.open()
    page = doc.new_page(width=594, height=792)
    page.insert_text((44, 92), "TABLE II. Total and layer-wise diffusion coefficients", fontsize=9)
    page.insert_text((44, 148), "Polarizable surface", fontsize=9)
    page.insert_text((44, 166), "4.09 1.506 1.176", fontsize=9)
    doc.save(pdf_path)
    doc.close()

    stale_group_bbox = [44.0, 140.0, 125.0, 152.0]
    monkeypatch.setattr(extraction, "_resolve_existing_path", lambda _path: str(pdf_path))

    payload = extraction._build_diffusion_candidate_pdf_evidence_payload(
        SimpleNamespace(file_path=str(pdf_path)),
        SimpleNamespace(
            evidence="Table II reports D_tot for BuPy+ as 1.506 x 10^-10 m2/s.",
            source_page=1,
            source_bbox=json.dumps(stale_group_bbox),
            source="Table II",
            system_name="Graphene slit pore",
            ionic_liquid="[BuPy][NTf2]",
            d_total=150.6,
            d_cation=None,
            d_anion=None,
            d_unit="10⁻¹² m²/s",
        ),
        candidate_id=29,
    )

    assert payload["page"] == 1
    assert payload["bbox"] != stale_group_bbox
    assert "1.506" in extraction._extract_text_from_bbox(str(pdf_path), payload["page"], payload["bbox"])


def test_diffusion_table_locator_matches_pdf_reported_10e_minus_13_values(tmp_path: Path, monkeypatch):
    pdf_path = tmp_path / "diffusion-table-10e-13.pdf"
    doc = fitz.open()
    page = doc.new_page(width=594, height=792)
    page.insert_text((44, 638), "Table 1", fontsize=9)
    page.insert_text((44, 682), "Diffusion coefficients (1 x 10-13 m2/s) of Cations and Anions", fontsize=9)
    page.insert_text((44, 710), "System D[cation] D[anion]", fontsize=9)
    page.insert_text((44, 728), "2 nm 0.65 +/- 0.01 0.17 +/- 0.02", fontsize=9)
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setattr(extraction, "_resolve_existing_path", lambda _path: str(pdf_path))

    payload = extraction._build_diffusion_candidate_pdf_evidence_payload(
        SimpleNamespace(file_path=str(pdf_path)),
        SimpleNamespace(
            evidence="Table 1 reports D_cation = 0.65 x 10^-13 m2/s and D_anion = 0.17 x 10^-13 m2/s.",
            source_page=1,
            source_bbox=None,
            source="Table 1",
            system_name="Graphene oxide membrane",
            ionic_liquid="[BMIM][PF6]",
            d_total=None,
            d_cation=0.065,
            d_anion=0.017,
            d_unit="10⁻¹² m²/s",
        ),
        candidate_id=20,
    )

    assert payload["page"] == 1
    assert payload["bbox"]
    located_text = extraction._extract_text_from_bbox(str(pdf_path), payload["page"], payload["bbox"])
    assert "0.65" in located_text
    assert "0.17" in located_text


def test_diffusion_table_locator_keeps_duplicate_cation_anion_cells(tmp_path: Path, monkeypatch):
    pdf_path = tmp_path / "diffusion-table-duplicate-values.pdf"
    doc = fitz.open()
    page = doc.new_page(width=594, height=792)
    page.insert_text((44, 92), "TABLE II. Total and layer-wise diffusion coefficients", fontsize=9)
    page.insert_text((44, 118), "d (nm) D+tot D-tot", fontsize=9)
    page.insert_text((44, 238), "1.65 0.215 0.215 0.201 0.214", fontsize=9)
    doc.save(pdf_path)
    doc.close()

    row_bbox = [44.0, 232.0, 250.0, 250.0]
    monkeypatch.setattr(extraction, "_resolve_existing_path", lambda _path: str(pdf_path))

    payload = extraction._build_diffusion_candidate_pdf_evidence_payload(
        SimpleNamespace(file_path=str(pdf_path)),
        SimpleNamespace(
            evidence="Table II reports D+tot = 0.215 and D-tot = 0.215 x 10^-10 m2/s.",
            source_page=1,
            source_bbox=json.dumps(row_bbox),
            source="Table II",
            system_name="Graphene slit pore",
            ionic_liquid="[BuPy][NTf2]",
            d_total=None,
            d_cation=21.5,
            d_anion=21.5,
            d_unit="10⁻¹² m²/s",
        ),
        candidate_id=34,
    )

    located_text = extraction._extract_text_from_bbox(str(pdf_path), payload["page"], payload["bbox"])
    assert located_text.count("0.215") >= 2


def test_layerwise_diffusion_table_locator_prefers_whole_table_bbox(tmp_path: Path, monkeypatch):
    pdf_path = tmp_path / "diffusion-layerwise-whole-table.pdf"
    doc = fitz.open()
    page = doc.new_page(width=594, height=792)
    page.insert_text((44, 92), "TABLE II. Total and layer-wise diffusion coefficients", fontsize=9)
    page.insert_text((44, 118), "d (nm) D+tot D-tot", fontsize=9)
    page.insert_text((44, 148), "Polarizable surface", fontsize=9)
    page.insert_text((44, 166), "4.09 1.506 1.176", fontsize=9)
    page.insert_text((44, 178), "2.36 0.958 0.982", fontsize=9)
    doc.save(pdf_path)
    doc.close()

    table_bbox = [44.0, 86.0, 360.0, 188.0]
    row_bbox = [44.0, 160.0, 170.0, 174.0]
    monkeypatch.setattr(extraction, "_resolve_existing_path", lambda _path: str(pdf_path))

    payload = extraction._build_diffusion_candidate_pdf_evidence_payload(
        SimpleNamespace(file_path=str(pdf_path)),
        SimpleNamespace(
            evidence="Table II reports D+tot = 1.506 and D-tot = 1.176 x 10^-10 m2/s.",
            source_page=1,
            source_bbox=json.dumps(table_bbox),
            source="Table II",
            system_name="Graphene slit pore",
            ionic_liquid="[BuPy][NTf2]",
            d_total=None,
            d_cation=150.6,
            d_anion=117.6,
            d_unit="10⁻¹² m²/s",
            novel_features_json=json.dumps({
                "table_parser": "layerwise_diffusion.v1",
                "source_table_bbox": table_bbox,
                "source_row_bbox": row_bbox,
            }),
        ),
        candidate_id=35,
    )

    assert payload["bbox"] == table_bbox
    located_text = extraction._extract_text_from_bbox(str(pdf_path), payload["page"], payload["bbox"])
    assert "TABLE II" in located_text
    assert "1.506" in located_text
    assert "0.982" in located_text

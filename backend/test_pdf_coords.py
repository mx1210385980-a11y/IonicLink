from pathlib import Path

import fitz

from utils.pdf_coords import find_text_coordinates


def test_find_text_coordinates_avoids_substring_hit_inside_larger_word(tmp_path: Path):
    pdf_path = tmp_path / "mica_trace.pdf"
    doc = fitz.open()
    page = doc.new_page(width=900, height=200)
    page.insert_text(
        (40, 72),
        (
            "Figure 2 caption states friction-force measurements at normal load ranging from 15 to 75 nN. "
            "The main text identifies the contact as an atomically flat mica surface and a smooth silica colloid."
        ),
        fontsize=12,
    )
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(str(pdf_path), [{"id": "mica", "queries": ["mica"]}])

    assert len(hits) == 1
    assert hits[0]["matched_text"] == "mica"


def test_find_text_coordinates_prefers_pages_near_page_hint(tmp_path: Path):
    pdf_path = tmp_path / "nearby_page_preference.pdf"
    doc = fitz.open()
    page1 = doc.new_page(width=700, height=200)
    page1.insert_text((40, 72), "Page one mentions mica in a distant section.", fontsize=12)
    page2 = doc.new_page(width=700, height=200)
    page2.insert_text((40, 72), "Page two has unrelated content.", fontsize=12)
    page3 = doc.new_page(width=700, height=200)
    page3.insert_text((40, 72), "Page three contains the nearby mica evidence.", fontsize=12)
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "mica", "queries": ["mica"], "page_hint": 3, "restrict_to_page_hint": False}],
    )

    assert len(hits) == 1
    assert hits[0]["page"] == 3
    assert hits[0]["matched_text"] == "mica"


def test_find_text_coordinates_rejects_numeric_match_without_required_unit(tmp_path: Path):
    pdf_path = tmp_path / "numeric_unit_guard.pdf"
    doc = fitz.open()
    page = doc.new_page(width=900, height=200)
    page.insert_text((40, 72), "Axis ticks show 0.3 3 30 300 but no temperature unit.", fontsize=12)
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(str(pdf_path), [{"id": "temp", "queries": ["298.15 K"]}])

    assert len(hits) == 1
    assert hits[0]["matched_text"] is None


def test_find_text_coordinates_rejects_cof_numeric_hit_in_roughness_context(tmp_path: Path):
    pdf_path = tmp_path / "roughness_not_cof.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=220)
    page.insert_text(
        (40, 72),
        "The slip length increases as the surface roughness increases from 0.1 to 4.9 nm.",
        fontsize=12,
    )
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "cof", "queries": ["0.1"], "semantic_type": "cof"}],
    )

    assert len(hits) == 1
    assert hits[0]["matched_text"] is None


def test_find_text_coordinates_keeps_cof_numeric_hit_when_context_mentions_mu(tmp_path: Path):
    pdf_path = tmp_path / "cof_numeric_context.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=220)
    page.insert_text((40, 72), "Table 2 Friction coefficient μ 0.10 for the dry condition.", fontsize=12)
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "cof", "queries": ["0.10"], "semantic_type": "cof"}],
    )

    assert len(hits) == 1
    assert hits[0]["matched_text"] == "0.10"

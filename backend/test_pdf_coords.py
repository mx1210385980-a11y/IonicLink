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


def test_find_text_coordinates_accepts_derived_speed_scan_condition_context(tmp_path: Path):
    pdf_path = tmp_path / "derived_speed_scan_conditions.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=220)
    page.insert_text(
        (40, 72),
        "The scan size was 500 nm, and scan rate was 6 Hz.",
        fontsize=12,
    )
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{
            "id": "speed",
            "queries": ["The scan size was 500 nm, and scan rate was 6 Hz."],
            "semantic_type": "speed",
        }],
    )

    assert len(hits) == 1
    assert "scan size" in (hits[0]["matched_text"] or "")


def test_find_text_coordinates_roughness_alias_rejects_bare_number_before_context(tmp_path: Path):
    pdf_path = tmp_path / "roughness_alias_context.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=240)
    page.insert_text(
        (40, 72),
        "Section 2 describes calibration. The AFM tip has RMS roughness 2 nm after cleaning.",
        fontsize=12,
    )
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "rough", "queries": ["2.0"], "semantic_type": "surface_roughness"}],
    )

    assert len(hits) == 1
    assert hits[0]["matched_text"] == "2"
    assert hits[0]["x"] > 250


def test_find_text_coordinates_rejects_potential_numeric_without_voltage_context(tmp_path: Path):
    pdf_path = tmp_path / "potential_not_plain_number.pdf"
    doc = fitz.open()
    page = doc.new_page(width=900, height=200)
    page.insert_text((40, 72), "The roughness was 0.5 nm and the load was 30 nN.", fontsize=12)
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "potential", "queries": ["0.5"], "semantic_type": "potential"}],
    )

    assert len(hits) == 1
    assert hits[0]["matched_text"] is None


def test_find_text_coordinates_accepts_potential_numeric_with_voltage_context(tmp_path: Path):
    pdf_path = tmp_path / "potential_voltage_context.pdf"
    doc = fitz.open()
    page = doc.new_page(width=900, height=200)
    page.insert_text((40, 72), "Friction coefficient measured under applied potential 0.5 V.", fontsize=12)
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "potential", "queries": ["0.5"], "semantic_type": "potential"}],
    )

    assert len(hits) == 1
    assert hits[0]["matched_text"] == "0.5"


def test_find_text_coordinates_keeps_positive_potential_away_from_negative_value(tmp_path: Path):
    pdf_path = tmp_path / "potential_sign_guard.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=240)
    page.insert_text(
        (40, 72),
        "The similarity of the -1 and -2 V data is discussed. "
        "The friction coefficient is high at 0.45 (+1 V).",
        fontsize=12,
    )
    doc.save(pdf_path)
    doc.close()

    hits = find_text_coordinates(
        str(pdf_path),
        [{"id": "potential", "queries": ["+1 V"], "semantic_type": "potential"}],
    )

    assert len(hits) == 1
    assert "+" in (hits[0]["matched_text"] or "")


def test_find_text_coordinates_tightly_matches_pdf_encoded_signed_potentials(tmp_path: Path):
    pdf_path = tmp_path / "encoded_potential_signs.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=240)
    page.insert_text(
        (40, 72),
        (
            "Small forces: 0.20 for \x031 V and 0.19 for \x032 V. "
            "High at 0.45 ( þ 1 V) and 0.59 ( þ 1:5 V)."
        ),
        fontsize=12,
    )
    doc.save(pdf_path)
    doc.close()

    minus_two = find_text_coordinates(
        str(pdf_path),
        [{"id": "potential", "queries": ["-2 V"], "semantic_type": "potential"}],
    )[0]
    plus_one = find_text_coordinates(
        str(pdf_path),
        [{"id": "potential", "queries": ["+1 V"], "semantic_type": "potential"}],
    )[0]
    plus_one_point_five = find_text_coordinates(
        str(pdf_path),
        [{"id": "potential", "queries": ["+1.5 V"], "semantic_type": "potential"}],
    )[0]

    assert minus_two["matched_text"].startswith("-2")
    assert minus_two["w"] < 35
    assert "þ 1 V" in plus_one["matched_text"]
    assert "1:5 V" in plus_one_point_five["matched_text"]

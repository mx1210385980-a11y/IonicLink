from utils.pdf_utils import repair_pdf_text_unit_artifacts
from utils.pdf_utils import extract_pdf_plain_text_pages


def test_extract_pdf_plain_text_pages_repairs_text_layer_units(tmp_path):
    import fitz

    pdf_path = tmp_path / "afm-unit-artifact.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(
        (72, 72),
        "Colloid probe AFM lateral force normal force nN sliding speeds 2 mm s-1 and 20 mm s-1.",
        fontsize=8,
    )
    doc.save(pdf_path)
    doc.close()

    page_count, text = extract_pdf_plain_text_pages(str(pdf_path))

    assert page_count == 1
    assert "Page 1" in text
    assert "2 μm s−1" in text
    assert "20 μm s−1" in text
    assert "mm s-1" not in text


def test_repair_pdf_text_unit_artifacts_recovers_afm_micro_sliding_speed():
    text = """
    Colloid probe atomic force microscopy (AFM) was used to measure lateral force
    versus normal force (nN). Table 2 lists friction coefficients at a sliding speed
    of 2 mm s1. Table 3 gives 2 mm s−1, 6 mm s−1, 12 mm s−1 and 20 mm s−1.
    """

    repaired = repair_pdf_text_unit_artifacts(text)

    assert "2 μm s−1" in repaired
    assert "6 μm s−1" in repaired
    assert "12 μm s−1" in repaired
    assert "20 μm s−1" in repaired
    assert "mm s" not in repaired


def test_repair_pdf_text_unit_artifacts_keeps_macro_mm_per_second():
    text = """
    A pin-on-disk tribometer was used at a normal load of 5 N.
    The sliding speed was 10 mm/s for the steel ball-on-flat contact.
    AFM was only used later to measure surface roughness.
    """

    assert repair_pdf_text_unit_artifacts(text) == text

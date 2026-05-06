from types import SimpleNamespace

from services.file_service import _archive_completed_literature_pdf


def test_archive_completed_literature_pdf_moves_managed_temp_upload(tmp_path, monkeypatch):
    monkeypatch.setattr("services.file_service._workspace_root", lambda: str(tmp_path))

    source_dir = tmp_path / "temp_uploads" / "pdfs"
    source_dir.mkdir(parents=True)
    source_pdf = source_dir / "7.pdf"
    source_pdf.write_bytes(b"%PDF-1.4\nfake pdf\n")

    literature = SimpleNamespace(
        id=7,
        title="Ionic Liquid Lubrication of Stainless Steel: Friction is Inversely Correlated",
        authors="Atkin R.; Example B.",
        year=2017,
        file_path=str(source_pdf),
        file_hash=None,
    )

    archived_path = _archive_completed_literature_pdf(literature, str(source_pdf))

    assert archived_path == (
        "Reference/Extracted/"
        "2017-atkin-Ionic Liquid Lubrication of Stainless Steel Friction is Inversely Correlated.pdf"
    )
    assert literature.file_path == archived_path
    assert literature.file_hash
    assert not source_pdf.exists()
    assert (tmp_path / archived_path).exists()


def test_archive_completed_literature_pdf_prefers_matching_reference_filename(tmp_path, monkeypatch):
    monkeypatch.setattr("services.file_service._workspace_root", lambda: str(tmp_path))

    source_dir = tmp_path / "temp_uploads" / "pdfs"
    source_dir.mkdir(parents=True)
    source_pdf = source_dir / "7.pdf"
    pdf_bytes = b"%PDF-1.4\nsame paper\n"
    source_pdf.write_bytes(pdf_bytes)

    reference_pdf = tmp_path / "Reference" / "2017-atkin-Original Library Name.pdf"
    reference_pdf.parent.mkdir(parents=True)
    reference_pdf.write_bytes(pdf_bytes)

    literature = SimpleNamespace(
        id=7,
        title="Ionic Liquid Lubrication of Stainless Steel",
        authors="Peter K. Cooper; Rob Atkin",
        year=2017,
        file_path=str(source_pdf),
        file_hash=None,
    )

    archived_path = _archive_completed_literature_pdf(literature, str(source_pdf))

    assert archived_path == "Reference/Extracted/2017-atkin-Original Library Name.pdf"
    assert not source_pdf.exists()
    assert reference_pdf.exists()
    assert (tmp_path / archived_path).exists()


def test_archive_completed_literature_pdf_keeps_existing_extracted_pdf(tmp_path, monkeypatch):
    monkeypatch.setattr("services.file_service._workspace_root", lambda: str(tmp_path))

    extracted_dir = tmp_path / "Reference" / "Extracted"
    extracted_dir.mkdir(parents=True)
    source_pdf = extracted_dir / "already-archived.pdf"
    source_pdf.write_bytes(b"%PDF-1.4\nfake pdf\n")

    literature = SimpleNamespace(
        id=8,
        title="Already Archived",
        authors="",
        year=2024,
        file_path=str(source_pdf),
        file_hash=None,
    )

    archived_path = _archive_completed_literature_pdf(literature, str(source_pdf))

    assert archived_path == "Reference/Extracted/already-archived.pdf"
    assert literature.file_path == archived_path
    assert source_pdf.exists()

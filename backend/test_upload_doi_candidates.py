from io import BytesIO

import pytest
from fastapi import UploadFile

from models.db_models import Literature, ResearchGroup, User
from security import AuthPrincipal, RequestScope
from services.doi_service import DOIMetadata, DOIService
from services.file_service import _clean_upload_metadata, _extract_doi_candidates, _resolve_upload_metadata, save_upload_entry


def test_upload_doi_candidates_prefer_front_matter_spaced_doi():
    text = """
Article
Ionic Liquid Lubrication of Stainless Steel
DOI: 10.1021/ acssuschemeng.7b03262

""" + ("body text\n" * 1600) + """
References
(1) Ionic liquid nanotribology. DOI: 10.1039/c1cp23134k.
"""

    assert _extract_doi_candidates(text, "paper.pdf") == ["10.1021/acssuschemeng.7b03262"]


def test_upload_doi_candidates_ignore_reference_only_dois():
    text = """
Article
Paper without a visible DOI

References
(1) Ionic liquid nanotribology. DOI: 10.1039/c1cp23134k.
"""

    assert _extract_doi_candidates(text, "paper.pdf") == []


def test_clean_upload_metadata_rejects_obvious_non_journal_values():
    cleaned = _clean_upload_metadata(
        {
            "journal": "Ionic Liquid Lubrication of Stainless Steel: Friction is Inversely Correlated with Interfacial Liquid Structure",
            "year": "2020",
        }
    )

    assert cleaned == {"year": 2020}

    short_topic_pollution = _clean_upload_metadata({"journal": "Ionic liquid", "year": "2022"})
    assert short_topic_pollution == {"year": 2022}

    valid = _clean_upload_metadata({"journal": "Faraday Discussions", "year": "2017"})
    assert valid == {"journal": "Faraday Discussions", "year": 2017}


@pytest.mark.anyio
async def test_resolve_upload_metadata_uses_filename_year_when_journal_is_polluted(monkeypatch):
    def fake_fallback(_text: str):
        return {
            "title": "Boundary layer friction of solvate ionic liquids as a function of potential",
            "journal": "Peter K. Cooper +3",
        }

    monkeypatch.setattr("services.file_service.extract_metadata_fallback", fake_fallback)

    metadata = await _resolve_upload_metadata(
        "front matter without visible DOI",
        "2020-boundary-layer-friction.pdf",
        [],
    )

    assert metadata["title"].startswith("Boundary layer friction")
    assert "journal" not in metadata
    assert metadata["year"] == 2020


@pytest.mark.anyio
async def test_save_upload_entry_prefills_new_literature_from_front_matter_doi(
    db_session,
    monkeypatch,
    tmp_path,
):
    sample_text = """
Probing dynamics and ion structuring of imidazolium ionic
liquid confined at charged graphene surfaces using graphene
colloid probe AFM
Muqiu Wu, Zhongyang Dai, Fan Zhang, Faiz Ullah Shah, Enrico Gnecco, Yijun Shi,
Braham Prakash, Rong An
Cite this article: Wu MQ, Dai ZY, Zhang F, et al. Friction 2025, 13(6): 9440976.
https://doi.org/10.26599/FRICT.2025.9440976
"""

    group = ResearchGroup(name="Upload Metadata Group", slug="upload-metadata-group")
    db_session.add(group)
    await db_session.flush()
    user = User(
        username="upload-metadata-user",
        display_name="Upload Metadata User",
        password_hash="test",
        role="researcher",
        group_id=group.id,
    )
    db_session.add(user)
    await db_session.flush()

    async def fake_resolve_doi(self, doi: str):
        assert doi == "10.26599/frict.2025.9440976"
        return DOIMetadata(
            title=(
                "Probing dynamics and ion structuring of imidazolium ionic liquid "
                "confined at charged graphene surfaces using graphene colloid probe AFM"
            ),
            authors=(
                "Muqiu Wu; Zhongyang Dai; Fan Zhang; Faiz Ullah Shah; Enrico Gnecco; "
                "Yijun Shi; Braham Prakash; Rong An"
            ),
            doi=doi,
            journal="Friction",
            volume="13",
            issue="6",
            pages="9440976",
            year=2025,
            issn="2223-7690",
        )

    monkeypatch.setattr("services.file_service.TEMP_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr("services.file_service.validate_pdf_bytes", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("services.file_service.extract_pdf_text_fitz", lambda _bytes: sample_text)
    monkeypatch.setattr(DOIService, "resolve_doi", fake_resolve_doi)

    upload = UploadFile(filename="吴沐秋-2025-friction.pdf", file=BytesIO(b"%PDF-1.4\nfake"))
    principal = AuthPrincipal(user=user, group=group, personal_workspace=None)
    scope = RequestScope(scope_type="group_library", group_id=group.id, scope_key="group_library")

    literature = await save_upload_entry(db_session, upload, principal=principal, scope=scope)

    assert literature.doi == "10.26599/frict.2025.9440976"
    assert literature.title.startswith("Probing dynamics and ion structuring")
    assert literature.authors.startswith("Muqiu Wu; Zhongyang Dai")
    assert literature.journal == "Friction"
    assert literature.year == 2025
    assert literature.volume == "13"
    assert literature.issue == "6"
    assert literature.pages == "9440976"
    assert literature.issn == "2223-7690"


@pytest.mark.anyio
async def test_save_upload_entry_reuses_existing_literature_when_metadata_resolves_existing_doi(
    db_session,
    monkeypatch,
    tmp_path,
):
    group = ResearchGroup(name="Upload Dedupe Group", slug="upload-dedupe-group")
    db_session.add(group)
    await db_session.flush()
    user = User(
        username="upload-dedupe-user",
        display_name="Upload Dedupe User",
        password_hash="test",
        role="researcher",
        group_id=group.id,
    )
    db_session.add(user)
    await db_session.flush()
    existing = Literature(
        doi="10.1021/acssuschemeng.5c10210",
        title="High-Load-Triggered Nanoscale Superlubricity in Long-Chain Borate Ionic Liquids",
        authors="Muqiu Wu; Guobing Zhou; Rong An",
        journal="ACS Sustainable Chemistry & Engineering",
        year=2026,
        content="old content",
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
        created_by_user_id=user.id,
        status="completed",
    )
    db_session.add(existing)
    await db_session.commit()
    await db_session.refresh(existing)

    async def fake_resolve_upload_metadata(*_args, **_kwargs):
        return {
            "doi": "10.1021/acssuschemeng.5c10210",
            "title": existing.title,
            "authors": existing.authors,
            "journal": existing.journal,
            "year": existing.year,
        }

    monkeypatch.setattr("services.file_service.TEMP_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr("services.file_service.validate_pdf_bytes", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("services.file_service.extract_pdf_text_fitz", lambda _bytes: "Title page without DOI text")
    monkeypatch.setattr("services.file_service._extract_doi_candidates", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("services.file_service._resolve_upload_metadata", fake_resolve_upload_metadata)

    upload = UploadFile(filename="2026-muqiu-high-load.pdf", file=BytesIO(b"%PDF-1.4\nfake-new-copy"))
    principal = AuthPrincipal(user=user, group=group, personal_workspace=None)
    scope = RequestScope(scope_type="group_library", group_id=group.id, scope_key="group_library")

    literature = await save_upload_entry(db_session, upload, principal=principal, scope=scope)

    assert literature.id == existing.id
    assert literature.doi == existing.doi
    assert literature.content == "Title page without DOI text"

    rows = (
        await db_session.execute(
            Literature.__table__.select().where(Literature.doi == "10.1021/acssuschemeng.5c10210")
        )
    ).all()
    assert len(rows) == 1

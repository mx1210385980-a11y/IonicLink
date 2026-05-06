from services.file_service import _extract_doi_candidates


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

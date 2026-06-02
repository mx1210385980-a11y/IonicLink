from datetime import datetime

from schemas import LiteratureWithRecords


def test_literature_detail_schema_allows_review_candidates_with_missing_probe_material():
    payload = {
        "id": 124,
        "title": "Candidate detail",
        "doi": "10.0000/detail",
        "authors": "",
        "journal": "",
        "year": 2026,
        "status": "completed",
        "uploadedAt": datetime.now(),
        "created_at": datetime.now(),
        "updatedAt": datetime.now(),
        "tribologyData": [
            {
                "id": 403,
                "literatureId": 124,
                "materialName": "Graphene",
                "lubricant": "[BMIM][BF4]",
                "probeMaterial": None,
                "probeGeometry": "Tip",
                "cofRaw": "0.08",
                "confidence": 0.52,
                "extractedAt": datetime.now(),
                "reviewStatus": "needs_review",
                "recordOrigin": "weak_candidate",
            }
        ],
    }

    detail = LiteratureWithRecords(**payload)

    assert detail.tribology_data[0].probe_geometry == "Tip"
    assert detail.tribology_data[0].probe_material is None

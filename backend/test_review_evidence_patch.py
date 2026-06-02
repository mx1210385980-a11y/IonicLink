from types import SimpleNamespace

from routers.extraction import ReviewFieldEvidencePatchPayload, _apply_review_field_evidence_patch


def test_apply_review_field_evidence_patch_replaces_location_and_confirms_field():
    record = SimpleNamespace(
        id=7,
        confidence=0.81,
        field_evidence_json={
            "d_anion": {
                "value": "5.50",
                "evidence": {"page": 4, "bbox": [1, 2, 3, 4], "matched_text": "5.50"},
                "review_state": "flagged",
            }
        },
    )
    payload = ReviewFieldEvidencePatchPayload(
        page=5,
        bbox=[120.0, 200.0, 260.0, 218.0],
        matched_text="MPIL_ethyl (5.50 ± 1.20) × 10−1 Å² ps−1",
        quote="Table 3 reports MPIL_ethyl (5.50 ± 1.20) × 10−1 Å² ps−1.",
    )

    field_map = _apply_review_field_evidence_patch(
        record,
        "d_anion",
        payload,
        value_getter=lambda _record, _key: "5.50",
    )

    entry = field_map["d_anion"]
    assert entry["review_state"] == "confirmed"
    assert entry["grounding_mode"] == "explicit"
    assert entry["evidence"]["source_type"] == "manual_review"
    assert entry["evidence"]["page"] == 5
    assert entry["evidence"]["bbox"] == [120.0, 200.0, 260.0, 218.0]
    assert entry["evidence"]["matched_text"] == "MPIL_ethyl (5.50 ± 1.20) × 10−1 Å² ps−1"

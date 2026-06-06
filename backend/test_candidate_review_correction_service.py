import json

import pytest

from models.db_models import Literature, RecordCandidate
from services.record_correction_service import apply_tribology_candidate_correction


@pytest.mark.anyio
async def test_candidate_correction_updates_review_fields_and_clears_flags(db_session):
    literature = Literature(
        doi="10.0000/candidate-review-correction",
        title="Candidate correction",
        authors="Review Tester",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        lubricant="[BMIM] BF4",
        probe_material="substrate leaked here",
        substrate_material=None,
        cof_raw="0.08",
        field_evidence_json=json.dumps(
            {
                "probe_material": {"value": "substrate leaked here", "review_state": "flagged"},
                "substrate_material": {"value": None, "review_state": "flagged"},
            }
        ),
        review_status="flagged",
    )
    db_session.add(candidate)
    await db_session.flush()

    result = await apply_tribology_candidate_correction(
        db_session,
        candidate.id,
        {
            "probe_material": "Si3N4 tip",
            "substrate_material": "mica",
        },
    )

    assert result.committed is True
    assert result.candidate_id == candidate.id
    assert result.field_diff["probe_material"] == {
        "before": "substrate leaked here",
        "after": "Si3N4 tip",
    }

    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.probe_material == "Si3N4 tip"
    assert refreshed.substrate_material == "mica"
    field_map = json.loads(refreshed.field_evidence_json)
    assert field_map["probe_material"]["value"] == "Si3N4 tip"
    assert field_map["probe_material"]["review_state"] is None
    assert field_map["substrate_material"]["value"] == "mica"
    assert field_map["substrate_material"]["review_state"] is None


@pytest.mark.anyio
async def test_candidate_correction_rejects_non_review_fields(db_session):
    literature = Literature(
        doi="10.0000/candidate-review-guard",
        title="Guard",
        authors="Review Tester",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        lubricant="[BMIM] BF4",
    )
    db_session.add(candidate)
    await db_session.flush()

    with pytest.raises(ValueError, match="non-correctable"):
        await apply_tribology_candidate_correction(
            db_session,
            candidate.id,
            {"promoted_record_id": 123},
        )

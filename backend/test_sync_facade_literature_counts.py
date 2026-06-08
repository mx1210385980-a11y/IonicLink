import pytest

from models.db_models import Literature, RecordCandidate, ResearchGroup, TribologyData
from security import RequestScope
from services.sync_facade_service import list_literature_payload


@pytest.mark.anyio
async def test_literature_payload_counts_only_unpromoted_unrejected_candidates(db_session):
    group = ResearchGroup(name="Library Counts", slug="library-counts")
    db_session.add(group)
    await db_session.flush()

    literature = Literature(
        doi="10.0000/library-counts",
        title="Library candidate counts",
        authors="Count Tester",
        journal="Test Journal",
        year=2026,
        group_id=group.id,
    )
    db_session.add(literature)
    await db_session.flush()

    promoted_record = TribologyData(
        literature_id=literature.id,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        review_status="approved",
    )
    db_session.add(promoted_record)
    await db_session.flush()

    def candidate(**kwargs):
        return RecordCandidate(
            literature_id=literature.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_raw="0.08",
            field_evidence_json="{}",
            review_status=kwargs.get("review_status", "needs_review"),
            promoted_record_id=kwargs.get("promoted_record_id"),
        )

    db_session.add_all([
        candidate(),
        candidate(review_status="rejected"),
        candidate(promoted_record_id=promoted_record.id, review_status="approved"),
    ])
    await db_session.flush()

    scope = RequestScope(scope_type="group_library", group_id=group.id, scope_key="group_library")

    payload = await list_literature_payload(db_session, scope=scope)

    paper = next(item for item in payload if item["id"] == literature.id)
    assert paper["candidateCount"] == 1
    assert paper["tribologyCandidateCount"] == 1
    assert paper["recordCount"] == 1
    assert paper["tribologyRecordCount"] == 1

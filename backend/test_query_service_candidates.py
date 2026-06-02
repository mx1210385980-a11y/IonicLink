import pytest

from models.db_models import Literature, RecordCandidate, TribologyData
from routers.data_explorer import SearchFilter
from services.query_service import search_records


@pytest.mark.anyio
async def test_search_records_includes_unpromoted_tribology_candidates(db_session):
    literature = Literature(
        doi="10.0000/candidate-search",
        title="Candidate search",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    final_record = TribologyData(
        literature_id=literature.id,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        review_status="approved",
        confidence=0.92,
    )
    db_session.add(final_record)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Graphite",
        lubricant="[EMIM][TFSI]",
        cof_value=0.03,
        cof_raw="0.03",
        field_evidence_json="{}",
        review_status="needs_review",
        record_origin="weak_candidate",
        confidence=0.52,
    )
    db_session.add(candidate)
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id)),
        skip=0,
        limit=20,
    )

    assert result["total"] == 2
    candidate_payload = next(item for item in result["items"] if item["review_entity_type"] == "candidate")
    assert candidate_payload["entity_type"] == "candidate"
    assert candidate_payload["entity_id"] == candidate.id
    assert candidate_payload["record_origin"] == "weak_candidate"
    assert candidate_payload["confidence_tier"] == "low"
    assert candidate_payload["material_name"] == "Graphite"


@pytest.mark.anyio
async def test_search_records_lists_latest_candidates_before_final_records(db_session):
    literature = Literature(
        doi="10.0000/candidate-first-search",
        title="Candidate first search",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    final_record = TribologyData(
        literature_id=literature.id,
        material_name="Final mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        review_status="approved",
        confidence=0.92,
    )
    old_candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Older candidate",
        lubricant="[EMIM][TFSI]",
        cof_value=0.03,
        cof_raw="0.03",
        field_evidence_json="{}",
        review_status="needs_review",
        record_origin="weak_candidate",
        confidence=0.52,
    )
    db_session.add_all([final_record, old_candidate])
    await db_session.flush()

    latest_candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Latest candidate",
        lubricant="[HMIM][PF6]",
        cof_value=0.05,
        cof_raw="0.05",
        field_evidence_json="{}",
        review_status="needs_review",
        record_origin="weak_candidate",
        confidence=0.61,
    )
    db_session.add(latest_candidate)
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id)),
        skip=0,
        limit=20,
    )

    assert [item["review_entity_type"] for item in result["items"]] == ["candidate", "candidate", "record"]
    assert [item["material_name"] for item in result["items"]] == ["Latest candidate", "Older candidate", "Final mica"]


@pytest.mark.anyio
async def test_search_records_excludes_promoted_tribology_candidates(db_session):
    literature = Literature(
        doi="10.0000/promoted-candidate-search",
        title="Promoted candidate search",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    final_record = TribologyData(
        literature_id=literature.id,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        review_status="approved",
        confidence=0.92,
    )
    db_session.add(final_record)
    await db_session.flush()

    db_session.add(
        RecordCandidate(
            literature_id=literature.id,
            promoted_record_id=final_record.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_value=0.18,
            cof_raw="0.18",
            field_evidence_json="{}",
            review_status="approved",
            record_origin="review_promoted_candidate",
            confidence=0.92,
        )
    )
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id)),
        skip=0,
        limit=20,
    )

    assert result["total"] == 1
    assert result["items"][0]["review_entity_type"] == "record"

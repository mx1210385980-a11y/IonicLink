import json

import pytest

from models.db_models import Literature, RecordCandidate, TribologyData
from routers.data_explorer import RecordResponse, SearchFilter
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
        evidence="Figure reports COF = 0.18.",
        source_page=4,
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
    # extracted_at rides along on the payload so the queue can triage by staleness.
    assert candidate_payload["extracted_at"]
    assert candidate_payload["extracted_at"] == candidate.extracted_at.isoformat()


@pytest.mark.anyio
async def test_search_records_accepts_multiple_literature_ids_for_merged_review_sources(db_session):
    lit_a = Literature(
        doi="10.0000/merged-source-a",
        title="Merged source A",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    lit_b = Literature(
        doi="10.0000/merged-source-b",
        title="Merged source B",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add_all([lit_a, lit_b])
    await db_session.flush()

    db_session.add_all([
        RecordCandidate(
            literature_id=lit_a.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_value=0.11,
            field_evidence_json="{}",
            review_status="needs_review",
            record_origin="weak_candidate",
        ),
        RecordCandidate(
            literature_id=lit_b.id,
            material_name="Silica",
            lubricant="[EMIM][TFSI]",
            cof_value=0.22,
            field_evidence_json="{}",
            review_status="needs_review",
            record_origin="weak_candidate",
        ),
    ])
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=f"{lit_a.id},{lit_b.id}", entityType="candidate"),
        skip=0,
        limit=20,
    )

    assert result["total"] == 2
    assert {item["literature_id"] for item in result["items"]} == {lit_a.id, lit_b.id}


@pytest.mark.anyio
async def test_search_records_deduplicates_equivalent_candidates_from_merged_sources(db_session):
    lit_a = Literature(
        doi="10.0000/merged-duplicate-a",
        title="Merged duplicate source",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    lit_b = Literature(
        doi="10.0000/merged-duplicate-b",
        title="Merged duplicate source",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add_all([lit_a, lit_b])
    await db_session.flush()

    shared = {
        "material_name": "Silicon nitride",
        "lubricant": "[Li(G4)][NO3]",
        "cof_value": 1.0,
        "cof_raw": "1.0",
        "load_value": "8-50 nN",
        "speed_value": "0.06 μm/s",
        "temperature": "298.15 K",
        "probe_material": "Silicon nitride",
        "substrate_material": "Au(111)",
        "field_evidence_json": "{}",
        "review_status": "needs_review",
        "record_origin": "weak_candidate",
    }
    db_session.add_all([
        RecordCandidate(literature_id=lit_a.id, **shared),
        RecordCandidate(literature_id=lit_b.id, **shared),
        RecordCandidate(
            literature_id=lit_b.id,
            **{
                **shared,
                "cof_value": 0.24,
                "cof_raw": "0.24",
            },
        ),
    ])
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=f"{lit_a.id},{lit_b.id}", entityType="candidate"),
        skip=0,
        limit=20,
    )

    assert result["total"] == 2
    assert sorted(item["cof_value"] for item in result["items"]) == [0.24, 1.0]


@pytest.mark.anyio
async def test_search_records_includes_final_record_evidence_quality(db_session):
    literature = Literature(
        doi="10.0000/final-evidence-quality",
        title="Final evidence quality",
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
        evidence="Figure reports COF = 0.18 for [BMIM][BF4] on mica.",
        source_page=4,
        review_status="approved",
        confidence=0.92,
        field_evidence_json=json.dumps(
            {
                "material": {"value": "Mica", "evidence": {"page": 4, "quote": "mica"}},
                "ionic_liquid": {"value": "[BMIM][BF4]", "evidence": {"page": 4, "quote": "[BMIM][BF4]"}},
                "cof": {"value": "0.18", "evidence": {"page": 4, "quote": "COF = 0.18"}},
            }
        ),
    )
    db_session.add(final_record)
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id)),
        skip=0,
        limit=20,
    )

    payload = result["items"][0]
    assert payload["review_entity_type"] == "record"
    assert payload["evidence_score"] >= 0.65
    assert payload["evidence_grade"] in {"adequate", "strong"}
    response_model = RecordResponse(**payload)
    assert response_model.evidence_score == payload["evidence_score"]
    assert response_model.evidence_grade == payload["evidence_grade"]


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
        evidence="Figure reports COF = 0.18.",
        source_page=4,
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
        evidence="Figure reports COF = 0.18.",
        source_page=4,
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


@pytest.mark.anyio
async def test_search_records_can_filter_official_records_and_review_candidates(db_session):
    literature = Literature(
        doi="10.0000/entity-filter-search",
        title="Entity filter search",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    final_record = TribologyData(
        literature_id=literature.id,
        material_name="Official mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        evidence="Figure reports COF = 0.18.",
        source_page=4,
        review_status="approved",
        confidence=0.92,
    )
    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Review graphite",
        lubricant="[EMIM][TFSI]",
        cof_value=0.03,
        cof_raw="0.03",
        field_evidence_json="{}",
        review_status="needs_review",
        record_origin="weak_candidate",
        confidence=0.52,
    )
    db_session.add_all([final_record, candidate])
    await db_session.flush()

    official_result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="record"),
        skip=0,
        limit=20,
    )
    review_result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="candidate"),
        skip=0,
        limit=20,
    )

    assert official_result["total"] == 1
    assert official_result["items"][0]["review_entity_type"] == "record"
    assert official_result["items"][0]["material_name"] == "Official mica"

    assert review_result["total"] == 1
    assert review_result["items"][0]["review_entity_type"] == "candidate"
    assert review_result["items"][0]["material_name"] == "Review graphite"


@pytest.mark.anyio
async def test_search_records_record_filter_excludes_untrusted_final_records(db_session):
    literature = Literature(
        doi="10.0000/untrusted-final-record",
        title="Untrusted final record",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    approved = TribologyData(
        literature_id=literature.id,
        material_name="Approved mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        evidence="Figure reports COF = 0.18.",
        source_page=4,
        review_status="approved",
        confidence=0.92,
    )
    legacy_unset = TribologyData(
        literature_id=literature.id,
        material_name="Legacy unset status",
        lubricant="[EMIM][TFSI]",
        cof_value=0.08,
        cof_raw="0.08",
        evidence="Legacy paper reports COF = 0.08.",
        source_page=5,
        review_status=None,
        confidence=0.82,
    )
    pending = TribologyData(
        literature_id=literature.id,
        material_name="Pending suspicious row",
        lubricant="[HMIM][PF6]",
        cof_value=3.4,
        cof_raw="3.4",
        review_status="pending_review",
        confidence=0.2,
    )
    rejected = TribologyData(
        literature_id=literature.id,
        material_name="Rejected row",
        lubricant="[OMIM][BF4]",
        cof_value=2.8,
        cof_raw="2.8",
        review_status="rejected",
        confidence=0.1,
    )
    db_session.add_all([approved, legacy_unset, pending, rejected])
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="record"),
        skip=0,
        limit=20,
    )

    assert result["total"] == 2
    assert {item["material_name"] for item in result["items"]} == {"Approved mica", "Legacy unset status"}


@pytest.mark.anyio
async def test_search_records_record_filter_excludes_approved_records_without_evidence_locator(db_session):
    literature = Literature(
        doi="10.0000/unlocated-approved-final-record",
        title="Unlocated approved final record",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    located = TribologyData(
        literature_id=literature.id,
        material_name="Located official record",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        evidence="Figure caption reports COF = 0.18.",
        source_page=4,
        review_status="approved",
        confidence=0.92,
    )
    unlocated = TribologyData(
        literature_id=literature.id,
        material_name="Unlocated official record",
        lubricant="[EMIM][TFSI]",
        cof_value=0.08,
        cof_raw="0.08",
        evidence="Text says the COF was 0.08, but no page locator was stored.",
        review_status="approved",
        confidence=0.82,
    )
    db_session.add_all([located, unlocated])
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="record"),
        skip=0,
        limit=20,
    )

    assert result["total"] == 1
    assert result["items"][0]["material_name"] == "Located official record"


@pytest.mark.anyio
async def test_search_records_excludes_rejected_candidates(db_session):
    literature = Literature(
        doi="10.0000/rejected-candidate",
        title="Rejected candidate search",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    pending = RecordCandidate(
        literature_id=literature.id,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.10,
        cof_raw="0.10",
        field_evidence_json="{}",
        review_status="needs_review",
        confidence=0.6,
    )
    rejected = RecordCandidate(
        literature_id=literature.id,
        material_name="Graphite",
        lubricant="[EMIM][TFSI]",
        cof_value=0.03,
        cof_raw="0.03",
        field_evidence_json="{}",
        review_status="rejected",
        confidence=0.4,
    )
    db_session.add_all([pending, rejected])
    await db_session.flush()

    result = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="candidate"),
        skip=0,
        limit=20,
    )

    assert result["total"] == 1
    assert result["items"][0]["entity_id"] == pending.id
    assert all(item["entity_id"] != rejected.id for item in result["items"])


@pytest.mark.anyio
async def test_search_records_sorts_official_records_by_cof(db_session):
    literature = Literature(
        doi="10.0000/sort-by-cof",
        title="Sort by COF",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    cof_values = [0.18, 0.022, 0.083]
    for value in cof_values:
        db_session.add(
            TribologyData(
                literature_id=literature.id,
                material_name="Mica",
                lubricant="[BMIM][BF4]",
                cof_value=value,
                cof_raw=str(value),
                evidence=f"Figure reports COF = {value}.",
                source_page=4,
                review_status="approved",
                confidence=0.9,
            )
        )
    # A record with no COF should always be pushed to the end regardless of direction.
    db_session.add(
        TribologyData(
            literature_id=literature.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_value=None,
            cof_raw=None,
            evidence="No COF reported here.",
            source_page=5,
            review_status="approved",
            confidence=0.9,
        )
    )
    await db_session.flush()

    asc = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="record", sortBy="cof", sortDir="asc"),
        skip=0,
        limit=20,
    )
    asc_cof = [item["cof_value"] for item in asc["items"]]
    assert asc_cof == [0.022, 0.083, 0.18, None]

    desc = await search_records(
        db_session,
        SearchFilter(fileId=str(literature.id), entityType="record", sortBy="cof", sortDir="desc"),
        skip=0,
        limit=20,
    )
    desc_cof = [item["cof_value"] for item in desc["items"]]
    assert desc_cof == [0.18, 0.083, 0.022, None]

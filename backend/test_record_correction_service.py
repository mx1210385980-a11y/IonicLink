from __future__ import annotations

import json
from datetime import datetime

import pytest

from models.db_models import Literature, RecordCandidate, TribologyData
from services.record_correction_service import (
    RecordCorrection,
    apply_tribology_record_correction,
)


async def _seed_record_with_candidates(db_session) -> tuple[int, list[int]]:
    literature = Literature(
        doi="10.1039/c1cp23134k",
        title="EAN on mica",
        authors="Rutland et al.",
        journal="PCCP",
        year=2012,
    )
    db_session.add(literature)
    await db_session.flush()

    record = TribologyData(
        literature_id=literature.id,
        material_name="silica / EAN / mica",
        lubricant="[EA][NO3]",
        cof_value=0.20,
        cof_raw="0.20",
        confidence=0.5,
    )
    db_session.add(record)
    await db_session.flush()

    candidate_a = RecordCandidate(
        literature_id=literature.id,
        promoted_record_id=record.id,
        material_name="silica / EAN / mica",
        lubricant="[EA][NO3]",
        cof_value=0.20,
        cof_raw="0.20",
    )
    candidate_b = RecordCandidate(  # a duplicate not yet linked
        literature_id=literature.id,
        material_name="silica / EAN / mica",
        lubricant="[EA][NO3]",
        cof_value=0.20,
        cof_raw="0.20",
    )
    db_session.add_all([candidate_a, candidate_b])
    await db_session.flush()
    return record.id, [candidate_a.id, candidate_b.id]


@pytest.mark.anyio
async def test_dry_run_reports_diff_without_persisting(db_session):
    record_id, _ = await _seed_record_with_candidates(db_session)

    correction = RecordCorrection(fields={"cof_value": 0.14, "cof_raw": "0.14"})
    result = await apply_tribology_record_correction(
        db_session, record_id, correction, dry_run=True
    )

    assert result.committed is False
    assert result.record_diff["cof_value"] == {"before": 0.20, "after": 0.14}

    # Nothing persisted: a fresh read still shows the original value.
    refreshed = await db_session.get(TribologyData, record_id)
    assert refreshed.cof_value == 0.20


@pytest.mark.anyio
async def test_commit_applies_correction_and_syncs_linked_candidate(db_session):
    record_id, (candidate_a_id, _) = await _seed_record_with_candidates(db_session)

    correction = RecordCorrection(
        fields={"cof_value": 0.14, "cof_raw": "0.14", "probe_material": "Silica"},
    )
    result = await apply_tribology_record_correction(
        db_session, record_id, correction, dry_run=False
    )

    assert result.committed is True
    record = await db_session.get(TribologyData, record_id)
    assert record.cof_value == 0.14
    assert record.probe_material == "Silica"

    # The already-linked candidate is kept in sync.
    candidate = await db_session.get(RecordCandidate, candidate_a_id)
    assert candidate.cof_value == 0.14
    assert candidate.probe_material == "Silica"


@pytest.mark.anyio
async def test_link_candidate_ids_attaches_and_syncs_duplicates(db_session):
    record_id, (candidate_a_id, candidate_b_id) = await _seed_record_with_candidates(db_session)

    correction = RecordCorrection(
        fields={"cof_value": 0.14},
        link_candidate_ids=[candidate_b_id],
    )
    result = await apply_tribology_record_correction(
        db_session, record_id, correction, dry_run=False, now=datetime(2026, 6, 3)
    )

    assert set(result.candidate_ids) == {candidate_a_id, candidate_b_id}

    duplicate = await db_session.get(RecordCandidate, candidate_b_id)
    assert duplicate.promoted_record_id == record_id
    assert duplicate.promoted_at == datetime(2026, 6, 3)
    assert duplicate.cof_value == 0.14


@pytest.mark.anyio
async def test_field_evidence_patch_merges_into_existing_json(db_session):
    record_id, _ = await _seed_record_with_candidates(db_session)
    record = await db_session.get(TribologyData, record_id)
    record.field_evidence_json = json.dumps({"cof": {"value": "0.20", "confidence": 0.5}})
    await db_session.flush()

    correction = RecordCorrection(
        fields={"cof_value": 0.14},
        field_evidence_patch={"speed": {"value": "5-40 μm/s", "confidence": 0.92}},
    )
    await apply_tribology_record_correction(db_session, record_id, correction, dry_run=False)

    refreshed = await db_session.get(TribologyData, record_id)
    merged = json.loads(refreshed.field_evidence_json)
    assert merged["cof"]["value"] == "0.20"  # existing preserved
    assert merged["speed"]["value"] == "5-40 μm/s"  # patch added


@pytest.mark.anyio
async def test_json_field_accepts_dict_and_serializes(db_session):
    record_id, _ = await _seed_record_with_candidates(db_session)

    correction = RecordCorrection(
        fields={"speed_conditions_json": {"value_type": "range", "speed_min_um_s": 5}}
    )
    await apply_tribology_record_correction(db_session, record_id, correction, dry_run=False)

    record = await db_session.get(TribologyData, record_id)
    assert json.loads(record.speed_conditions_json) == {"value_type": "range", "speed_min_um_s": 5}


@pytest.mark.anyio
async def test_unknown_field_is_rejected(db_session):
    record_id, _ = await _seed_record_with_candidates(db_session)

    correction = RecordCorrection(fields={"not_a_real_column": "x"})
    with pytest.raises(ValueError, match="non-correctable"):
        await apply_tribology_record_correction(db_session, record_id, correction)


@pytest.mark.anyio
async def test_missing_record_raises(db_session):
    correction = RecordCorrection(fields={"cof_value": 0.1})
    with pytest.raises(ValueError, match="not found"):
        await apply_tribology_record_correction(db_session, 999999, correction)


@pytest.mark.anyio
async def test_confidence_fn_recomputes_and_propagates(db_session):
    record_id, (candidate_a_id, _) = await _seed_record_with_candidates(db_session)

    correction = RecordCorrection(fields={"cof_value": 0.14})
    result = await apply_tribology_record_correction(
        db_session,
        record_id,
        correction,
        dry_run=False,
        confidence_fn=lambda rec: 0.96,
    )

    assert result.confidence == 0.96
    record = await db_session.get(TribologyData, record_id)
    assert record.confidence == 0.96
    candidate = await db_session.get(RecordCandidate, candidate_a_id)
    assert candidate.confidence == 0.96

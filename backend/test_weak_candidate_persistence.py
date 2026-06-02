import json

import pytest
from sqlalchemy import func, select

import services.file_service as file_service
from models.db_models import ExtractionCandidate, ExtractionRun, Literature, RecordCandidate, TribologyData
from services.file_service import (
    _finalize_weak_candidates_for_review,
    _load_cached_extraction_result,
    _persist_weak_candidates_for_review,
)


@pytest.mark.anyio
async def test_persist_weak_candidates_marks_literature_completed_for_review(db_session):
    literature = Literature(
        doi="10.0000/weak-candidate-paper",
        title="Weak candidate paper",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    stale_candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Stale candidate",
        lubricant="[OLD][IL]",
        confidence=0.9,
    )
    stale_record = TribologyData(
        literature_id=literature.id,
        material_name="Stale record",
        lubricant="[OLD][IL]",
        confidence=0.9,
    )
    db_session.add_all([stale_candidate, stale_record])
    await db_session.flush()

    trace_candidates = [
        {
            "stage": "stage_c",
            "modality": "text",
            "page": 2,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "source_page": 2,
                "evidence": "Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
            },
            "drop_reason": "no_target_metric",
        }
    ]

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=trace_candidates,
        file_path=None,
    )

    rows = (
        await db_session.execute(
            select(RecordCandidate).where(RecordCandidate.literature_id == literature.id)
        )
    ).scalars().all()
    final_rows = (
        await db_session.execute(
            select(TribologyData).where(TribologyData.literature_id == literature.id)
        )
    ).scalars().all()

    assert literature.status == "completed"
    assert literature.error_message is None
    assert weak_summary["review_status"] == "needs_review"
    assert weak_summary["weak_candidate_count"] == 1
    assert weak_summary["candidate_count"] == 1
    assert weak_summary["final_count"] == 0
    assert len(rows) == 1
    assert final_rows == []
    assert rows[0].record_origin == "weak_candidate"
    assert rows[0].review_status == "needs_review"
    assert rows[0].confidence <= 0.52
    assert "load and sliding speed" in (rows[0].assembly_notes or "")
    assert response_rows[0]["review_status"] == "needs_review"
    assert response_rows[0]["record_origin"] == "weak_candidate"
    assert response_rows[0]["review_entity_type"] == "candidate"
    assert response_rows[0]["admission_reason"] == "weak_candidate"
    assert response_rows[0]["confidence_tier"] == "low"
    assert response_rows[0]["confidence_details"]["score"] <= 0.52
    assert response_rows[0]["confidence_details"]["band"] == "low"
    assert response_rows[0]["missing_fields"] == ["normal_load", "speed"]
    assert "load and sliding speed" in response_rows[0]["quality_notes"]


@pytest.mark.anyio
async def test_persist_weak_candidates_skips_expensive_record_level_pdf_coordinate_lookup(db_session, monkeypatch):
    literature = Literature(
        doi="10.0000/weak-candidate-fast-finalize",
        title="Weak candidate fast finalize",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    def fail_if_record_level_lookup_runs(*_args, **_kwargs):
        raise AssertionError("weak candidates should not block finalization on record-level PDF coordinate lookup")

    monkeypatch.setattr(file_service, "_try_resolve_evidence_coords", fail_if_record_level_lookup_runs)

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=[
            {
                "stage": "stage_c",
                "modality": "text",
                "page": 2,
                "normalized": {
                    "ionic_liquid": "[EMIM][TFSI]",
                    "material_name": "graphene",
                    "cof": "0.08",
                    "source_page": 2,
                    "evidence": "Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
                },
                "drop_reason": "missing_load",
            }
        ],
        file_path="/tmp/nonexistent.pdf",
    )

    assert weak_summary["weak_candidate_count"] == 1
    assert response_rows[0]["record_origin"] == "weak_candidate"


@pytest.mark.anyio
async def test_persist_weak_candidates_skips_expensive_field_level_pdf_locator(db_session, monkeypatch, tmp_path):
    literature = Literature(
        doi="10.0000/weak-candidate-no-field-locator",
        title="Weak candidate no field locator",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="Normal load was 5 nN for [EMIM][TFSI] on graphene.",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    def fail_if_field_locator_runs(*_args, **_kwargs):
        raise AssertionError("weak candidates should not run field-level PDF evidence relocation")

    pdf_path = tmp_path / "weak-candidate.pdf"
    doc = file_service.fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Normal load was 5 nN for [EMIM][TFSI] on graphene.")
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setattr(file_service, "_locate_field_evidence_for_value", fail_if_field_locator_runs)

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=[
            {
                "stage": "stage_c",
                "modality": "text",
                "page": 3,
                "normalized": {
                    "ionic_liquid": "[EMIM][TFSI]",
                    "material_name": "graphene",
                    "normal_load": "5 nN",
                    "speed": "1 μm/s",
                    "source_page": 3,
                    "evidence": "Normal load was 5 nN for [EMIM][TFSI] on graphene.",
                },
                "drop_reason": "missing_primary_metric",
            }
        ],
        file_path=str(pdf_path),
    )

    assert weak_summary["weak_candidate_count"] == 1
    assert response_rows[0]["record_origin"] == "weak_candidate"


@pytest.mark.anyio
async def test_persist_weak_candidates_normalizes_reference_marker_ionic_liquid_noise(db_session):
    literature = Literature(
        doi="10.0000/weak-candidate-il-noise",
        title="Weak candidate IL noise",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="The lubricant was 1-butyl-3-methylimidazolium tetrafluoroborate ([BMIM][BF4], BB).",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=[
            {
                "stage": "stage_c",
                "modality": "text",
                "page": 1,
                "normalized": {
                    "ionic_liquid": "[5][to]",
                    "material_name": "HOPG",
                    "cof": "0.004",
                    "potential": "2 V",
                    "source_page": 1,
                    "evidence": (
                        "The lubricant was 1-butyl-3-methylimidazolium "
                        "tetrafluoroborate ([BMIM][BF4], BB)."
                    ),
                },
                "drop_reason": "missing_load",
            }
        ],
        file_path=None,
    )

    row = (
        await db_session.execute(
            select(RecordCandidate).where(RecordCandidate.literature_id == literature.id)
        )
    ).scalar_one()

    assert weak_summary["weak_candidate_count"] == 1
    assert row.lubricant == "[BMIM][BF4]"
    assert response_rows[0]["ionic_liquid"] == "[BMIM][BF4]"


@pytest.mark.anyio
async def test_cached_weak_candidates_stay_low_confidence(db_session):
    literature = Literature(
        doi="10.0000/cached-weak-candidate-paper",
        title="Cached weak candidate paper",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=[
            {
                "stage": "stage_c",
                "modality": "text",
                "page": 2,
                "normalized": {
                    "ionic_liquid": "[EMIM][TFSI]",
                    "material_name": "graphene",
                    "cof": "0.08",
                    "normal_load": "5 nN",
                    "speed": "1 um/s",
                    "source_page": 2,
                    "evidence": "Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
                },
            }
        ],
        file_path=None,
    )

    _, cached_rows, cache_summary = await _load_cached_extraction_result(db_session, literature)

    assert len(cached_rows) == 1
    assert cached_rows[0]["record_origin"] == "weak_candidate"
    assert cached_rows[0]["review_entity_type"] == "candidate"
    assert cached_rows[0]["confidence"] <= 0.52
    assert cached_rows[0]["confidence_tier"] == "low"
    assert cached_rows[0]["confidence_details"]["score"] <= 0.52
    assert cached_rows[0]["confidence_details"]["band"] == "low"
    assert cached_rows[0]["admission_reason"] == "weak_candidate"
    assert cache_summary["final_count"] == 0
    assert cache_summary["weak_candidate_count"] == 1
    assert cache_summary["review_status"] == "needs_review"


@pytest.mark.anyio
async def test_strict_validation_dropped_records_finalize_as_weak_candidates(db_session):
    literature = Literature(
        doi="10.0000/strict-drop-weak-candidate-paper",
        title="Strict drop weak candidate paper",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="The normal load was 5 nN for [EMIM][TFSI] on graphene.",
        status="extracting",
    )
    db_session.add(literature)
    db_session.add(
        ExtractionRun(
            run_id="strict-drop-weak-run",
            literature=literature,
            extractor_type="tribology",
            profile="high_accuracy",
            status="running",
        )
    )
    await db_session.flush()

    stage_e_candidates = [
        {
            "stage": "stage_e",
            "modality": "merge",
            "page": 5,
            "raw": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "normal_load": "5 nN",
                "source_page": 5,
                "evidence": "The normal load was 5 nN for [EMIM][TFSI] on graphene.",
            },
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "normal_load": "5 nN",
                "source_page": 5,
                "evidence": "The normal load was 5 nN for [EMIM][TFSI] on graphene.",
            },
            "drop_reason": "missing_primary_metric",
            "merged_into": None,
        }
    ]

    result = await _finalize_weak_candidates_for_review(
        db_session,
        literature=literature,
        run_id="strict-drop-weak-run",
        llm_summary={"candidate_count": 5, "dropped_by_reason": {"model_filter": 2}},
        trace_candidates=[
            {
                "stage": "stage_c",
                "modality": "text",
                "page": 1,
                "raw": {"notes": "background"},
                "normalized": {"notes": "background"},
                "drop_reason": "no_core_quant_signal",
            }
        ],
        extra_candidates=stage_e_candidates,
        file_path=None,
        profile="high_accuracy",
        dropped_by_reason={"missing_primary_metric": 1},
    )

    assert result is not None
    weak_rows, extraction_summary = result
    run = (
        await db_session.execute(
            select(ExtractionRun).where(ExtractionRun.run_id == "strict-drop-weak-run")
        )
    ).scalar_one()
    candidate_trace_count = (
        await db_session.execute(
            select(func.count(ExtractionCandidate.id)).where(
                ExtractionCandidate.run_id == "strict-drop-weak-run"
            )
        )
    ).scalar_one()

    assert literature.status == "completed"
    assert len(weak_rows) == 1
    assert weak_rows[0]["review_status"] == "needs_review"
    assert weak_rows[0]["record_origin"] == "weak_candidate"
    assert weak_rows[0]["review_entity_type"] == "candidate"
    assert extraction_summary["review_status"] == "needs_review"
    assert extraction_summary["status"] == "needs_review"
    assert extraction_summary["weak_candidate_count"] == 1
    assert extraction_summary["candidate_count"] == 5
    assert extraction_summary["final_count"] == 0
    assert extraction_summary["dropped_by_reason"] == {"missing_primary_metric": 1}
    assert run.status == "completed"
    assert run.candidate_count == 5
    assert run.final_count == 0
    assert json.loads(run.summary_json)["current_stage"] == "stage_e.weak_candidates"
    assert candidate_trace_count == 2


@pytest.mark.anyio
async def test_persist_weak_candidates_returns_empty_for_true_no_data(db_session):
    literature = Literature(
        doi="10.0000/no-data-paper",
        title="No data paper",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        content="Background only.",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=[],
        file_path=None,
    )

    assert response_rows == []
    assert weak_summary == {"weak_candidate_count": 0}
    assert literature.status == "extracting"
    assert literature.error_message is None

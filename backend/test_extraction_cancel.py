import json

import pytest

from models.db_models import ExtractionRun, Literature
from services.extraction_trace_service import (
    CANCELLED_EXTRACTION_MESSAGE,
    cancel_latest_extraction_run,
    finalize_extraction_run,
    update_extraction_run_progress,
)


@pytest.mark.anyio
async def test_cancelled_extraction_run_is_not_revived_by_progress_or_finalize(db_session):
    literature = Literature(
        doi="temp-cancel-test",
        title="Cancellation Test",
        authors="",
        journal="",
        year=2026,
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    run = ExtractionRun(
        run_id="cancel-test-run",
        literature_id=literature.id,
        extractor_type="tribology",
        profile="high_accuracy",
        status="running",
        summary_json=json.dumps({"progress_log": [{"stage": "stage_c", "message": "running"}]}),
    )
    db_session.add(run)
    await db_session.flush()

    cancelled = await cancel_latest_extraction_run(
        db_session,
        literature_id=literature.id,
        extractor_type="tribology",
    )
    assert cancelled is run
    assert run.status == "cancelled"
    assert run.error_message == CANCELLED_EXTRACTION_MESSAGE

    await update_extraction_run_progress(
        db_session,
        run_id=run.run_id,
        candidate_count=12,
        summary_patch={"current_stage": "stage_d", "current_message": "should not revive"},
    )
    await finalize_extraction_run(
        db_session,
        run_id=run.run_id,
        status="completed",
        candidate_count=12,
        final_count=3,
        dropped_by_reason={},
        summary={"current_stage": "stage_e.finalize"},
    )

    assert run.status == "cancelled"
    summary = json.loads(run.summary_json or "{}")
    assert summary["current_stage"] == "cancelled"
    assert summary["dropped_by_reason"]["cancelled"] == 1

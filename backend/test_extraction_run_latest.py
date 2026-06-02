import json

import pytest

from models.db_models import ExtractionRun, Literature, RecordCandidate, ResearchGroup, User
from routers.extraction import get_latest_extraction_run_detail
from security import AuthPrincipal


@pytest.mark.anyio
async def test_latest_tribology_run_keeps_completed_run_counts_when_artifact_tables_lag(db_session):
    group = ResearchGroup(name="IonicLink", slug="ioniclink")
    user = User(
        username="admin-latest-run",
        display_name="Admin",
        password_hash="test",
        role="group_admin",
        group=group,
    )
    literature = Literature(
        doi="10.1000/latest-run-counts",
        title="Latest run counts",
        authors="Tester",
        journal="Journal",
        year=2026,
        group=group,
        created_by=user,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    db_session.add_all([group, user, literature])
    await db_session.flush()

    summary = {
        "candidate_count": 8,
        "final_count": 1,
        "progress_log": [{"stage": "stage_e.finalize", "message": "validated_records=1"}],
    }
    db_session.add(
        ExtractionRun(
            run_id="run-latest-counts",
            literature_id=literature.id,
            extractor_type="tribology",
            profile="standard",
            status="completed",
            candidate_count=8,
            final_count=1,
            summary_json=json.dumps(summary),
        )
    )
    db_session.add(
        RecordCandidate(
            literature_id=literature.id,
            material_name="Au(111)",
            lubricant="[BMIM][AOT]",
            cof_value=0.312,
            cof_raw="0.312",
        )
    )
    await db_session.commit()

    response = await get_latest_extraction_run_detail(
        literature.id,
        extractor_type="tribology",
        db=db_session,
        principal=AuthPrincipal(user=user, group=group, personal_workspace=None),
    )

    assert response["status"] == "completed"
    assert response["candidate_count"] == 8
    assert response["final_count"] == 1
    assert response["summary"]["candidate_count"] == 8
    assert response["summary"]["final_count"] == 1


@pytest.mark.anyio
async def test_latest_diffusion_run_keeps_completed_run_counts_when_artifact_tables_lag(db_session):
    group = ResearchGroup(name="IonicLink Diffusion", slug="ioniclink-diffusion")
    user = User(
        username="admin-latest-diffusion-run",
        display_name="Admin",
        password_hash="test",
        role="group_admin",
        group=group,
    )
    literature = Literature(
        doi="10.1000/latest-diffusion-run-counts",
        title="Latest diffusion run counts",
        authors="Tester",
        journal="Journal",
        year=2026,
        group=group,
        created_by=user,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    db_session.add_all([group, user, literature])
    await db_session.flush()

    summary = {
        "candidate_count": 3,
        "final_count": 2,
        "progress_log": [{"stage": "stage_e.finalize", "message": "validated_records=2"}],
    }
    db_session.add(
        ExtractionRun(
            run_id="run-latest-diffusion-counts",
            literature_id=literature.id,
            extractor_type="diffusion",
            profile="standard",
            status="completed",
            candidate_count=3,
            final_count=2,
            summary_json=json.dumps(summary),
        )
    )
    await db_session.commit()

    response = await get_latest_extraction_run_detail(
        literature.id,
        extractor_type="diffusion",
        db=db_session,
        principal=AuthPrincipal(user=user, group=group, personal_workspace=None),
    )

    assert response["status"] == "completed"
    assert response["candidate_count"] == 3
    assert response["final_count"] == 2
    assert response["summary"]["candidate_count"] == 3
    assert response["summary"]["final_count"] == 2
    assert response["summary"]["diffusion_artifacts"] == {
        "candidate_count": 3,
        "final_count": 2,
        "reviewable_count": 5,
    }

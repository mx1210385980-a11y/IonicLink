from datetime import datetime, timezone

import pytest

from models.db_models import (
    DiffusionCandidate,
    DiffusionRecord,
    Literature,
    RecordCandidate,
    ResearchGroup,
    TribologyData,
    User,
)
from routers.monitor_router import build_extraction_review_progress


@pytest.mark.anyio
async def test_build_extraction_review_progress_tracks_reviewed_library_and_candidate_backlog(db_session):
    group = ResearchGroup(name="Progress Group", slug="progress-group")
    reviewer = User(
        username="codex-reviewer",
        display_name="Codex Reviewer",
        password_hash="hash",
        role="admin",
        group=group,
    )
    db_session.add_all([group, reviewer])
    await db_session.flush()

    reviewed_at = datetime(2026, 6, 2, 8, 0, tzinfo=timezone.utc)
    earlier_reviewed_at = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)

    reviewed_lit = Literature(
        doi="10.1000/reviewed",
        title="Reviewed paper",
        authors="A",
        journal="Langmuir",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
        submission_status="approved",
        reviewed_at=reviewed_at,
        reviewed_by_user_id=reviewer.id,
        review_note="Codex reviewed.",
    )
    earlier_lit = Literature(
        doi="10.1000/earlier",
        title="Earlier paper",
        authors="B",
        journal="Friction",
        year=2025,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
        submission_status="approved",
        reviewed_at=earlier_reviewed_at,
        reviewed_by_user_id=reviewer.id,
        review_note="Codex reviewed.",
    )
    pending_lit = Literature(
        doi="10.1000/pending",
        title="Pending paper",
        authors="C",
        journal="JPCC",
        year=2024,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
        submission_status="draft",
    )
    other_group = ResearchGroup(name="Other Group", slug="other-group")
    other_lit = Literature(
        doi="10.1000/other",
        title="Other group paper",
        authors="D",
        journal="JPCC",
        year=2024,
        group=other_group,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
        submission_status="approved",
        reviewed_at=reviewed_at,
    )
    db_session.add_all([reviewed_lit, earlier_lit, pending_lit, other_group, other_lit])
    await db_session.flush()

    db_session.add_all(
        [
            TribologyData(
                literature_id=reviewed_lit.id,
                material_name="Graphite",
                lubricant="[A][B]",
                cof_value=0.1,
                cof_raw="0.1",
                review_status="approved",
                extracted_at=reviewed_at,
            ),
            TribologyData(
                literature_id=reviewed_lit.id,
                material_name="Graphite",
                lubricant="[A][C]",
                cof_value=0.2,
                cof_raw="0.2",
                review_status="flagged",
                extracted_at=reviewed_at,
            ),
            DiffusionRecord(
                literature_id=earlier_lit.id,
                system_name="Pore IL",
                ionic_liquid="[A][B]",
                d_total=1.2,
                review_status="approved",
                extracted_at=earlier_reviewed_at,
            ),
            RecordCandidate(
                literature_id=pending_lit.id,
                material_name="Mica",
                lubricant="[P][F]",
                cof_value=0.3,
                review_status="pending_review",
            ),
            DiffusionCandidate(
                literature_id=pending_lit.id,
                system_name="Pending diffusion",
                ionic_liquid="[X][Y]",
                review_status="pending_review",
            ),
            TribologyData(
                literature_id=other_lit.id,
                material_name="Other",
                lubricant="[O][G]",
                cof_value=0.4,
                cof_raw="0.4",
                review_status="approved",
            ),
        ]
    )
    await db_session.flush()

    progress = await build_extraction_review_progress(db_session, group_id=group.id)

    assert progress["summary"]["libraryLiterature"] == 3
    assert progress["summary"]["reviewedLiterature"] == 2
    assert progress["summary"]["approvedRecords"] == 2
    assert progress["summary"]["unpromotedCandidates"] == 2
    assert progress["summary"]["flaggedOrRejectedRecords"] == 1
    assert progress["summary"]["reviewCompletionRate"] == pytest.approx(0.4)
    assert progress["summary"]["reviewCompletionLabel"] == "Approved final records / review work surface"

    assert [item["date"] for item in progress["trend"]] == ["2026-06-01", "2026-06-02"]
    assert progress["trend"][0]["reviewedLiterature"] == 1
    assert progress["trend"][0]["approvedRecords"] == 1
    assert progress["trend"][1]["reviewedLiterature"] == 1
    assert progress["trend"][1]["approvedRecords"] == 1

    assert progress["recentReviewedLiterature"][0]["title"] == "Reviewed paper"
    assert progress["candidateBacklog"][0]["title"] == "Pending paper"
    assert progress["candidateBacklog"][0]["unpromotedCandidates"] == 2

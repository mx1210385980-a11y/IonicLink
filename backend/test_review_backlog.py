import pytest
from typing import get_args

from models.db_models import Literature, RecordCandidate, ResearchGroup, TribologyData, User, Workspace
from routers.data_explorer import _scope_filter_values_for_mode, review_backlog
from security import AuthPrincipal, RequestScope


async def _seed(db_session):
    group = ResearchGroup(name="Backlog Group", slug="backlog-group")
    db_session.add(group)
    await db_session.flush()
    user = User(
        username="backlog-admin",
        display_name="Backlog Admin",
        password_hash="test",
        role="group_admin",
        group_id=group.id,
    )
    db_session.add(user)

    lit_a = Literature(doi="10.0/a", title="Paper A", authors="x", journal="J", year=2025, group_id=group.id)
    lit_b = Literature(doi="10.0/b", title="Paper B", authors="x", journal="J", year=2024, group_id=group.id)
    db_session.add_all([lit_a, lit_b])
    await db_session.flush()

    def candidate(lit, **kw):
        return RecordCandidate(
            literature_id=lit.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_value=0.1,
            field_evidence_json="{}",
            review_status=kw.get("review_status", "needs_review"),
            record_origin="weak_candidate",
            promoted_record_id=kw.get("promoted_record_id"),
        )

    # Paper A: 3 pending; Paper B: 1 pending + 1 rejected + 1 promoted (excluded).
    db_session.add_all([candidate(lit_a), candidate(lit_a), candidate(lit_a)])
    db_session.add_all([
        candidate(lit_b),
        candidate(lit_b, review_status="rejected"),
    ])
    promoted_target = TribologyData(literature_id=lit_b.id, material_name="Mica", lubricant="[BMIM][BF4]", review_status="approved")
    db_session.add(promoted_target)
    await db_session.flush()
    db_session.add(candidate(lit_b, promoted_record_id=promoted_target.id))
    await db_session.flush()

    principal = AuthPrincipal(user=user, group=group, personal_workspace=None)
    return principal, lit_a, lit_b


@pytest.mark.anyio
async def test_review_backlog_counts_pending_candidates_per_paper(db_session):
    principal, lit_a, lit_b = await _seed(db_session)

    result = await review_backlog(
        scope_mode="all_visible",
        session=db_session,
        principal=principal,
        scope=None,
    )

    papers = {p["literatureId"]: p for p in result["papers"]}
    # Paper A has 3 pending, Paper B has 1 (rejected + promoted excluded).
    assert papers[lit_a.id]["pendingCount"] == 3
    assert papers[lit_b.id]["pendingCount"] == 1
    assert result["totalPending"] == 4
    assert result["paperCount"] == 2
    # Sorted by pending count descending → Paper A first.
    assert result["papers"][0]["literatureId"] == lit_a.id
    assert result["papers"][0]["title"] == "Paper A"


@pytest.mark.anyio
async def test_review_backlog_deduplicates_duplicate_literature_sources(db_session):
    principal, lit_a, _lit_b = await _seed(db_session)
    duplicate = Literature(
        doi=lit_a.doi,
        title=lit_a.title,
        authors="x",
        journal=lit_a.journal,
        year=lit_a.year,
        group_id=principal.group.id,
        scope_type="workspace",
        scope_key="workspace:1",
        workspace_id=None,
    )
    workspace = Workspace(
        group_id=principal.group.id,
        owner_user_id=principal.user.id,
        name="Personal cache",
        slug="personal-cache",
        is_personal=True,
    )
    db_session.add(workspace)
    await db_session.flush()
    duplicate.scope_key = f"workspace:{workspace.id}"
    duplicate.workspace_id = workspace.id
    db_session.add(duplicate)
    await db_session.flush()
    db_session.add_all([
        RecordCandidate(
            literature_id=duplicate.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_value=0.2,
            field_evidence_json="{}",
            review_status="needs_review",
            record_origin="weak_candidate",
        ),
        RecordCandidate(
            literature_id=duplicate.id,
            material_name="Silica",
            lubricant="[BMIM][BF4]",
            cof_value=0.3,
            field_evidence_json="{}",
            review_status="needs_review",
            record_origin="weak_candidate",
        ),
    ])
    await db_session.flush()

    result = await review_backlog(
        scope_mode="all_visible",
        session=db_session,
        principal=principal,
        scope=None,
    )

    matching = [paper for paper in result["papers"] if paper["doi"] == lit_a.doi]
    assert len(matching) == 1
    assert matching[0]["pendingCount"] == 5
    assert matching[0]["literatureIds"] == [lit_a.id, duplicate.id]
    assert result["paperCount"] == 2
    assert result["totalPending"] == 6


def test_review_backlog_scope_mode_annotation_accepts_project_scopes():
    scope_modes = set(get_args(review_backlog.__annotations__["scope_mode"]))
    helper_scope_modes = set(get_args(_scope_filter_values_for_mode.__annotations__["scope_mode"]))

    assert {"active", "group_library", "all_visible"}.issubset(scope_modes)
    assert {"active", "group_library", "all_visible"}.issubset(helper_scope_modes)


@pytest.mark.anyio
async def test_review_backlog_accepts_group_library_scope_mode(db_session):
    principal, lit_a, _lit_b = await _seed(db_session)
    scope = RequestScope(
        scope_type="group_library",
        group_id=principal.group.id,
        scope_key="group_library",
    )

    result = await review_backlog(
        scope_mode="group_library",
        session=db_session,
        principal=principal,
        scope=scope,
    )

    assert result["paperCount"] == 2
    assert result["papers"][0]["literatureId"] == lit_a.id

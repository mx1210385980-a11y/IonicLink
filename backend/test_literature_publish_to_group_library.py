from types import SimpleNamespace

import pytest
from sqlalchemy import select

from models.db_models import Literature, ResearchGroup, TribologyData, User, Workspace
from routers.collaboration_router import _publish_literature_to_group_library


@pytest.mark.anyio
async def test_publish_workspace_literature_replaces_group_library_records(db_session):
    group = ResearchGroup(name="Publish Group", slug="publish-group")
    user = User(
        username="publisher",
        display_name="Publisher",
        password_hash="hash",
        role="researcher",
        group=group,
    )
    workspace = Workspace(group=group, owner_user_id=None, name="Workspace", slug="workspace")
    db_session.add_all([group, user, workspace])
    await db_session.flush()

    target = Literature(
        doi="10.1234/publish-test",
        title="Published target",
        authors="A",
        journal="Langmuir",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    source = Literature(
        doi="10.1234/publish-test",
        title="Published target",
        authors="A",
        journal="Langmuir",
        year=2026,
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=f"workspace:{workspace.id}",
        status="completed",
    )
    db_session.add_all([target, source])
    await db_session.flush()

    db_session.add(
        TribologyData(
            literature_id=target.id,
            material_name="Old",
            lubricant="[OLD][IL]",
            cof_raw="0.9",
            cof_value=0.9,
            review_status="pending_review",
            record_origin="cached_record",
        )
    )
    db_session.add_all(
        [
            TribologyData(
                literature_id=source.id,
                material_name="Graphite",
                lubricant="[N88812][A4BMB]",
                cof_raw="0.0032",
                cof_value=0.0032,
                review_status="approved",
                record_origin="review_promoted_candidate",
            ),
            TribologyData(
                literature_id=source.id,
                material_name="Graphite",
                lubricant="[N88812][A8BMB]",
                cof_raw="0.0068",
                cof_value=0.0068,
                review_status="approved",
                record_origin="review_promoted_candidate",
            ),
        ]
    )
    await db_session.flush()

    principal = SimpleNamespace(user=user, group=group)
    result = await _publish_literature_to_group_library(db_session, source=source, principal=principal)
    await db_session.commit()

    assert result["target"].id == target.id
    assert result["copied"]["tribology"] == 2
    assert source.promoted_literature_id == target.id
    assert source.submission_status == "approved"

    rows = (
        await db_session.execute(
            select(TribologyData).where(TribologyData.literature_id == target.id).order_by(TribologyData.id)
        )
    ).scalars().all()
    assert [row.lubricant for row in rows] == ["[N88812][A4BMB]", "[N88812][A8BMB]"]
    assert {row.review_status for row in rows} == {"approved"}
    assert {row.record_origin for row in rows} == {"workspace_submission"}


@pytest.mark.anyio
async def test_publish_workspace_literature_reuses_group_record_by_title_when_doi_differs(db_session):
    group = ResearchGroup(name="Title Match Group", slug="title-match-group")
    user = User(
        username="title-publisher",
        display_name="Title Publisher",
        password_hash="hash",
        role="researcher",
        group=group,
    )
    workspace = Workspace(group=group, owner_user_id=None, name="Workspace", slug="workspace")
    db_session.add_all([group, user, workspace])
    await db_session.flush()

    target = Literature(
        doi="10.1021/acssuschemeng.5c10210",
        title="High-Load-Triggered Nanoscale Superlubricity in Long-Chain Borate Ionic Liquids",
        authors="A",
        journal="ACS Sustainable Chem. Eng.",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    source = Literature(
        doi="10.1021/acssuschemeng.5b05678",
        title="High-Load-Triggered Nanoscale Superlubricity in Long-Chain Borate Ionic Liquids",
        authors="A",
        journal="ACS Sustainable Chem. Eng.",
        year=2026,
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=f"workspace:{workspace.id}",
        status="completed",
    )
    db_session.add_all([target, source])
    await db_session.flush()
    db_session.add(
        TribologyData(
            literature_id=source.id,
            material_name="Graphite",
            lubricant="[N88812][A4BMB]",
            cof_raw="0.0032",
            cof_value=0.0032,
            review_status="approved",
        )
    )
    await db_session.flush()

    result = await _publish_literature_to_group_library(
        db_session,
        source=source,
        principal=SimpleNamespace(user=user, group=group),
    )

    assert result["target"].id == target.id
    assert source.promoted_literature_id == target.id

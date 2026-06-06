import pytest

from models.db_models import DiffusionCandidate, DiffusionRecord, Literature, RecordCandidate, ResearchGroup, TribologyData, User, Workspace
from security import create_access_token


@pytest.mark.anyio
async def test_admin_all_visible_literature_lists_group_and_workspace(async_client, db_session):
    group = ResearchGroup(name="Admin Visible Group", slug="admin-visible-group")
    admin = User(
        username="admin-visible",
        display_name="Admin Visible",
        password_hash="hash",
        role="principal_investigator",
        group=group,
    )
    db_session.add_all([group, admin])
    await db_session.flush()
    workspace = Workspace(
        group_id=group.id,
        owner_user_id=admin.id,
        name="Admin Workspace",
        slug="admin-workspace",
        is_personal=True,
    )
    db_session.add(workspace)
    await db_session.flush()

    db_session.add_all(
        [
            Literature(
                doi="10.1000/library",
                title="Library paper",
                authors="A",
                journal="Langmuir",
                year=2026,
                group_id=group.id,
                scope_type="group_library",
                scope_key="group_library",
            ),
            Literature(
                doi="10.1000/workspace",
                title="Workspace paper",
                authors="B",
                journal="Friction",
                year=2026,
                group_id=group.id,
                workspace_id=workspace.id,
                created_by_user_id=admin.id,
                scope_type="workspace",
                scope_key=f"workspace:{workspace.id}",
            ),
        ]
    )
    await db_session.commit()

    response = await async_client.get(
        "/api/sync/literature?scope_mode=all_visible",
        headers={"Authorization": f"Bearer {create_access_token(admin)}"},
    )

    assert response.status_code == 200
    titles = {item["title"] for item in response.json()}
    assert titles == {"Library paper", "Workspace paper"}


@pytest.mark.anyio
async def test_admin_all_visible_record_search_counts_group_records_and_workspace_candidates(async_client, db_session):
    group = ResearchGroup(name="Admin Visible Records", slug="admin-visible-records")
    admin = User(
        username="admin-visible-records",
        display_name="Admin Visible Records",
        password_hash="hash",
        role="principal_investigator",
        group=group,
    )
    db_session.add_all([group, admin])
    await db_session.flush()
    workspace = Workspace(
        group_id=group.id,
        owner_user_id=admin.id,
        name="Admin Workspace",
        slug="admin-workspace",
        is_personal=True,
    )
    db_session.add(workspace)
    await db_session.flush()

    library_lit = Literature(
        doi="10.1000/library-record",
        title="Library record paper",
        authors="A",
        journal="Langmuir",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    workspace_lit = Literature(
        doi="10.1000/workspace-candidate",
        title="Workspace candidate paper",
        authors="B",
        journal="Friction",
        year=2026,
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=admin.id,
        scope_type="workspace",
        scope_key=f"workspace:{workspace.id}",
    )
    db_session.add_all([library_lit, workspace_lit])
    await db_session.flush()
    db_session.add_all(
        [
            TribologyData(
                literature_id=library_lit.id,
                material_name="Graphite",
                lubricant="[A][B]",
                cof_value=0.1,
                cof_raw="0.1",
                evidence="The paper reports COF = 0.1.",
                source_page=3,
            ),
            RecordCandidate(
                literature_id=workspace_lit.id,
                material_name="Mica",
                lubricant="[C][D]",
                cof_value=0.2,
                cof_raw="0.2",
                review_status="pending_review",
            ),
        ]
    )
    await db_session.commit()

    response = await async_client.post(
        "/api/records/search?scope_mode=all_visible&skip=0&limit=20",
        json={},
        headers={"Authorization": f"Bearer {create_access_token(admin)}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert {item["literature"]["title"] for item in payload["items"]} == {
        "Library record paper",
        "Workspace candidate paper",
    }


@pytest.mark.anyio
async def test_all_visible_diffusion_library_is_available_before_account_scoping(async_client, db_session):
    group = ResearchGroup(name="Unified Diffusion Group", slug="unified-diffusion-group")
    user = User(
        username="unified-diffusion-user",
        display_name="Unified Diffusion User",
        password_hash="hash",
        role="member",
        group=group,
    )
    db_session.add_all([group, user])
    await db_session.flush()
    workspace = Workspace(
        group_id=group.id,
        owner_user_id=user.id,
        name="Unified Workspace",
        slug="unified-workspace",
        is_personal=True,
    )
    db_session.add(workspace)
    await db_session.flush()

    library_lit = Literature(
        doi="10.1000/diffusion-library",
        title="Library diffusion paper",
        authors="A",
        journal="JPCB",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    workspace_lit = Literature(
        doi="10.1000/diffusion-workspace",
        title="Workspace diffusion paper",
        authors="B",
        journal="JPCC",
        year=2026,
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=f"workspace:{workspace.id}",
    )
    db_session.add_all([library_lit, workspace_lit])
    await db_session.flush()
    db_session.add_all(
        [
            DiffusionRecord(
                literature_id=library_lit.id,
                system_name="Library pore",
                ionic_liquid="[C2MIM][BF4]",
                d_total=1.1,
                d_unit="10^-11 m^2/s",
                evidence="The paper reports D = 1.1.",
                source_page=5,
                review_status="approved",
            ),
            DiffusionCandidate(
                literature_id=workspace_lit.id,
                system_name="Workspace pore",
                ionic_liquid="[C4MIM][TFSI]",
                d_total=2.2,
                d_unit="10^-11 m^2/s",
                review_status="pending_review",
            ),
        ]
    )
    await db_session.commit()

    response = await async_client.get(
        "/api/records/diffusion-library?scope_mode=all_visible&limit=20",
        headers={"Authorization": f"Bearer {create_access_token(user)}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["summary"]["finalRecordCount"] == 1
    assert payload["summary"]["candidateCount"] == 1
    assert {item["literatureTitle"] for item in payload["items"]} == {
        "Library diffusion paper",
        "Workspace diffusion paper",
    }


@pytest.mark.anyio
async def test_all_visible_diffusion_official_database_excludes_pending_final_records(async_client, db_session):
    group = ResearchGroup(name="Trusted Diffusion Group", slug="trusted-diffusion-group")
    user = User(
        username="trusted-diffusion-user",
        display_name="Trusted Diffusion User",
        password_hash="hash",
        role="member",
        group=group,
    )
    db_session.add_all([group, user])
    await db_session.flush()

    literature = Literature(
        doi="10.1000/trusted-diffusion-library",
        title="Trusted diffusion paper",
        authors="A",
        journal="JPCB",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    db_session.add(literature)
    await db_session.flush()
    db_session.add_all(
        [
            DiffusionRecord(
                literature_id=literature.id,
                system_name="Approved pore",
                ionic_liquid="[C2MIM][BF4]",
                d_total=1.1,
                d_unit="10^-11 m^2/s",
                evidence="The table reports D = 1.1.",
                source_page=5,
                review_status="approved",
            ),
            DiffusionRecord(
                literature_id=literature.id,
                system_name="Pending pore",
                ionic_liquid="[C4MIM][TFSI]",
                d_total=9.9,
                d_unit="10^-11 m^2/s",
                review_status="pending_review",
            ),
        ]
    )
    await db_session.commit()

    response = await async_client.get(
        "/api/records/diffusion-library?scope_mode=all_visible&entity_type=record&limit=20",
        headers={"Authorization": f"Bearer {create_access_token(user)}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["system_name"] == "Approved pore"


@pytest.mark.anyio
async def test_all_visible_diffusion_official_database_excludes_approved_records_without_evidence_locator(async_client, db_session):
    group = ResearchGroup(name="Located Diffusion Group", slug="located-diffusion-group")
    user = User(
        username="located-diffusion-user",
        display_name="Located Diffusion User",
        password_hash="hash",
        role="member",
        group=group,
    )
    db_session.add_all([group, user])
    await db_session.flush()

    literature = Literature(
        doi="10.1000/located-diffusion-library",
        title="Located diffusion paper",
        authors="A",
        journal="JPCB",
        year=2026,
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    db_session.add(literature)
    await db_session.flush()
    db_session.add_all(
        [
            DiffusionRecord(
                literature_id=literature.id,
                system_name="Located pore",
                ionic_liquid="[C2MIM][BF4]",
                d_total=1.1,
                d_unit="10^-11 m^2/s",
                evidence="The table reports D = 1.1.",
                source_page=5,
                review_status="approved",
            ),
            DiffusionRecord(
                literature_id=literature.id,
                system_name="Unlocated pore",
                ionic_liquid="[C4MIM][TFSI]",
                d_total=2.2,
                d_unit="10^-11 m^2/s",
                evidence="The text reports D = 2.2 without a stored page.",
                review_status="approved",
            ),
        ]
    )
    await db_session.commit()

    response = await async_client.get(
        "/api/records/diffusion-library?scope_mode=all_visible&entity_type=record&limit=20",
        headers={"Authorization": f"Bearer {create_access_token(user)}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["system_name"] == "Located pore"

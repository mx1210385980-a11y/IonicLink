import pytest
from sqlalchemy import select

from models.db_models import Literature, RecordCandidate, ResearchGroup, TribologyData, User, Workspace
from services.file_service import _copy_matching_tribology_cache_records, _load_cached_extraction_result


@pytest.mark.anyio
async def test_copy_matching_tribology_cache_records_reuses_same_group_doi_across_scopes(db_session):
    group = ResearchGroup(name="Cache Group", slug="cache-group")
    db_session.add(group)
    await db_session.flush()
    user = User(
        username="cache-user",
        display_name="Cache User",
        password_hash="hash",
        role="researcher",
        group_id=group.id,
    )
    workspace = Workspace(group_id=group.id, owner_user_id=None, name="Workspace", slug="workspace")
    db_session.add_all([user, workspace])
    await db_session.flush()

    source = Literature(
        doi="10.1234/canonical-cache-source",
        title="Figure-Derived Tribology Dataset",
        authors="",
        journal="Langmuir",
        year=2019,
        status="completed",
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    target = Literature(
        doi="10.1234/canonical-cache-source",
        title="Figure-Derived Tribology Dataset",
        authors="",
        journal="Langmuir",
        year=2019,
        status="no_data",
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=f"workspace:{workspace.id}",
    )
    db_session.add_all([source, target])
    await db_session.flush()

    db_session.add(
        TribologyData(
            literature_id=source.id,
            material_name="Mica",
            lubricant="[C10(C1Im)2][NTf2]2",
            cof_value=0.08,
            cof_raw="0.08",
            speed_value="0.105",
            temperature="298 K",
            source_page=11,
            source_figure="Fig. 2",
            evidence="Figure 2 shows kinetic friction force as a function of normal force.",
            confidence=0.89,
            review_status="approved",
            record_origin="cached_record",
        )
    )
    await db_session.flush()

    result = await _copy_matching_tribology_cache_records(db_session, target)

    assert result == {
        "source_literature_id": source.id,
        "source_scope_key": "group_library",
        "source_table": "tribology_data",
        "copied_count": 1,
    }
    assert target.status == "completed"
    assert target.error_message is None

    rows = (
        await db_session.execute(
            select(RecordCandidate).where(RecordCandidate.literature_id == target.id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].material_name == "Mica"
    assert rows[0].lubricant == "[C10(C1Im)2][NTf2]2"
    assert rows[0].cof_raw == "0.08"
    assert rows[0].source_page == 11
    assert rows[0].review_status == "pending_review"
    assert rows[0].record_origin == "canonical_cache"
    assert f"literature #{source.id}" in rows[0].assembly_notes


@pytest.mark.anyio
async def test_load_cached_extraction_result_backfills_missing_probe_from_text_context(db_session):
    literature = Literature(
        doi="10.1234/probe-backfill",
        title="High-Load-Triggered Nanoscale Superlubricity",
        authors="",
        journal="ACS",
        year=2026,
        status="completed",
        content="""
        Force Measurements The friction force measurements were performed by a Bruker Dimension Icon
        atomic force microscopy (AFM) in contact mode. The SNL probes (silicon nitride, radius of 2 nm)
        for friction measurements were from Bruker. The highly oriented pyrolytic graphite (HOPG)
        was purchased as the supporting substrate for the ILs.
        """,
    )
    db_session.add(literature)
    await db_session.flush()
    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Graphite",
        substrate_material="Graphite",
        lubricant="[N88812][A12BMB]",
        cof_raw="0.0013",
        probe_radius="2 nm",
        evidence="The friction μ ≈0.0013 once the normal load exceeds ∼30 nN.",
        source="Plain text",
        source_page=1,
        review_status="pending_review",
    )
    db_session.add(candidate)
    await db_session.flush()

    _, rows, _ = await _load_cached_extraction_result(db_session, literature)

    assert rows[0]["probe_material"] == "Silicon nitride"
    assert rows[0]["probe_geometry"] == "Tip"
    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.probe_material == "Silicon nitride"
    assert refreshed.probe_geometry == "Tip"


@pytest.mark.anyio
async def test_load_cached_extraction_result_corrects_snl_probe_generic_geometry(db_session):
    literature = Literature(
        doi="10.1234/probe-geometry-backfill",
        title="High-Load-Triggered Nanoscale Superlubricity",
        authors="",
        journal="ACS",
        year=2026,
        status="completed",
        content="""
        Force Measurements The friction force measurements were performed by AFM in contact mode.
        The SNL probes (silicon nitride, radius of 2 nm) were used for friction measurements.
        A separate unrelated method note mentions a colloidal probe.
        """,
    )
    db_session.add(literature)
    await db_session.flush()
    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Graphite",
        substrate_material="Graphite",
        lubricant="[N88812][A12BMB]",
        cof_raw="0.0013",
        probe_material="Silicon nitride",
        probe_geometry="Colloid probe",
        probe_radius="2 nm",
        evidence="The friction μ ≈0.0013 once the normal load exceeds ∼30 nN.",
        source="Plain text",
        source_page=1,
        review_status="pending_review",
    )
    db_session.add(candidate)
    await db_session.flush()

    _, rows, _ = await _load_cached_extraction_result(db_session, literature)

    assert rows[0]["probe_material"] == "Silicon nitride"
    assert rows[0]["probe_geometry"] == "Tip"
    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.probe_material == "Silicon nitride"
    assert refreshed.probe_geometry == "Tip"


@pytest.mark.anyio
async def test_load_cached_extraction_result_corrects_mica_surface_pair_geometry(db_session):
    literature = Literature(
        doi="10.1234/mica-surface-pair",
        title="Interfacial structure of a dicationic ionic liquid",
        authors="",
        journal="Langmuir",
        year=2019,
        status="completed",
        content="Figure 2 shows kinetic friction force for the ionic liquid between mica surfaces.",
    )
    db_session.add(literature)
    await db_session.flush()
    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        substrate_material="mica",
        lubricant="[C10(C1Im)2][NTf2]2",
        cof_raw="0.001",
        probe_material="Mica",
        probe_geometry="Colloid probe",
        evidence="Figure 2 shows kinetic friction force as a function of normal force between mica surfaces.",
        source="Plain text",
        source_page=1,
        review_status="pending_review",
    )
    db_session.add(candidate)
    await db_session.flush()

    _, rows, _ = await _load_cached_extraction_result(db_session, literature)

    assert rows[0]["probe_material"] == "Mica"
    assert rows[0]["probe_geometry"] == "Surface pair"
    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.probe_geometry == "Surface pair"

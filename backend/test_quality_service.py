import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from database import Base
from models.db_models import Literature, ResearchGroup, TribologyData, User
from services.quality_service import get_quality_asset_summary


async def _run_quality_case(callback):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with session_maker() as session:
            return await callback(session)
    finally:
        await engine.dispose()


async def _seed_quality_data(session) -> None:
    group = ResearchGroup(name="Quality Group", slug="quality-group")
    other_group = ResearchGroup(name="Other Group", slug="other-group")
    user = User(
        username="quality-user",
        display_name="Quality User",
        password_hash="hashed",
        role="researcher",
        group=group,
    )
    session.add_all([group, other_group, user])
    await session.flush()

    first = Literature(
        doi="https://doi.org/10.1000/Quality",
        title="Quality Paper A",
        authors="Author A",
        journal="Tribology Letters",
        year=2025,
        group_id=group.id,
        created_by_user_id=user.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    duplicate = Literature(
        doi="10.1000/quality",
        title="Quality Paper B",
        authors="Author B",
        journal="Wear",
        year=2026,
        group_id=group.id,
        created_by_user_id=user.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    out_of_scope = Literature(
        doi="10.1000/out-of-scope-quality",
        title="Out Of Scope Paper",
        authors="Author C",
        journal="Other",
        year=2026,
        group_id=other_group.id,
        scope_type="group_library",
        scope_key="group_library",
        status="completed",
    )
    session.add_all([first, duplicate, out_of_scope])
    await session.flush()

    session.add_all(
        [
            TribologyData(
                literature_id=first.id,
                material_name="Mica",
                lubricant="[EMIM][TFSI]",
                cof_value=0.08,
                cof_raw="0.08",
                load_value="5 nN",
                speed_value="1 um/s",
                temperature="298 K",
                probe_material="Silica",
                substrate_material="Mica",
                cation="EMIM",
                anion="TFSI",
                source_page=4,
                source_figure="Figure 2",
                evidence="COF = 0.08",
                review_status="approved",
                tribological_system_json='{"scale":"nanoscale","training_view":"afm_surface_response"}',
            ),
            TribologyData(
                literature_id=duplicate.id,
                material_name="Steel",
                lubricant="[BMIM][BF4]",
                cof_value=2.5,
                cof_raw="2.5",
                load_value="5",
                speed_value="10",
                temperature="room temperature",
                probe_material="Steel",
                substrate_material="Steel",
                cation="BMIM",
                anion="BF4",
                tribological_system_json='{"scale":"macroscale","training_view":"macro_performance"}',
            ),
            TribologyData(
                literature_id=duplicate.id,
                material_name="Rejected",
                lubricant="[HMIM][FAP]",
                cof_value=0.2,
                cof_raw="0.2",
                load_value="10 nN",
                probe_material="Silica",
                substrate_material="Gold",
                review_status="rejected",
                tribological_system_json='{"scale":"macroscale","training_view":"macro_performance"}',
            ),
            TribologyData(
                literature_id=out_of_scope.id,
                material_name="Titanium",
                lubricant="[P6,6,6,14][BMB]",
                cof_value=3.0,
                cof_raw="3.0",
                load_value="10",
            ),
        ]
    )
    await session.commit()


def test_quality_asset_summary_flags_data_asset_risks():
    async def _case(session):
        await _seed_quality_data(session)
        return await get_quality_asset_summary(
            session,
            scope_filter_values={
                "group_id": 1,
                "scope_type": "group_library",
                "scope_key": "group_library",
                "workspace_id": None,
            },
        )

    payload = asyncio.run(_run_quality_case(_case))
    summary = payload["summary"]

    assert summary["literatureCount"] == 2
    assert summary["recordCount"] == 3
    assert summary["activeRecordCount"] == 2
    assert summary["duplicateDoiGroups"] == 1
    assert summary["duplicateDoiExcess"] == 1
    assert summary["cofOutlierCount"] == 1
    assert summary["unitIssueCount"] >= 2
    assert summary["missingEvidenceCount"] == 1
    assert summary["trainableSampleCount"] == 2
    assert summary["reviewedCount"] == 2
    assert summary["unreviewedCount"] == 1
    assert payload["doiDuplicates"][0]["doi"] == "10.1000/quality"
    assert payload["cofOutliers"][0]["recordId"] == 2
    scale_breakdown = {item["key"]: item for item in payload["scaleBreakdown"]}
    assert scale_breakdown["macroscale"]["summary"]["recordCount"] == 2
    assert scale_breakdown["macroscale"]["summary"]["activeRecordCount"] == 1
    assert scale_breakdown["nanoscale"]["summary"]["activeRecordCount"] == 1
    assert scale_breakdown["macroscale"]["training"]["readiness"]["state"] == "limited"
    replenishment = scale_breakdown["macroscale"]["training"]["replenishment"]
    assert replenishment["sampleGap"] == 29
    assert replenishment["sourceLiteratureCount"] == 1
    assert replenishment["actionItems"][0]["key"] == "sample_gap"

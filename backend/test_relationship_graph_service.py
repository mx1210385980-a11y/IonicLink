import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from database import Base
from models.db_models import Literature, ResearchGroup, TribologyData, User, Workspace
from routers.data_explorer import SearchFilter
from security import build_scope_key
from services.relationship_graph_service import (
    build_relationship_graph,
    drilldown_relationship_graph,
)


async def _seed_graph_data(session) -> None:
    group = ResearchGroup(name="Graph Group", slug="graph-group")
    user = User(
        username="graph-user",
        display_name="Graph User",
        password_hash="hashed",
        role="researcher",
        group=group,
    )
    workspace = Workspace(
        group=group,
        owner=user,
        name="Workspace A",
        slug="workspace-a",
        description="Primary scope",
        is_personal=True,
    )
    other_workspace = Workspace(
        group=group,
        owner=user,
        name="Workspace B",
        slug="workspace-b",
        description="Secondary scope",
        is_personal=False,
    )
    session.add_all([group, user, workspace, other_workspace])
    await session.flush()

    lit_scope_key = build_scope_key("workspace", workspace.id)
    other_scope_key = build_scope_key("workspace", other_workspace.id)
    literature = Literature(
        doi="10.1000/test-graph",
        title="Primary Graph Paper",
        authors="Author A",
        journal="Tribology Letters",
        year=2025,
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=lit_scope_key,
        status="completed",
    )
    second_literature = Literature(
        doi="10.1000/test-graph-2",
        title="Secondary Graph Paper",
        authors="Author B",
        journal="Wear",
        year=2026,
        group_id=group.id,
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=lit_scope_key,
        status="completed",
    )
    out_of_scope_literature = Literature(
        doi="10.1000/out-of-scope",
        title="Other Scope Paper",
        authors="Author C",
        journal="Other Journal",
        year=2026,
        group_id=group.id,
        workspace_id=other_workspace.id,
        created_by_user_id=user.id,
        scope_type="workspace",
        scope_key=other_scope_key,
        status="completed",
    )
    session.add_all([literature, second_literature, out_of_scope_literature])
    await session.flush()

    session.add_all(
        [
            TribologyData(
                literature_id=literature.id,
                material_name="Mica",
                lubricant="[EMIM][TFSI]",
                cof_value=0.02,
                cof_raw="0.02",
                temperature="298.15 K",
                load_value="15-75 nN",
                load_raw="15-75 nN",
                speed_value="1 μm/s",
                water_content="IL-0%",
                potential="+0.2 V",
                probe_material="Silica",
                substrate_material="Mica",
                cation="EMIM",
                anion="TFSI",
            ),
            TribologyData(
                literature_id=literature.id,
                material_name="Mica",
                lubricant="[EMIM][TFSI]",
                cof_value=0.04,
                cof_raw="0.04",
                temperature="298.15 K",
                load_value="15-75 nN",
                load_raw="15-75 nN",
                speed_value="1 μm/s",
                water_content="IL-44%",
                probe_material="Silica",
                substrate_material="Mica",
                cation="EMIM",
                anion="TFSI",
            ),
            TribologyData(
                literature_id=second_literature.id,
                material_name="Mica",
                lubricant="[EMIM][TFSI]",
                cof_value=0.06,
                cof_raw="0.06",
                temperature="323.15 K",
                load_value="20 nN",
                load_raw="20 nN",
                speed_value="2 μm/s",
                water_content="IL-44%",
                probe_material="Silica",
                substrate_material="Mica",
                cation="EMIM",
                anion="TFSI",
            ),
            TribologyData(
                literature_id=second_literature.id,
                material_name="Steel",
                lubricant="[BMIM][BF4]",
                cof_value=0.10,
                cof_raw="0.10",
                temperature="298.15 K",
                load_value="30 nN",
                load_raw="30 nN",
                speed_value="1 μm/s",
                water_content="Dry",
                probe_material="Steel",
                substrate_material="Steel",
                cation="BMIM",
                anion="BF4",
            ),
            TribologyData(
                literature_id=second_literature.id,
                material_name="Steel",
                lubricant="[BMIM][BF4]",
                cof_value=0.12,
                cof_raw="0.12",
                temperature="333.15 K",
                load_value="30 nN",
                load_raw="30 nN",
                speed_value="2 μm/s",
                water_content="Dry",
                probe_material="Steel",
                substrate_material="Steel",
                cation="BMIM",
                anion="BF4",
            ),
            TribologyData(
                literature_id=out_of_scope_literature.id,
                material_name="Titanium",
                lubricant="[P6,6,6,14][BMB]",
                cof_value=0.18,
                cof_raw="0.18",
                temperature="350 K",
                load_value="40 nN",
                load_raw="40 nN",
                speed_value="5 μm/s",
                water_content="Dry",
                probe_material="Titanium",
                substrate_material="Titanium",
                cation="P66614",
                anion="BMB",
            ),
        ]
    )
    await session.commit()


async def _run_with_seed(callback):
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
            await _seed_graph_data(session)
            return await callback(session)
    finally:
        await engine.dispose()


def test_relationship_graph_respects_scope_and_hides_sparse_dimensions():
    async def _case(session):
        payload = await build_relationship_graph(
            session,
            SearchFilter(),
            scope_filter_values={
                "group_id": 1,
                "scope_type": "workspace",
                "scope_key": "workspace:1",
                "workspace_id": 1,
            },
        )

        assert payload["summary"]["totalRecords"] == 5
        assert payload["summary"]["totalLiterature"] == 2
        hidden_types = {item["type"] for item in payload["summary"]["hiddenDimensions"]}
        assert "potential" in hidden_types
        assert "filmThickness" in hidden_types

        lubricant_nodes = [node for node in payload["nodes"] if node["type"] == "lubricant"]
        assert {node["label"] for node in lubricant_nodes} == {"[EMIM][TFSI]", "[BMIM][BF4]"}
        assert payload["title"] == "当前筛选结果润滑参数关系图谱"

        cation_edge = next(
            edge
            for edge in payload["edges"]
            if edge["sourceLabel"] == "[EMIM][TFSI]" and edge["targetType"] == "cation" and edge["targetLabel"] == "EMIM"
        )
        assert cation_edge["count"] == 3

    asyncio.run(_run_with_seed(_case))


def test_relationship_graph_single_lubricant_uses_personalized_title():
    async def _case(session):
        payload = await build_relationship_graph(
            session,
            SearchFilter(lubricants=["[EMIM][TFSI]"]),
            scope_filter_values={
                "group_id": 1,
                "scope_type": "workspace",
                "scope_key": "workspace:1",
                "workspace_id": 1,
            },
        )

        assert payload["title"] == "[EMIM][TFSI] 专属润滑参数关系图谱"
        lubricant_nodes = [node for node in payload["nodes"] if node["type"] == "lubricant"]
        assert len(lubricant_nodes) == 1
        assert lubricant_nodes[0]["count"] == 3

    asyncio.run(_run_with_seed(_case))


def test_relationship_graph_drilldown_supports_node_and_edge_selection():
    async def _case(session):
        scope = {
            "group_id": 1,
            "scope_type": "workspace",
            "scope_key": "workspace:1",
            "workspace_id": 1,
        }
        node_payload = await drilldown_relationship_graph(
            session,
            SearchFilter(),
            {"kind": "node", "nodeType": "tribopair", "nodeValue": "Silica vs. Mica"},
            scope_filter_values=scope,
        )
        assert node_payload["total"] == 3
        assert node_payload["summary"]["label"] == "Silica vs. Mica"
        assert {item["id"] for item in node_payload["items"]} == {1, 2, 3}

        edge_payload = await drilldown_relationship_graph(
            session,
            SearchFilter(),
            {
                "kind": "edge",
                "sourceType": "lubricant",
                "sourceValue": "[EMIM][TFSI]",
                "targetType": "temperature",
                "targetValue": "298.15 K",
            },
            scope_filter_values=scope,
        )
        assert edge_payload["total"] == 2
        assert edge_payload["summary"]["label"] == "[EMIM][TFSI] → 298.15 K"
        assert len(edge_payload["literatureSummaries"]) == 1
        assert edge_payload["literatureSummaries"][0]["hitCount"] == 2

    asyncio.run(_run_with_seed(_case))

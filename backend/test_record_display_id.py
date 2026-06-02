from types import SimpleNamespace

import pytest

from models.db_models import Literature, TribologyData
from services.query_service import search_records


def _empty_filter() -> SimpleNamespace:
    return SimpleNamespace(
        record_id=None,
        materials=[],
        lubricants=[],
        cations=[],
        anions=[],
        cof_min=None,
        cof_max=None,
        review_statuses=[],
        experiment_scales=[],
        experiment_methods=[],
        measurement_types=[],
        training_views=[],
        speed_values=[],
        shear_rate_values=[],
        temperature_values=[],
        potential_values=[],
        water_content_values=[],
        doi=None,
        query=None,
        file_id=None,
        load_min=None,
        load_max=None,
    )


@pytest.mark.anyio
async def test_search_records_returns_dense_display_ids_without_replacing_primary_keys(db_session):
    literature = Literature(
        id=21,
        doi="10.0000/display-id",
        title="Display ID paper",
        authors="A. Author",
        journal="Journal",
        year=2026,
    )
    db_session.add(literature)
    db_session.add_all(
        [
            TribologyData(
                id=348,
                literature_id=21,
                material_name="Graphite",
                lubricant="[A][B]",
                cof_value=0.0032,
                cof_raw="0.0032",
            ),
            TribologyData(
                id=353,
                literature_id=21,
                material_name="Graphite",
                lubricant="[A][B]",
                cof_value=0.0068,
                cof_raw="0.0068",
            ),
        ]
    )
    await db_session.commit()

    result = await search_records(db_session, _empty_filter(), skip=0, limit=20)

    assert [item["id"] for item in result["items"]] == [348, 353]
    assert [item["display_id"] for item in result["items"]] == ["R-000001", "R-000002"]


@pytest.mark.anyio
async def test_search_records_query_matches_title_lubricant_material_and_partial_doi(db_session):
    first_literature = Literature(
        id=31,
        doi="10.4242/nanolubrication-title",
        title="Potential dependent nanolubrication on mica",
        authors="A. Author",
        journal="Journal",
        year=2026,
    )
    second_literature = Literature(
        id=32,
        doi="10.4242/steel-control",
        title="Unrelated control paper",
        authors="B. Author",
        journal="Journal",
        year=2026,
    )
    db_session.add_all([first_literature, second_literature])
    db_session.add_all(
        [
            TribologyData(
                id=601,
                literature_id=31,
                material_name="Mica",
                substrate_material="Mica",
                probe_material="Silica",
                lubricant="[EMIM][TFSI]",
                cation="[EMIM]+",
                anion="[TFSI]-",
                cof_value=0.11,
                cof_raw="0.11",
            ),
            TribologyData(
                id=602,
                literature_id=32,
                material_name="Steel",
                substrate_material="Steel",
                probe_material="Steel",
                lubricant="[BMIM][BF4]",
                cation="[BMIM]+",
                anion="[BF4]-",
                cof_value=0.21,
                cof_raw="0.21",
            ),
        ]
    )
    await db_session.commit()

    for query in ("nanolubrication", "[EMIM]", "mica", "nanolubrication-title"):
        filter_params = _empty_filter()
        filter_params.query = query
        result = await search_records(db_session, filter_params, skip=0, limit=20)

        assert [item["id"] for item in result["items"]] == [601]

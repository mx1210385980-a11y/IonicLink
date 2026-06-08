import json

import pytest

from models.db_models import Literature, RecordCandidate
from services.record_correction_service import apply_tribology_candidate_correction, refresh_tribology_schema_layers


@pytest.mark.anyio
async def test_candidate_correction_updates_review_fields_and_clears_flags(db_session):
    literature = Literature(
        doi="10.0000/candidate-review-correction",
        title="Candidate correction",
        authors="Review Tester",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        lubricant="[BMIM] BF4",
        probe_material="substrate leaked here",
        substrate_material=None,
        cof_raw="0.08",
        field_evidence_json=json.dumps(
            {
                "probe_material": {"value": "substrate leaked here", "review_state": "flagged"},
                "substrate_material": {"value": None, "review_state": "flagged"},
            }
        ),
        review_status="flagged",
    )
    db_session.add(candidate)
    await db_session.flush()

    result = await apply_tribology_candidate_correction(
        db_session,
        candidate.id,
        {
            "probe_material": "Si3N4 tip",
            "substrate_material": "mica",
        },
    )

    assert result.committed is True
    assert result.candidate_id == candidate.id
    assert result.field_diff["probe_material"] == {
        "before": "substrate leaked here",
        "after": "Si3N4 tip",
    }

    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.probe_material == "Si3N4 tip"
    assert refreshed.substrate_material == "mica"
    field_map = json.loads(refreshed.field_evidence_json)
    assert field_map["probe_material"]["value"] == "Si3N4 tip"
    assert field_map["probe_material"]["review_state"] is None
    assert field_map["substrate_material"]["value"] == "mica"
    assert field_map["substrate_material"]["review_state"] is None


@pytest.mark.anyio
async def test_candidate_correction_updates_strict_core_schema_fields(db_session):
    literature = Literature(
        doi="10.0000/candidate-review-core-fields",
        title="Core fields",
        authors="Review Tester",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        lubricant="[BMIM][BF4]",
        cof_raw="0.08",
        load_raw="2 nN",
        substrate_material="mica",
        field_evidence_json=json.dumps(
            {
                "_schema_layers": {
                    "core_fields": [
                        {"key": "material_name", "label": "Paper / system", "layer": "core", "status": "ready", "value": "Core fields"},
                        {"key": "lubricant", "label": "Lubricant / material", "layer": "core", "status": "ready", "value": "[BMIM][BF4]"},
                        {"key": "cof", "label": "Reported signal", "layer": "core", "status": "ready", "value": "0.08"},
                    ],
                    "extended_fields": [],
                    "raw_flexible_json": {"source": "reading_report"},
                }
            }
        ),
        review_status="needs_review",
    )
    db_session.add(candidate)
    await db_session.flush()

    await apply_tribology_candidate_correction(
        db_session,
        candidate.id,
        {
            "cation": "BMIM",
            "anion": "BF4",
            "temperature": "298 K",
        },
    )

    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.cation == "BMIM"
    assert refreshed.anion == "BF4"
    assert refreshed.temperature == "298 K"
    field_map = json.loads(refreshed.field_evidence_json)
    assert field_map["cation"]["value"] == "BMIM"
    assert field_map["anion"]["value"] == "BF4"
    assert field_map["temperature"]["value"] == "298 K"
    schema = field_map["_schema_layers"]
    assert [field["key"] for field in schema["core_fields"]] == [
        "cation",
        "anion",
        "substrate_material",
        "temperature",
        "load",
        "cof",
    ]
    assert {field["status"] for field in schema["core_fields"]} == {"ready"}
    assert schema["core_summary"] == {
        "total": 6,
        "ready": 6,
        "missing_keys": [],
        "missing_labels": [],
        "can_promote": True,
    }
    assert {field["key"] for field in schema["extended_fields"]} >= {"material_name", "lubricant"}
    assert schema["raw_flexible_json"]["source"] == "reading_report"


@pytest.mark.anyio
async def test_candidate_correction_updates_extended_surface_roughness_schema(db_session):
    literature = Literature(
        doi="10.0000/candidate-review-extended-roughness",
        title="Extended roughness",
        authors="Review Tester",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        lubricant="[BMIM][BF4]",
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature="298 K",
        load_raw="2 nN",
        cof_raw="0.08",
        field_evidence_json=json.dumps(
            {
                "_schema_layers": {
                    "extended_fields": [
                        {"key": "surface_roughness", "label": "Roughness", "layer": "extended", "status": "review", "value": ""}
                    ],
                    "raw_flexible_json": {"source": "reading_report"},
                }
            }
        ),
        review_status="needs_review",
    )
    db_session.add(candidate)
    await db_session.flush()

    await apply_tribology_candidate_correction(
        db_session,
        candidate.id,
        {"surface_roughness": "RMS 0.3 nm"},
    )

    refreshed = await db_session.get(RecordCandidate, candidate.id)
    assert refreshed.surface_roughness == "RMS 0.3 nm"
    field_map = json.loads(refreshed.field_evidence_json)
    assert field_map["surface_roughness"]["value"] == "RMS 0.3 nm"
    extended_by_key = {
        field["key"]: field
        for field in field_map["_schema_layers"]["extended_fields"]
    }
    assert extended_by_key["surface_roughness"]["status"] == "ready"
    assert extended_by_key["surface_roughness"]["value"] == "RMS 0.3 nm"


def test_refresh_tribology_schema_layers_uses_current_core_values():
    candidate = RecordCandidate(
        material_name="Draft system",
        lubricant="[BMIM][BF4]",
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature="298 K",
        load_raw="2 nN",
        cof_raw="0.08",
        speed_value=4.0,
        lubricant_components_json=json.dumps([
            {"compound": "[BMIM][BF4]", "fraction": 5, "unit": "wt%", "role": "additive"},
            {"compound": "PAO", "fraction": 95, "unit": "wt%", "role": "base_oil"},
        ]),
        potential="0 V",
        field_evidence_json=json.dumps({
            "_schema_layers": {
                "raw_flexible_json": {
                    "source": "reading_report",
                    "test_duration": "30 min",
                },
            },
        }),
    )
    field_map = {
        "_schema_layers": {
            "core_fields": [
                {"key": "material_name", "label": "Paper / system", "layer": "core", "status": "ready", "value": "Draft system"}
            ],
            "extended_fields": [],
            "raw_flexible_json": {"source": "reading_report"},
        }
    }

    refreshed = refresh_tribology_schema_layers(field_map, candidate)
    schema = refreshed["_schema_layers"]

    assert [field["key"] for field in schema["core_fields"]] == [
        "cation",
        "anion",
        "substrate_material",
        "temperature",
        "load",
        "cof",
    ]
    assert {field["status"] for field in schema["core_fields"]} == {"ready"}
    assert schema["core_summary"] == {
        "total": 6,
        "ready": 6,
        "missing_keys": [],
        "missing_labels": [],
        "can_promote": True,
    }
    assert {field["key"] for field in schema["extended_fields"]} >= {
        "material_name",
        "lubricant",
        "speed",
        "additive",
        "potential",
        "surface_roughness",
        "test_duration",
    }
    extended_by_key = {field["key"]: field for field in schema["extended_fields"]}
    assert extended_by_key["additive"]["status"] == "ready"
    assert "[BMIM][BF4]" in extended_by_key["additive"]["value"]
    assert extended_by_key["test_duration"]["status"] == "ready"
    assert extended_by_key["test_duration"]["value"] == "30 min"
    assert schema["raw_flexible_json"] == {"source": "reading_report", "test_duration": "30 min"}


def test_refresh_tribology_schema_layers_does_not_promote_niche_raw_keys_as_generic_additive():
    candidate = RecordCandidate(
        material_name="Draft system",
        lubricant="[BMIM][BF4]",
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature="298 K",
        load_raw="2 nN",
        cof_raw="0.08",
        field_evidence_json=json.dumps({
            "_schema_layers": {
                "raw_flexible_json": {
                    "source": "legacy_extraction",
                    "iron_oxide_additive_ratio": "15 wt%",
                },
            },
        }),
    )

    refreshed = refresh_tribology_schema_layers({}, candidate)
    extended_by_key = {field["key"]: field for field in refreshed["_schema_layers"]["extended_fields"]}

    assert extended_by_key["additive"]["status"] == "review"
    assert extended_by_key["additive"]["value"] == ""
    assert refreshed["_schema_layers"]["raw_flexible_json"]["iron_oxide_additive_ratio"] == "15 wt%"


def test_refresh_tribology_schema_layers_summarizes_missing_core_values():
    candidate = RecordCandidate(
        material_name="Draft system",
        lubricant="[BMIM][BF4]",
        cation="BMIM",
        anion="BF4",
        substrate_material="mica",
        temperature=None,
        load_raw="2 nN",
        cof_raw=None,
    )

    refreshed = refresh_tribology_schema_layers({}, candidate)
    schema = refreshed["_schema_layers"]

    assert schema["core_summary"] == {
        "total": 6,
        "ready": 4,
        "missing_keys": ["temperature", "cof"],
        "missing_labels": ["Temperature", "COF"],
        "can_promote": False,
    }


@pytest.mark.anyio
async def test_candidate_correction_rejects_non_review_fields(db_session):
    literature = Literature(
        doi="10.0000/candidate-review-guard",
        title="Guard",
        authors="Review Tester",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="mica",
        lubricant="[BMIM] BF4",
    )
    db_session.add(candidate)
    await db_session.flush()

    with pytest.raises(ValueError, match="non-correctable"):
        await apply_tribology_candidate_correction(
            db_session,
            candidate.id,
            {"promoted_record_id": 123},
        )

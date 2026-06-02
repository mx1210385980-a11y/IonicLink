import pytest

from routers.extraction import (
    ManualDiffusionCandidatePayload,
    _build_manual_diffusion_candidate_field_map,
    _build_manual_diffusion_source_values,
    _deduplicate_tribology_payloads,
    _field_grounding_status,
    _no_data_message_for_run,
    _upload_cache_payload,
    _upload_status_for_extractor,
    _should_wait_for_fresh_extractor_run,
)
from models.db_models import Literature, RecordCandidate, ResearchGroup
from models.db_models import ExtractionRun


def test_terminal_requested_extractor_run_is_not_masked_by_shared_literature_status():
    for run_status in ("no_data", "completed", "success", "failed", "error", "cancelled"):
        assert _should_wait_for_fresh_extractor_run("extracting", run_status) is False


def test_missing_requested_extractor_run_does_not_wait_on_shared_literature_status():
    assert _should_wait_for_fresh_extractor_run("extracting", "", has_requested_run=False) is False
    assert _should_wait_for_fresh_extractor_run("extracting", "", has_requested_run=True) is True
    assert _should_wait_for_fresh_extractor_run("completed", "") is False


def test_textual_field_evidence_with_page_and_quote_is_grounded_without_bbox():
    assert _field_grounding_status(
        {
            "value": "0.0032",
            "evidence": {
                "source_type": "text",
                "page": 1,
                "quote": "A4 and A8 show stable superlow friction across the load range (μ ≈0.0032.",
                "bbox": None,
            },
        }
    ) == "grounded"


def test_source_label_alone_is_only_partial_evidence():
    assert _field_grounding_status(
        {
            "value": "0.0032",
            "evidence": {
                "source_type": "text",
                "source_label": "Plain text",
            },
        }
    ) == "partial"


def test_existing_candidate_payloads_are_deduplicated_for_review_preview():
    rows = [
        {
            "id": "350",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "probe_material": "Probe N/A",
            "substrate_material": "Graphite",
            "cof": "0.023",
            "temperature": "298.15 K",
            "source": "Plain text",
            "source_page": 1,
            "review_entity_type": "candidate",
        },
        {
            "id": "352",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "probe_material": "Probe N/A",
            "substrate_material": "Graphite",
            "cof": "0.023",
            "temperature": "298.15 K",
            "source": "Plain text",
            "source_page": 8,
            "review_entity_type": "candidate",
        },
        {
            "id": "351",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "probe_material": "Probe N/A",
            "substrate_material": "Graphite",
            "cof": "0.0013",
            "temperature": "298.15 K",
            "load": "30 nN",
            "source": "Plain text",
            "source_page": 1,
            "review_entity_type": "candidate",
        },
    ]

    deduped = _deduplicate_tribology_payloads(rows)

    assert [row["id"] for row in deduped] == ["350", "351"]


def test_deduped_tribology_payloads_include_stable_semantic_keys():
    rows = [
        {
            "id": "350",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "probe_material": "Probe N/A",
            "substrate_material": "Graphite",
            "cof": "0.023",
            "temperature": "298.15 K",
            "source_page": 1,
            "field_evidence_json": {},
        },
        {
            "id": "352",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "probe_material": "Probe N/A",
            "substrate_material": "Graphite",
            "cof": "0.023",
            "temperature": "298.15 K",
            "source_page": 8,
            "field_evidence_json": {},
        },
        {
            "id": "351",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "probe_material": "Probe N/A",
            "substrate_material": "Graphite",
            "cof": "0.0013",
            "temperature": "298.15 K",
            "load": "30 nN",
            "field_evidence_json": {},
        },
    ]

    deduped = _deduplicate_tribology_payloads(rows)

    assert [row["id"] for row in deduped] == ["350", "351"]
    assert deduped[0]["semantic_key"].startswith("tribology:")
    assert deduped[1]["semantic_key"].startswith("tribology:")
    assert deduped[0]["semantic_key"] != deduped[1]["semantic_key"]


def test_evidence_quality_scores_text_quotes_above_label_only_evidence():
    quote_backed = _deduplicate_tribology_payloads([
        {
            "id": "1",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "cof": "0.023",
            "field_evidence_json": {
                "material": {"value": "Graphite", "evidence": {"page": 1, "quote": "graphite"}},
                "ionic_liquid": {"value": "[N8,8,8,12][A12BMB]", "evidence": {"page": 1, "quote": "A12BMB"}},
                "cof": {"value": "0.023", "evidence": {"page": 1, "quote": "0.023"}},
            },
        }
    ])[0]
    label_only = _deduplicate_tribology_payloads([
        {
            "id": "2",
            "material_name": "Graphite",
            "ionic_liquid": "[N8,8,8,12][A12BMB]",
            "cof": "0.023",
            "field_evidence_json": {
                "material": {"value": "Graphite", "evidence": {"source_label": "Plain text"}},
                "ionic_liquid": {"value": "[N8,8,8,12][A12BMB]", "evidence": {"source_label": "Plain text"}},
                "cof": {"value": "0.023", "evidence": {"source_label": "Plain text"}},
            },
        }
    ])[0]

    assert quote_backed["evidence_grade"] in {"adequate", "strong"}
    assert quote_backed["evidence_score"] >= 0.65
    assert label_only["evidence_grade"] == "weak"
    assert label_only["evidence_score"] < 0.65


@pytest.mark.anyio
async def test_upload_cache_payload_reports_existing_metadata_and_record_counts(db_session):
    group = ResearchGroup(name="Upload Cache Group", slug="upload-cache-group")
    db_session.add(group)
    await db_session.flush()
    literature = Literature(
        doi="10.1021/cached-upload",
        title="Cached Upload Literature",
        authors="Cache Author",
        journal="Langmuir",
        year=2019,
        volume="35",
        issue="11",
        pages="100-110",
        issn="0743-7463",
        status="completed",
        group_id=group.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    db_session.add(literature)
    await db_session.flush()
    db_session.add(
        RecordCandidate(
            literature_id=literature.id,
            material_name="mica",
            lubricant="[C10(C1Im)2][NTf2]2",
            cof_raw="0.08",
        )
    )
    await db_session.flush()

    payload = await _upload_cache_payload(db_session, literature, "tribology")

    assert payload["metadata"]["title"] == "Cached Upload Literature"
    assert payload["metadata"]["doi"] == "10.1021/cached-upload"
    assert payload["metadata"]["issn"] == "0743-7463"
    assert payload["candidate_count"] == 1
    assert payload["record_count"] == 0
    assert payload["cached_record_count"] == 1
    assert payload["cache_hit"] is True


@pytest.mark.anyio
async def test_upload_status_ignores_cancelled_other_extractor_run(db_session):
    literature = Literature(
        doi="10.26599/frict.cancelled-other-lane",
        title="Cancelled Other Lane",
        authors="Test Author",
        journal="Friction",
        year=2025,
        status="cancelled",
        scope_type="group_library",
        scope_key="group_library",
    )
    db_session.add(literature)
    await db_session.flush()
    db_session.add(
        ExtractionRun(
            run_id="cancelled-diffusion-run",
            literature_id=literature.id,
            extractor_type="diffusion",
            profile="standard",
            status="cancelled",
        )
    )
    await db_session.flush()

    status = await _upload_status_for_extractor(db_session, literature, "tribology")

    assert status == "pending"


def test_no_data_message_prefers_requested_extractor_run_over_shared_literature_error():
    message = _no_data_message_for_run(
        literature_message="摩擦通道没有结构化数据",
        run_message="扩散通道没有明确数值和单位",
        summary={"current_message": "扩散 summary"},
    )

    assert message == "扩散通道没有明确数值和单位"


def test_manual_diffusion_candidate_field_map_marks_graph_estimates_as_figure_evidence():
    payload = ManualDiffusionCandidatePayload(
        systemName="[BuPy][NTf2] in graphene slit",
        ionicLiquid="[BuPy][NTf2]",
        diffusingIon="cation",
        dCation=1.2,
        dUnit="10^-10 m2/s",
        sourcePage=6,
        sourceFigure="Fig. 10",
        evidence="Estimated from cation curve at d = 4 nm.",
    )

    field_map = _build_manual_diffusion_candidate_field_map(payload)

    assert field_map["d_cation"]["value"] == 1.2
    assert field_map["d_cation"]["evidence"]["source_type"] == "figure"
    assert field_map["d_cation"]["evidence"]["source_label"] == "Fig. 10"
    assert field_map["d_unit"]["value"] == "10^-10 m2/s"
    assert field_map["diffusing_ion"]["value"] == "cation"


def test_manual_diffusion_source_values_keep_raw_value_separate_from_canonical_value():
    payload = ManualDiffusionCandidatePayload(
        systemName="[BuPy][NTf2] in graphene slit",
        dCation=1.2,
        dUnit="10^-10 m2/s",
        sourceFigure="Fig. 4",
    )

    source_values = _build_manual_diffusion_source_values(payload)

    assert source_values["D_cation"]["raw_value"] == 1.2
    assert source_values["D_cation"]["raw_unit"] == "10^-10 m2/s"
    assert "canonical_value" not in source_values["D_cation"]
    assert "canonical_unit" not in source_values["D_cation"]

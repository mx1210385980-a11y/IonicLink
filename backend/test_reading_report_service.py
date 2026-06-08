from __future__ import annotations

import json

from sqlalchemy import select

import pytest

from models.db_models import Literature, LiteratureReadingReport, RecordCandidate, ResearchGroup, TribologyData, User
from services.reading_report_service import (
    READING_REPORT_PROMPT_VERSION,
    ReadingReportService,
    build_reading_report_prompt,
    _extract_core_context_from_report,
)
from services.llm.prompts import READING_REPORT_PROMPT


class FakeReportRuntime:
    def __init__(self):
        self.calls: list[str] = []
        self.fail_next = False

    async def generate_reading_report(self, *, prompt: str, content: str, pdf_path: str | None = None) -> dict:
        self.calls.append(prompt)
        if self.fail_next:
            raise RuntimeError("model unavailable")
        return {
            "report_markdown": "## Reading report\n\n- Ionic liquid: [EMIM][TFSI]\n- Current: 20 A",
            "model": "fake-report-model",
            "provider": "fake",
        }


def test_report_candidate_load_ignores_afm_setpoint_voltage():
    report_text = (
        "AFM friction measurements used a load control range from 0 to 3.5 V "
        "in AFM setpoint units. The report does not convert this setpoint "
        "voltage to a normal force."
    )

    context = _extract_core_context_from_report(report_text)

    assert context["load"] is None


def test_report_candidate_load_ignores_pressure_without_force_unit():
    report_text = (
        "The method summary reports Load: 2.4 GPa contact pressure at the interface, "
        "but no normal force in nN or N is provided."
    )

    context = _extract_core_context_from_report(report_text)

    assert context["load"] is None


def test_report_candidate_load_prefers_force_when_pressure_is_also_reported():
    report_text = (
        "A12 enters the superlubric state when the normal load exceeds ~30 nN, "
        "equivalent to about 2.4 GPa contact pressure."
    )

    context = _extract_core_context_from_report(report_text)

    assert context["load"] == "~30 nN"


async def _seed_literature(db_session) -> Literature:
    group = ResearchGroup(name="Report Group", slug="report-group")
    db_session.add(group)
    await db_session.flush()
    user = User(
        username="report-user",
        display_name="Report User",
        password_hash="hash",
        role="researcher",
        group_id=group.id,
    )
    db_session.add(user)
    await db_session.flush()
    literature = Literature(
        title="Current-assisted ionic liquid lubrication",
        doi="10.0000/report",
        authors="A. Researcher",
        journal="Ionic Tribology",
        year=2026,
        content="The paper reports [EMIM][TFSI] lubrication with current density and Fe2O3 additive ratio.",
        group_id=group.id,
        created_by_user_id=user.id,
        scope_type="group_library",
        scope_key="group_library",
    )
    db_session.add(literature)
    await db_session.flush()
    return literature


@pytest.mark.anyio
async def test_reading_report_generates_and_persists_markdown(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)

    report = await service.generate_for_literature(db_session, literature)

    assert report.status == "completed"
    assert "Ionic liquid" in report.report_markdown
    assert report.model == "fake-report-model"
    assert report.prompt_version == READING_REPORT_PROMPT_VERSION

    persisted = (
        await db_session.execute(
            select(LiteratureReadingReport).where(LiteratureReadingReport.literature_id == literature.id)
        )
    ).scalar_one()
    assert persisted.id == report.id
    assert persisted.report_markdown == report.report_markdown


@pytest.mark.anyio
async def test_reading_report_reuses_cached_completed_report(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)

    first = await service.generate_for_literature(db_session, literature)
    second = await service.generate_for_literature(db_session, literature)

    assert first.id == second.id
    assert len(runtime.calls) == 1


@pytest.mark.anyio
async def test_start_reading_report_job_returns_running_without_calling_model(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)

    report, should_start = await service.start_for_literature(db_session, literature)

    assert should_start is True
    assert report.status == "running"
    assert report.report_markdown == ""
    assert runtime.calls == []


@pytest.mark.anyio
async def test_reading_report_persists_failure_status(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    runtime.fail_next = True
    service = ReadingReportService(runtime=runtime)

    report = await service.generate_for_literature(db_session, literature, force=True)

    assert report.status == "failed"
    assert report.error_message == "model unavailable"
    assert report.report_markdown == ""


@pytest.mark.anyio
async def test_update_reading_report_persists_manual_markdown(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.start_for_literature(db_session, literature)

    report = await service.update_markdown(
        db_session,
        literature,
        markdown="## Edited report\n\nManual correction.",
        extractor_type="tribology",
    )

    assert report.status == "completed"
    assert report.report_markdown == "## Edited report\n\nManual correction."
    assert report.error_message is None
    assert report.prompt_version == READING_REPORT_PROMPT_VERSION
    assert runtime.calls == []

    persisted = (
        await db_session.execute(
            select(LiteratureReadingReport).where(LiteratureReadingReport.literature_id == literature.id)
        )
    ).scalar_one()
    assert persisted.report_markdown == report.report_markdown


@pytest.mark.anyio
async def test_update_reading_report_invalidates_unpromoted_draft_when_markdown_changes(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.generate_for_literature(db_session, literature)
    await service.generate_candidate_draft(db_session, literature)

    before = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalars().all()
    assert len(before) == 1
    assert before[0].record_origin == "reading_report_draft"

    await service.update_markdown(
        db_session,
        literature,
        markdown="## Edited report\n\nRegenerate candidates from this corrected report.",
        extractor_type="tribology",
    )

    remaining = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalars().all()
    assert remaining == []


@pytest.mark.anyio
async def test_update_reading_report_keeps_draft_when_markdown_is_unchanged(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    report = await service.generate_for_literature(db_session, literature)
    await service.generate_candidate_draft(db_session, literature)

    await service.update_markdown(
        db_session,
        literature,
        markdown=report.report_markdown,
        extractor_type="tribology",
    )

    remaining = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalars().all()
    assert len(remaining) == 1
    assert remaining[0].record_origin == "reading_report_draft"


@pytest.mark.anyio
async def test_candidate_draft_skips_new_review_candidate_when_final_records_exist(db_session):
    literature = await _seed_literature(db_session)
    final_record = TribologyData(
        literature_id=literature.id,
        material_name="Existing final",
        lubricant="[OLD][IL]",
        confidence=0.9,
    )
    db_session.add(final_record)
    await db_session.flush()
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.generate_for_literature(db_session, literature)

    result = await service.generate_candidate_draft(db_session, literature)

    assert result["candidate_count"] == 0
    assert result["candidate_ids"] == []
    assert result["status"] == "already_promoted"
    candidates = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalars().all()
    reading_report = (
        await db_session.execute(
            select(LiteratureReadingReport).where(LiteratureReadingReport.literature_id == literature.id)
        )
    ).scalar_one()
    final_records = (
        await db_session.execute(select(TribologyData).where(TribologyData.literature_id == literature.id))
    ).scalars().all()
    assert candidates == []
    assert [field["key"] for field in result["cleaning_preview"]["core_fields"]] == [
        "cation",
        "anion",
        "substrate_material",
        "temperature",
        "load",
        "cof",
    ]
    assert {field["layer"] for field in result["cleaning_preview"]["core_fields"]} == {"core"}
    assert result["cleaning_preview"]["extended_fields"][0]["layer"] == "extended"
    assert {field["key"] for field in result["cleaning_preview"]["extended_fields"]} >= {
        "material_name",
        "lubricant",
        "speed",
        "additive",
        "surface_roughness",
        "test_duration",
    }
    assert result["cleaning_preview"]["raw_flexible_json"]["source"] == "reading_report"
    assert result["cleaning_preview"]["raw_flexible_json"]["literature_id"] == literature.id
    assert result["cleaning_preview"]["raw_flexible_json"]["extractor_type"] == "tribology"
    assert result["cleaning_preview"]["raw_flexible_json"]["prompt_version"] == READING_REPORT_PROMPT_VERSION
    assert result["cleaning_preview"]["raw_flexible_json"]["report_id"] == reading_report.id
    assert result["cleaning_preview"]["core_summary"]["total"] == 6
    assert result["cleaning_preview"]["core_summary"]["ready"] < 6
    assert result["cleaning_preview"]["core_summary"]["can_promote"] is False
    assert set(result["cleaning_preview"]["core_summary"]["missing_keys"]) <= {
        "cation",
        "anion",
        "substrate_material",
        "temperature",
        "load",
        "cof",
    }
    assert len(final_records) == 1


@pytest.mark.anyio
async def test_candidate_draft_fills_explicit_core_context_from_general_report(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.update_markdown(
        db_session,
        literature,
        markdown=(
            "## Snapshot table\n\n"
            "| Topic | What to capture |\n"
            "| --- | --- |\n"
            "| System studied | [BMIM][BF4] film on HOPG graphite substrate |\n"
            "| Method / setup | AFM friction tests at 298 K under normal load 15 nN |\n"
            "| Main results | COF 0.04 |\n"
        ),
    )

    result = await service.generate_candidate_draft(db_session, literature)

    candidate = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalar_one()
    assert candidate.cation == "BMIM"
    assert candidate.anion == "BF4"
    assert candidate.substrate_material == "HOPG graphite substrate"
    assert candidate.temperature == "298 K"
    assert candidate.load_raw == "15 nN"
    assert candidate.cof_raw == "0.04"

    core_fields = {field["key"]: field for field in result["cleaning_preview"]["core_fields"]}
    assert core_fields["substrate_material"]["value"] == "HOPG graphite substrate"
    assert core_fields["temperature"]["value"] == "298 K"
    assert core_fields["load"]["value"] == "15 nN"
    assert core_fields["substrate_material"]["status"] == "ready"
    assert result["cleaning_preview"]["core_summary"] == {
        "total": 6,
        "ready": 6,
        "missing_keys": [],
        "missing_labels": [],
        "can_promote": True,
    }
    field_evidence = json.loads(candidate.field_evidence_json or "{}")
    assert field_evidence["substrate_material"]["raw_text"] == "HOPG graphite substrate"
    assert field_evidence["temperature"]["raw_text"] == "298 K"
    assert field_evidence["load"]["raw_text"] == "15 nN"


@pytest.mark.anyio
async def test_candidate_draft_treats_not_reported_core_text_as_missing(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.update_markdown(
        db_session,
        literature,
        markdown=(
            "## Snapshot table\n\n"
            "| Topic | What to capture |\n"
            "| --- | --- |\n"
            "| System studied | [BMIM][BF4] film on substrate not stated |\n"
            "| Method / setup | temperature: not reported; normal load: not provided |\n"
            "| Main results | COF not given |\n"
        ),
    )

    result = await service.generate_candidate_draft(db_session, literature)

    core_fields = {field["key"]: field for field in result["cleaning_preview"]["core_fields"]}
    assert core_fields["substrate_material"]["status"] == "review"
    assert core_fields["temperature"]["status"] == "review"
    assert core_fields["load"]["status"] == "review"
    assert core_fields["cof"]["status"] == "review"
    assert set(result["cleaning_preview"]["core_summary"]["missing_keys"]) >= {
        "substrate_material",
        "temperature",
        "load",
        "cof",
    }
    assert result["cleaning_preview"]["core_summary"]["can_promote"] is False


@pytest.mark.anyio
async def test_candidate_draft_keeps_graphical_abstract_source_label(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.update_markdown(
        db_session,
        literature,
        markdown=(
            "## Snapshot table\n\n"
            "| Topic | What to capture |\n"
            "| --- | --- |\n"
            "| System studied | [BMIM][BF4] film on HOPG graphite substrate |\n"
            "| Method / setup | AFM friction at 298 K; source: Graphical abstract |\n"
            "| Main results | COF 0.04 at normal load 30 nN |\n"
        ),
    )

    await service.generate_candidate_draft(db_session, literature)

    candidate = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalar_one()
    field_evidence = json.loads(candidate.field_evidence_json or "{}")
    assert candidate.source_figure == "Graphical abstract"
    source_field = next(
        field for field in field_evidence["_schema_layers"]["extended_fields"] if field["key"] == "source_location"
    )
    assert source_field["value"] == "Graphical abstract"


@pytest.mark.anyio
async def test_candidate_draft_fills_explicit_extended_context_without_requiring_it(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.update_markdown(
        db_session,
        literature,
        markdown=(
            "## Snapshot table\n\n"
            "| Topic | What to capture |\n"
            "| --- | --- |\n"
            "| System studied | [BMIM][BF4] film on mica substrate |\n"
            "| Method / setup | Sliding speed: 10 μm/s; surface roughness: 0.3 nm; test duration: 30 min |\n"
            "| Main results | COF 0.04 |\n"
            "| Evidence to verify | Additive: 5 wt% LiTFSI |\n"
        ),
    )

    result = await service.generate_candidate_draft(db_session, literature)

    candidate = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalar_one()
    assert candidate.speed_value == "10 μm/s"
    assert candidate.surface_roughness == "0.3 nm"

    extended_fields = {field["key"]: field for field in result["cleaning_preview"]["extended_fields"]}
    assert extended_fields["speed"]["value"] == "10 μm/s"
    assert extended_fields["surface_roughness"]["value"] == "0.3 nm"
    assert extended_fields["test_duration"]["value"] == "30 min"
    assert extended_fields["additive"]["value"] == "5 wt% LiTFSI"
    assert extended_fields["speed"]["status"] == "ready"
    assert extended_fields["test_duration"]["layer"] == "extended"

    field_evidence = json.loads(candidate.field_evidence_json or "{}")
    assert field_evidence["speed"]["raw_text"] == "10 μm/s"
    assert field_evidence["surface_roughness"]["raw_text"] == "0.3 nm"
    assert field_evidence["test_duration"]["raw_text"] == "30 min"
    assert field_evidence["additive"]["raw_text"] == "5 wt% LiTFSI"
    assert field_evidence["_schema_layers"]["raw_flexible_json"]["extended_context"]["additive"] == "5 wt% LiTFSI"


@pytest.mark.anyio
async def test_candidate_draft_refreshes_standard_schema_layers_before_review(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.update_markdown(
        db_session,
        literature,
        markdown=(
            "## Snapshot table\n\n"
            "| Topic | What to capture |\n"
            "| --- | --- |\n"
            "| System studied | [BMIM][BF4] film on HOPG graphite substrate |\n"
            "| Method / setup | AFM friction tests at 298 K under normal load 15 nN |\n"
            "| Main results | COF 0.04 |\n"
            "| Evidence to verify | Figure 2, page 4 |\n"
        ),
    )

    result = await service.generate_candidate_draft(db_session, literature)

    candidate = (
        await db_session.execute(select(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    ).scalar_one()
    field_evidence = json.loads(candidate.field_evidence_json or "{}")
    schema_layers = field_evidence["_schema_layers"]
    extended_keys = {field["key"] for field in schema_layers["extended_fields"]}
    result_extended_keys = {field["key"] for field in result["cleaning_preview"]["extended_fields"]}

    assert {"tribological_system", "potential", "method_context", "source_location"} <= extended_keys
    assert {"tribological_system", "potential", "method_context", "source_location"} <= result_extended_keys
    core_fields = {field["key"]: field for field in schema_layers["core_fields"]}
    assert core_fields["load"]["status"] == "ready"
    assert core_fields["load"]["value"] == "15 nN"
    assert core_fields["cof"]["status"] == "ready"
    assert core_fields["cof"]["value"] == "0.04"
    assert schema_layers["raw_flexible_json"]["source"] == "reading_report"
    assert schema_layers["raw_flexible_json"]["report_id"] is not None


@pytest.mark.anyio
async def test_candidate_draft_preserves_promoted_reading_report_draft_provenance(db_session):
    literature = await _seed_literature(db_session)
    final_record = TribologyData(
        literature_id=literature.id,
        material_name="Promoted final",
        lubricant="[EMIM][TFSI]",
        confidence=0.9,
    )
    db_session.add(final_record)
    await db_session.flush()
    literature_id = literature.id
    final_record_id = final_record.id
    promoted_candidate = RecordCandidate(
        literature_id=literature_id,
        promoted_record_id=final_record_id,
        material_name="Promoted draft",
        lubricant="[EMIM][TFSI]",
        record_origin="reading_report_draft",
        review_status="approved",
        confidence=0.9,
    )
    stale_unpromoted_candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Old unpromoted draft",
        lubricant="[OLD][IL]",
        record_origin="reading_report_draft",
        review_status="needs_review",
        confidence=0.2,
    )
    db_session.add_all([promoted_candidate, stale_unpromoted_candidate])
    await db_session.flush()
    promoted_candidate_id = promoted_candidate.id

    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.generate_for_literature(db_session, literature)

    result = await service.generate_candidate_draft(db_session, literature)

    db_session.expire_all()
    candidates = (
        await db_session.execute(
            select(RecordCandidate)
            .where(RecordCandidate.literature_id == literature_id)
            .order_by(RecordCandidate.id)
        )
    ).scalars().all()
    candidate_ids = {candidate.id for candidate in candidates}
    assert promoted_candidate_id in candidate_ids
    assert all(candidate.material_name != "Old unpromoted draft" for candidate in candidates)
    assert any(candidate.promoted_record_id == final_record_id for candidate in candidates)
    assert result["candidate_count"] == 0
    assert result["candidate_ids"] == []
    assert result["status"] == "already_promoted"
    assert result["official_record_count"] == 1
    assert len([candidate for candidate in candidates if not candidate.promoted_record_id]) == 0


@pytest.mark.anyio
async def test_candidate_draft_replaces_all_unpromoted_candidates_for_literature(db_session):
    literature = await _seed_literature(db_session)
    stale_deep_candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Stale deep extraction candidate",
        lubricant="[OLD][IL]",
        record_origin="strict_validated",
        review_status="needs_review",
        confidence=0.2,
    )
    promoted_final = TribologyData(
        literature_id=literature.id,
        material_name="Promoted final from earlier candidate",
        lubricant="[KEEP][IL]",
        confidence=0.9,
    )
    db_session.add_all([stale_deep_candidate, promoted_final])
    await db_session.flush()
    promoted_candidate = RecordCandidate(
        literature_id=literature.id,
        promoted_record_id=promoted_final.id,
        material_name="Promoted candidate provenance",
        lubricant="[KEEP][IL]",
        record_origin="strict_validated",
        review_status="approved",
        confidence=0.9,
    )
    db_session.add(promoted_candidate)
    await db_session.flush()
    promoted_candidate_id = promoted_candidate.id

    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.update_markdown(
        db_session,
        literature,
        markdown=(
            "## Snapshot table\n\n"
            "| Topic | What to capture |\n"
            "| --- | --- |\n"
            "| System studied | [BMIM][BF4] film on HOPG graphite substrate |\n"
            "| Method / setup | AFM friction tests at 298 K under normal load 15 nN |\n"
            "| Main results | COF 0.04 |\n"
        ),
    )

    result = await service.generate_candidate_draft(db_session, literature)

    candidates = (
        await db_session.execute(
            select(RecordCandidate)
            .where(RecordCandidate.literature_id == literature.id)
            .order_by(RecordCandidate.id)
        )
    ).scalars().all()
    assert {candidate.material_name for candidate in candidates} == {
        "Promoted candidate provenance",
    }
    assert candidates[0].id == promoted_candidate_id
    assert candidates[0].promoted_record_id == promoted_final.id
    assert result["status"] == "already_promoted"


@pytest.mark.anyio
async def test_candidate_draft_waits_for_ready_report_without_calling_model(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)
    await service.start_for_literature(db_session, literature)

    result = await service.generate_candidate_draft(db_session, literature)

    assert result["success"] is False
    assert result["candidate_count"] == 0
    assert result["status"] == "running"
    assert runtime.calls == []


@pytest.mark.anyio
async def test_candidate_draft_without_report_returns_not_ready_without_calling_model(db_session):
    literature = await _seed_literature(db_session)
    runtime = FakeReportRuntime()
    service = ReadingReportService(runtime=runtime)

    result = await service.generate_candidate_draft(db_session, literature)

    assert result["success"] is False
    assert result["candidate_count"] == 0
    assert result["status"] == "missing"
    assert runtime.calls == []


def test_reading_report_prompt_is_general_purpose_without_niche_checklist():
    prompt = build_reading_report_prompt(
        title="A paper",
        metadata={"journal": "Tribology Letters", "year": 2026},
    )

    assert READING_REPORT_PROMPT_VERSION == "reading-report-v3-general-table"
    assert "Markdown" in prompt
    assert "Snapshot table" in prompt
    assert "| Topic | What to capture |" in prompt
    assert "strict JSON" not in prompt
    assert "general-purpose" in prompt
    assert "normal large-model response" in prompt
    assert "Do not create dedicated sections named" in prompt
    assert "Operating conditions" in prompt
    assert "Additives" in prompt
    assert "iron-oxide additive ratio" not in prompt
    assert "Fe2O3" not in prompt
    assert "Fe3O4" not in prompt
    assert "current density" not in prompt
    assert "additive loading" not in prompt
    assert "special additives" not in prompt


def test_reading_report_system_prompt_avoids_template_specific_fields():
    assert "rigid extraction schema" in READING_REPORT_PROMPT
    assert "template-specific checklists" in READING_REPORT_PROMPT
    assert "Do not create dedicated sections named" in READING_REPORT_PROMPT
    assert "Operating conditions" in READING_REPORT_PROMPT
    assert "Additives" in READING_REPORT_PROMPT
    assert "iron-oxide additive ratio" not in READING_REPORT_PROMPT
    assert "Fe2O3" not in READING_REPORT_PROMPT
    assert "Fe3O4" not in READING_REPORT_PROMPT
    assert "current/current density" not in READING_REPORT_PROMPT
    assert "additive loading" not in READING_REPORT_PROMPT
    assert "special additives" not in READING_REPORT_PROMPT

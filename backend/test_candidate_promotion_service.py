import pytest

from models.db_models import DiffusionCandidate, DiffusionRecord, Literature, RecordCandidate, TribologyData
from services.candidate_promotion_service import (
    promote_diffusion_candidate,
    promote_tribology_candidate,
)


@pytest.mark.anyio
async def test_promote_tribology_candidate_creates_final_record(db_session):
    literature = Literature(
        doi="10.0000/tribology-promotion",
        title="Tribology candidate promotion",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        cof_value=0.18,
        cof_raw="0.18",
        source_page=3,
        field_evidence_json="{}",
        review_status="approved",
        record_origin="llm_extraction",
        confidence=0.87,
    )
    db_session.add(candidate)
    await db_session.flush()

    promoted = await promote_tribology_candidate(db_session, candidate)

    assert isinstance(promoted, TribologyData)
    assert promoted.id is not None
    assert candidate.promoted_record_id == promoted.id
    assert promoted.literature_id == literature.id
    assert promoted.material_name == "Mica"
    assert promoted.lubricant == "[BMIM][BF4]"
    assert promoted.cof_value == 0.18
    assert promoted.record_origin == "review_promoted_candidate"


@pytest.mark.anyio
async def test_promote_tribology_candidate_updates_existing_promoted_record(db_session):
    literature = Literature(
        doi="10.0000/tribology-promotion-update",
        title="Tribology candidate promotion update",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    promoted = TribologyData(
        literature_id=literature.id,
        material_name="Old",
        lubricant="[OLD][IL]",
        cof_value=0.1,
    )
    db_session.add(promoted)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        promoted_record_id=promoted.id,
        material_name="Graphite",
        lubricant="[EMIM][TFSI]",
        cof_value=0.03,
        cof_raw="0.03",
        field_evidence_json="{}",
        review_status="approved",
        confidence=0.91,
    )
    db_session.add(candidate)
    await db_session.flush()

    updated = await promote_tribology_candidate(db_session, candidate)

    assert updated.id == promoted.id
    assert candidate.promoted_record_id == promoted.id
    assert updated.material_name == "Graphite"
    assert updated.lubricant == "[EMIM][TFSI]"
    assert updated.cof_value == 0.03


@pytest.mark.anyio
async def test_promote_tribology_candidate_backfills_probe_from_literature_context(db_session):
    literature = Literature(
        doi="10.1007/s40544-021-0486-4",
        title="Probe context promotion",
        authors="Test Author",
        journal="Friction",
        year=2022,
        content="""
        Friction force measurements were performed in contact mode.
        Si3N4 cantilever tips (DNP-10, a tip with tip radius of 20 nm)
        were employed with a scan rate of 2 Hz and scan size of 5 um x 5 um.
        The force-distance curves were captured with AFM glass colloidal probe
        (20 um in dimension). Fig. 5 reports friction force measurements
        with silicon nitride AFM tip on Ti surface.
        """,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = RecordCandidate(
        literature_id=literature.id,
        material_name="Titanium",
        lubricant="[P6,6,6,14][DCA]",
        cof_value=0.1,
        cof_raw="0.10",
        probe_material=None,
        probe_geometry="Colloid probe",
        probe_radius="20 nm",
        substrate_material="Titanium",
        source_page=6,
        source_figure="Table 1",
        field_evidence_json="{}",
        review_status="approved",
        confidence=0.91,
    )
    db_session.add(candidate)
    await db_session.flush()

    promoted = await promote_tribology_candidate(db_session, candidate)

    assert promoted.probe_material == "Silicon nitride"
    assert promoted.probe_geometry == "Tip"
    assert promoted.probe_radius == "20 nm"


@pytest.mark.anyio
async def test_promote_diffusion_candidate_creates_final_record(db_session):
    literature = Literature(
        doi="10.0000/diffusion-promotion",
        title="Diffusion candidate promotion",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
    )
    db_session.add(literature)
    await db_session.flush()

    candidate = DiffusionCandidate(
        literature_id=literature.id,
        system_name="[BMIM][BF4] in silica",
        ionic_liquid="[BMIM][BF4]",
        d_total=2.3,
        d_unit="10^-12 m2/s",
        source_page=4,
        field_evidence_json="{}",
        review_status="approved",
        confidence=0.82,
    )
    db_session.add(candidate)
    await db_session.flush()

    promoted = await promote_diffusion_candidate(db_session, candidate)

    assert isinstance(promoted, DiffusionRecord)
    assert promoted.id is not None
    assert candidate.promoted_record_id == promoted.id
    assert promoted.literature_id == literature.id
    assert promoted.system_name == "[BMIM][BF4] in silica"
    assert promoted.ionic_liquid == "[BMIM][BF4]"
    assert promoted.d_total == 2.3
    assert promoted.record_origin == "review_promoted_candidate"

from models.db_models import DiffusionCandidate, DiffusionRecord
from routers.data_explorer import _diffusion_library_matches_focus, _diffusion_library_rows


def test_diffusion_library_focus_matches_literature_and_record_ids():
    row = {
        "id": 12,
        "library_id": "record:12",
        "literature_id": 34,
        "literatureId": 34,
    }

    assert _diffusion_library_matches_focus(row, literature_id=34, record_id=None)
    assert _diffusion_library_matches_focus(row, literature_id=None, record_id=12)
    assert _diffusion_library_matches_focus(row, literature_id=34, record_id=12)
    assert not _diffusion_library_matches_focus(row, literature_id=35, record_id=None)
    assert not _diffusion_library_matches_focus(row, literature_id=None, record_id=13)


def test_diffusion_library_focus_can_disambiguate_candidate_and_record_ids():
    candidate_row = {
        "id": 12,
        "library_id": "candidate:12",
        "review_entity_type": "candidate",
        "reviewEntityType": "candidate",
        "literature_id": 34,
    }
    record_row = {
        "id": 12,
        "library_id": "record:12",
        "review_entity_type": "record",
        "reviewEntityType": "record",
        "literature_id": 34,
    }

    assert _diffusion_library_matches_focus(candidate_row, record_id=12, entity_type="candidate")
    assert not _diffusion_library_matches_focus(record_row, record_id=12, entity_type="candidate")
    assert _diffusion_library_matches_focus(record_row, record_id=12, entity_type="record")
    assert not _diffusion_library_matches_focus(candidate_row, record_id=12, entity_type="record")


def test_diffusion_library_rows_do_not_duplicate_candidates():
    rows = _diffusion_library_rows(
        [],
        [
            DiffusionCandidate(
                id=7,
                literature_id=34,
                system_name="Graphene slit",
                ionic_liquid="[BMIM][BF4]",
                d_total=1.0,
                d_cation=None,
                d_anion=None,
                d_unit="10^-12 m2/s",
                field_evidence_json="{}",
            )
        ],
    )

    assert len(rows) == 1
    assert rows[0]["library_id"] == "candidate:7"


def test_diffusion_library_rows_put_latest_candidates_before_records():
    rows = _diffusion_library_rows(
        [
            DiffusionRecord(
                id=3,
                literature_id=34,
                system_name="Final slit",
                ionic_liquid="[BMIM][BF4]",
                d_total=0.8,
                d_unit="10^-12 m2/s",
                field_evidence_json="{}",
            )
        ],
        [
            DiffusionCandidate(
                id=7,
                literature_id=34,
                system_name="Older candidate",
                ionic_liquid="[BMIM][BF4]",
                d_total=1.0,
                d_unit="10^-12 m2/s",
                field_evidence_json="{}",
            ),
            DiffusionCandidate(
                id=9,
                literature_id=34,
                system_name="Latest candidate",
                ionic_liquid="[EMIM][TFSI]",
                d_total=1.4,
                d_unit="10^-12 m2/s",
                field_evidence_json="{}",
            ),
        ],
    )

    assert [row["library_id"] for row in rows] == ["candidate:9", "candidate:7", "record:3"]

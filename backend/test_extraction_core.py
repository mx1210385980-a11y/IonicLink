from models.tribology import TribologyData
from services.file_service import _build_record_uniqueness_key
from services.llm.deduplication import deduplicate_records
from services.llm.utils import has_core_quantitative_signal


def test_has_core_quantitative_signal_accepts_afm_layering_record():
    record = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.6 nm",
        "temperature": "298.15 K",
        "source": "Fig. 1c",
        "evidence": "The step period of 0.6 nm was consistent with the size of the ion pair.",
    }

    assert has_core_quantitative_signal(record) is True


def test_has_core_quantitative_signal_rejects_purely_qualitative_record():
    record = {
        "material_name": "Mica",
        "ionic_liquid": "[BMIM][PF6]",
        "notes": "friction decreases with thickness",
        "evidence": "A qualitative trend only.",
    }

    assert has_core_quantitative_signal(record) is False


def test_deduplication_preserves_non_cof_afm_record():
    records = [
        TribologyData(
            material_name="Mica",
            ionic_liquid="[C3mpyr][FSI]",
            layer_spacing_delta="0.6 nm",
            residual_film_thickness_d="3 nm",
            source="Fig. 1c",
            evidence="Five oscillations were measured and the step period was 0.6 nm.",
        )
    ]

    deduped = deduplicate_records(records)

    assert len(deduped) == 1
    assert deduped[0].layer_spacing_delta == "0.6 nm"


def test_deduplication_does_not_merge_distinct_afm_measurements():
    records = [
        TribologyData(
            material_name="Mica",
            ionic_liquid="[HMIM][NTf2]",
            surface_roughness="RMS 2 nm",
            source="Fig. 10a",
            evidence="Representative force curves with a smooth colloid probe (RMS = 2 nm).",
        ),
        TribologyData(
            material_name="Mica",
            ionic_liquid="[HMIM][NTf2]",
            surface_roughness="RMS 9 nm",
            source="Fig. 10a",
            evidence="Representative force curves with a rough colloid probe (RMS = 9 nm).",
        ),
    ]

    deduped = deduplicate_records(records)

    assert len(deduped) == 2


def test_record_uniqueness_key_includes_afm_measurements():
    left = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.6 nm",
        "source": "Fig. 1c",
    }
    right = {
        "material_name": "Mica",
        "ionic_liquid": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.7 nm",
        "source": "Fig. 1c",
    }

    assert _build_record_uniqueness_key(left) != _build_record_uniqueness_key(right)

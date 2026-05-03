from utils.experiment_profile import build_experiment_profile, record_matches_training_view
from utils.structured_conditions import derive_tribological_system


def test_macro_ball_on_disk_profile_routes_to_macro_performance():
    profile = build_experiment_profile(
        {
            "regime": "macroscopic ball-on-disk boundary lubrication",
            "cof": "0.12",
            "load": "5 N",
        }
    )

    assert profile["scale"] == "macroscale"
    assert profile["method"] == "ball_on_disk"
    assert profile["instrument"] == "tribometer"
    assert profile["measurement_type"] == "cof"
    assert profile["profile"] == "macro"
    assert profile["training_view"] == "macro_performance"


def test_afm_profile_routes_to_surface_response():
    profile = build_experiment_profile(
        {
            "source": "AFM friction loop",
            "evidence": "Colloidal probe AFM lateral force at 20 nN normal load.",
            "friction_force": "1.2 nN",
            "load": "20 nN",
        }
    )

    assert profile["scale"] == "nanoscale"
    assert profile["method"] == "afm_colloidal_probe"
    assert profile["instrument"] == "afm"
    assert profile["measurement_type"] in {"friction_force", "lateral_force"}
    assert profile["profile"] == "afm"
    assert profile["training_view"] == "afm_surface_response"


def test_tribological_system_derivation_carries_training_view_fields():
    system = derive_tribological_system("static friction, macroscopic ball-on-3-pins")

    assert system["scale"] == "macroscale"
    assert system["method"] == "ball_on_3_pins"
    assert system["profile"] == "macro"
    assert system["training_view"] == "macro_performance"


def test_cross_scale_view_accepts_macro_and_afm_but_not_unknown():
    macro = {"regime": "ball-on-disk", "cof": "0.1"}
    afm = {"source": "AFM", "friction_force": "2 nN"}
    unknown = {"source": "Table 1", "cof": "0.1"}

    assert record_matches_training_view(macro, "cross_scale")
    assert record_matches_training_view(afm, "cross_scale")
    assert not record_matches_training_view(unknown, "cross_scale")

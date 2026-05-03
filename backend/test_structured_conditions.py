from utils.structured_conditions import derive_load_conditions, derive_tribological_system


def test_derive_composite_load_conditions():
    payload = derive_load_conditions("5 N total load; 2.36 N per pin")

    assert payload["value_type"] == "composite"
    assert payload["system_total_load_N"] == 5.0
    assert payload["contact_load_per_unit_N"] == 2.36
    assert payload["contact_unit_type"] == "pin"


def test_derive_tribological_system_from_mixed_regime_text():
    payload = derive_tribological_system("static friction, macroscopic ball-on-3-pins")

    assert payload["friction_regime"] == "static"
    assert payload["contact_geometry"] == "ball_on_3_pins"
    assert payload["scale"] == "macroscale"
    assert payload["method"] == "ball_on_3_pins"
    assert payload["training_view"] == "macro_performance"

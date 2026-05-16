from scripts.backfill_tribology_scale import classify_record


def _row(**overrides):
    base = {
        "id": 1,
        "literature_id": 1,
        "material_name": "Mica",
        "lubricant": "[EMIM][TFSI]",
        "cof_value": 0.1,
        "cof_raw": "0.1",
        "load_value": "",
        "load_raw": "",
        "speed_value": "",
        "shear_rate": "",
        "probe_geometry": "",
        "probe_radius": "",
        "probe_material": "",
        "substrate_material": "",
        "regime": "",
        "source": "",
        "source_figure": "",
        "evidence": "",
        "tribological_system_json": "",
        "title": "Untitled",
        "journal": "",
    }
    return {**base, **overrides}


def test_classifies_existing_macro_system():
    payload, changed = classify_record(
        _row(
            tribological_system_json='{"scale":"macro","contact_geometry":"ball_on_3_pins","method":"ball_on_3_pins"}',
        )
    )

    assert changed
    assert payload["scale"] == "macroscale"
    assert payload["training_view"] == "macro_performance"


def test_classifies_afm_title_as_nanoscale():
    payload, _ = classify_record(
        _row(
            title="Effect of Hydrogen Bonding between Ions of Like Charge on the Boundary Layer Friction of Hydroxy-Functionalized Ionic Liquids",
            evidence="Atomic force microscopy measured boundary layer friction at mica surfaces.",
        )
    )

    assert payload["scale"] == "nanoscale"
    assert payload["training_view"] == "afm_surface_response"


def test_classifies_lateral_force_curve_as_nanoscale():
    payload, _ = classify_record(
        _row(
            title="Surface-active ionic liquids as lubricant additives to hexadecane and diethyl succinate",
            evidence="Fig. 5. Lateral force vs normal load on stainless steel immersed in ionic liquid additive.",
        )
    )

    assert payload["scale"] == "nanoscale"

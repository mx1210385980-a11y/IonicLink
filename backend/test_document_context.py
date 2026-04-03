from utils.document_context import (
    apply_experimental_document_context,
    extract_experimental_document_context,
)


def test_extract_experimental_document_context_recovers_shared_conditions():
    page_texts = {
        5: """
        EXPERIMENTAL
        An AISI 316 stainless steel-coated quartz crystal microbalance sensor was used as the substrate.
        The roughness of the stainless steel was measured by AFM. The RMS roughness was 0.89 nm.
        """,
        6: """
        Normal and friction force measurements were performed using a Bruker Multimode 8 AFM.
        Sharp Si tips with a nominal tip radius of 8 nm were used for this study.
        Friction measurements were performed using a scan size of 100 nm at a scan speed of 6.5 um s-1
        while the normal load was increased from 0 to 100 nN.
        Surface chromium readily reacts with oxygen in air to form a passivating layer of chromium oxide.
        """,
    }

    context = extract_experimental_document_context(page_texts)

    assert context["substrate_material"] == "Stainless steel"
    assert context["probe_material"] == "Silicon"
    assert context["probe_geometry"] == "Tip"
    assert context["probe_radius"] == "8 nm"
    assert context["speed_value"] == "6.5 μm/s"
    assert context["load_value"] == "0-100 nN"
    assert context["substrate_roughness"] == "RMS 0.89 nm"
    assert context["substrate_coating"] == "Chromium oxide"


def test_apply_experimental_document_context_overrides_false_probe_default():
    context = {
        "probe_material": "Silicon",
        "probe_geometry": "Tip",
        "probe_radius": "8 nm",
        "load_value": "0-100 nN",
        "speed_value": "6.5 μm/s",
        "substrate_material": "Stainless steel",
        "substrate_roughness": "RMS 0.89 nm",
    }
    record = {
        "material_name": "Stainless steel",
        "probe_material": "Stainless steel",
        "substrate_material": "Stainless steel",
        "probe_geometry": None,
        "probe_radius": None,
        "probe_roughness": None,
        "load_value": None,
        "speed_value": None,
    }

    enriched = apply_experimental_document_context(
        record,
        context,
        override_probe_material=True,
    )

    assert enriched["probe_material"] == "Silicon"
    assert enriched["probe_geometry"] == "Tip"
    assert enriched["probe_radius"] == "8 nm"
    assert enriched["load_value"] == "0-100 nN"
    assert enriched["speed_value"] == "6.5 μm/s"
    assert enriched["surface_roughness"] == "RMS 0.89 nm"

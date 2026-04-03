from utils.document_context import (
    apply_experimental_document_context,
    extract_experimental_document_context,
    normalize_surface_roughness_value,
)


def test_normalize_surface_roughness_explicit_descriptor():
    assert normalize_surface_roughness_value("RMS 0.89 nm") == "RMS 0.89 nm"


def test_normalize_surface_roughness_semantic_mapping():
    assert normalize_surface_roughness_value("freshly cleaved mica") == "~0.1 nm (Estimated)"


def test_extract_document_context_estimated_roughness():
    context = extract_experimental_document_context(
        {
            0: "Materials and methods. Freshly cleaved mica was used as the substrate for all measurements.",
        }
    )

    assert context["substrate_material"] == "Mica"
    assert context["substrate_roughness"] == "~0.1 nm (Estimated)"
    assert context["surface_roughness"] == "~0.1 nm (Estimated)"


def test_apply_document_context_backfills_missing_roughness():
    record = {
        "material_name": "Mica",
        "substrate_material": "Mica",
        "evidence": "The measurements were performed on freshly cleaved mica.",
    }

    enriched = apply_experimental_document_context(record, {})

    assert enriched["substrate_roughness"] == "~0.1 nm (Estimated)"
    assert enriched["surface_roughness"] == "~0.1 nm (Estimated)"

from services.score_service import calculate_confidence_details


def test_grounded_record_scores_high():
    details = calculate_confidence_details(
        {
            "material_name": "Au(111)",
            "lubricant": "[BMIM][BF4]",
            "cof": "0.12",
            "load": "10 nN",
            "speed": "5 um/s",
            "temperature": "298 K",
            "source": "Fig. 2a",
            "source_page": 4,
            "evidence": "COF was 0.12 for [BMIM][BF4] on Au(111).",
            "review_status": "approved",
            "field_evidence_json": {
                "material": {
                    "value": "Au(111)",
                    "review_state": "confirmed",
                    "status": "grounded",
                    "evidence": {"page": 4, "quote": "Au(111)", "bbox": [1, 2, 3, 4], "source_label": "Fig. 2a"},
                },
                "ionic_liquid": {
                    "value": "[BMIM][BF4]",
                    "review_state": "confirmed",
                    "status": "grounded",
                    "evidence": {"page": 4, "quote": "[BMIM][BF4]", "bbox": [1, 2, 3, 4], "source_label": "Fig. 2a"},
                },
                "cof": {
                    "value": "0.12",
                    "review_state": "confirmed",
                    "status": "grounded",
                    "evidence": {"page": 4, "quote": "COF was 0.12", "bbox": [1, 2, 3, 4], "source_label": "Fig. 2a"},
                },
            },
        }
    )

    assert details["score"] >= 0.9
    assert details["components"]["grounding"] >= 0.9


def test_stored_high_confidence_does_not_override_missing_evidence():
    details = calculate_confidence_details(
        {
            "material_name": "Unknown",
            "lubricant": "",
            "confidence": 0.97,
            "model_confidence": 0.97,
        }
    )

    assert details["score"] < 0.4
    assert any(item["reason"] == "missing_lubricant" for item in details["penalties"])


def test_pending_review_caps_otherwise_strong_record_below_ninety():
    details = calculate_confidence_details(
        {
            "material_name": "Au(111)",
            "lubricant": "[BMIM][BF4]",
            "cation": "BMIM",
            "anion": "BF4",
            "il_smiles": "C[N+]1=CN(C)C=C1.F[B-](F)(F)F",
            "cof": "0.12",
            "load": "10 nN",
            "speed": "5 um/s",
            "temperature": "298 K",
            "potential": "0 V",
            "water_content": "Dry",
            "surface_roughness": "1 nm",
            "review_status": "pending_review",
            "field_evidence_json": {
                "material": {"value": "Au(111)", "status": "grounded", "evidence": {"page": 4, "quote": "Au(111)", "bbox": [1, 2, 3, 4], "source_label": "Fig. 2a"}},
                "ionic_liquid": {"value": "[BMIM][BF4]", "status": "grounded", "evidence": {"page": 4, "quote": "[BMIM][BF4]", "bbox": [1, 2, 3, 4], "source_label": "Fig. 2a"}},
                "cof": {"value": "0.12", "status": "grounded", "evidence": {"page": 4, "quote": "COF was 0.12", "bbox": [1, 2, 3, 4], "source_label": "Fig. 2a"}},
            },
        }
    )

    assert details["score"] <= 0.89
    assert any(item["reason"] == "pending_review_ceiling" for item in details["penalties"])


def test_flagged_required_field_lowers_confidence():
    base = {
        "material_name": "Mica",
        "lubricant": "[C3mpyr][FSI]",
        "layer_spacing_delta": "0.6 nm",
        "field_evidence_json": {
            "material": {"value": "Mica", "status": "grounded", "evidence": {"page": 3, "quote": "Mica"}},
            "ionic_liquid": {"value": "[C3mpyr][FSI]", "status": "grounded", "evidence": {"page": 3, "quote": "[C3mpyr][FSI]"}},
            "layer_spacing_delta": {"value": "0.6 nm", "status": "grounded", "evidence": {"page": 3, "quote": "0.6 nm"}},
        },
    }
    flagged = {
        **base,
        "field_evidence_json": {
            **base["field_evidence_json"],
            "layer_spacing_delta": {
                **base["field_evidence_json"]["layer_spacing_delta"],
                "review_state": "flagged",
            },
        },
    }

    assert calculate_confidence_details(flagged)["score"] < calculate_confidence_details(base)["score"]

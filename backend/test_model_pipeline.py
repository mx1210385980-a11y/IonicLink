from __future__ import annotations

import copy
import json

from models.db_models import CleanedDataset
from services.model_cleaning_service import DEFAULT_CLEANING_WORKBENCH_OPTIONS, ModelCleaningService
from services.model_training_service import ModelTrainingService


def _cleaning_row(
    cof_value: float,
    cation_smiles: str,
    anion_smiles: str,
    temperature: float,
    speed: float,
    load: float,
    potential: float,
) -> dict[str, object]:
    return {
        "record_id": int(cof_value * 1000),
        "literature_id": 1,
        "material_name": "Steel",
        "lubricant": "Synthetic IL",
        "confidence": 0.95,
        "cof_value": cof_value,
        "cation_smiles": cation_smiles,
        "anion_smiles": anion_smiles,
        "temperature": None,
        "speed_value": None,
        "load_value": None,
        "load_raw": None,
        "potential": None,
        "water_content": None,
        "film_thickness": None,
        "alkyl_chain_length": 8,
        "normalized_temperature_c": temperature,
        "normalized_speed_mps": speed,
        "normalized_load_n": load,
        "normalized_potential_v": potential,
        "normalized_water_content_ppm": 20.0,
        "normalized_film_thickness_nm": 85.0,
        "normalized_alkyl_chain_length": 8.0,
        "repaired_fields": [],
        "is_target_outlier": False,
    }


def test_cleaning_service_builds_pca_matrix_payload() -> None:
    service = ModelCleaningService()
    rows = [
        _cleaning_row(0.10, "C[N+](C)(C)C", "F[B-](F)(F)F", 25.0, 0.12, 4.5, 0.1),
        _cleaning_row(0.12, "CC[N+](C)(C)C", "O=S(=O)([O-])C(F)(F)F", 35.0, 0.14, 4.8, 0.2),
        _cleaning_row(0.14, "CCC[N+](C)(C)C", "F[P-](F)(F)(F)(F)F", 45.0, 0.18, 5.0, 0.3),
        _cleaning_row(0.16, "CCCC[N+](C)(C)C", "Cl[Al-](Cl)(Cl)Cl", 55.0, 0.22, 5.4, 0.4),
        _cleaning_row(0.18, "CCO[N+](C)(C)C", "O=S(=O)([N-]S(=O)(=O)C(F)(F)F)C(F)(F)F", 65.0, 0.26, 5.8, 0.5),
        _cleaning_row(0.20, "CCCO[N+](C)(C)C", "C(=O)([O-])C(F)(F)F", 75.0, 0.30, 6.2, 0.6),
    ]
    options = copy.deepcopy(DEFAULT_CLEANING_WORKBENCH_OPTIONS)
    options["feature_config"] = {
        "use_pca": True,
        "n_components": 3,
        "keep_features": ["temperature", "speed", "load", "potential"],
    }

    payload = service._build_matrix_payload(rows, target_key="cof", options=options)

    assert payload["target_column"] == "Target_COF"
    assert payload["feature_columns"][:4] == ["Temperature", "Speed", "Load", "Potential"]
    assert payload["feature_columns"][4:] == ["PCA_1", "PCA_2", "PCA_3"]
    assert payload["matrix_columns"] == ["Target_COF", "Temperature", "Speed", "Load", "Potential", "PCA_1", "PCA_2", "PCA_3"]
    assert payload["pca_info"]["enabled"] is True
    assert payload["pca_info"]["actual_components"] == 3
    assert payload["pca_info"]["explained_variance_ratio"] is not None
    assert payload["feature_coverage"][0]["label"] == "FP_PCA_1"
    assert payload["feature_coverage"][2]["label"] == "FP_PCA_3"
    assert set(payload["rows"][0].keys()) == set(payload["matrix_columns"])
    assert all(isinstance(value, float) or value is None for value in payload["rows"][0].values())


def test_training_service_uses_saved_matrix_columns_automatically() -> None:
    rows = []
    for index in range(12):
        rows.append({
            "Target_COF": 0.08 + index * 0.01,
            "Temperature": 25.0 + index,
            "Speed": None if index == 3 else 0.11 + index * 0.01,
            "PCA_1": 1.5 + index * 0.05,
        })

    metadata = {
        "summary": {
            "raw_records": 12,
            "target_ready_records": 12,
            "chemistry_ready_records": 12,
            "training_ready_records": 12,
            "dropped_by_reason": {
                "missing_target": 0,
                "missing_cation_smiles": 0,
                "missing_anion_smiles": 0,
            },
            "rules": {
                "drop_missing_target": True,
                "require_dual_smiles": True,
            },
        },
        "source_scope": {
            "requested_mode": "group_library_fallback",
            "resolved_scope_key": "group_library",
            "resolved_scope_type": "group_library",
            "label": "Group library",
            "used_fallback": False,
        },
        "target": {
            "key": "cof",
            "label": "Coefficient of Friction (COF)",
        },
        "target_column": "Target_COF",
        "feature_columns": ["Temperature", "Speed", "PCA_1"],
        "matrix_columns": ["Target_COF", "Temperature", "Speed", "PCA_1"],
        "pca_info": {
            "enabled": True,
            "requested_components": 1,
            "actual_components": 1,
            "explained_variance_ratio": 0.91,
        },
    }

    dataset = CleanedDataset(
        name="Matrix dataset",
        description=None,
        target_key="cof",
        source_scope_type="group_library",
        source_scope_key="group_library",
        group_id=1,
        workspace_id=None,
        created_by_user_id=1,
        scope_type="workspace",
        scope_key="workspace:test",
        row_count=len(rows),
        config_json=json.dumps({}),
        summary_json=json.dumps(metadata),
        rows_json=json.dumps(rows),
    )

    service = ModelTrainingService()
    summary = service.summarize_saved_dataset(dataset)
    prepared = service._prepare_saved_dataset(
        rows,
        {
            "algorithm": "gradient_boosting",
            "hyperparameters": {"n_estimators": 50, "learning_rate": 0.06, "max_depth": 3},
            "data_options": {"validation_split": 0.2, "random_seed": 42, "max_records": None},
        },
        metadata,
    )

    assert summary["dataset"]["target_column"] == "Target_COF"
    assert summary["dataset"]["feature_columns"] == ["Temperature", "Speed", "PCA_1"]
    assert summary["dataset"]["feature_dimensions"] == 3
    assert prepared["dataset"]["feature_dimensions"] == 3
    assert prepared["feature_blocks"][0]["features"] == ["Temperature", "Speed", "PCA_1"]
    assert prepared["warnings"] == ["Missing numeric values in the saved matrix were median-imputed during training."]
    assert prepared["X_train"].shape[1] == 3
    assert prepared["X_val"].shape[1] == 3

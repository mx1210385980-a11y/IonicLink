from __future__ import annotations

import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from models.db_models import CleanedDataset
from security import RequestScope
from routers import model_training as model_training_router
from services.model_cleaning_service import DEFAULT_CLEANING_WORKBENCH_OPTIONS, ModelCleaningService
from services import model_training_service as model_training_service_module
from services.model_training_service import ModelTrainingService, _feature_value, _parse_water_content_ppm
from services.query_service import _load_matches_filter
from services.unit_converter import parse_force_range_to_newtons, parse_force_to_newtons


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
        "normalized_load_min_n": load,
        "normalized_load_max_n": load,
        "normalized_load_span_n": 0.0,
        "normalized_load_is_range": 0.0,
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


def test_algorithm_options_include_catboost_when_dependency_is_available(monkeypatch) -> None:
    monkeypatch.setattr(model_training_service_module, "CATBOOST_AVAILABLE", True)
    service = ModelTrainingService()

    options = service._algorithm_options()

    assert any(option["key"] == "catboost" for option in options)


@pytest.mark.anyio
async def test_training_service_runs_catboost_rounds(monkeypatch) -> None:
    class FakeCatBoostRegressor:
        def __init__(self, **kwargs):
            self.iterations = kwargs["iterations"]

        def fit(self, X, y, verbose=False):
            self._mean = float(sum(y) / len(y))
            return self

        def predict(self, X):
            return [self._mean for _ in range(len(X))]

    rows = []
    for index in range(12):
        rows.append({
            "Target_COF": 0.08 + index * 0.01,
            "Temperature": 25.0 + index,
            "Speed": 0.11 + index * 0.01,
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
            "requested_mode": "workspace",
            "resolved_scope_key": "workspace:1",
            "resolved_scope_type": "workspace",
            "label": "Current workspace",
            "used_fallback": False,
        },
        "target": {
            "key": "cof",
            "label": "Coefficient of Friction (COF)",
        },
        "target_column": "Target_COF",
        "feature_columns": ["Temperature", "Speed", "PCA_1"],
        "matrix_columns": ["Target_COF", "Temperature", "Speed", "PCA_1"],
        "pca_info": None,
    }

    service = ModelTrainingService()
    task = model_training_service_module.TrainingTaskState(
        task_id="catboost-task",
        owner_user_id=1,
        group_id=1,
        scope_key="workspace:1",
        config={
            "algorithm": "catboost",
            "hyperparameters": {"n_estimators": 3, "learning_rate": 0.06, "max_depth": 3},
            "data_options": {"validation_split": 0.2, "random_seed": 42, "max_records": None},
        },
    )

    async def fake_sleep(_seconds: float):
        return None

    monkeypatch.setattr(model_training_service_module, "CATBOOST_AVAILABLE", True)
    monkeypatch.setattr(model_training_service_module, "CatBoostRegressor", FakeCatBoostRegressor)
    monkeypatch.setattr(model_training_service_module.asyncio, "sleep", fake_sleep)

    await service._run_training(task, rows, metadata["source_scope"], metadata)

    assert task.status == "completed"
    assert task.current_round == 20
    assert len(task.history) == 20
    assert task.dataset["feature_dimensions"] == 3


def test_parse_water_content_ppm_treats_il_prefix_as_label_not_negative_sign() -> None:
    assert _parse_water_content_ppm("IL-44%") == 440000.0
    assert _parse_water_content_ppm("IL-0%") == 0.0
    assert _parse_water_content_ppm("Ambient (R.H. = 22%)") == 220000.0


def test_force_range_values_are_converted_to_newton_bounds_and_midpoint() -> None:
    assert parse_force_range_to_newtons("0-250 nN") == (0.0, 2.5e-07)
    assert parse_force_to_newtons("0-250 nN") == 1.25e-07


def test_feature_value_expands_load_range_into_range_features() -> None:
    record = {
        "load_value": "0-250 nN",
        "load_raw": "0-250 nN",
        "normalized_load_n": None,
        "normalized_load_min_n": None,
        "normalized_load_max_n": None,
        "normalized_load_span_n": None,
        "normalized_load_is_range": None,
    }

    assert _feature_value(record, "load") == 1.25e-07
    assert _feature_value(record, "load_min") == 0.0
    assert _feature_value(record, "load_max") == 2.5e-07
    assert _feature_value(record, "load_span") == 2.5e-07
    assert _feature_value(record, "load_is_range") == 1.0


def test_load_filter_uses_range_overlap_instead_of_first_numeric_token() -> None:
    assert _load_matches_filter("0-250 nN", 1.0e-07, 1.2e-07) is True
    assert _load_matches_filter("0-250 nN", 3.0e-07, 4.0e-07) is False
    assert _load_matches_filter("55 nN", 5.0e-08, 6.0e-08) is True
    assert _load_matches_filter("55 nN", 6.0e-08, 7.0e-08) is False


def test_cleaning_service_upgrades_legacy_load_keep_features() -> None:
    service = ModelCleaningService()
    upgraded = service._upgrade_legacy_keep_features(["temperature", "load", "potential"])
    assert upgraded == ["temperature", "load", "load_min", "load_max", "load_span", "load_is_range", "potential"]


def test_cleaning_service_builds_imported_csv_payload() -> None:
    service = ModelCleaningService()
    csv_text = "\n".join([
        "Cation,anion,compound_CSV,surface,temperature,load,friction coefficient",
        "[BMIm]+,[BF4]-,1,steel,298,4.0,0.12",
        "[EMIm]+,[PF6]-,0,glass,303,4.5,0.15",
    ])

    payload = service._build_imported_csv_payload(
        csv_text,
        filename="ILS_dataset.csv",
        target_column="friction coefficient",
        scope=RequestScope(scope_type="workspace", group_id=1, scope_key="workspace:1", workspace=None),
    )

    assert payload["target_column"] == "friction coefficient"
    assert payload["feature_columns"] == ["compound_CSV", "temperature", "load"]
    assert payload["matrix_columns"] == ["Cation", "anion", "compound_CSV", "surface", "temperature", "load", "friction coefficient"]
    assert payload["rows"][0]["Cation"] == "[BMIm]+"
    assert payload["rows"][0]["temperature"] == 298.0
    assert payload["rows"][0]["friction coefficient"] == 0.12
    assert payload["summary"]["training_ready_records"] == 2
    assert payload["target"]["key"] == "cof"


def test_cleaning_service_skips_upgrade_for_imported_dataset() -> None:
    service = ModelCleaningService()
    dataset = CleanedDataset(
        name="Imported dataset",
        description=None,
        target_key="cof",
        source_scope_type="workspace",
        source_scope_key="workspace:1",
        group_id=1,
        workspace_id=1,
        created_by_user_id=1,
        scope_type="workspace",
        scope_key="workspace:1",
        row_count=1,
        config_json=json.dumps({
            "dataset_kind": "imported_csv",
        }),
        summary_json=json.dumps({
            "dataset_kind": "imported_csv",
            "target_column": "friction coefficient",
            "feature_columns": ["temperature"],
            "matrix_columns": ["Cation", "temperature", "friction coefficient"],
        }),
        rows_json=json.dumps([{
            "Cation": "[BMIm]+",
            "temperature": 298.0,
            "friction coefficient": 0.12,
        }]),
    )

    upgraded = asyncio.run(service.upgrade_dataset_if_needed(None, dataset))

    assert upgraded is dataset
    assert json.loads(upgraded.rows_json)[0]["Cation"] == "[BMIm]+"


@pytest.mark.anyio
async def test_start_training_route_logs_task_id_without_attribute_error(monkeypatch) -> None:
    payload = model_training_router.TrainingStartPayload(cleaned_dataset_id=4)
    dataset = CleanedDataset(
        name="ILS Standard Dataset",
        description=None,
        target_key="cof",
        source_scope_type="workspace",
        source_scope_key="workspace:1",
        group_id=1,
        workspace_id=1,
        created_by_user_id=1,
        scope_type="workspace",
        scope_key="workspace:1",
        row_count=269,
        config_json=json.dumps({}),
        summary_json=json.dumps({}),
        rows_json=json.dumps([]),
    )
    principal = SimpleNamespace(
        user=SimpleNamespace(id=1),
        group=SimpleNamespace(id=1),
    )
    scope = RequestScope(
        scope_type="workspace",
        group_id=1,
        scope_key="workspace:1",
        workspace=SimpleNamespace(id=1),
    )
    task = SimpleNamespace(
        task_id="train-task-123",
        snapshot=lambda include_history=True: {"task_id": "train-task-123"},
    )
    logged: dict[str, object] = {}

    async def fake_require_cleaned_dataset_access(*args, **kwargs):
        return dataset

    async def fake_upgrade_dataset_if_needed(*args, **kwargs):
        return dataset

    async def fake_create_training_task(*args, **kwargs):
        return task

    async def fake_log_activity(**kwargs):
        logged.update(kwargs)
        return None

    monkeypatch.setattr(model_training_router, "require_cleaned_dataset_access", fake_require_cleaned_dataset_access)
    monkeypatch.setattr(model_training_router, "log_activity", fake_log_activity)
    monkeypatch.setattr(
        model_training_router,
        "get_model_cleaning_service",
        lambda: SimpleNamespace(upgrade_dataset_if_needed=fake_upgrade_dataset_if_needed),
    )
    monkeypatch.setattr(
        model_training_router,
        "get_model_training_service",
        lambda: SimpleNamespace(create_training_task=fake_create_training_task),
    )

    response = await model_training_router.start_training(
        payload=payload,
        request=object(),
        session=object(),
        principal=principal,
        scope=scope,
    )

    assert response == {"task": {"task_id": "train-task-123"}}
    assert logged["action_detail"] == {
        "task_id": "train-task-123",
        "target": payload.target,
        "algorithm": payload.algorithm,
        "cleaned_dataset_id": 4,
    }

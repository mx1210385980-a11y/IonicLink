from __future__ import annotations

import asyncio
import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import TribologyData
from security import literature_scope_conditions
from services.unit_converter import parse_force_to_newtons, parse_speed_to_mps

try:
    from rdkit import Chem, DataStructs
    from rdkit.Chem import rdFingerprintGenerator

    RDKit_AVAILABLE = True
    MORGAN_GENERATOR = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=128)
except Exception:
    Chem = None
    DataStructs = None
    rdFingerprintGenerator = None
    RDKit_AVAILABLE = False
    MORGAN_GENERATOR = None


TARGET_DEFINITIONS: dict[str, dict[str, Any]] = {
    "cof": {
        "label": "Coefficient of Friction (COF)",
        "field": "cof_value",
    },
}

ALGORITHM_DEFINITIONS: dict[str, dict[str, Any]] = {
    "gradient_boosting": {
        "label": "Gradient Boosting",
        "description": "Boosted regression trees with staged round-by-round metrics.",
    },
    "random_forest": {
        "label": "Random Forest",
        "description": "Incrementally grown ensemble of trees for stable comparison runs.",
    },
}

FEATURE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "key": "cation_fingerprint",
        "label": "Cation Morgan fingerprint",
        "group": "Molecular",
        "description": "128-bit Morgan fingerprint derived from cation SMILES.",
        "default_enabled": True,
    },
    {
        "key": "anion_fingerprint",
        "label": "Anion Morgan fingerprint",
        "group": "Molecular",
        "description": "128-bit Morgan fingerprint derived from anion SMILES.",
        "default_enabled": True,
    },
    {
        "key": "temperature",
        "label": "Temperature",
        "group": "Process",
        "description": "Normalized temperature converted to degrees Celsius.",
        "default_enabled": True,
    },
    {
        "key": "speed",
        "label": "Speed",
        "group": "Process",
        "description": "Sliding speed converted to m/s when units are present.",
        "default_enabled": False,
    },
    {
        "key": "load",
        "label": "Load",
        "group": "Process",
        "description": "Applied load converted to Newtons.",
        "default_enabled": False,
    },
    {
        "key": "potential",
        "label": "Potential",
        "group": "Process",
        "description": "Electrochemical potential parsed from the source record.",
        "default_enabled": False,
    },
    {
        "key": "water_content",
        "label": "Water content",
        "group": "Process",
        "description": "Water content normalized to ppm when possible.",
        "default_enabled": False,
    },
    {
        "key": "film_thickness",
        "label": "Film thickness",
        "group": "Process",
        "description": "Film thickness converted to nm when units are available.",
        "default_enabled": False,
    },
    {
        "key": "alkyl_chain_length",
        "label": "Alkyl chain length",
        "group": "Chemistry",
        "description": "Resolved alkyl chain length from the ionic liquid metadata.",
        "default_enabled": True,
    },
]

DEFAULT_FEATURE_SELECTION = {
    feature["key"]: bool(feature["default_enabled"])
    for feature in FEATURE_DEFINITIONS
}

DEFAULT_HYPERPARAMETERS = {
    "n_estimators": 120,
    "learning_rate": 0.06,
    "max_depth": 3,
}

DEFAULT_DATA_OPTIONS = {
    "validation_split": 0.2,
    "min_confidence": 0.0,
    "max_records": None,
    "random_seed": 42,
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric) or math.isinf(numeric):
        return None
    return numeric


def _extract_first_number(raw: str | None) -> float | None:
    text = str(raw or "").strip()
    if not text:
        return None
    match = re.search(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", text)
    if not match:
        return None
    return _safe_float(match.group(0))


def _normalize_microunit_text(raw: str | None) -> str:
    text = str(raw or "")
    return (
        text.replace("μ", "u")
        .replace("µ", "u")
        .replace("¦Ě", "u")
        .replace("碌", "u")
        .replace("渭", "u")
    )


def _parse_temperature_celsius(raw: str | None) -> float | None:
    text = _normalize_microunit_text(raw).strip()
    if not text:
        return None
    numeric = _extract_first_number(text)
    if numeric is None:
        return None
    lowered = text.lower()
    if "k" in lowered and "kg" not in lowered:
        return numeric - 273.15
    if "f" in lowered:
        return (numeric - 32.0) * 5.0 / 9.0
    return numeric


def _parse_potential_volts(raw: str | None) -> float | None:
    return _extract_first_number(raw)


def _parse_water_content_ppm(raw: str | None) -> float | None:
    text = _normalize_microunit_text(raw).strip().lower()
    if not text:
        return None
    if text.startswith("dry"):
        return 0.0
    numeric = _extract_first_number(text)
    if numeric is None:
        return None
    if "ppm" in text:
        return numeric
    if "%" in text:
        return numeric * 10_000.0
    if "rh" in text:
        return numeric * 10_000.0
    return numeric


def _parse_film_thickness_nm(raw: str | None) -> float | None:
    text = _normalize_microunit_text(raw).strip().lower()
    if not text:
        return None
    numeric = _extract_first_number(text)
    if numeric is None:
        return None
    if "pm" in text:
        return numeric * 0.001
    if "um" in text:
        return numeric * 1000.0
    if "mm" in text:
        return numeric * 1_000_000.0
    return numeric


def _fingerprint_from_smiles(smiles: str | None, fp_size: int = 128) -> np.ndarray:
    text = str(smiles or "").strip()
    if not text:
        return np.zeros(fp_size, dtype=np.float32)

    if RDKit_AVAILABLE and Chem is not None and DataStructs is not None and MORGAN_GENERATOR is not None:
        mol = Chem.MolFromSmiles(text)
        if mol is None:
            return np.zeros(fp_size, dtype=np.float32)
        arr = np.zeros((fp_size,), dtype=np.int8)
        fp = MORGAN_GENERATOR.GetFingerprint(mol)
        DataStructs.ConvertToNumpyArray(fp, arr)
        return arr.astype(np.float32)

    # Fallback for environments without RDKit: deterministic hashed characters.
    arr = np.zeros(fp_size, dtype=np.float32)
    for idx, char in enumerate(text):
        arr[(idx * 31 + ord(char)) % fp_size] = 1.0
    return arr


def _feature_value(record: dict[str, Any], key: str) -> float | None:
    if key == "temperature":
        return _parse_temperature_celsius(record.get("temperature"))
    if key == "speed":
        return parse_speed_to_mps(_normalize_microunit_text(record.get("speed_value")))
    if key == "load":
        return parse_force_to_newtons(_normalize_microunit_text(record.get("load_value") or record.get("load_raw")))
    if key == "potential":
        return _parse_potential_volts(record.get("potential"))
    if key == "water_content":
        return _parse_water_content_ppm(record.get("water_content"))
    if key == "film_thickness":
        return _parse_film_thickness_nm(record.get("film_thickness"))
    if key == "alkyl_chain_length":
        return _safe_float(record.get("alkyl_chain_length"))
    return None


def _metric_point(round_index: int, total_rounds: int, y_train: np.ndarray, train_pred: np.ndarray, y_val: np.ndarray, val_pred: np.ndarray) -> dict[str, Any]:
    train_rmse = float(math.sqrt(mean_squared_error(y_train, train_pred)))
    val_rmse = float(math.sqrt(mean_squared_error(y_val, val_pred)))
    train_mae = float(mean_absolute_error(y_train, train_pred))
    val_mae = float(mean_absolute_error(y_val, val_pred))

    train_r2 = 0.0
    if len(y_train) >= 2 and not np.isclose(np.var(y_train), 0.0):
        train_r2 = float(r2_score(y_train, train_pred))

    val_r2 = 0.0
    if len(y_val) >= 2 and not np.isclose(np.var(y_val), 0.0):
        val_r2 = float(r2_score(y_val, val_pred))

    return {
        "round": round_index,
        "progress": round_index / total_rounds if total_rounds else 0.0,
        "train_r2": train_r2,
        "val_r2": val_r2,
        "train_rmse": train_rmse,
        "val_rmse": val_rmse,
        "train_mae": train_mae,
        "val_mae": val_mae,
    }


def _serialize_record(record: TribologyData) -> dict[str, Any]:
    return {
        "id": record.id,
        "literature_id": record.literature_id,
        "cof_value": record.cof_value,
        "confidence": record.confidence,
        "cation_smiles": record.cation_smiles,
        "anion_smiles": record.anion_smiles,
        "load_value": record.load_value,
        "load_raw": record.load_raw,
        "speed_value": record.speed_value,
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "film_thickness": record.film_thickness,
        "alkyl_chain_length": record.alkyl_chain_length,
    }


@dataclass
class TrainingTaskState:
    task_id: str
    owner_user_id: int
    group_id: int
    scope_key: str
    config: dict[str, Any]
    dataset: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    feature_blocks: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    status: str = "queued"
    status_message: str = "Queued for training."
    error: str | None = None
    created_at: str = field(default_factory=_utc_now_iso)
    started_at: str | None = None
    finished_at: str | None = None
    total_rounds: int = 0
    current_round: int = 0
    current: dict[str, Any] | None = None
    cancel_requested: bool = False
    subscribers: set[asyncio.Queue] = field(default_factory=set)

    def snapshot(self, *, include_history: bool = True) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "status_message": self.status_message,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "total_rounds": self.total_rounds,
            "current_round": self.current_round,
            "current": self.current,
            "dataset": self.dataset,
            "warnings": self.warnings,
            "feature_blocks": self.feature_blocks,
            "config": self.config,
            "history": self.history if include_history else [],
        }


class ModelTrainingService:
    def __init__(self) -> None:
        self._tasks: dict[str, TrainingTaskState] = {}

    async def summarize_scope(self, session: AsyncSession, scope_filter_values: dict[str, Any]) -> dict[str, Any]:
        records = await self._load_scope_records(session, scope_filter_values)
        feature_options = []
        for feature in FEATURE_DEFINITIONS:
            key = feature["key"]
            available_count = self._feature_available_count(records, key)
            feature_options.append(
                {
                    **feature,
                    "available_count": available_count,
                    "coverage": available_count / len(records) if records else 0.0,
                    "disabled": available_count == 0,
                }
            )

        target_options = []
        for key, target in TARGET_DEFINITIONS.items():
            available_count = sum(1 for record in records if _safe_float(record.get(target["field"])) is not None)
            target_options.append(
                {
                    "key": key,
                    "label": target["label"],
                    "available_count": available_count,
                }
            )

        algorithm_options = [
            {"key": key, **value}
            for key, value in ALGORITHM_DEFINITIONS.items()
        ]

        return {
            "dataset": {
                "total_records": len(records),
                "rdkit_enabled": RDKit_AVAILABLE,
            },
            "targets": target_options,
            "algorithms": algorithm_options,
            "features": feature_options,
            "defaults": {
                "target": "cof",
                "algorithm": "gradient_boosting",
                "features": DEFAULT_FEATURE_SELECTION,
                "hyperparameters": DEFAULT_HYPERPARAMETERS,
                "data_options": DEFAULT_DATA_OPTIONS,
            },
        }

    async def create_training_task(
        self,
        session: AsyncSession,
        *,
        scope_filter_values: dict[str, Any],
        owner_user_id: int,
        group_id: int,
        scope_key: str,
        config: dict[str, Any],
    ) -> TrainingTaskState:
        records = await self._load_scope_records(session, scope_filter_values)
        task_id = uuid.uuid4().hex
        task = TrainingTaskState(
            task_id=task_id,
            owner_user_id=owner_user_id,
            group_id=group_id,
            scope_key=scope_key,
            config=config,
        )
        self._tasks[task_id] = task
        asyncio.create_task(self._run_training(task, records))
        return task

    def get_task(self, task_id: str, requester_user_id: int) -> TrainingTaskState:
        task = self._tasks.get(task_id)
        if not task or task.owner_user_id != requester_user_id:
            raise KeyError(task_id)
        return task

    def cancel_task(self, task_id: str, requester_user_id: int) -> TrainingTaskState:
        task = self.get_task(task_id, requester_user_id)
        if task.status in {"completed", "failed", "cancelled"}:
            return task
        task.cancel_requested = True
        task.status_message = "Cancellation requested. Waiting for the current training step to finish."
        return task

    def register_subscriber(self, task_id: str, requester_user_id: int) -> tuple[TrainingTaskState, asyncio.Queue]:
        task = self.get_task(task_id, requester_user_id)
        queue: asyncio.Queue = asyncio.Queue()
        task.subscribers.add(queue)
        return task, queue

    def unregister_subscriber(self, task: TrainingTaskState, queue: asyncio.Queue) -> None:
        task.subscribers.discard(queue)

    async def _publish(self, task: TrainingTaskState, event: dict[str, Any]) -> None:
        stale: list[asyncio.Queue] = []
        for queue in list(task.subscribers):
            try:
                queue.put_nowait(event)
            except Exception:
                stale.append(queue)
        for queue in stale:
            task.subscribers.discard(queue)

    async def _load_scope_records(self, session: AsyncSession, scope_filter_values: dict[str, Any]) -> list[dict[str, Any]]:
        stmt = (
            select(TribologyData)
            .join(TribologyData.literature)
            .options(selectinload(TribologyData.literature))
            .where(*literature_scope_conditions(scope_filter_values))
            .order_by(TribologyData.id.asc())
        )
        result = await session.execute(stmt)
        return [_serialize_record(record) for record in result.scalars().all()]

    def _feature_available_count(self, records: list[dict[str, Any]], key: str) -> int:
        if key == "cation_fingerprint":
            return sum(1 for record in records if str(record.get("cation_smiles") or "").strip())
        if key == "anion_fingerprint":
            return sum(1 for record in records if str(record.get("anion_smiles") or "").strip())
        return sum(1 for record in records if _feature_value(record, key) is not None)

    def _prepare_dataset(self, records: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
        target_key = config.get("target", "cof")
        target_def = TARGET_DEFINITIONS.get(target_key)
        if not target_def:
            raise ValueError(f"Unsupported target '{target_key}'.")

        selected_features = {
            key: bool(value)
            for key, value in (config.get("features") or {}).items()
        }
        if not any(selected_features.values()):
            raise ValueError("Select at least one feature before starting training.")

        data_options = config.get("data_options") or {}
        min_confidence = max(0.0, min(1.0, float(data_options.get("min_confidence", 0.0) or 0.0)))
        max_records = data_options.get("max_records")
        max_records = int(max_records) if max_records not in (None, "", 0) else None
        random_seed = int(data_options.get("random_seed", 42) or 42)
        validation_split = float(data_options.get("validation_split", 0.2) or 0.2)
        validation_split = min(0.4, max(0.1, validation_split))

        eligible_records = []
        for record in records:
            target_value = _safe_float(record.get(target_def["field"]))
            confidence = _safe_float(record.get("confidence")) or 0.0
            if target_value is None:
                continue
            if confidence < min_confidence:
                continue
            eligible_records.append({**record, "_target_value": target_value})

        if max_records:
            eligible_records = eligible_records[:max_records]

        total_records = len(records)
        usable_records = len(eligible_records)
        if usable_records < 10:
            raise ValueError(
                f"Only {usable_records} records are usable after filtering. At least 10 records are required."
            )

        selected_numeric_keys = [
            feature["key"]
            for feature in FEATURE_DEFINITIONS
            if feature["key"] not in {"cation_fingerprint", "anion_fingerprint"} and selected_features.get(feature["key"])
        ]

        blocks: list[np.ndarray] = []
        feature_blocks: list[dict[str, Any]] = []
        warnings: list[str] = []

        if selected_features.get("cation_fingerprint"):
            cation_block = np.vstack([_fingerprint_from_smiles(record.get("cation_smiles")) for record in eligible_records])
            blocks.append(cation_block)
            feature_blocks.append(
                {
                    "key": "cation_fingerprint",
                    "label": "Cation Morgan fingerprint",
                    "dimensions": int(cation_block.shape[1]),
                }
            )

        if selected_features.get("anion_fingerprint"):
            anion_block = np.vstack([_fingerprint_from_smiles(record.get("anion_smiles")) for record in eligible_records])
            blocks.append(anion_block)
            feature_blocks.append(
                {
                    "key": "anion_fingerprint",
                    "label": "Anion Morgan fingerprint",
                    "dimensions": int(anion_block.shape[1]),
                }
            )

        numeric_columns: list[list[float | None]] = []
        numeric_labels: list[str] = []
        for key in selected_numeric_keys:
            values = [_feature_value(record, key) for record in eligible_records]
            available_count = sum(1 for value in values if value is not None)
            if available_count == 0:
                warnings.append(f"{self._feature_label(key)} has no usable values in the current scope and was skipped.")
                continue
            numeric_columns.append(values)
            numeric_labels.append(key)

        if numeric_columns:
            numeric_matrix = np.array(numeric_columns, dtype=object).T
            imputed = SimpleImputer(strategy="median").fit_transform(numeric_matrix)
            scaled = StandardScaler().fit_transform(imputed)
            blocks.append(scaled.astype(np.float32))
            feature_blocks.append(
                {
                    "key": "numeric_conditions",
                    "label": "Normalized process conditions",
                    "dimensions": int(scaled.shape[1]),
                    "features": [self._feature_label(key) for key in numeric_labels],
                }
            )

        if not blocks:
            raise ValueError("The selected features produced an empty feature matrix.")

        X = np.concatenate(blocks, axis=1).astype(np.float32)
        y = np.array([record["_target_value"] for record in eligible_records], dtype=np.float32)

        if X.shape[0] < 10 or X.shape[1] == 0:
            raise ValueError("The selected configuration did not produce enough training data.")

        X_train, X_val, y_train, y_val = train_test_split(
            X,
            y,
            test_size=validation_split,
            random_state=random_seed,
        )

        if len(X_train) < 5 or len(X_val) < 2:
            raise ValueError("The validation split is too aggressive for the current dataset. Increase max records or reduce validation split.")

        n_estimators = int((config.get("hyperparameters") or {}).get("n_estimators", DEFAULT_HYPERPARAMETERS["n_estimators"]) or DEFAULT_HYPERPARAMETERS["n_estimators"])
        total_rounds = min(300, max(20, n_estimators))

        return {
            "X_train": X_train,
            "X_val": X_val,
            "y_train": y_train,
            "y_val": y_val,
            "total_rounds": total_rounds,
            "dataset": {
                "total_records": total_records,
                "usable_records": usable_records,
                "dropped_records": total_records - usable_records,
                "train_size": int(len(X_train)),
                "validation_size": int(len(X_val)),
                "feature_dimensions": int(X.shape[1]),
                "selected_feature_count": int(sum(bool(value) for value in selected_features.values())),
                "target": {
                    "key": target_key,
                    "label": target_def["label"],
                },
                "filters": {
                    "min_confidence": min_confidence,
                    "max_records": max_records,
                    "validation_split": validation_split,
                },
            },
            "feature_blocks": feature_blocks,
            "warnings": warnings,
        }

    def _feature_label(self, key: str) -> str:
        for feature in FEATURE_DEFINITIONS:
            if feature["key"] == key:
                return feature["label"]
        return key.replace("_", " ").title()

    async def _run_training(self, task: TrainingTaskState, records: list[dict[str, Any]]) -> None:
        try:
            prepared = self._prepare_dataset(records, task.config)
            X_train = prepared["X_train"]
            X_val = prepared["X_val"]
            y_train = prepared["y_train"]
            y_val = prepared["y_val"]
            task.dataset = prepared["dataset"]
            task.feature_blocks = prepared["feature_blocks"]
            task.warnings = prepared["warnings"]
            task.total_rounds = prepared["total_rounds"]
            task.status = "running"
            task.status_message = "Training has started."
            task.started_at = _utc_now_iso()

            await self._publish(
                task,
                {
                    "type": "task.snapshot",
                    "task": task.snapshot(include_history=True),
                },
            )

            algorithm = task.config.get("algorithm", "gradient_boosting")
            hyperparameters = task.config.get("hyperparameters") or {}
            learning_rate = float(hyperparameters.get("learning_rate", DEFAULT_HYPERPARAMETERS["learning_rate"]) or DEFAULT_HYPERPARAMETERS["learning_rate"])
            max_depth = int(hyperparameters.get("max_depth", DEFAULT_HYPERPARAMETERS["max_depth"]) or DEFAULT_HYPERPARAMETERS["max_depth"])
            random_seed = int((task.config.get("data_options") or {}).get("random_seed", DEFAULT_DATA_OPTIONS["random_seed"]) or DEFAULT_DATA_OPTIONS["random_seed"])

            if algorithm == "gradient_boosting":
                model = GradientBoostingRegressor(
                    n_estimators=1,
                    learning_rate=learning_rate,
                    max_depth=max_depth,
                    random_state=random_seed,
                    warm_start=True,
                )
            elif algorithm == "random_forest":
                model = RandomForestRegressor(
                    n_estimators=1,
                    max_depth=max_depth,
                    random_state=random_seed,
                    warm_start=True,
                    n_jobs=1,
                )
            else:
                raise ValueError(f"Unsupported algorithm '{algorithm}'.")

            for round_index in range(1, task.total_rounds + 1):
                if task.cancel_requested:
                    task.status = "cancelled"
                    task.status_message = "Training run cancelled."
                    task.finished_at = _utc_now_iso()
                    await self._publish(
                        task,
                        {
                            "type": "task.cancelled",
                            "task": task.snapshot(include_history=True),
                        },
                    )
                    return

                model.set_params(n_estimators=round_index)
                model.fit(X_train, y_train)

                train_pred = model.predict(X_train)
                val_pred = model.predict(X_val)
                point = _metric_point(round_index, task.total_rounds, y_train, train_pred, y_val, val_pred)

                task.current_round = round_index
                task.current = point
                task.history.append(point)
                task.status_message = f"Round {round_index} / {task.total_rounds}"

                await self._publish(
                    task,
                    {
                        "type": "task.metric",
                        "task_id": task.task_id,
                        "point": point,
                        "snapshot": task.snapshot(include_history=False),
                    },
                )

                await asyncio.sleep(0.03)

            task.status = "completed"
            task.status_message = "Training completed."
            task.finished_at = _utc_now_iso()
            await self._publish(
                task,
                {
                    "type": "task.completed",
                    "task": task.snapshot(include_history=True),
                },
            )
        except Exception as exc:
            task.status = "failed"
            task.error = str(exc)
            task.status_message = "Training failed."
            task.finished_at = _utc_now_iso()
            await self._publish(
                task,
                {
                    "type": "task.failed",
                    "task": task.snapshot(include_history=True),
                },
            )


_model_training_service: ModelTrainingService | None = None


def get_model_training_service() -> ModelTrainingService:
    global _model_training_service
    if _model_training_service is None:
        _model_training_service = ModelTrainingService()
    return _model_training_service

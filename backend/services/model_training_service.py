from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, KFold, StratifiedKFold, train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import async_session_maker
from models.db_models import CleanedDataset, ModelTrainingRun, RegisteredModel, TribologyData
from security import literature_scope_conditions
from services.unit_converter import parse_force_range_to_newtons, parse_force_to_newtons, parse_speed_to_mps
from utils.experiment_profile import build_experiment_profile, normalize_training_view, record_matches_training_view
from utils.lubricant_mixture import normalize_lubricant_components
from utils.speed_conditions import normalize_speed_conditions

logger = logging.getLogger(__name__)

try:
    from catboost import CatBoostRegressor

    CATBOOST_AVAILABLE = True
except Exception:
    CatBoostRegressor = None
    CATBOOST_AVAILABLE = False

try:
    from xgboost import XGBRegressor

    XGBOOST_AVAILABLE = True
except Exception as _xgb_exc:  # libomp 缺失时也会落到这里
    XGBRegressor = None
    XGBOOST_AVAILABLE = False
    logger.info("XGBoost unavailable: %s", _xgb_exc)

try:
    from rdkit import Chem, DataStructs
    from rdkit.Chem import rdFingerprintGenerator

    RDKit_AVAILABLE = True
except Exception:
    Chem = None
    DataStructs = None
    rdFingerprintGenerator = None
    RDKit_AVAILABLE = False
    MORGAN_GENERATOR = None


MORGAN_FINGERPRINT_SIZE = 256
DEFAULT_PCA_COMPONENTS = 10

if RDKit_AVAILABLE and rdFingerprintGenerator is not None:
    MORGAN_GENERATOR = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=MORGAN_FINGERPRINT_SIZE)


class _ScaledRegressor:
    """SVR / MLP 等对量纲敏感的模型需先做特征标准化，再做预测。

    重要：只有当底层 estimator 真的具备 `feature_importances_` 或 `coef_` 时才
    透传出去，否则不要设置占位 None——下游的 `hasattr` 判断会被 None 占位
    误导，导致 `_build_feature_importance` 拿到 None 后 float() 抛异常。
    """

    def __init__(self, scaler: StandardScaler, estimator: Any, target_scaler: StandardScaler | None = None) -> None:
        self.scaler = scaler
        self.estimator = estimator
        self.target_scaler = target_scaler
        if hasattr(estimator, "feature_importances_"):
            self.feature_importances_ = estimator.feature_importances_
        elif hasattr(estimator, "coef_"):
            self.coef_ = estimator.coef_

    def fit(self, X: np.ndarray, y: np.ndarray) -> "_ScaledRegressor":
        X_scaled = self.scaler.fit_transform(X)
        y_fit = y
        if self.target_scaler is not None:
            y_fit = self.target_scaler.fit_transform(np.asarray(y, dtype=np.float32).reshape(-1, 1)).ravel()
        self.estimator.fit(X_scaled, y_fit)
        if hasattr(self.estimator, "feature_importances_"):
            self.feature_importances_ = self.estimator.feature_importances_
        elif hasattr(self.estimator, "coef_"):
            self.coef_ = self.estimator.coef_
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        prediction = np.asarray(self.estimator.predict(self.scaler.transform(X)), dtype=np.float32)
        if self.target_scaler is not None:
            prediction = self.target_scaler.inverse_transform(prediction.reshape(-1, 1)).ravel()
        return prediction


TARGET_DEFINITIONS: dict[str, dict[str, Any]] = {
    "cof": {
        "label": "摩擦系数 μ/COF",
        "field": "cof_value",
        "column_name": "Target_COF",
    },
}

TARGET_DISPLAY_ALIASES = {
    "cof",
    "mu",
    "targetcof",
    "targetmu",
    "coefficientoffriction",
    "frictioncoefficient",
}

BASE_ALGORITHM_DEFINITIONS: dict[str, dict[str, Any]] = {
    "linear_regression": {
        "label": "线性回归（Linear Regression）",
        "description": "线性基线模型；用于判断非线性模型是否真的带来了提升。",
    },
    "gradient_boosting": {
        "label": "梯度提升（Gradient Boosting）",
        "description": "经典梯度提升树，按轮次逐步拟合残差，可观察 R² 随轮次的变化。",
    },
    "random_forest": {
        "label": "随机森林（Random Forest）",
        "description": "Bagging 集成的多棵决策树，对噪声鲁棒，不需要特征标准化。",
    },
    "svr": {
        "label": "支持向量回归（SVR）",
        "description": "基于核函数的非线性回归，适合样本量小、特征维度较高的情形（自动做特征标准化）。",
    },
    "mlp": {
        "label": "多层感知机（MLP）",
        "description": "前馈神经网络，能学习复杂非线性关系；在小样本下需要更多调参（自动做特征标准化）。",
    },
}
DISABLED_TRAINING_ALGORITHMS = {"mlp"}

PROCESS_FEATURE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "key": "temperature",
        "label": "Temperature",
        "group": "Process",
        "description": "Normalized temperature converted to degrees Celsius.",
        "column_name": "Temperature",
        "normalized_field": "normalized_temperature_c",
    },
    {
        "key": "speed",
        "label": "Speed",
        "group": "Process",
        "description": "Sliding speed converted to m/s when units are present.",
        "column_name": "Speed",
        "normalized_field": "normalized_speed_mps",
    },
    {
        "key": "load",
        "label": "Load",
        "group": "Process",
        "description": "Applied load converted to Newtons. Range values are represented by their midpoint.",
        "column_name": "Load",
        "normalized_field": "normalized_load_n",
    },
    {
        "key": "system_total_load",
        "label": "System Total Load",
        "group": "Process",
        "description": "Macroscopic/system load converted to Newtons when structured load_conditions are available.",
        "column_name": "System_Total_Load",
        "normalized_field": "normalized_system_total_load_n",
    },
    {
        "key": "contact_load_per_unit",
        "label": "Contact Load Per Unit",
        "group": "Process",
        "description": "Per-contact load converted to Newtons when structured load_conditions are available.",
        "column_name": "Contact_Load_Per_Unit",
        "normalized_field": "normalized_contact_load_per_unit_n",
    },
    {
        "key": "load_min",
        "label": "Load Min",
        "group": "Process",
        "description": "Lower bound of the applied load range converted to Newtons.",
        "column_name": "Load_Min",
        "normalized_field": "normalized_load_min_n",
    },
    {
        "key": "load_max",
        "label": "Load Max",
        "group": "Process",
        "description": "Upper bound of the applied load range converted to Newtons.",
        "column_name": "Load_Max",
        "normalized_field": "normalized_load_max_n",
    },
    {
        "key": "load_span",
        "label": "Load Span",
        "group": "Process",
        "description": "Width of the applied load range converted to Newtons.",
        "column_name": "Load_Span",
        "normalized_field": "normalized_load_span_n",
    },
    {
        "key": "load_is_range",
        "label": "Load Is Range",
        "group": "Process",
        "description": "Binary flag indicating whether the source load was recorded as a range.",
        "column_name": "Load_Is_Range",
        "normalized_field": "normalized_load_is_range",
    },
    {
        "key": "potential",
        "label": "Potential",
        "group": "Process",
        "description": "Electrochemical potential parsed from the source record.",
        "column_name": "Potential",
        "normalized_field": "normalized_potential_v",
    },
    {
        "key": "water_content",
        "label": "Water Content",
        "group": "Process",
        "description": "Water content normalized to ppm when possible.",
        "column_name": "Water_Content",
        "normalized_field": "normalized_water_content_ppm",
    },
    {
        "key": "il_additive_mol_fraction",
        "label": "IL Additive Mol Fraction",
        "group": "Process",
        "description": "Mole fraction of the ionic-liquid additive in an IL/base-oil lubricant blend.",
        "column_name": "IL_Additive_Mol_Fraction",
        "normalized_field": "normalized_il_additive_mol_fraction",
    },
    {
        "key": "base_oil_mol_fraction",
        "label": "Base Oil Mol Fraction",
        "group": "Process",
        "description": "Mole fraction of the base-oil component in an IL/base-oil lubricant blend.",
        "column_name": "Base_Oil_Mol_Fraction",
        "normalized_field": "normalized_base_oil_mol_fraction",
    },
    {
        "key": "film_thickness",
        "label": "Film Thickness",
        "group": "Process",
        "description": "Film thickness converted to nm when units are available.",
        "column_name": "Film_Thickness",
        "normalized_field": "normalized_film_thickness_nm",
    },
    {
        "key": "alkyl_chain_length",
        "label": "Alkyl Chain Length",
        "group": "Process",
        "description": "Resolved alkyl chain length from the ionic liquid metadata.",
        "column_name": "Alkyl_Chain_Length",
        "normalized_field": "normalized_alkyl_chain_length",
    },
]

PROCESS_FEATURE_LOOKUP = {feature["key"]: feature for feature in PROCESS_FEATURE_DEFINITIONS}

MOLECULAR_FEATURE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "key": "cation_fingerprint",
        "label": "Cation Morgan fingerprint",
        "group": "Molecular",
        "description": f"{MORGAN_FINGERPRINT_SIZE}-bit Morgan fingerprint derived from cation SMILES.",
    },
    {
        "key": "anion_fingerprint",
        "label": "Anion Morgan fingerprint",
        "group": "Molecular",
        "description": f"{MORGAN_FINGERPRINT_SIZE}-bit Morgan fingerprint derived from anion SMILES.",
    },
]

DEFAULT_FEATURE_CONFIG = {
    "use_pca": False,
    "n_components": DEFAULT_PCA_COMPONENTS,
    "keep_features": [feature["key"] for feature in PROCESS_FEATURE_DEFINITIONS],
}

DEFAULT_HYPERPARAMETERS = {
    "n_estimators": 120,
    "learning_rate": 0.06,
    "max_depth": 3,
    "l2_leaf_reg": 3.0,
    "random_strength": 1.0,
}

DEFAULT_DATA_OPTIONS = {
    "validation_split": 0.2,
    "min_confidence": 0.0,
    "max_records": None,
    "random_seed": 42,
    "split_strategy": "joint_stratified",
    "cv_folds": 5,
}

JOINT_STRATIFICATION_BINS = 8

DEFAULT_CLEANING_OPTIONS = {
    "source_mode": "group_library_fallback",
    "training_view": "all",
    "drop_missing_target": True,
    "require_dual_smiles": True,
}


# ─── Hyperparameter tuning grids ──────────────────────────────────────────
# Compact grids—优先覆盖关键的几个旋钮，避免学生等过久。
TUNE_PARAM_GRIDS: dict[str, list[dict[str, Any]]] = {
    "gradient_boosting": [
        {"n_estimators": n, "learning_rate": lr, "max_depth": d}
        for n in (80, 200)
        for lr in (0.03, 0.06, 0.1)
        for d in (2, 3, 5)
    ],  # 18
    "random_forest": [
        {"n_estimators": n, "max_depth": d}
        for n in (100, 200, 400)
        for d in (4, 8, None)
    ],  # 9
    "catboost": [
        {"iterations": it, "learning_rate": lr, "depth": d, "l2_leaf_reg": l2}
        for it in (200, 500)
        for lr in (0.03, 0.08)
        for d in (4, 6)
        for l2 in (3.0, 7.0)
    ],  # 16
    "xgboost": [
        {"n_estimators": n, "learning_rate": lr, "max_depth": d}
        for n in (100, 250)
        for lr in (0.03, 0.08)
        for d in (3, 5, 7)
    ],  # 12
    "svr": [
        {"C": c, "gamma": g, "epsilon": e}
        for c in (1.0, 10.0, 100.0)
        for g in ("scale", 0.1, 0.01)
        for e in (0.05, 0.1)
    ],  # 18
    "mlp": [
        {"hidden_layer_sizes": h, "learning_rate_init": lr, "alpha": a}
        for h in ((64, 32), (128,))
        for lr in (0.001, 0.01)
        for a in (0.0001, 0.001)
    ],  # 8
    "linear_regression": [{}],  # 无可调参数
}

SPLIT_STRATEGY_DEFINITIONS: dict[str, dict[str, str]] = {
    "joint_stratified": {
        "label": "论文复现：阳离子 × μ 分箱",
        "description": "按阳离子类型和摩擦系数分箱构建联合标签；单样本标签进入外部文献验证集，多样本标签再按 8:2 分层切训练/测试。",
    },
    "k_fold": {
        "label": "5 折交叉验证（K-Fold CV）",
        "description": "数据切 5 份，每份轮流当验证集训练 5 次，最终指标为 5 次平均——是模型真实泛化能力的可靠估计。",
    },
    "literature_group_kfold": {
        "label": "按文献分组（Literature Group K-Fold）",
        "description": "同一篇文献的记录强制全部落在同一折，避免「训练集见过这篇论文」造成的虚高评分。最严格的评估。",
    },
    "random_holdout": {
        "label": "单次 8:2 切分（Random Holdout）",
        "description": "随机切一次 80/20，训练快但 R² 受运气影响大，仅适合快速试错。正式评估请用 K 折。",
    },
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


def _float_or_default(value: Any, default: float) -> float:
    numeric = _safe_float(value)
    if numeric is None:
        return float(default)
    return numeric


def _int_or_default(value: Any, default: int) -> int:
    numeric = _safe_float(value)
    if numeric is None:
        return int(default)
    return int(round(numeric))


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


def _component_mol_fraction(record: dict[str, Any], role: str) -> float | None:
    components = normalize_lubricant_components(record.get("lubricant_components") or record.get("lubricantComponents"))
    if not components:
        return None
    role = role.lower()
    for component in components:
        component_role = str(component.get("role") or "").strip().lower()
        compound = str(component.get("compound") or "").strip().lower()
        unit = str(component.get("unit") or "").strip().lower()
        if unit != "mol%":
            continue
        is_base_oil = component_role in {"base_oil", "oil", "solvent"} or "oil" in compound or compound in {"degdbe", "peg", "pao"}
        if role == "base_oil" and not is_base_oil:
            continue
        if role == "additive" and is_base_oil:
            continue
        fraction = _safe_float(component.get("fraction"))
        if fraction is not None:
            return fraction / 100.0
    return None


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


def _parse_load_statistics(raw: str | None) -> dict[str, float] | None:
    text = _normalize_microunit_text(raw).strip()
    if not text:
        return None

    range_bounds = parse_force_range_to_newtons(text)
    if range_bounds is not None:
        low, high = range_bounds
        return {
            "load": (low + high) / 2.0,
            "load_min": low,
            "load_max": high,
            "load_span": high - low,
            "load_is_range": 1.0,
        }

    scalar = parse_force_to_newtons(text)
    if scalar is None:
        return None

    return {
        "load": scalar,
        "load_min": scalar,
        "load_max": scalar,
        "load_span": 0.0,
        "load_is_range": 0.0,
    }


def _structured_load_conditions(record: dict[str, Any]) -> dict[str, Any]:
    value = record.get("load_conditions") or record.get("loadConditions")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return {}
    return value if isinstance(value, dict) else {}


def _load_statistics_for_record(record: dict[str, Any]) -> dict[str, float] | None:
    structured = _structured_load_conditions(record)
    if structured:
        load_min = _safe_float(structured.get("load_min_N") if "load_min_N" in structured else structured.get("loadMinN"))
        load_max = _safe_float(structured.get("load_max_N") if "load_max_N" in structured else structured.get("loadMaxN"))
        contact = _safe_float(
            structured.get("contact_load_per_unit_N")
            if "contact_load_per_unit_N" in structured
            else structured.get("contactLoadPerUnitN")
        )
        system = _safe_float(
            structured.get("system_total_load_N")
            if "system_total_load_N" in structured
            else structured.get("systemTotalLoadN")
        )
        primary = contact if contact is not None else system
        if load_min is None and primary is not None:
            load_min = primary
        if load_max is None and primary is not None:
            load_max = primary
        if load_min is not None and load_max is not None:
            return {
                "load": primary if primary is not None else (load_min + load_max) / 2.0,
                "load_min": load_min,
                "load_max": load_max,
                "load_span": load_max - load_min,
                "load_is_range": 1.0 if abs(load_max - load_min) > 0 else 0.0,
                "system_total_load": system,
                "contact_load_per_unit": contact,
            }
    stats = _parse_load_statistics(record.get("load_value") or record.get("load_raw"))
    if stats is not None:
        stats["system_total_load"] = None
        stats["contact_load_per_unit"] = stats.get("load")
    return stats


def _parse_water_content_ppm(raw: str | None) -> float | None:
    text = _normalize_microunit_text(raw).strip().lower()
    if not text:
        return None
    if text.startswith("dry"):
        return 0.0
    numeric = _extract_first_number(text)
    if numeric is None:
        return None
    # Labels like "IL-44%" use the hyphen as a separator, not a negative sign.
    numeric = abs(numeric)
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


def _fingerprint_from_smiles(smiles: str | None, fp_size: int = MORGAN_FINGERPRINT_SIZE) -> np.ndarray:
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
        if _safe_float(record.get("normalized_temperature_c")) is not None:
            return _safe_float(record.get("normalized_temperature_c"))
        return _parse_temperature_celsius(record.get("temperature"))
    if key == "speed":
        if _safe_float(record.get("normalized_speed_mps")) is not None:
            return _safe_float(record.get("normalized_speed_mps"))
        speed_conditions = normalize_speed_conditions(record.get("speed_conditions"))
        speed_um_s = _safe_float(speed_conditions.get("sliding_velocity_um_s"))
        if speed_um_s is not None:
            return speed_um_s * 1e-6
        return parse_speed_to_mps(_normalize_microunit_text(record.get("speed_value")))
    if key == "load":
        if _safe_float(record.get("normalized_load_n")) is not None:
            return _safe_float(record.get("normalized_load_n"))
        stats = _load_statistics_for_record(record)
        return stats.get("load") if stats else None
    if key == "system_total_load":
        if _safe_float(record.get("normalized_system_total_load_n")) is not None:
            return _safe_float(record.get("normalized_system_total_load_n"))
        stats = _load_statistics_for_record(record)
        return stats.get("system_total_load") if stats else None
    if key == "contact_load_per_unit":
        if _safe_float(record.get("normalized_contact_load_per_unit_n")) is not None:
            return _safe_float(record.get("normalized_contact_load_per_unit_n"))
        stats = _load_statistics_for_record(record)
        return stats.get("contact_load_per_unit") if stats else None
    if key == "load_min":
        if _safe_float(record.get("normalized_load_min_n")) is not None:
            return _safe_float(record.get("normalized_load_min_n"))
        stats = _load_statistics_for_record(record)
        return stats.get("load_min") if stats else None
    if key == "load_max":
        if _safe_float(record.get("normalized_load_max_n")) is not None:
            return _safe_float(record.get("normalized_load_max_n"))
        stats = _load_statistics_for_record(record)
        return stats.get("load_max") if stats else None
    if key == "load_span":
        if _safe_float(record.get("normalized_load_span_n")) is not None:
            return _safe_float(record.get("normalized_load_span_n"))
        stats = _load_statistics_for_record(record)
        return stats.get("load_span") if stats else None
    if key == "load_is_range":
        if _safe_float(record.get("normalized_load_is_range")) is not None:
            return _safe_float(record.get("normalized_load_is_range"))
        stats = _load_statistics_for_record(record)
        return stats.get("load_is_range") if stats else None
    if key == "potential":
        if _safe_float(record.get("normalized_potential_v")) is not None:
            return _safe_float(record.get("normalized_potential_v"))
        return _parse_potential_volts(record.get("potential"))
    if key == "water_content":
        if _safe_float(record.get("normalized_water_content_ppm")) is not None:
            return _safe_float(record.get("normalized_water_content_ppm"))
        return _parse_water_content_ppm(record.get("water_content"))
    if key == "il_additive_mol_fraction":
        if _safe_float(record.get("normalized_il_additive_mol_fraction")) is not None:
            return _safe_float(record.get("normalized_il_additive_mol_fraction"))
        return _component_mol_fraction(record, "additive")
    if key == "base_oil_mol_fraction":
        if _safe_float(record.get("normalized_base_oil_mol_fraction")) is not None:
            return _safe_float(record.get("normalized_base_oil_mol_fraction"))
        return _component_mol_fraction(record, "base_oil")
    if key == "film_thickness":
        if _safe_float(record.get("normalized_film_thickness_nm")) is not None:
            return _safe_float(record.get("normalized_film_thickness_nm"))
        return _parse_film_thickness_nm(record.get("film_thickness"))
    if key == "alkyl_chain_length":
        if _safe_float(record.get("normalized_alkyl_chain_length")) is not None:
            return _safe_float(record.get("normalized_alkyl_chain_length"))
        return _safe_float(record.get("alkyl_chain_length"))
    return None


def target_column_name(target_key: str) -> str:
    target = TARGET_DEFINITIONS.get(target_key)
    if not target:
        raise ValueError(f"Unsupported target '{target_key}'.")
    return str(target["column_name"])


def _target_lookup_key(value: Any) -> str:
    text = str(value or "").strip().lower().replace("μ", "mu").replace("µ", "mu")
    return re.sub(r"[^a-z0-9]+", "", text)


def target_display_payload(*, key: Any = None, label: Any = None, column: Any = None) -> dict[str, str]:
    values = [_target_lookup_key(value) for value in (key, label, column)]
    if any(value in TARGET_DISPLAY_ALIASES for value in values):
        return {
            "key": "cof",
            "label": TARGET_DEFINITIONS["cof"]["label"],
            "column": str(column or target_column_name("cof")),
        }
    return {
        "key": str(key or "target"),
        "label": str(label or column or "Target"),
        "column": str(column or ""),
    }


def _normalize_split_strategy(value: Any) -> str:
    strategy = str(value or DEFAULT_DATA_OPTIONS["split_strategy"]).strip().lower()
    if strategy not in SPLIT_STRATEGY_DEFINITIONS:
        return DEFAULT_DATA_OPTIONS["split_strategy"]
    return strategy


def _normalize_cv_folds(value: Any) -> int:
    try:
        folds = int(value)
    except (TypeError, ValueError):
        folds = int(DEFAULT_DATA_OPTIONS["cv_folds"])
    return min(8, max(3, folds))


def _summarize_metric_points(points: list[dict[str, Any]]) -> dict[str, float]:
    if not points:
        return {
            "train_r2": 0.0,
            "val_r2": 0.0,
            "train_rmse": 0.0,
            "val_rmse": 0.0,
            "train_mae": 0.0,
            "val_mae": 0.0,
        }
    return {
        "train_r2": float(np.mean([point["train_r2"] for point in points])),
        "val_r2": float(np.mean([point["val_r2"] for point in points])),
        "train_rmse": float(np.mean([point["train_rmse"] for point in points])),
        "val_rmse": float(np.mean([point["val_rmse"] for point in points])),
        "train_mae": float(np.mean([point["train_mae"] for point in points])),
        "val_mae": float(np.mean([point["val_mae"] for point in points])),
    }


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
    row = {
        "id": record.id,
        "literature_id": record.literature_id,
        "cof_value": record.cof_value,
        "confidence": record.confidence,
        "lubricant_components": getattr(record, "lubricant_components_json", None),
        "mol_ratio": record.mol_ratio,
        "cation": record.cation,
        "anion": record.anion,
        "cation_smiles": record.cation_smiles,
        "anion_smiles": record.anion_smiles,
        "load_value": record.load_value,
        "load_raw": record.load_raw,
        "load_conditions": getattr(record, "load_conditions_json", None),
        "speed_value": record.speed_value,
        "speed_conditions": getattr(record, "speed_conditions_json", None),
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "film_thickness": record.film_thickness,
        "regime": getattr(record, "regime", None),
        "tribological_system": getattr(record, "tribological_system_json", None),
        "alkyl_chain_length": record.alkyl_chain_length,
    }
    experiment_profile = build_experiment_profile(row)
    row.update(
        {
            "experiment_profile": experiment_profile,
            "experiment_scale": experiment_profile["scale"],
            "experiment_method": experiment_profile["method"],
            "measurement_type": experiment_profile["measurement_type"],
            "training_view": experiment_profile["training_view"],
        }
    )
    return row


@dataclass
class TrainingTaskState:
    run_record_id: int | None
    task_id: str
    owner_user_id: int
    group_id: int
    scope_key: str
    config: dict[str, Any]
    dataset: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    feature_blocks: list[dict[str, Any]] = field(default_factory=list)
    insights: dict[str, Any] = field(default_factory=dict)
    fold_summaries: list[dict[str, Any]] = field(default_factory=list)
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
    tune_progress: dict[str, Any] | None = None
    test_metrics: dict[str, Any] | None = None
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
            "insights": self.insights,
            "fold_summaries": self.fold_summaries,
            "config": self.config,
            "tune_progress": self.tune_progress,
            "test_metrics": self.test_metrics,
            "history": self.history if include_history else [],
        }


class ModelTrainingService:
    def __init__(self) -> None:
        self._tasks: dict[str, TrainingTaskState] = {}

    async def summarize_scope(
        self,
        session: AsyncSession,
        scope_filter_values: dict[str, Any],
        cleaning_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        logger.debug("Summarizing training scope scope=%s", scope_filter_values.get("scope_key"))
        resolved = await self._resolve_records_for_cleaning(session, scope_filter_values, cleaning_options)
        cleaning_profile = self._build_cleaning_profile(
            resolved["records"],
            target_key="cof",
            cleaning_options=resolved["cleaning_options"],
        )
        return self._build_scope_summary_payload(
            total_records=len(resolved["records"]),
            cleaned_records=len(cleaning_profile["summary_records"]),
            cleaning_summary=cleaning_profile["summary"],
            source_scope=resolved["source_scope"],
        )

    def summarize_saved_dataset(self, dataset: CleanedDataset) -> dict[str, Any]:
        logger.debug("Summarizing saved dataset dataset_id=%s", dataset.id)
        rows, metadata = self._load_saved_dataset_rows(dataset)
        feature_columns = self._feature_columns_from_dataset_metadata(rows, metadata)
        target_column = self._target_column_from_metadata(metadata)
        usable_records = self._usable_saved_rows(rows, target_column, feature_columns)

        return {
            "dataset": {
                "id": dataset.id,
                "name": dataset.name,
                "description": dataset.description,
                "total_records": int(dataset.row_count),
                "cleaned_records": int(dataset.row_count),
                "usable_records": usable_records,
                "feature_dimensions": len(feature_columns),
                "target_column": target_column,
                "target": target_display_payload(
                    key=metadata.get("target", {}).get("key") if isinstance(metadata.get("target"), dict) else dataset.target_key,
                    label=metadata.get("target", {}).get("label") if isinstance(metadata.get("target"), dict) else None,
                    column=target_column,
                ),
                "feature_columns": feature_columns,
                "columns": [target_column, *feature_columns],
                "rdkit_enabled": RDKit_AVAILABLE,
                "source_scope": metadata.get("source_scope", {}),
            },
            "algorithms": self._algorithm_options(),
            "split_options": self._split_options(),
            "cleaning": metadata.get("summary", {}),
            "pca_info": metadata.get("pca_info"),
            "defaults": {
                "target": target_column,
                "algorithm": "gradient_boosting",
                "hyperparameters": DEFAULT_HYPERPARAMETERS,
                "data_options": DEFAULT_DATA_OPTIONS,
                "cleaned_dataset_id": dataset.id,
            },
        }

    def _build_scope_summary_payload(
        self,
        *,
        total_records: int,
        cleaned_records: int,
        cleaning_summary: dict[str, Any],
        source_scope: dict[str, Any],
    ) -> dict[str, Any]:
        target_column = target_column_name("cof")
        return {
            "dataset": {
                "id": None,
                "name": "Live cleaned scope",
                "description": "Save a cleaned dataset before starting a training run.",
                "total_records": total_records,
                "cleaned_records": cleaned_records,
                "usable_records": cleaned_records,
                "feature_dimensions": 0,
                "target_column": target_column,
                "target": target_display_payload(key="cof", column=target_column),
                "feature_columns": [],
                "columns": [target_column],
                "rdkit_enabled": RDKit_AVAILABLE,
                "source_scope": source_scope,
            },
            "algorithms": self._algorithm_options(),
            "split_options": self._split_options(),
            "cleaning": cleaning_summary,
            "pca_info": None,
            "defaults": {
                "target": target_column,
                "algorithm": "gradient_boosting",
                "hyperparameters": DEFAULT_HYPERPARAMETERS,
                "data_options": DEFAULT_DATA_OPTIONS,
                "cleaned_dataset_id": None,
            },
        }

    def _algorithm_options(self) -> list[dict[str, Any]]:
        definitions = dict(BASE_ALGORITHM_DEFINITIONS)
        if CATBOOST_AVAILABLE:
            definitions["catboost"] = {
                "label": "CatBoost",
                "description": "对称树梯度提升，原生支持类别特征，小样本表现优秀。",
            }
        if XGBOOST_AVAILABLE:
            definitions["xgboost"] = {
                "label": "极端梯度提升（XGBoost）",
                "description": "工业界使用最广泛的梯度提升实现，对结构化数据表现稳定，支持 L1/L2 正则。",
            }
        # 排序：树模型在前，线性/SVR 在后，便于学生从效果好的开始尝试
        order = ["gradient_boosting", "random_forest", "catboost", "xgboost", "svr", "linear_regression"]
        return [
            {"key": key, **definitions[key]}
            for key in order
            if key in definitions and key not in DISABLED_TRAINING_ALGORITHMS
        ]

    def _split_options(self) -> list[dict[str, Any]]:
        return [{"key": key, **value} for key, value in SPLIT_STRATEGY_DEFINITIONS.items()]

    def _fit_round_model(
        self,
        *,
        algorithm: str,
        round_index: int,
        learning_rate: float,
        max_depth: int,
        l2_leaf_reg: float,
        random_strength: float,
        random_seed: int,
        model: Any | None,
        X_train: np.ndarray,
        y_train: np.ndarray,
    ) -> Any:
        if algorithm == "gradient_boosting":
            if model is None:
                model = GradientBoostingRegressor(
                    n_estimators=1,
                    learning_rate=learning_rate,
                    max_depth=max_depth,
                    random_state=random_seed,
                    warm_start=True,
                )
            model.set_params(n_estimators=round_index)
            model.fit(X_train, y_train)
            return model

        if algorithm == "linear_regression":
            if model is None:
                model = LinearRegression()
            model.fit(X_train, y_train)
            return model

        if algorithm == "random_forest":
            if model is None:
                model = RandomForestRegressor(
                    n_estimators=1,
                    max_depth=max_depth,
                    random_state=random_seed,
                    warm_start=True,
                    n_jobs=1,
                )
            model.set_params(n_estimators=round_index)
            model.fit(X_train, y_train)
            return model

        if algorithm == "catboost":
            if not CATBOOST_AVAILABLE or CatBoostRegressor is None:
                raise ValueError("CatBoost is not installed on the server. Install backend dependencies to enable this model.")
            model = CatBoostRegressor(
                iterations=round_index,
                learning_rate=learning_rate,
                depth=max_depth,
                l2_leaf_reg=l2_leaf_reg,
                random_strength=random_strength,
                loss_function="RMSE",
                random_seed=random_seed,
                verbose=False,
                allow_writing_files=False,
                thread_count=1,
            )
            model.fit(X_train, y_train, verbose=False)
            return model

        if algorithm == "xgboost":
            if not XGBOOST_AVAILABLE or XGBRegressor is None:
                raise ValueError(
                    "XGBoost is not installed on the server (Mac users may also need `brew install libomp`)."
                )
            model = XGBRegressor(
                n_estimators=round_index,
                learning_rate=learning_rate,
                max_depth=max_depth,
                reg_lambda=l2_leaf_reg,
                random_state=random_seed,
                tree_method="hist",
                verbosity=0,
                n_jobs=1,
            )
            model.fit(X_train, y_train)
            return model

        if algorithm == "svr":
            # SVR 是一次性拟合（没有"轮次"概念）；为保留与梯度提升同样的进度条，我们
            # 在第一轮就训练完整模型，后续轮次直接复用即可（loop 仍然会调用，但开销可忽略）。
            if model is not None:
                return model
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X_train)
            estimator = SVR(kernel="rbf", C=10.0, epsilon=0.05, gamma="scale")
            estimator.fit(X_scaled, y_train)
            return _ScaledRegressor(scaler=scaler, estimator=estimator)

        if algorithm == "mlp":
            if model is not None:
                return model
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X_train)
            target_scaler = StandardScaler()
            y_scaled = target_scaler.fit_transform(np.asarray(y_train, dtype=np.float32).reshape(-1, 1)).ravel()
            mlp_learning_rate = learning_rate if 0.0001 <= learning_rate <= 0.01 else 0.001
            estimator = MLPRegressor(
                hidden_layer_sizes=(64, 32),
                activation="relu",
                solver="adam",
                learning_rate_init=mlp_learning_rate,
                alpha=max(0.0001, l2_leaf_reg * 0.0005),
                max_iter=500,
                random_state=random_seed,
                early_stopping=True,
                validation_fraction=0.1,
            )
            estimator.fit(X_scaled, y_scaled)
            return _ScaledRegressor(scaler=scaler, estimator=estimator, target_scaler=target_scaler)

        raise ValueError(f"Unsupported algorithm '{algorithm}'.")

    async def create_training_task(
        self,
        session: AsyncSession,
        *,
        scope_filter_values: dict[str, Any],
        owner_user_id: int,
        group_id: int,
        scope_key: str,
        config: dict[str, Any],
        saved_dataset: CleanedDataset | None = None,
    ) -> TrainingTaskState:
        if saved_dataset is None:
            raise ValueError("Select a saved cleaned dataset before starting training.")

        logger.info(
            "Creating training task user_id=%s group_id=%s scope=%s dataset_id=%s",
            owner_user_id,
            group_id,
            scope_key,
            saved_dataset.id,
        )
        rows, metadata = self._load_saved_dataset_rows(saved_dataset)
        algorithm = str(config.get("algorithm") or "gradient_boosting")
        if algorithm in DISABLED_TRAINING_ALGORITHMS:
            raise ValueError(f"Algorithm '{algorithm}' is disabled for new training runs.")
        task_id = uuid.uuid4().hex
        run = ModelTrainingRun(
            task_id=task_id,
            status="queued",
            target_column=str(config.get("target") or self._target_column_from_metadata(metadata)),
            algorithm=algorithm,
            split_strategy=_normalize_split_strategy((config.get("data_options") or {}).get("split_strategy")),
            group_id=group_id,
            workspace_id=scope_filter_values.get("workspace_id"),
            cleaned_dataset_id=saved_dataset.id,
            owner_user_id=owner_user_id,
            scope_type=str(scope_filter_values.get("scope_type") or "workspace"),
            scope_key=scope_key,
            usable_records=0,
            config_json=json.dumps(config, ensure_ascii=False),
            summary_json=None,
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        task = TrainingTaskState(
            run_record_id=run.id,
            task_id=task_id,
            owner_user_id=owner_user_id,
            group_id=group_id,
            scope_key=scope_key,
            config=config,
        )
        self._tasks[task_id] = task
        asyncio.create_task(self._run_training(task, rows, metadata.get("source_scope", {}), metadata))
        logger.info("Training task created task_id=%s", task_id)
        return task

    async def list_runs(
        self,
        session: AsyncSession,
        *,
        group_id: int,
        scope_key: str,
        limit: int = 12,
    ) -> list[dict[str, Any]]:
        stmt = (
            select(ModelTrainingRun)
            .where(
                ModelTrainingRun.group_id == group_id,
                ModelTrainingRun.scope_key == scope_key,
                ModelTrainingRun.status.in_(("completed", "failed", "cancelled")),
            )
            .order_by(desc(ModelTrainingRun.created_at), desc(ModelTrainingRun.id))
            .limit(limit)
        )
        result = await session.execute(stmt)
        return [self._run_list_item(item) for item in result.scalars().all()]

    async def get_run(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        group_id: int,
        scope_key: str,
    ) -> dict[str, Any] | None:
        stmt = select(ModelTrainingRun).where(
            ModelTrainingRun.task_id == task_id,
            ModelTrainingRun.group_id == group_id,
            ModelTrainingRun.scope_key == scope_key,
        )
        run = (await session.execute(stmt)).scalar_one_or_none()
        if run is None:
            return None
        payload = self._run_payload(run)
        return payload.get("snapshot")

    async def register_run(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        group_id: int,
        scope_key: str,
        owner_user_id: int,
        workspace_id: int | None,
        scope_type: str,
        name: str | None,
        description: str | None,
    ) -> dict[str, Any]:
        stmt = (
            select(ModelTrainingRun)
            .options(selectinload(ModelTrainingRun.cleaned_dataset))
            .where(
                ModelTrainingRun.task_id == task_id,
                ModelTrainingRun.group_id == group_id,
                ModelTrainingRun.scope_key == scope_key,
            )
        )
        run = (await session.execute(stmt)).scalar_one_or_none()
        if run is None:
            raise KeyError(task_id)
        if run.status != "completed":
            raise ValueError("Only completed runs can be registered as reusable models.")

        existing_stmt = select(RegisteredModel).where(
            RegisteredModel.training_run_id == run.id,
            RegisteredModel.scope_key == scope_key,
        )
        existing = (await session.execute(existing_stmt)).scalar_one_or_none()
        snapshot = (self._run_payload(run).get("snapshot") or {})
        model_name = (name or "").strip() or self._default_registry_name(run, snapshot)
        model_description = (description or "").strip() or None

        if existing is not None:
            existing.name = model_name
            existing.description = model_description
            existing.summary_json = json.dumps(snapshot, ensure_ascii=False)
            await session.commit()
            existing = await session.get(
                RegisteredModel,
                existing.id,
                options=[selectinload(RegisteredModel.training_run), selectinload(RegisteredModel.source_dataset)],
            )
            if existing is None:
                raise ValueError("The registered model could not be reloaded after update.")
            return self._registered_model_list_item(existing)

        registered = RegisteredModel(
            name=model_name,
            description=model_description,
            training_run_id=run.id,
            source_dataset_id=run.cleaned_dataset_id,
            group_id=group_id,
            workspace_id=workspace_id,
            created_by_user_id=owner_user_id,
            scope_type=scope_type,
            scope_key=scope_key,
            config_json=run.config_json,
            summary_json=json.dumps(snapshot, ensure_ascii=False),
        )
        session.add(registered)
        await session.commit()
        await session.refresh(registered)
        registered = await session.get(
            RegisteredModel,
            registered.id,
            options=[selectinload(RegisteredModel.training_run), selectinload(RegisteredModel.source_dataset)],
        )
        if registered is None:
            raise ValueError("The registered model could not be reloaded after creation.")
        return self._registered_model_list_item(registered)

    async def list_registered_models(
        self,
        session: AsyncSession,
        *,
        group_id: int,
        scope_key: str,
    ) -> list[dict[str, Any]]:
        stmt = (
            select(RegisteredModel)
            .options(selectinload(RegisteredModel.training_run), selectinload(RegisteredModel.source_dataset))
            .where(
                RegisteredModel.group_id == group_id,
                RegisteredModel.scope_key == scope_key,
            )
            .order_by(desc(RegisteredModel.created_at), desc(RegisteredModel.id))
        )
        result = await session.execute(stmt)
        return [self._registered_model_list_item(item) for item in result.scalars().all()]

    async def delete_registered_model(
        self,
        session: AsyncSession,
        *,
        registry_id: int,
        group_id: int,
        scope_key: str,
    ) -> None:
        stmt = select(RegisteredModel).where(
            RegisteredModel.id == registry_id,
            RegisteredModel.group_id == group_id,
            RegisteredModel.scope_key == scope_key,
        )
        model = (await session.execute(stmt)).scalar_one_or_none()
        if model is None:
            raise KeyError(registry_id)
        await session.delete(model)
        await session.commit()

    async def predict_with_registered_model(
        self,
        session: AsyncSession,
        *,
        registry_id: int,
        group_id: int,
        scope_key: str,
        target_dataset: CleanedDataset,
    ) -> dict[str, Any]:
        stmt = (
            select(RegisteredModel)
            .options(
                selectinload(RegisteredModel.training_run).selectinload(ModelTrainingRun.cleaned_dataset),
                selectinload(RegisteredModel.source_dataset),
            )
            .where(
                RegisteredModel.id == registry_id,
                RegisteredModel.group_id == group_id,
                RegisteredModel.scope_key == scope_key,
            )
        )
        registered = (await session.execute(stmt)).scalar_one_or_none()
        if registered is None:
            raise KeyError(registry_id)
        if registered.training_run is None or registered.training_run.cleaned_dataset is None:
            raise ValueError("The registered model is missing its source training dataset.")

        source_dataset = registered.training_run.cleaned_dataset
        run_payload = self._run_payload(registered.training_run)
        config = run_payload.get("config") or json.loads(registered.training_run.config_json or "{}")
        source_rows, source_metadata = self._load_saved_dataset_rows(source_dataset)
        target_rows, target_metadata = self._load_saved_dataset_rows(target_dataset)
        prepared = self._prepare_saved_dataset(source_rows, config, source_metadata)
        feature_columns = list(prepared["dataset"]["feature_columns"])
        target_column = self._target_column_from_metadata(target_metadata)

        available_columns = set(target_metadata.get("matrix_columns") or [])
        if not available_columns and target_rows:
            available_columns = set(target_rows[0].keys())
        missing_features = [column for column in feature_columns if column not in available_columns]
        if missing_features:
            raise ValueError(
                "The target dataset is missing required feature columns: "
                + ", ".join(missing_features[:12])
            )
        if not target_rows:
            raise ValueError("The target dataset does not contain any rows to predict.")

        imputer = SimpleImputer(strategy="median")
        imputer.fit(prepared["matrix_raw"])
        X_train_full = imputer.transform(prepared["matrix_raw"]).astype(np.float32)
        model = self._fit_full_model(config, X_train_full, prepared["y"])

        target_matrix = np.array([[row.get(column) for column in feature_columns] for row in target_rows], dtype=object)
        X_target = imputer.transform(target_matrix).astype(np.float32)
        predictions = np.asarray(model.predict(X_target), dtype=np.float32)

        preview_rows: list[dict[str, Any]] = []
        actual_values: list[float] = []
        predicted_values: list[float] = []
        for row_index, (row, prediction) in enumerate(zip(target_rows, predictions.tolist(), strict=False)):
            actual = _safe_float(row.get(target_column))
            predicted = _safe_float(prediction)
            residual = float(predicted - actual) if actual is not None and predicted is not None else None
            if actual is not None and predicted is not None:
                actual_values.append(float(actual))
                predicted_values.append(float(predicted))
            preview_rows.append(
                {
                    "row_index": row_index,
                    "record_id": row.get("__record_id"),
                    "literature_id": row.get("__literature_id"),
                    "confidence": _safe_float(row.get("__confidence")),
                    "actual": float(actual) if actual is not None else None,
                    "predicted": float(predicted) if predicted is not None else None,
                    "residual": residual,
                }
            )

        preview_rows.sort(
            key=lambda item: abs(item["residual"]) if item["residual"] is not None else -1.0,
            reverse=True,
        )
        metrics = self._prediction_metrics(actual_values, predicted_values)
        return {
            "registry_id": registered.id,
            "registered_model_name": registered.name,
            "source_dataset": {
                "id": source_dataset.id,
                "name": source_dataset.name,
            },
            "target_dataset": {
                "id": target_dataset.id,
                "name": target_dataset.name,
                "row_count": len(target_rows),
            },
            "feature_columns": feature_columns,
            "summary": {
                "predicted_rows": len(target_rows),
                "scored_rows": len(actual_values),
                "feature_dimensions": len(feature_columns),
                "r2": metrics["r2"],
                "rmse": metrics["rmse"],
                "mae": metrics["mae"],
            },
            "preview_rows": preview_rows[:20],
        }

    def get_task(self, task_id: str, requester_user_id: int) -> TrainingTaskState:
        logger.debug("Fetching training task task_id=%s requester_user_id=%s", task_id, requester_user_id)
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
        logger.info("Cancellation requested for task_id=%s", task_id)
        return task

    def register_subscriber(self, task_id: str, requester_user_id: int) -> tuple[TrainingTaskState, asyncio.Queue]:
        task = self.get_task(task_id, requester_user_id)
        queue: asyncio.Queue = asyncio.Queue()
        task.subscribers.add(queue)
        logger.debug("Registered websocket subscriber for task_id=%s", task_id)
        return task, queue

    def unregister_subscriber(self, task: TrainingTaskState, queue: asyncio.Queue) -> None:
        task.subscribers.discard(queue)
        logger.debug("Unregistered websocket subscriber for task_id=%s", task.task_id)

    def _run_payload(self, run: ModelTrainingRun) -> dict[str, Any]:
        if run.summary_json:
            try:
                return json.loads(run.summary_json)
            except Exception:
                logger.warning("Failed to parse training run summary for task_id=%s", run.task_id)
        return {
            "task_id": run.task_id,
            "status": run.status,
            "config": json.loads(run.config_json or "{}"),
            "snapshot": None,
        }

    def _run_list_item(self, run: ModelTrainingRun) -> dict[str, Any]:
        payload = self._run_payload(run)
        snapshot = payload.get("snapshot") or {}
        current = snapshot.get("current") or {}
        dataset = snapshot.get("dataset") or {}
        return {
            "task_id": run.task_id,
            "status": run.status,
            "algorithm": run.algorithm,
            "split_strategy": run.split_strategy,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "usable_records": int(run.usable_records or 0),
            "cleaned_dataset_id": run.cleaned_dataset_id,
            "target_column": run.target_column,
            "val_r2": current.get("val_r2"),
            "val_rmse": current.get("val_rmse"),
            "val_mae": current.get("val_mae"),
            "feature_dimensions": dataset.get("feature_dimensions"),
        }

    def _registered_model_list_item(self, model: RegisteredModel) -> dict[str, Any]:
        run_payload = self._run_payload(model.training_run)
        snapshot = run_payload.get("snapshot") or {}
        current = snapshot.get("current") or {}
        dataset = snapshot.get("dataset") or {}
        return {
            "id": model.id,
            "name": model.name,
            "description": model.description,
            "created_at": model.created_at.isoformat() if model.created_at else None,
            "algorithm": model.training_run.algorithm,
            "split_strategy": model.training_run.split_strategy,
            "task_id": model.training_run.task_id,
            "source_dataset_id": model.source_dataset_id,
            "source_dataset_name": model.source_dataset.name if model.source_dataset else None,
            "val_r2": current.get("val_r2"),
            "val_rmse": current.get("val_rmse"),
            "val_mae": current.get("val_mae"),
            "feature_dimensions": dataset.get("feature_dimensions"),
        }

    def _default_registry_name(self, run: ModelTrainingRun, snapshot: dict[str, Any]) -> str:
        dataset_name = (
            (snapshot.get("dataset") or {}).get("name")
            or (run.cleaned_dataset.name if run.cleaned_dataset else None)
            or "Dataset"
        )
        algorithm = BASE_ALGORITHM_DEFINITIONS.get(run.algorithm, {}).get("label") or run.algorithm.replace("_", " ").title()
        created_at = (run.finished_at or run.created_at)
        timestamp = created_at.strftime("%Y-%m-%d %H:%M") if created_at else "Run"
        return f"{algorithm} / {dataset_name} / {timestamp}"

    def _fit_full_model(self, config: dict[str, Any], X: np.ndarray, y: np.ndarray) -> Any:
        algorithm = str(config.get("algorithm") or "gradient_boosting")
        hyperparameters = config.get("hyperparameters") or {}
        learning_rate = _float_or_default(hyperparameters.get("learning_rate"), DEFAULT_HYPERPARAMETERS["learning_rate"])
        max_depth = _int_or_default(hyperparameters.get("max_depth"), DEFAULT_HYPERPARAMETERS["max_depth"])
        l2_leaf_reg = _float_or_default(hyperparameters.get("l2_leaf_reg"), DEFAULT_HYPERPARAMETERS["l2_leaf_reg"])
        random_strength = _float_or_default(hyperparameters.get("random_strength"), DEFAULT_HYPERPARAMETERS["random_strength"])
        random_seed = _int_or_default((config.get("data_options") or {}).get("random_seed"), DEFAULT_DATA_OPTIONS["random_seed"])

        if algorithm == "linear_regression":
            total_rounds = 1
        else:
            n_estimators = _int_or_default(hyperparameters.get("n_estimators"), DEFAULT_HYPERPARAMETERS["n_estimators"])
            total_rounds = min(300, max(20, n_estimators))

        model: Any | None = None
        for round_index in range(1, total_rounds + 1):
            model = self._fit_round_model(
                algorithm=algorithm,
                round_index=round_index,
                learning_rate=learning_rate,
                max_depth=max_depth,
                l2_leaf_reg=l2_leaf_reg,
                random_strength=random_strength,
                random_seed=random_seed,
                model=model,
                X_train=X,
                y_train=y,
            )
        return model

    def _prediction_metrics(self, actual_values: list[float], predicted_values: list[float]) -> dict[str, float | None]:
        if len(actual_values) < 2:
            return {"r2": None, "rmse": None, "mae": None}
        actual = np.array(actual_values, dtype=np.float32)
        predicted = np.array(predicted_values, dtype=np.float32)
        r2 = None
        if not np.isclose(np.var(actual), 0.0):
            r2 = float(r2_score(actual, predicted))
        return {
            "r2": r2,
            "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
            "mae": float(mean_absolute_error(actual, predicted)),
        }

    async def _persist_run_update(self, task: TrainingTaskState) -> None:
        if task.run_record_id is None:
            return
        async with async_session_maker() as session:
            run = await session.get(ModelTrainingRun, task.run_record_id)
            if run is None:
                return
            run.status = task.status
            run.usable_records = int((task.dataset or {}).get("usable_records") or 0)
            run.started_at = datetime.fromisoformat(task.started_at) if task.started_at else None
            run.finished_at = datetime.fromisoformat(task.finished_at) if task.finished_at else None
            run.summary_json = json.dumps(
                {
                    "task_id": task.task_id,
                    "status": task.status,
                    "config": task.config,
                    "snapshot": task.snapshot(include_history=True),
                },
                ensure_ascii=False,
            )
            await session.commit()

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

    def _normalize_cleaning_options(self, cleaning_options: dict[str, Any] | None) -> dict[str, Any]:
        options = {**DEFAULT_CLEANING_OPTIONS, **(cleaning_options or {})}
        source_mode = str(options.get("source_mode") or DEFAULT_CLEANING_OPTIONS["source_mode"]).strip().lower()
        if source_mode not in {"current_scope", "group_library", "group_library_fallback"}:
            source_mode = DEFAULT_CLEANING_OPTIONS["source_mode"]
        options["source_mode"] = source_mode
        options["training_view"] = normalize_training_view(options.get("training_view"))
        options["drop_missing_target"] = bool(options.get("drop_missing_target", True))
        options["require_dual_smiles"] = bool(options.get("require_dual_smiles", True))
        return options

    def _group_library_scope(self, scope_filter_values: dict[str, Any]) -> dict[str, Any]:
        return {
            "group_id": scope_filter_values["group_id"],
            "scope_type": "group_library",
            "scope_key": "group_library",
            "workspace_id": None,
        }

    def _scope_label(self, scope_filter_values: dict[str, Any], current_scope_key: str) -> str:
        if scope_filter_values["scope_key"] == "group_library":
            return "Group library"
        if scope_filter_values["scope_key"] == current_scope_key:
            return "Current workspace"
        return "Workspace"

    async def _resolve_records_for_cleaning(
        self,
        session: AsyncSession,
        scope_filter_values: dict[str, Any],
        cleaning_options: dict[str, Any] | None,
    ) -> dict[str, Any]:
        normalized_options = self._normalize_cleaning_options(cleaning_options)
        current_records = await self._load_scope_records(session, scope_filter_values)
        resolved_scope = scope_filter_values
        records = current_records

        if normalized_options["source_mode"] == "group_library":
            resolved_scope = self._group_library_scope(scope_filter_values)
            records = await self._load_scope_records(session, resolved_scope)
        elif normalized_options["source_mode"] == "group_library_fallback" and not current_records:
            resolved_scope = self._group_library_scope(scope_filter_values)
            records = await self._load_scope_records(session, resolved_scope)

        return {
            "records": records,
            "cleaning_options": normalized_options,
            "source_scope": {
                "requested_mode": normalized_options["source_mode"],
                "resolved_scope_key": resolved_scope["scope_key"],
                "resolved_scope_type": resolved_scope["scope_type"],
                "label": self._scope_label(resolved_scope, scope_filter_values["scope_key"]),
                "used_fallback": resolved_scope["scope_key"] != scope_filter_values["scope_key"],
            },
        }

    def _build_cleaning_profile(
        self,
        records: list[dict[str, Any]],
        *,
        target_key: str,
        cleaning_options: dict[str, Any] | None,
    ) -> dict[str, Any]:
        target_def = TARGET_DEFINITIONS.get(target_key)
        if not target_def:
            raise ValueError(f"Unsupported target '{target_key}'.")

        options = self._normalize_cleaning_options(cleaning_options)
        training_view = normalize_training_view(options.get("training_view"))
        view_ready = [record for record in records if record_matches_training_view(record, training_view)]
        scoped_records = view_ready if training_view != "all" else records
        target_ready = [record for record in scoped_records if _safe_float(record.get(target_def["field"])) is not None]
        chemistry_ready = [
            record
            for record in scoped_records
            if str(record.get("cation_smiles") or "").strip() and str(record.get("anion_smiles") or "").strip()
        ]

        cleaned_records = target_ready if options["drop_missing_target"] else list(scoped_records)
        if options["require_dual_smiles"]:
            cleaned_records = [
                record
                for record in cleaned_records
                if str(record.get("cation_smiles") or "").strip() and str(record.get("anion_smiles") or "").strip()
            ]

        return {
            "summary_records": cleaned_records,
            "summary": {
                "source_mode": options["source_mode"],
                "training_view": training_view,
                "raw_records": len(records),
                "view_ready_records": len(view_ready),
                "target_ready_records": len(target_ready),
                "chemistry_ready_records": len(chemistry_ready),
                "training_ready_records": len(cleaned_records),
                "dropped_by_reason": {
                    "missing_target": sum(1 for record in scoped_records if _safe_float(record.get(target_def["field"])) is None),
                    "missing_cation_smiles": sum(1 for record in scoped_records if not str(record.get("cation_smiles") or "").strip()),
                    "missing_anion_smiles": sum(1 for record in scoped_records if not str(record.get("anion_smiles") or "").strip()),
                    "outside_training_view": 0 if training_view == "all" else max(0, len(records) - len(view_ready)),
                },
                "rules": {
                    "training_view": training_view,
                    "drop_missing_target": options["drop_missing_target"],
                    "require_dual_smiles": options["require_dual_smiles"],
                },
            },
        }

    def _load_saved_dataset_rows(self, dataset: CleanedDataset) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        rows = json.loads(dataset.rows_json)
        metadata = json.loads(dataset.summary_json)
        return rows, metadata

    def _target_column_from_metadata(self, metadata: dict[str, Any]) -> str:
        return str(metadata.get("target_column") or target_column_name("cof"))

    def _feature_columns_from_dataset_metadata(
        self,
        rows: list[dict[str, Any]],
        metadata: dict[str, Any],
    ) -> list[str]:
        feature_columns = metadata.get("feature_columns")
        if isinstance(feature_columns, list) and feature_columns:
            return [str(column) for column in feature_columns]

        target_column = self._target_column_from_metadata(metadata)
        if not rows:
            return []
        return [str(column) for column in rows[0].keys() if str(column) != target_column]

    def _usable_saved_rows(
        self,
        rows: list[dict[str, Any]],
        target_column: str,
        feature_columns: list[str],
    ) -> int:
        count = 0
        for row in rows:
            if _safe_float(row.get(target_column)) is None:
                continue
            if not feature_columns:
                continue
            count += 1
        return count

    def _normalize_joint_cation_label(self, row: dict[str, Any]) -> str:
        for field in ("__cation", "cation", "Cation", "cation_label", "__cation_smiles", "cation_smiles", "Cation_SMILES"):
            value = str(row.get(field) or "").strip()
            if value:
                normalized = re.sub(r"\s+", "", value).lower()
                return normalized[:96] or "unknown"
        return "unknown"

    def _target_quantile_edges(self, values: list[float], *, bins: int = JOINT_STRATIFICATION_BINS) -> list[float]:
        usable = np.asarray([value for value in values if math.isfinite(value)], dtype=float)
        if usable.size < 2 or np.isclose(float(np.var(usable)), 0.0):
            return []
        quantiles = np.quantile(usable, np.linspace(0, 1, bins + 1)[1:-1])
        edges: list[float] = []
        for value in quantiles.tolist():
            numeric = float(value)
            if not edges or not np.isclose(edges[-1], numeric):
                edges.append(numeric)
        return edges

    def _target_bin_index(self, value: float, edges: list[float]) -> int:
        if not edges:
            return 0
        return int(np.searchsorted(np.asarray(edges, dtype=float), float(value), side="right"))

    def _build_joint_stratification(self, eligible_rows: list[dict[str, Any]]) -> tuple[np.ndarray, dict[str, Any]]:
        target_values = [float(row["_target_value"]) for row in eligible_rows]
        edges = self._target_quantile_edges(target_values)
        labels: list[str] = []
        missing_cation_count = 0
        cation_counts: dict[str, int] = {}
        stratum_counts: dict[str, int] = {}

        for row in eligible_rows:
            cation_label = self._normalize_joint_cation_label(row)
            if cation_label == "unknown":
                missing_cation_count += 1
            friction_bin = self._target_bin_index(float(row["_target_value"]), edges)
            stratum = f"{cation_label}|mu_bin_{friction_bin}"
            row["_cation_label"] = cation_label
            row["_friction_bin"] = friction_bin
            row["_joint_stratum"] = stratum
            cation_counts[cation_label] = cation_counts.get(cation_label, 0) + 1
            stratum_counts[stratum] = stratum_counts.get(stratum, 0) + 1
            labels.append(stratum)

        singleton_strata = sum(1 for count in stratum_counts.values() if count == 1)
        return np.asarray(labels, dtype=object), {
            "target_bin_count": len(edges) + 1 if edges else 1,
            "target_bin_edges": [round(float(edge), 6) for edge in edges],
            "cation_count": len(cation_counts),
            "missing_cation_count": missing_cation_count,
            "strata_count": len(stratum_counts),
            "singleton_strata": singleton_strata,
        }

    def _format_target_bin_label(self, bin_index: int | None, edges: list[float]) -> str:
        if bin_index is None:
            return "未分箱"
        if not edges:
            return "全部 μ"
        index = int(bin_index)
        if index <= 0:
            return f"μ ≤ {edges[0]:.3f}"
        if index >= len(edges):
            return f"μ > {edges[-1]:.3f}"
        return f"{edges[index - 1]:.3f} < μ ≤ {edges[index]:.3f}"

    def _joint_stratified_holdout_indices(
        self,
        labels: np.ndarray,
        *,
        test_fraction: float,
        random_seed: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        rng = np.random.default_rng(random_seed)
        label_to_indices: dict[str, list[int]] = {}
        for index, label in enumerate(labels.tolist()):
            label_to_indices.setdefault(str(label), []).append(index)

        train_pool: list[int] = []
        test: list[int] = []
        external: list[int] = []
        for label in sorted(label_to_indices):
            indices = np.asarray(label_to_indices[label], dtype=int)
            rng.shuffle(indices)
            if len(indices) == 1:
                external.extend(indices.tolist())
                continue
            test_count = max(1, int(round(len(indices) * test_fraction)))
            test_count = min(test_count, len(indices) - 1)
            test.extend(indices[:test_count].tolist())
            train_pool.extend(indices[test_count:].tolist())

        rng.shuffle(train_pool)
        rng.shuffle(test)
        rng.shuffle(external)
        return (
            np.asarray(train_pool, dtype=int),
            np.asarray(test, dtype=int),
            np.asarray(external, dtype=int),
        )

    def _prepare_saved_dataset(self, rows: list[dict[str, Any]], config: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
        target_column = self._target_column_from_metadata(metadata)
        feature_columns = self._feature_columns_from_dataset_metadata(rows, metadata)
        if not feature_columns:
            raise ValueError("The saved dataset does not contain any feature columns.")

        data_options = config.get("data_options") or {}
        max_records = data_options.get("max_records")
        max_records = _int_or_default(max_records, 0) if max_records not in (None, "", 0) else None
        min_confidence = _float_or_default(data_options.get("min_confidence"), DEFAULT_DATA_OPTIONS["min_confidence"])
        random_seed = _int_or_default(data_options.get("random_seed"), DEFAULT_DATA_OPTIONS["random_seed"])
        validation_split = _float_or_default(data_options.get("validation_split"), DEFAULT_DATA_OPTIONS["validation_split"])
        validation_split = min(0.4, max(0.1, validation_split))
        split_strategy = _normalize_split_strategy(data_options.get("split_strategy"))
        cv_folds = _normalize_cv_folds(data_options.get("cv_folds"))

        eligible_rows: list[dict[str, Any]] = []
        dropped_low_confidence = 0
        for row_index, row in enumerate(rows):
            target_value = _safe_float(row.get(target_column))
            if target_value is None:
                continue
            confidence_value = _safe_float(row.get("__confidence"))
            if confidence_value is not None and confidence_value < min_confidence:
                dropped_low_confidence += 1
                continue
            eligible_rows.append(
                {
                    **row,
                    "_target_value": target_value,
                    "_row_index": row_index,
                    "_record_id": row.get("__record_id"),
                    "_literature_id": row.get("__literature_id"),
                    "_confidence": confidence_value,
                }
            )

        if max_records:
            eligible_rows = eligible_rows[:max_records]

        usable_records = len(eligible_rows)
        if usable_records < 10:
            raise ValueError(f"Only {usable_records} rows are usable. At least 10 rows are required for training.")

        max_reasonable_folds = max(3, usable_records // 2)
        effective_cv_folds = min(cv_folds, max_reasonable_folds)

        matrix = np.array([[row.get(column) for column in feature_columns] for row in eligible_rows], dtype=object)
        missing_before_imputation = int(sum(1 for value in matrix.ravel() if _safe_float(value) is None))
        X = SimpleImputer(strategy="median").fit_transform(matrix).astype(np.float32)
        y = np.array([row["_target_value"] for row in eligible_rows], dtype=np.float32)

        if X.shape[0] < 10 or X.shape[1] == 0:
            raise ValueError("The selected dataset did not produce a usable training matrix.")

        groups = np.array(
            [str(row.get("_literature_id")) if row.get("_literature_id") is not None else f"row-{row['_row_index']}" for row in eligible_rows],
            dtype=object,
        )
        distinct_groups = len(set(groups.tolist()))
        joint_labels, joint_summary = self._build_joint_stratification(eligible_rows)

        # 留出测试集——训练全程不可见，最终给学生"出考卷"用。
        all_indices = np.arange(len(eligible_rows))
        external_idx = np.array([], dtype=int)
        if split_strategy == "joint_stratified":
            train_pool_idx, test_idx, external_idx = self._joint_stratified_holdout_indices(
                joint_labels,
                test_fraction=validation_split,
                random_seed=int(random_seed) + 1000,
            )
            if len(train_pool_idx) < 10:
                # 极端稀疏数据无法按论文规则留下足够训练池时，回退为随机训练池以保持可用性。
                train_pool_idx = all_indices
                test_idx = np.array([], dtype=int)
                external_idx = np.array([], dtype=int)
        elif len(all_indices) >= 30:
            test_pool_seed = int(random_seed) + 1000
            train_pool_idx, test_idx = train_test_split(
                all_indices,
                test_size=0.15,
                random_state=test_pool_seed,
                shuffle=True,
            )
            train_pool_idx = np.asarray(train_pool_idx)
            test_idx = np.asarray(test_idx)
        else:
            # 数据少于 30 行时不留测试集，避免训练池过小
            train_pool_idx = all_indices
            test_idx = np.array([], dtype=int)
        if split_strategy == "literature_group_kfold" and distinct_groups < 3:
            raise ValueError("Literature group K-fold requires at least 3 distinct literature groups in the saved dataset.")

        # train_pool_idx / test_idx 已经在前面切好；train/val 都在 train_pool 里再切
        pool_size = int(len(train_pool_idx))
        held_out_test_size = int(len(test_idx))
        external_size = int(len(external_idx))
        if split_strategy == "joint_stratified":
            train_pool_labels = joint_labels[train_pool_idx] if len(train_pool_idx) else np.asarray([], dtype=object)
            label_counts = {
                str(label): int(np.sum(train_pool_labels == label))
                for label in set(train_pool_labels.tolist())
            }
            min_label_count = min(label_counts.values(), default=0)
            if min_label_count >= 2 and len(label_counts) >= 2:
                effective_cv_folds = min(effective_cv_folds, min_label_count)
        if split_strategy == "random_holdout":
            if pool_size < 7:
                raise ValueError("The validation split is too aggressive for the selected dataset.")
            train_size = int(round(pool_size * (1.0 - validation_split)))
            validation_size = max(2, pool_size - train_size)
        else:
            train_size = int(round(pool_size * (1.0 - 1.0 / effective_cv_folds)))
            validation_size = int(round(pool_size / effective_cv_folds))

        algorithm = str(config.get("algorithm") or "gradient_boosting")
        if algorithm == "linear_regression":
            total_rounds = 1
        else:
            n_estimators = _int_or_default(
                (config.get("hyperparameters") or {}).get("n_estimators"),
                DEFAULT_HYPERPARAMETERS["n_estimators"],
            )
            total_rounds = min(300, max(20, n_estimators))

        warnings: list[str] = []
        if missing_before_imputation:
            warnings.append("Missing numeric values in the saved matrix were median-imputed during training.")
        if dropped_low_confidence:
            warnings.append(f"{dropped_low_confidence} rows were excluded because their confidence was below the selected threshold.")
        if effective_cv_folds != cv_folds and split_strategy != "random_holdout":
            warnings.append(f"Cross-validation folds were reduced from {cv_folds} to {effective_cv_folds} to keep each validation fold large enough to evaluate.")
        if split_strategy == "joint_stratified":
            if joint_summary["missing_cation_count"]:
                warnings.append(f"{joint_summary['missing_cation_count']} rows did not carry a cation label; their joint split label used 'unknown'.")
            if external_size:
                warnings.append(f"{external_size} singleton cation × μ-bin strata were reserved as external literature validation rows.")
            if not held_out_test_size:
                warnings.append("Joint stratified split fell back to the full pool because too few rows remained for training.")

        metadata_target = metadata.get("target") if isinstance(metadata.get("target"), dict) else {}
        target_payload = target_display_payload(
            key=metadata_target.get("key"),
            label=metadata_target.get("label"),
            column=target_column,
        )
        split_label = SPLIT_STRATEGY_DEFINITIONS[split_strategy]["label"]
        cleaning_rules = (metadata.get("summary") or {}).get("rules") or {}
        training_view = normalize_training_view(cleaning_rules.get("training_view"))

        return {
            "matrix_raw": matrix,
            "X": X,
            "y": y,
            "groups": groups,
            "joint_labels": joint_labels,
            "train_pool_idx": train_pool_idx,
            "test_idx": test_idx,
            "external_idx": external_idx,
            "row_metadata": [
                {
                    "row_index": int(row["_row_index"]),
                    "record_id": row.get("_record_id"),
                    "literature_id": row.get("_literature_id"),
                    "confidence": row.get("_confidence"),
                    "cation": row.get("_cation_label"),
                    "friction_bin": row.get("_friction_bin"),
                    "joint_stratum": row.get("_joint_stratum"),
                    "experiment_scale": row.get("__experiment_scale"),
                    "experiment_method": row.get("__experiment_method"),
                    "measurement_type": row.get("__measurement_type"),
                    "training_view": row.get("__training_view"),
                    "actual": float(row["_target_value"]),
                }
                for row in eligible_rows
            ],
            "split_strategy": split_strategy,
            "cv_folds": effective_cv_folds,
            "validation_split": validation_split,
            "random_seed": random_seed,
            "total_rounds": total_rounds,
            "dataset": {
                "total_records": len(rows),
                "cleaned_records": len(rows),
                "usable_records": usable_records,
                "dropped_records": max(0, len(rows) - usable_records),
                "train_size": train_size,
                "validation_size": validation_size,
                "test_size": held_out_test_size,
                "external_size": external_size,
                "pool_size": pool_size,
                "feature_dimensions": int(X.shape[1]),
                "selected_feature_count": int(len(feature_columns)),
                "target": {
                    "key": target_payload["key"],
                    "label": target_payload["label"],
                    "column": target_column,
                },
                "target_column": target_column,
                "feature_columns": feature_columns,
                "columns": [target_column, *feature_columns],
                "filters": {
                    "min_confidence": min_confidence,
                    "max_records": max_records,
                    "validation_split": validation_split,
                    "split_strategy": split_strategy,
                    "cv_folds": effective_cv_folds,
                    "training_view": training_view,
                },
                "split": {
                    "strategy": split_strategy,
                    "label": split_label,
                    "cv_folds": effective_cv_folds if split_strategy != "random_holdout" else None,
                    "train_pool_size": pool_size,
                    "test_size": held_out_test_size,
                    "external_size": external_size,
                    **(joint_summary if split_strategy == "joint_stratified" else {}),
                },
                "cleaning": metadata.get("summary", {}),
                "pca_info": metadata.get("pca_info"),
            },
            "feature_blocks": [
                {
                    "key": "saved_matrix",
                    "label": "Saved cleaned feature matrix",
                    "dimensions": int(X.shape[1]),
                    "features": feature_columns,
                }
            ],
            "warnings": warnings,
        }

    def _build_split_plan(self, prepared: dict[str, Any]) -> list[dict[str, Any]]:
        X = prepared["X"]
        y = prepared["y"]
        split_strategy = prepared["split_strategy"]
        random_seed = prepared["random_seed"]
        cv_folds = prepared["cv_folds"]
        # 测试集已经在 _prepare_saved_dataset 阶段隔离；这里只在训练池内部做 train/val 切分
        pool_idx = prepared.get("train_pool_idx")
        if pool_idx is None or len(pool_idx) == 0:
            pool_idx = np.arange(len(y))
        pool_idx = np.asarray(pool_idx)

        if split_strategy == "random_holdout":
            train_rel, val_rel = train_test_split(
                np.arange(len(pool_idx)),
                test_size=prepared["validation_split"],
                random_state=random_seed,
            )
            return [{
                "label": "Holdout",
                "train_idx": pool_idx[train_rel],
                "val_idx": pool_idx[val_rel],
            }]

        if split_strategy == "k_fold":
            splitter = KFold(n_splits=min(cv_folds, len(pool_idx)), shuffle=True, random_state=random_seed)
            return [
                {
                    "label": f"Fold {fold_index}",
                    "train_idx": pool_idx[train_rel],
                    "val_idx": pool_idx[val_rel],
                }
                for fold_index, (train_rel, val_rel) in enumerate(splitter.split(X[pool_idx], y[pool_idx]), start=1)
            ]

        if split_strategy == "joint_stratified":
            joint_labels = np.asarray(prepared.get("joint_labels"), dtype=object)
            pool_labels = joint_labels[pool_idx] if len(joint_labels) == len(y) else np.asarray([], dtype=object)
            label_counts = {
                str(label): int(np.sum(pool_labels == label))
                for label in set(pool_labels.tolist())
            }
            min_label_count = min(label_counts.values(), default=0)
            if len(label_counts) >= 2 and min_label_count >= 2:
                n_splits = min(cv_folds, min_label_count)
                splitter = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=random_seed)
                return [
                    {
                        "label": f"Joint Fold {fold_index}",
                        "train_idx": pool_idx[train_rel],
                        "val_idx": pool_idx[val_rel],
                    }
                    for fold_index, (train_rel, val_rel) in enumerate(splitter.split(X[pool_idx], pool_labels), start=1)
                ]

            n_splits = min(cv_folds, len(pool_idx))
            splitter = KFold(n_splits=n_splits, shuffle=True, random_state=random_seed)
            return [
                {
                    "label": f"Joint Fallback Fold {fold_index}",
                    "train_idx": pool_idx[train_rel],
                    "val_idx": pool_idx[val_rel],
                }
                for fold_index, (train_rel, val_rel) in enumerate(splitter.split(X[pool_idx], y[pool_idx]), start=1)
            ]

        groups = prepared["groups"]
        pool_groups = groups[pool_idx]
        n_splits = min(cv_folds, len(set(pool_groups.tolist())))
        splitter = GroupKFold(n_splits=n_splits)
        return [
            {
                "label": f"Literature Fold {fold_index}",
                "train_idx": pool_idx[train_rel],
                "val_idx": pool_idx[val_rel],
            }
            for fold_index, (train_rel, val_rel) in enumerate(splitter.split(X[pool_idx], y[pool_idx], pool_groups), start=1)
        ]

    def _split_distribution_summary(
        self,
        row_metadata: list[dict[str, Any]],
        indices: np.ndarray,
        *,
        label: str | None = None,
        key: str | None = None,
    ) -> dict[str, Any]:
        entries = [row_metadata[int(index)] for index in indices.tolist() if int(index) < len(row_metadata)]
        actuals = [
            float(entry["actual"])
            for entry in entries
            if _safe_float(entry.get("actual")) is not None
        ]
        cations = {
            str(entry.get("cation") or "unknown")
            for entry in entries
        }
        strata = {
            str(entry.get("joint_stratum") or "")
            for entry in entries
            if entry.get("joint_stratum")
        }
        bins = {
            int(entry["friction_bin"])
            for entry in entries
            if entry.get("friction_bin") is not None
        }
        summary: dict[str, Any] = {
            "count": int(len(entries)),
            "cation_count": int(len(cations)),
            "strata_count": int(len(strata)),
            "bin_count": int(len(bins)),
            "target_min": round(min(actuals), 6) if actuals else None,
            "target_max": round(max(actuals), 6) if actuals else None,
        }
        if key is not None:
            summary["key"] = key
        if label is not None:
            summary["label"] = label
        return summary

    def _build_split_details(self, prepared: dict[str, Any], split_plan: list[dict[str, Any]]) -> dict[str, Any] | None:
        if prepared.get("split_strategy") != "joint_stratified":
            return None

        row_metadata: list[dict[str, Any]] = prepared.get("row_metadata") or []
        if not row_metadata:
            return None

        split_payload = (prepared.get("dataset") or {}).get("split") or {}
        target_edges = [float(edge) for edge in split_payload.get("target_bin_edges") or []]
        def prepared_indices(key: str) -> np.ndarray:
            value = prepared.get(key)
            if value is None:
                return np.array([], dtype=int)
            return np.asarray(value, dtype=int)

        subset_defs = [
            ("train_pool", "训练池", prepared_indices("train_pool_idx")),
            ("test", "测试集", prepared_indices("test_idx")),
            ("external", "外部验证", prepared_indices("external_idx")),
        ]

        subset_lookup: dict[int, str] = {}
        for subset_key, _label, indices in subset_defs:
            for index in indices.tolist():
                subset_lookup[int(index)] = subset_key

        def zero_counts() -> dict[str, int]:
            return {"total": 0, "train_pool": 0, "test": 0, "external": 0}

        bin_map: dict[int, dict[str, Any]] = {}
        stratum_map: dict[str, dict[str, Any]] = {}
        for absolute_index, meta in enumerate(row_metadata):
            subset_key = subset_lookup.get(absolute_index)
            if subset_key is None:
                continue
            bin_index = int(meta.get("friction_bin") or 0)
            bin_entry = bin_map.setdefault(
                bin_index,
                {
                    "bin": bin_index,
                    "label": self._format_target_bin_label(bin_index, target_edges),
                    **zero_counts(),
                },
            )
            bin_entry["total"] += 1
            bin_entry[subset_key] += 1

            cation = str(meta.get("cation") or "unknown")
            stratum = str(meta.get("joint_stratum") or f"{cation}|mu_bin_{bin_index}")
            stratum_entry = stratum_map.setdefault(
                stratum,
                {
                    "stratum": stratum,
                    "cation": cation,
                    "friction_bin": bin_index,
                    "bin_label": self._format_target_bin_label(bin_index, target_edges),
                    **zero_counts(),
                },
            )
            stratum_entry["total"] += 1
            stratum_entry[subset_key] += 1

        def validation_strata(indices: np.ndarray, limit: int = 12) -> list[dict[str, Any]]:
            counts: dict[str, dict[str, Any]] = {}
            for absolute_index in indices.tolist():
                if int(absolute_index) >= len(row_metadata):
                    continue
                meta = row_metadata[int(absolute_index)]
                bin_index = int(meta.get("friction_bin") or 0)
                cation = str(meta.get("cation") or "unknown")
                stratum = str(meta.get("joint_stratum") or f"{cation}|mu_bin_{bin_index}")
                entry = counts.setdefault(
                    stratum,
                    {
                        "stratum": stratum,
                        "cation": cation,
                        "friction_bin": bin_index,
                        "bin_label": self._format_target_bin_label(bin_index, target_edges),
                        "count": 0,
                    },
                )
                entry["count"] += 1
            return sorted(
                counts.values(),
                key=lambda item: (-int(item["count"]), int(item["friction_bin"]), str(item["cation"])),
            )[:limit]

        def validation_bins(indices: np.ndarray) -> list[dict[str, Any]]:
            counts: dict[int, int] = {}
            for absolute_index in indices.tolist():
                if int(absolute_index) >= len(row_metadata):
                    continue
                meta = row_metadata[int(absolute_index)]
                bin_index = int(meta.get("friction_bin") or 0)
                counts[bin_index] = counts.get(bin_index, 0) + 1
            return [
                {
                    "bin": bin_index,
                    "label": self._format_target_bin_label(bin_index, target_edges),
                    "count": count,
                }
                for bin_index, count in sorted(counts.items(), key=lambda item: item[0])
            ]

        folds = []
        for index, split in enumerate(split_plan, start=1):
            train_idx = np.asarray(split.get("train_idx") if split.get("train_idx") is not None else np.array([], dtype=int), dtype=int)
            val_idx = np.asarray(split.get("val_idx") if split.get("val_idx") is not None else np.array([], dtype=int), dtype=int)
            folds.append(
                {
                    "index": index,
                    "label": split.get("label") or f"Fold {index}",
                    "train": self._split_distribution_summary(row_metadata, train_idx),
                    "validation": self._split_distribution_summary(row_metadata, val_idx),
                    "validation_bins": validation_bins(val_idx),
                    "validation_strata": validation_strata(val_idx),
                }
            )

        strata = sorted(
            stratum_map.values(),
            key=lambda item: (int(item["friction_bin"]), str(item["cation"])),
        )
        return {
            "subsets": [
                self._split_distribution_summary(row_metadata, indices, key=key, label=label)
                for key, label, indices in subset_defs
            ],
            "target_bins": [
                bin_map[bin_index]
                for bin_index in sorted(bin_map)
            ],
            "strata": strata[:120],
            "strata_total": len(strata),
            "strata_truncated": len(strata) > 120,
            "folds": folds,
        }

    def _build_feature_importance(self, model: Any, feature_columns: list[str]) -> list[dict[str, Any]]:
        raw_values: list[float] | None = None
        importance_attr = getattr(model, "feature_importances_", None)
        coef_attr = getattr(model, "coef_", None)
        if importance_attr is not None:
            try:
                raw_values = [float(value) for value in np.ravel(np.asarray(importance_attr)).tolist()]
            except (TypeError, ValueError):
                raw_values = None
        elif coef_attr is not None:
            try:
                raw_values = [abs(float(value)) for value in np.ravel(np.asarray(coef_attr)).tolist()]
            except (TypeError, ValueError):
                raw_values = None

        if not raw_values:
            return []

        ranked = [
            {"feature": feature, "importance": float(value)}
            for feature, value in zip(feature_columns, raw_values)
        ]
        ranked.sort(key=lambda item: item["importance"], reverse=True)
        return ranked[:12]

    def _build_prediction_insights(
        self,
        row_metadata: list[dict[str, Any]],
        oof_predictions: np.ndarray,
    ) -> dict[str, Any]:
        points: list[dict[str, Any]] = []
        for index, prediction in enumerate(oof_predictions.tolist()):
            predicted = _safe_float(prediction)
            if predicted is None:
                continue
            meta = row_metadata[index]
            actual = _safe_float(meta.get("actual"))
            if actual is None:
                continue
            residual = predicted - actual
            points.append(
                {
                    "row_index": meta["row_index"],
                    "record_id": meta.get("record_id"),
                    "literature_id": meta.get("literature_id"),
                    "confidence": meta.get("confidence"),
                    "cation": meta.get("cation"),
                    "friction_bin": meta.get("friction_bin"),
                    "joint_stratum": meta.get("joint_stratum"),
                    "experiment_scale": meta.get("experiment_scale"),
                    "experiment_method": meta.get("experiment_method"),
                    "measurement_type": meta.get("measurement_type"),
                    "training_view": meta.get("training_view"),
                    "actual": actual,
                    "predicted": predicted,
                    "residual": residual,
                    "abs_residual": abs(residual),
                }
            )

        ranked_residuals = sorted(points, key=lambda item: item["abs_residual"], reverse=True)
        return {
            "prediction_samples": points[:40],
            "largest_residuals": ranked_residuals[:12],
        }

    def _fit_with_param_overrides(
        self,
        algorithm: str,
        params: dict[str, Any],
        X: np.ndarray,
        y: np.ndarray,
        random_seed: int,
    ) -> Any:
        """构建一个一次性拟合好的模型，给网格搜索 / 全量训练复用。"""
        if algorithm == "linear_regression":
            estimator = LinearRegression()
            estimator.fit(X, y)
            return estimator
        if algorithm == "gradient_boosting":
            estimator = GradientBoostingRegressor(
                n_estimators=int(params.get("n_estimators", 120)),
                learning_rate=float(params.get("learning_rate", 0.06)),
                max_depth=int(params.get("max_depth", 3)),
                random_state=random_seed,
            )
            estimator.fit(X, y)
            return estimator
        if algorithm == "random_forest":
            md = params.get("max_depth")
            estimator = RandomForestRegressor(
                n_estimators=int(params.get("n_estimators", 200)),
                max_depth=None if md is None else int(md),
                random_state=random_seed,
                n_jobs=1,
            )
            estimator.fit(X, y)
            return estimator
        if algorithm == "catboost":
            if not CATBOOST_AVAILABLE or CatBoostRegressor is None:
                raise ValueError("CatBoost is not installed.")
            estimator = CatBoostRegressor(
                iterations=int(params.get("iterations", 300)),
                learning_rate=float(params.get("learning_rate", 0.06)),
                depth=int(params.get("depth", 4)),
                l2_leaf_reg=float(params.get("l2_leaf_reg", 3.0)),
                loss_function="RMSE",
                random_seed=random_seed,
                verbose=False,
                allow_writing_files=False,
                thread_count=1,
            )
            estimator.fit(X, y, verbose=False)
            return estimator
        if algorithm == "xgboost":
            if not XGBOOST_AVAILABLE or XGBRegressor is None:
                raise ValueError("XGBoost is not installed.")
            estimator = XGBRegressor(
                n_estimators=int(params.get("n_estimators", 200)),
                learning_rate=float(params.get("learning_rate", 0.06)),
                max_depth=int(params.get("max_depth", 4)),
                reg_lambda=float(params.get("reg_lambda", 1.0)),
                random_state=random_seed,
                tree_method="hist",
                verbosity=0,
                n_jobs=1,
            )
            estimator.fit(X, y)
            return estimator
        if algorithm == "svr":
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            estimator = SVR(
                kernel="rbf",
                C=float(params.get("C", 10.0)),
                gamma=params.get("gamma", "scale"),
                epsilon=float(params.get("epsilon", 0.05)),
            )
            estimator.fit(X_scaled, y)
            return _ScaledRegressor(scaler=scaler, estimator=estimator)
        if algorithm == "mlp":
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            target_scaler = StandardScaler()
            y_scaled = target_scaler.fit_transform(np.asarray(y, dtype=np.float32).reshape(-1, 1)).ravel()
            hidden = params.get("hidden_layer_sizes", (64, 32))
            if isinstance(hidden, list):
                hidden = tuple(hidden)
            estimator = MLPRegressor(
                hidden_layer_sizes=hidden,
                activation="relu",
                solver="adam",
                learning_rate_init=min(0.01, max(0.0001, float(params.get("learning_rate_init", 0.001)))),
                alpha=float(params.get("alpha", 0.0001)),
                max_iter=500,
                random_state=random_seed,
                early_stopping=True,
                validation_fraction=0.1,
            )
            estimator.fit(X_scaled, y_scaled)
            return _ScaledRegressor(scaler=scaler, estimator=estimator, target_scaler=target_scaler)
        raise ValueError(f"Unsupported algorithm '{algorithm}' for tuning.")

    async def _tune_hyperparameters(
        self,
        task: TrainingTaskState,
        X: np.ndarray,
        y: np.ndarray,
    ) -> None:
        """对当前算法做一次小网格搜索，把最佳参数写回 task.config.hyperparameters。"""
        algorithm = str(task.config.get("algorithm") or "gradient_boosting")
        grid = TUNE_PARAM_GRIDS.get(algorithm)
        random_seed = _int_or_default((task.config.get("data_options") or {}).get("random_seed"), DEFAULT_DATA_OPTIONS["random_seed"])

        if not grid or len(grid) <= 1:
            task.tune_progress = {
                "active": False,
                "searched": 0,
                "total": 0,
                "best_score": None,
                "best_params": None,
                "skipped": True,
                "reason": "该算法没有可调超参数。",
            }
            return

        # 5 折交叉验证；样本极少时退到 3 折
        n_splits = 5 if len(y) >= 25 else max(2, min(3, len(y) // 5))
        splitter = KFold(n_splits=n_splits, shuffle=True, random_state=random_seed)
        total = len(grid)

        task.tune_progress = {
            "active": True,
            "searched": 0,
            "total": total,
            "best_score": None,
            "best_params": None,
            "algorithm": algorithm,
        }
        task.status_message = f"调参中 0 / {total}"
        await self._publish(task, {"type": "task.snapshot", "task": task.snapshot(include_history=True)})

        best_score: float | None = None
        best_params: dict[str, Any] | None = None
        all_results: list[dict[str, Any]] = []

        for index, params in enumerate(grid, start=1):
            if task.cancel_requested:
                task.tune_progress["active"] = False
                return
            try:
                fold_scores: list[float] = []
                for train_idx, val_idx in splitter.split(X):
                    estimator = self._fit_with_param_overrides(
                        algorithm=algorithm,
                        params=params,
                        X=X[train_idx],
                        y=y[train_idx],
                        random_seed=random_seed,
                    )
                    val_pred = estimator.predict(X[val_idx])
                    if len(y[val_idx]) >= 2 and not np.isclose(np.var(y[val_idx]), 0.0):
                        fold_scores.append(float(r2_score(y[val_idx], val_pred)))
                mean_score = float(np.mean(fold_scores)) if fold_scores else float("-inf")
            except Exception as exc:
                logger.warning("Tune failed for params=%s exc=%s", params, exc)
                mean_score = float("-inf")

            all_results.append({"params": params, "score": mean_score})
            if best_score is None or mean_score > best_score:
                best_score = mean_score
                best_params = params

            task.tune_progress = {
                "active": True,
                "searched": index,
                "total": total,
                "best_score": best_score if best_score is not None and best_score != float("-inf") else None,
                "best_params": best_params,
                "algorithm": algorithm,
            }
            task.status_message = (
                f"调参中 {index} / {total}"
                + (f" · 当前最佳 R²={best_score:.3f}" if best_score is not None and best_score > -1 else "")
            )
            await self._publish(task, {"type": "task.snapshot", "task": task.snapshot(include_history=True)})
            await asyncio.sleep(0)  # 让出事件循环以保持 WebSocket 心跳

        # 把最佳参数合并回 hyperparameters；未涉及的参数保持原值
        merged = dict(task.config.get("hyperparameters") or {})
        if best_params:
            for k, v in best_params.items():
                # CatBoost 的 iterations / depth 映射到通用的 n_estimators / max_depth
                if k == "iterations":
                    merged["n_estimators"] = v
                elif k == "depth":
                    merged["max_depth"] = v
                else:
                    merged[k] = v
        task.config["hyperparameters"] = merged
        task.tune_progress = {
            "active": False,
            "searched": total,
            "total": total,
            "best_score": best_score if best_score is not None and best_score != float("-inf") else None,
            "best_params": best_params,
            "algorithm": algorithm,
            "all_results": all_results[:50],
        }
        task.status_message = (
            f"调参完成（最佳 R²={best_score:.3f}），开始用最佳参数训练" if best_score is not None and best_score > -1
            else "调参完成（无有效结果），按原参数继续训练"
        )
        await self._publish(task, {"type": "task.snapshot", "task": task.snapshot(include_history=True)})

    async def _run_training(
        self,
        task: TrainingTaskState,
        rows: list[dict[str, Any]],
        source_scope: dict[str, Any],
        metadata: dict[str, Any],
    ) -> None:
        try:
            prepared = self._prepare_saved_dataset(rows, task.config, metadata)
            X = prepared["X"]
            y = prepared["y"]
            row_metadata = prepared["row_metadata"]
            split_plan = self._build_split_plan(prepared)
            if not split_plan:
                raise ValueError("The selected training configuration did not produce any validation splits.")
            split_details = self._build_split_details(prepared, split_plan)
            if split_details:
                prepared["dataset"].setdefault("split", {})["details"] = split_details

            task.dataset = {**prepared["dataset"], "source_scope": source_scope}
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

            # 自动调参：在常规训练前先做一次小规模网格搜索
            if bool(task.config.get("tune")):
                tune_pool_idx = np.asarray(prepared.get("train_pool_idx") if prepared.get("train_pool_idx") is not None else np.arange(len(y)))
                await self._tune_hyperparameters(task, X[tune_pool_idx], y[tune_pool_idx])
                if task.cancel_requested or task.status in {"cancelled", "failed"}:
                    return

            algorithm = task.config.get("algorithm", "gradient_boosting")
            hyperparameters = task.config.get("hyperparameters") or {}
            learning_rate = _float_or_default(hyperparameters.get("learning_rate"), DEFAULT_HYPERPARAMETERS["learning_rate"])
            max_depth = _int_or_default(hyperparameters.get("max_depth"), DEFAULT_HYPERPARAMETERS["max_depth"])
            l2_leaf_reg = _float_or_default(hyperparameters.get("l2_leaf_reg"), DEFAULT_HYPERPARAMETERS["l2_leaf_reg"])
            random_strength = _float_or_default(hyperparameters.get("random_strength"), DEFAULT_HYPERPARAMETERS["random_strength"])
            random_seed = _int_or_default((task.config.get("data_options") or {}).get("random_seed"), DEFAULT_DATA_OPTIONS["random_seed"])
            fold_models: list[Any | None] = [None for _ in split_plan]
            oof_predictions = np.full(len(y), np.nan, dtype=np.float32)

            for round_index in range(1, task.total_rounds + 1):
                if task.cancel_requested:
                    task.status = "cancelled"
                    task.status_message = "Training run cancelled."
                    task.finished_at = _utc_now_iso()
                    await self._persist_run_update(task)
                    await self._publish(
                        task,
                        {
                            "type": "task.cancelled",
                            "task": task.snapshot(include_history=True),
                        },
                    )
                    return

                round_points: list[dict[str, Any]] = []
                fold_summaries: list[dict[str, Any]] = []
                for split_index, split in enumerate(split_plan):
                    train_idx = split["train_idx"]
                    val_idx = split["val_idx"]
                    model = self._fit_round_model(
                        algorithm=algorithm,
                        round_index=round_index,
                        learning_rate=learning_rate,
                        max_depth=max_depth,
                        l2_leaf_reg=l2_leaf_reg,
                        random_strength=random_strength,
                        random_seed=random_seed,
                        model=fold_models[split_index],
                        X_train=X[train_idx],
                        y_train=y[train_idx],
                    )
                    fold_models[split_index] = model

                    train_pred = model.predict(X[train_idx])
                    val_pred = model.predict(X[val_idx])
                    point = _metric_point(round_index, task.total_rounds, y[train_idx], train_pred, y[val_idx], val_pred)
                    round_points.append(point)
                    if round_index == task.total_rounds:
                        oof_predictions[val_idx] = np.asarray(val_pred, dtype=np.float32)
                        fold_summaries.append(
                            {
                                "label": split["label"],
                                "train_size": int(len(train_idx)),
                                "validation_size": int(len(val_idx)),
                                "metrics": {
                                    "train_r2": point["train_r2"],
                                    "val_r2": point["val_r2"],
                                    "train_rmse": point["train_rmse"],
                                    "val_rmse": point["val_rmse"],
                                    "train_mae": point["train_mae"],
                                    "val_mae": point["val_mae"],
                                },
                            }
                        )

                summary_point = {
                    "round": round_index,
                    "progress": round_index / task.total_rounds if task.total_rounds else 0.0,
                    **_summarize_metric_points(round_points),
                }

                task.current_round = round_index
                task.current = summary_point
                task.history.append(summary_point)
                if round_index == task.total_rounds:
                    task.fold_summaries = fold_summaries
                task.status_message = f"Round {round_index} / {task.total_rounds}"

                await self._publish(
                    task,
                    {
                        "type": "task.metric",
                        "task_id": task.task_id,
                        "point": summary_point,
                        "snapshot": task.snapshot(include_history=False),
                    },
                )

                await asyncio.sleep(0.03)

            # 用整个训练池训练最终模型，再在隔离的测试集上"开盲考"
            train_pool_idx = np.asarray(prepared.get("train_pool_idx") if prepared.get("train_pool_idx") is not None else np.arange(len(y)))
            test_idx = np.asarray(prepared.get("test_idx") if prepared.get("test_idx") is not None else np.array([], dtype=int))
            external_idx = np.asarray(prepared.get("external_idx") if prepared.get("external_idx") is not None else np.array([], dtype=int))
            X_pool = X[train_pool_idx]
            y_pool = y[train_pool_idx]

            final_model: Any | None = None
            for round_index in range(1, task.total_rounds + 1):
                final_model = self._fit_round_model(
                    algorithm=algorithm,
                    round_index=round_index,
                    learning_rate=learning_rate,
                    max_depth=max_depth,
                    l2_leaf_reg=l2_leaf_reg,
                    random_strength=random_strength,
                    random_seed=random_seed,
                    model=final_model,
                    X_train=X_pool,
                    y_train=y_pool,
                )

            def evaluate_index_set(indices: np.ndarray, *, metric_prefix: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
                metrics: dict[str, Any] | None = None
                samples: list[dict[str, Any]] = []
                if final_model is None or len(indices) == 0:
                    return metrics, samples
                try:
                    y_true = y[indices]
                    y_pred = np.asarray(final_model.predict(X[indices]), dtype=np.float32)
                    r2_value = None
                    if len(indices) >= 2 and not np.isclose(np.var(y_true), 0.0):
                        r2_value = float(r2_score(y_true, y_pred))
                    metrics = {
                        f"{metric_prefix}_r2": r2_value,
                        f"{metric_prefix}_rmse": float(math.sqrt(mean_squared_error(y_true, y_pred))),
                        f"{metric_prefix}_mae": float(mean_absolute_error(y_true, y_pred)),
                        "sample_count": int(len(indices)),
                    }
                    for absolute_index, predicted in zip(indices.tolist(), y_pred.tolist()):
                        meta = row_metadata[absolute_index] if absolute_index < len(row_metadata) else {}
                        actual = _safe_float(meta.get("actual"))
                        pred = _safe_float(predicted)
                        if actual is None or pred is None:
                            continue
                        residual = pred - actual
                        samples.append(
                            {
                                "row_index": meta.get("row_index", absolute_index),
                                "record_id": meta.get("record_id"),
                                "literature_id": meta.get("literature_id"),
                                "cation": meta.get("cation"),
                                "friction_bin": meta.get("friction_bin"),
                                "joint_stratum": meta.get("joint_stratum"),
                                "actual": actual,
                                "predicted": pred,
                                "residual": residual,
                                "abs_residual": abs(residual),
                            }
                        )
                except Exception as exc:
                    logger.warning("%s-set evaluation failed: %s", metric_prefix, exc)
                    metrics = None
                return metrics, samples

            test_metrics, test_samples = evaluate_index_set(test_idx, metric_prefix="test")
            external_metrics, external_samples = evaluate_index_set(external_idx, metric_prefix="external")

            task.test_metrics = test_metrics

            task.insights = {
                "feature_importance": self._build_feature_importance(final_model, task.dataset.get("feature_columns", [])),
                **self._build_prediction_insights(row_metadata, oof_predictions),
                "test_samples": test_samples,
                "external_samples": external_samples,
                "external_metrics": external_metrics,
            }

            task.status = "completed"
            task.status_message = "Training completed."
            task.finished_at = _utc_now_iso()
            await self._persist_run_update(task)
            await self._publish(
                task,
                {
                    "type": "task.completed",
                    "task": task.snapshot(include_history=True),
                },
            )
        except Exception as exc:
            logger.exception(
                "Training task failed task_id=%s algorithm=%s",
                task.task_id,
                task.config.get("algorithm"),
            )
            task.status = "failed"
            task.error = f"{type(exc).__name__}: {exc}"
            task.status_message = "Training failed."
            task.finished_at = _utc_now_iso()
            await self._persist_run_update(task)
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

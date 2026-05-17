from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
from pathlib import Path
from collections import defaultdict
from typing import Any, Callable

import numpy as np
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import CleanedDataset, ModelTrainingRun, RegisteredModel, TribologyData
from security import AuthPrincipal, RequestScope, ensure_scope_writable, literature_scope_conditions
from services.model_training_service import (
    DEFAULT_CLEANING_OPTIONS,
    DEFAULT_FEATURE_CONFIG,
    MOLECULAR_FEATURE_DEFINITIONS,
    PROCESS_FEATURE_DEFINITIONS,
    PROCESS_FEATURE_LOOKUP,
    TARGET_DEFINITIONS,
    _fingerprint_from_smiles,
    _feature_value,
    _safe_float,
    target_column_name,
)
from utils.experiment_profile import build_experiment_profile, normalize_training_view, record_matches_training_view
from utils.lubricant_mixture import normalize_lubricant_components
from utils.tribopair import composite_roughness_nm, parse_roughness_nm

logger = logging.getLogger(__name__)

try:
    from rdkit import Chem
    from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

    RDKIT_DESCRIPTOR_AVAILABLE = True
except Exception:
    Chem = None
    Crippen = None
    Descriptors = None
    Lipinski = None
    rdMolDescriptors = None
    RDKIT_DESCRIPTOR_AVAILABLE = False


DEFAULT_CLEANING_WORKBENCH_OPTIONS = {
    **DEFAULT_CLEANING_OPTIONS,
    "training_view": "all",
    "missing_value_strategy": "median",
    "remove_target_outliers": False,
    "require_valid_smiles": True,
    "iqr_multiplier": 1.5,
    "feature_config": DEFAULT_FEATURE_CONFIG,
}

IMPORTED_DATASET_KIND = "imported_csv"
WFF_THESIS_DATASET_KIND = "wff_thesis_csv"
IMPORTED_TARGET_ALIASES = {
    "cof",
    "mu",
    "coefficientoffriction",
    "frictioncoefficient",
    "frictionfactor",
    "targetcof",
    "targetmu",
}

IMPORT_RESERVED_METADATA_COLUMNS = {
    "frictionbin",
    "cationbin",
    "stratifylabel",
    "originalindex",
    "frictionpred",
    "frictionprediction",
    "frictiondiff",
    "predictiondiff",
    "errorflag",
}

WFF_DATASET_SPECS = [
    {
        "key": "dataset_b",
        "filename": "film+dataset0312.csv",
        "name": "WFF 论文复刻 Dataset-B（含膜厚 h）",
        "description": "来自 backend/data/wff；保留论文 Dataset-B 的训练集、测试集和外部文献验证集固定划分。",
        "target_column": "μ",
    },
    {
        "key": "dataset_a",
        "filename": "no+film+dataset+0312.csv",
        "name": "WFF 论文复刻 Dataset-A（不含膜厚）",
        "description": "来自 backend/data/wff；用于对照不含界面膜厚 h 的单模型复现实验。",
        "target_column": "μ",
    },
]

LOAD_RANGE_FEATURE_KEYS = ["load_min", "load_max", "load_span", "load_is_range"]
LOAD_RANGE_COLUMN_NAMES = ["Load_Min", "Load_Max", "Load_Span", "Load_Is_Range"]

NUMERIC_PREVIEW_FIELDS = [
    (feature["normalized_field"], feature["label"], feature["key"])
    for feature in PROCESS_FEATURE_DEFINITIONS
]

DATASET_BUILDER_TARGET_COLUMN = "COF"
DATASET_BUILDER_FILM_THICKNESS_COLUMN = "Film_Thickness"
DATASET_BUILDER_IDENTIFIER_COLUMNS = [
    "__record_id",
    "__literature_id",
    "__confidence",
    "__cation",
    "__anion",
    "__cation_smiles",
    "__anion_smiles",
    "__experiment_scale",
    "__experiment_method",
    "__measurement_type",
    "__training_view",
]

SURFACE_DESCRIPTOR_LOOKUP = {
    "au_111": {
        "label": "Au(111)",
        "gamma_s": 0.7,
        "sigma_s": -0.02,
        "rq_nm": 0.835,
        "theta_s": 60.0,
        "i_ss": 0.0,
    },
    "mica": {
        "label": "Mica",
        "gamma_s": 1.77,
        "sigma_s": -0.16,
        "rq_nm": 0.0569,
        "theta_s": 0.0,
        "i_ss": 0.0,
    },
    "stainless_steel": {
        "label": "Stainless steel",
        "gamma_s": 0.07,
        "sigma_s": 0.01,
        "rq_nm": 0.9,
        "theta_s": 72.0,
        "i_ss": 1.0,
    },
    "hopg": {
        "label": "HOPG",
        "gamma_s": 0.05,
        "sigma_s": -0.0002,
        "rq_nm": 0.89,
        "theta_s": 85.0,
        "i_ss": 0.0,
    },
    "ptfe": {
        "label": "PTFE",
        "gamma_s": 0.019,
        "sigma_s": -0.00005,
        "rq_nm": 7.0,
        "theta_s": 110.0,
        "i_ss": 0.0,
    },
    "silica": {
        "label": "Silica",
        "gamma_s": 0.2,
        "sigma_s": -0.07,
        "rq_nm": 0.5,
        "theta_s": 20.7,
        "i_ss": 0.0,
    },
    "titanium": {
        "label": "Titanium",
        "gamma_s": 0.5,
        "sigma_s": 0.005,
        "rq_nm": 61.15,
        "theta_s": 60.0,
        "i_ss": 0.0,
    },
}

SURFACE_DESCRIPTOR_ALIASES = [
    ("au_111", ("au(111)", "au 111", "au-111", "gold(111)", "gold 111")),
    ("mica", ("mica", "muscovite", "云母")),
    ("stainless_steel", ("stainless steel", "stainless-steel", "stainlesssteel", "不锈钢")),
    ("hopg", ("hopg", "highly ordered pyrolytic graphite", "pyrolytic graphite")),
    ("ptfe", ("ptfe", "polytetrafluoroethylene", "聚四氟乙烯")),
    ("silica", ("silica", "sio2", "silicon dioxide", "quartz", "二氧化硅")),
    ("titanium", ("titanium", "ti substrate", "钛")),
]

DATASET_BUILDER_MACRO_FEATURES = [
    {
        "key": "surface_free_energy",
        "label": "Surface Free Energy (gamma_s)",
        "column_name": "gamma_s",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_surface_descriptor_value(row, "gamma_s"),
    },
    {
        "key": "surface_charge_density",
        "label": "Surface Charge Density (sigma_s)",
        "column_name": "sigma_s",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_surface_descriptor_value(row, "sigma_s"),
    },
    {
        "key": "surface_roughness",
        "label": "Surface Roughness (Rq)",
        "column_name": "Surface_Roughness",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_surface_roughness_value(row),
    },
    {
        "key": "surface_contact_angle",
        "label": "Static Contact Angle (theta_s)",
        "column_name": "theta_s",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_surface_descriptor_value(row, "theta_s"),
    },
    {
        "key": "stainless_steel_indicator",
        "label": "Stainless Steel Indicator (I_ss)",
        "column_name": "I_ss",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_surface_descriptor_value(row, "i_ss"),
    },
    {
        "key": "probe_roughness",
        "label": "Probe Roughness",
        "column_name": "Probe_Roughness",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_probe_roughness_value(row),
    },
    {
        "key": "substrate_roughness",
        "label": "Substrate Roughness",
        "column_name": "Substrate_Roughness",
        "group": "Surface",
        "getter": lambda row: ModelCleaningService._builder_substrate_roughness_value(row),
    },
    {
        "key": "temperature",
        "label": "Temperature",
        "column_name": "Temperature",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_temperature_c")),
    },
    {
        "key": "speed",
        "label": "Sliding Speed",
        "column_name": "Speed",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_speed_mps")),
    },
    {
        "key": "load",
        "label": "Normal Load",
        "column_name": "Load",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_load_n")),
    },
    {
        "key": "system_total_load",
        "label": "System Total Load",
        "column_name": "System_Total_Load",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_system_total_load_n")),
    },
    {
        "key": "contact_load_per_unit",
        "label": "Contact Load Per Unit",
        "column_name": "Contact_Load_Per_Unit",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_contact_load_per_unit_n")),
    },
    {
        "key": "potential",
        "label": "Applied Potential",
        "column_name": "Potential",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_potential_v")),
    },
    {
        "key": "water_content",
        "label": "Water Content",
        "column_name": "Water_Content",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_water_content_ppm")),
    },
    {
        "key": "il_additive_mol_fraction",
        "label": "IL Additive Mol Fraction",
        "column_name": "IL_Additive_Mol_Fraction",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_il_additive_mol_fraction")),
    },
    {
        "key": "base_oil_mol_fraction",
        "label": "Base Oil Mol Fraction",
        "column_name": "Base_Oil_Mol_Fraction",
        "group": "Environment",
        "getter": lambda row: _safe_float(row.get("normalized_base_oil_mol_fraction")),
    },
    {
        "key": "film_thickness",
        "label": "Interfacial Film Thickness (h)",
        "column_name": DATASET_BUILDER_FILM_THICKNESS_COLUMN,
        "group": "Interface",
        "getter": lambda row: ModelCleaningService._builder_film_thickness_value(row),
    },
    {
        "key": "alkyl_chain_length",
        "label": "Alkyl Chain Length",
        "column_name": "Alkyl_Chain_Length",
        "group": "Interface",
        "getter": lambda row: _safe_float(row.get("normalized_alkyl_chain_length")),
    },
]

SURFACE_MACRO_COLUMNS = [
    feature["column_name"]
    for feature in DATASET_BUILDER_MACRO_FEATURES
    if feature["group"] == "Surface"
]


def _descriptor_callable(name: str, fn: Callable[[Any], float | int | None]) -> dict[str, Any]:
    return {"name": name, "fn": fn}


ION_DESCRIPTOR_SPECS = [
    _descriptor_callable("MolWt", lambda mol: Descriptors.MolWt(mol) if Descriptors is not None else None),
    _descriptor_callable("HeavyAtomMolWt", lambda mol: Descriptors.HeavyAtomMolWt(mol) if Descriptors is not None else None),
    _descriptor_callable("ExactMolWt", lambda mol: Descriptors.ExactMolWt(mol) if Descriptors is not None else None),
    _descriptor_callable("MolLogP", lambda mol: Crippen.MolLogP(mol) if Crippen is not None else None),
    _descriptor_callable("MolMR", lambda mol: Crippen.MolMR(mol) if Crippen is not None else None),
    _descriptor_callable("TPSA", lambda mol: Descriptors.TPSA(mol) if Descriptors is not None else None),
    _descriptor_callable("LabuteASA", lambda mol: Descriptors.LabuteASA(mol) if Descriptors is not None else None),
    _descriptor_callable("FractionCSP3", lambda mol: Descriptors.FractionCSP3(mol) if Descriptors is not None else None),
    _descriptor_callable("HeavyAtomCount", lambda mol: Descriptors.HeavyAtomCount(mol) if Descriptors is not None else None),
    _descriptor_callable("NHOHCount", lambda mol: Descriptors.NHOHCount(mol) if Descriptors is not None else None),
    _descriptor_callable("NOCount", lambda mol: Descriptors.NOCount(mol) if Descriptors is not None else None),
    _descriptor_callable("NumHAcceptors", lambda mol: Descriptors.NumHAcceptors(mol) if Descriptors is not None else None),
    _descriptor_callable("NumHDonors", lambda mol: Descriptors.NumHDonors(mol) if Descriptors is not None else None),
    _descriptor_callable("NumHeteroatoms", lambda mol: Descriptors.NumHeteroatoms(mol) if Descriptors is not None else None),
    _descriptor_callable("NumRotatableBonds", lambda mol: Descriptors.NumRotatableBonds(mol) if Descriptors is not None else None),
    _descriptor_callable("RingCount", lambda mol: Descriptors.RingCount(mol) if Descriptors is not None else None),
    _descriptor_callable("NumAromaticRings", lambda mol: Lipinski.NumAromaticRings(mol) if Lipinski is not None else None),
    _descriptor_callable("NumSaturatedRings", lambda mol: Lipinski.NumSaturatedRings(mol) if Lipinski is not None else None),
    _descriptor_callable("NumAliphaticRings", lambda mol: Lipinski.NumAliphaticRings(mol) if Lipinski is not None else None),
    _descriptor_callable("NumAromaticHeterocycles", lambda mol: Lipinski.NumAromaticHeterocycles(mol) if Lipinski is not None else None),
    _descriptor_callable("NumSaturatedHeterocycles", lambda mol: Lipinski.NumSaturatedHeterocycles(mol) if Lipinski is not None else None),
    _descriptor_callable("NumAliphaticHeterocycles", lambda mol: Lipinski.NumAliphaticHeterocycles(mol) if Lipinski is not None else None),
    _descriptor_callable("NumAromaticCarbocycles", lambda mol: Lipinski.NumAromaticCarbocycles(mol) if Lipinski is not None else None),
    _descriptor_callable("NumSaturatedCarbocycles", lambda mol: Lipinski.NumSaturatedCarbocycles(mol) if Lipinski is not None else None),
    _descriptor_callable("NumAliphaticCarbocycles", lambda mol: Lipinski.NumAliphaticCarbocycles(mol) if Lipinski is not None else None),
    _descriptor_callable("HallKierAlpha", lambda mol: Descriptors.HallKierAlpha(mol) if Descriptors is not None else None),
    _descriptor_callable("BalabanJ", lambda mol: Descriptors.BalabanJ(mol) if Descriptors is not None else None),
    _descriptor_callable("BertzCT", lambda mol: Descriptors.BertzCT(mol) if Descriptors is not None else None),
    _descriptor_callable("Kappa1", lambda mol: Descriptors.Kappa1(mol) if Descriptors is not None else None),
    _descriptor_callable("Kappa2", lambda mol: Descriptors.Kappa2(mol) if Descriptors is not None else None),
    _descriptor_callable("Kappa3", lambda mol: Descriptors.Kappa3(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi0", lambda mol: Descriptors.Chi0(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi0n", lambda mol: Descriptors.Chi0n(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi0v", lambda mol: Descriptors.Chi0v(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi1", lambda mol: Descriptors.Chi1(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi1n", lambda mol: Descriptors.Chi1n(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi1v", lambda mol: Descriptors.Chi1v(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi2n", lambda mol: Descriptors.Chi2n(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi2v", lambda mol: Descriptors.Chi2v(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi3n", lambda mol: Descriptors.Chi3n(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi3v", lambda mol: Descriptors.Chi3v(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi4n", lambda mol: Descriptors.Chi4n(mol) if Descriptors is not None else None),
    _descriptor_callable("Chi4v", lambda mol: Descriptors.Chi4v(mol) if Descriptors is not None else None),
    _descriptor_callable("MaxAbsPartialCharge", lambda mol: Descriptors.MaxAbsPartialCharge(mol) if Descriptors is not None else None),
    _descriptor_callable("MaxPartialCharge", lambda mol: Descriptors.MaxPartialCharge(mol) if Descriptors is not None else None),
    _descriptor_callable("MinAbsPartialCharge", lambda mol: Descriptors.MinAbsPartialCharge(mol) if Descriptors is not None else None),
    _descriptor_callable("MinPartialCharge", lambda mol: Descriptors.MinPartialCharge(mol) if Descriptors is not None else None),
    _descriptor_callable("NumValenceElectrons", lambda mol: Descriptors.NumValenceElectrons(mol) if Descriptors is not None else None),
    _descriptor_callable("NumRadicalElectrons", lambda mol: Descriptors.NumRadicalElectrons(mol) if Descriptors is not None else None),
    _descriptor_callable("FpDensityMorgan1", lambda mol: Descriptors.FpDensityMorgan1(mol) if Descriptors is not None else None),
    _descriptor_callable("FpDensityMorgan2", lambda mol: Descriptors.FpDensityMorgan2(mol) if Descriptors is not None else None),
    _descriptor_callable("FpDensityMorgan3", lambda mol: Descriptors.FpDensityMorgan3(mol) if Descriptors is not None else None),
    _descriptor_callable("NumBridgeheadAtoms", lambda mol: rdMolDescriptors.CalcNumBridgeheadAtoms(mol) if rdMolDescriptors is not None else None),
    _descriptor_callable("NumSpiroAtoms", lambda mol: rdMolDescriptors.CalcNumSpiroAtoms(mol) if rdMolDescriptors is not None else None),
]


class ModelCleaningService:
    async def import_csv_dataset(
        self,
        session: AsyncSession,
        *,
        principal: AuthPrincipal,
        scope: RequestScope,
        name: str,
        description: str | None,
        csv_text: str,
        filename: str,
        target_column: str | None = None,
    ) -> CleanedDataset:
        logger.info(
            "Importing CSV dataset name=%s scope=%s target_column=%s",
            name,
            scope.scope_key,
            target_column,
        )
        ensure_scope_writable(principal, scope)
        payload = self._build_imported_csv_payload(
            csv_text,
            filename=filename,
            target_column=target_column,
            scope=scope,
        )

        dataset = CleanedDataset(
            name=name.strip(),
            description=(description or "").strip() or None,
            target_key=payload["target"]["key"],
            source_scope_type=scope.scope_type,
            source_scope_key=scope.scope_key,
            group_id=scope.group_id,
            workspace_id=scope.workspace.id if scope.workspace else None,
            created_by_user_id=principal.user.id,
            scope_type=scope.scope_type,
            scope_key=scope.scope_key,
            row_count=len(payload["rows"]),
            config_json=json.dumps(
                self._build_imported_dataset_config(
                    filename=filename,
                    target_column=payload["target_column"],
                    feature_columns=payload["feature_columns"],
                    identifier_columns=payload["import_metadata"]["identifier_columns"],
                ),
                ensure_ascii=False,
            ),
            summary_json=json.dumps(
                {
                    "dataset_kind": IMPORTED_DATASET_KIND,
                    "summary": payload["summary"],
                    "source_scope": payload["source_scope"],
                    "feature_coverage": payload["feature_coverage"],
                    "target": payload["target"],
                    "pca_info": None,
                    "matrix_columns": payload["matrix_columns"],
                    "feature_columns": payload["feature_columns"],
                    "target_column": payload["target_column"],
                    "import_metadata": payload["import_metadata"],
                },
                ensure_ascii=False,
            ),
            rows_json=json.dumps(payload["rows"], ensure_ascii=False),
        )
        session.add(dataset)
        await session.commit()
        await session.refresh(dataset)
        logger.info("Imported CSV dataset dataset_id=%s rows=%s", dataset.id, dataset.row_count)
        return dataset

    async def import_wff_thesis_datasets(
        self,
        session: AsyncSession,
        *,
        principal: AuthPrincipal,
        scope: RequestScope,
    ) -> list[CleanedDataset]:
        logger.info("Importing built-in WFF thesis datasets scope=%s", scope.scope_key)
        ensure_scope_writable(principal, scope)
        data_dir = Path(__file__).resolve().parents[1] / "data" / "wff"
        if not data_dir.exists():
            raise ValueError("WFF data directory was not found under backend/data/wff.")

        imported: list[CleanedDataset] = []
        for spec in WFF_DATASET_SPECS:
            path = data_dir / spec["filename"]
            if not path.exists():
                raise ValueError(f"WFF dataset file '{spec['filename']}' was not found.")

            existing = await self._find_existing_imported_dataset(
                session,
                scope=scope,
                dataset_kind=WFF_THESIS_DATASET_KIND,
                filename=spec["filename"],
            )
            if existing is not None:
                imported.append(existing)
                continue

            csv_text = path.read_text(encoding="utf-8-sig")
            payload = self._build_imported_csv_payload(
                csv_text,
                filename=spec["filename"],
                target_column=spec["target_column"],
                scope=scope,
            )
            self._apply_wff_thesis_metadata(payload, dataset_key=spec["key"], filename=spec["filename"])

            dataset = CleanedDataset(
                name=spec["name"],
                description=spec["description"],
                target_key=payload["target"]["key"],
                source_scope_type=scope.scope_type,
                source_scope_key=scope.scope_key,
                group_id=scope.group_id,
                workspace_id=scope.workspace.id if scope.workspace else None,
                created_by_user_id=principal.user.id,
                scope_type=scope.scope_type,
                scope_key=scope.scope_key,
                row_count=len(payload["rows"]),
                config_json=json.dumps(
                    self._build_imported_dataset_config(
                        filename=spec["filename"],
                        target_column=payload["target_column"],
                        feature_columns=payload["feature_columns"],
                        identifier_columns=payload["import_metadata"]["identifier_columns"],
                        dataset_kind=WFF_THESIS_DATASET_KIND,
                    ),
                    ensure_ascii=False,
                ),
                summary_json=json.dumps(
                    {
                        "dataset_kind": WFF_THESIS_DATASET_KIND,
                        "summary": payload["summary"],
                        "source_scope": payload["source_scope"],
                        "feature_coverage": payload["feature_coverage"],
                        "target": payload["target"],
                        "pca_info": None,
                        "matrix_columns": payload["matrix_columns"],
                        "feature_columns": payload["feature_columns"],
                        "target_column": payload["target_column"],
                        "import_metadata": payload["import_metadata"],
                    },
                    ensure_ascii=False,
                ),
                rows_json=json.dumps(payload["rows"], ensure_ascii=False),
            )
            session.add(dataset)
            await session.flush()
            imported.append(dataset)

        await session.commit()
        for dataset in imported:
            await session.refresh(dataset)
        logger.info("Imported WFF thesis datasets count=%s", len(imported))
        return imported

    async def preview_cleaning(
        self,
        session: AsyncSession,
        scope_filter_values: dict[str, Any],
        *,
        target_key: str = "cof",
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        logger.debug("Previewing cleaning target=%s scope=%s", target_key, scope_filter_values.get("scope_key"))
        normalized_options = self._normalize_options(options)
        target = TARGET_DEFINITIONS.get(target_key)
        if not target:
            raise ValueError(f"Unsupported target '{target_key}'.")

        resolved = await self._resolve_source_records(session, scope_filter_values, normalized_options)
        base_rows = [self._serialize_record(record) for record in resolved["records"]]
        cleaned_rows, cleaning_summary = self._clean_rows(base_rows, target_key=target_key, options=normalized_options)
        matrix_payload = self._build_matrix_payload(cleaned_rows, target_key=target_key, options=normalized_options)
        dataset_builder_payload = self._build_dataset_builder_payload(cleaned_rows, target_key=target_key)

        return {
            "target": {
                "key": target_key,
                "label": target["label"],
                "column_name": matrix_payload["target_column"],
            },
            "options": normalized_options,
            "source_scope": resolved["source_scope"],
            "summary": {
                **cleaning_summary,
                "final_feature_count": len(matrix_payload["feature_columns"]),
                "final_feature_columns": matrix_payload["feature_columns"],
            },
            "feature_coverage": matrix_payload["feature_coverage"],
            "pca_info": matrix_payload["pca_info"],
            "matrix_columns": matrix_payload["matrix_columns"],
            "feature_columns": matrix_payload["feature_columns"],
            "target_column": matrix_payload["target_column"],
            "rows": matrix_payload["rows"],
            "preview_rows": matrix_payload["rows"][:25],
            "normalization_preview": matrix_payload["rows"][:12],
            "dataset_builder": dataset_builder_payload,
        }

    async def save_dataset(
        self,
        session: AsyncSession,
        *,
        principal: AuthPrincipal,
        scope: RequestScope,
        name: str,
        description: str | None,
        target_key: str,
        options: dict[str, Any] | None,
    ) -> CleanedDataset:
        logger.info("Saving cleaned dataset name=%s target=%s scope=%s", name, target_key, scope.scope_key)
        ensure_scope_writable(principal, scope)
        preview = await self.preview_cleaning(session, {
            "group_id": scope.group_id,
            "scope_type": scope.scope_type,
            "scope_key": scope.scope_key,
            "workspace_id": scope.workspace.id if scope.workspace else None,
        }, target_key=target_key, options=options)

        rows = list(preview["rows"])
        dataset = CleanedDataset(
            name=name.strip(),
            description=(description or "").strip() or None,
            target_key=target_key,
            source_scope_type=preview["source_scope"]["resolved_scope_type"],
            source_scope_key=preview["source_scope"]["resolved_scope_key"],
            group_id=scope.group_id,
            workspace_id=scope.workspace.id if scope.workspace else None,
            created_by_user_id=principal.user.id,
            scope_type=scope.scope_type,
            scope_key=scope.scope_key,
            row_count=len(rows),
            config_json=json.dumps(preview["options"], ensure_ascii=False),
            summary_json=json.dumps({
                "summary": preview["summary"],
                "source_scope": preview["source_scope"],
                "feature_coverage": preview["feature_coverage"],
                "target": preview["target"],
                "pca_info": preview["pca_info"],
                "matrix_columns": preview["matrix_columns"],
                "feature_columns": preview["feature_columns"],
                "target_column": preview["target_column"],
            }, ensure_ascii=False),
            rows_json=json.dumps(rows, ensure_ascii=False),
        )
        session.add(dataset)
        await session.commit()
        await session.refresh(dataset)
        logger.info("Saved cleaned dataset dataset_id=%s rows=%s", dataset.id, dataset.row_count)
        return dataset

    async def list_datasets(self, session: AsyncSession, scope: RequestScope) -> list[dict[str, Any]]:
        logger.debug("Listing cleaned datasets for scope=%s", scope.scope_key)
        stmt = (
            select(CleanedDataset)
            .where(CleanedDataset.group_id == scope.group_id, CleanedDataset.scope_key == scope.scope_key)
            .order_by(CleanedDataset.created_at.desc(), CleanedDataset.id.desc())
        )
        result = await session.execute(stmt)
        datasets = result.scalars().all()
        items: list[dict[str, Any]] = []
        for dataset in datasets:
            upgraded = await self.upgrade_dataset_if_needed(session, dataset)
            items.append(self._dataset_to_summary(upgraded))
        return items

    async def get_dataset(self, session: AsyncSession, dataset_id: int) -> CleanedDataset | None:
        dataset = await session.get(CleanedDataset, dataset_id)
        if dataset is None:
            return None
        return await self.upgrade_dataset_if_needed(session, dataset)

    async def update_dataset_metadata(
        self,
        session: AsyncSession,
        dataset: CleanedDataset,
        *,
        name: str,
        description: str | None,
    ) -> CleanedDataset:
        dataset.name = name.strip()
        dataset.description = (description or "").strip() or None
        await session.commit()
        await session.refresh(dataset)
        return await self.upgrade_dataset_if_needed(session, dataset)

    async def delete_dataset(self, session: AsyncSession, dataset: CleanedDataset) -> None:
        await session.execute(
            update(ModelTrainingRun)
            .where(ModelTrainingRun.cleaned_dataset_id == dataset.id)
            .values(cleaned_dataset_id=None)
        )
        await session.execute(
            update(RegisteredModel)
            .where(RegisteredModel.source_dataset_id == dataset.id)
            .values(source_dataset_id=None)
        )
        await session.delete(dataset)
        await session.commit()

    def dataset_payload(self, dataset: CleanedDataset) -> dict[str, Any]:
        summary_payload = json.loads(dataset.summary_json)
        rows = json.loads(dataset.rows_json)
        return {
            "id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "target_key": dataset.target_key,
            "row_count": dataset.row_count,
            "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
            "source_scope": summary_payload.get("source_scope", {}),
            "summary": summary_payload.get("summary", {}),
            "feature_coverage": summary_payload.get("feature_coverage", []),
            "target": summary_payload.get("target", {}),
            "pca_info": summary_payload.get("pca_info"),
            "matrix_columns": summary_payload.get("matrix_columns", []),
            "feature_columns": summary_payload.get("feature_columns", []),
            "target_column": summary_payload.get("target_column"),
            "dataset_kind": summary_payload.get("dataset_kind", "cleaned_scope"),
            "import_metadata": summary_payload.get("import_metadata"),
            "rows": rows,
            "config": json.loads(dataset.config_json),
        }

    def export_dataset_csv(self, dataset: CleanedDataset) -> str:
        logger.debug("Exporting dataset dataset_id=%s", dataset.id)
        summary_payload = json.loads(dataset.summary_json)
        rows = json.loads(dataset.rows_json)
        fieldnames = list(summary_payload.get("matrix_columns") or [])
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field) for field in fieldnames})
        return output.getvalue()

    async def upgrade_dataset_if_needed(self, session: AsyncSession, dataset: CleanedDataset) -> CleanedDataset:
        logger.debug("Checking dataset upgrade requirements dataset_id=%s", dataset.id)
        config_payload = json.loads(dataset.config_json or "{}")
        summary_payload = json.loads(dataset.summary_json or "{}")
        if self._dataset_kind(config_payload, summary_payload) in {IMPORTED_DATASET_KIND, WFF_THESIS_DATASET_KIND}:
            target_column = str(summary_payload.get("target_column") or "").strip()
            if target_column:
                target_payload = self._build_import_target_payload(target_column)
                current_target = summary_payload.get("target") or {}
                needs_target_upgrade = (
                    dataset.target_key != target_payload["key"]
                    or current_target.get("key") != target_payload["key"]
                    or current_target.get("label") != target_payload["label"]
                )
                if needs_target_upgrade:
                    dataset.target_key = target_payload["key"]
                    summary_payload["target"] = target_payload
                    dataset.summary_json = json.dumps(summary_payload, ensure_ascii=False)
                    if session is not None:
                        await session.commit()
                        await session.refresh(dataset)
            return dataset
        rows = json.loads(dataset.rows_json or "[]")
        raw_keep_features = ((config_payload.get("feature_config") or {}).get("keep_features")) or []
        if not raw_keep_features:
            raw_keep_features = list(DEFAULT_FEATURE_CONFIG["keep_features"])
        upgraded_keep_features = self._upgrade_legacy_keep_features(raw_keep_features)
        feature_columns = [str(column) for column in summary_payload.get("feature_columns") or []]
        matrix_columns = [str(column) for column in summary_payload.get("matrix_columns") or []]

        needs_missing_feature_config = not bool(raw_keep_features)
        needs_missing_feature_columns = bool(rows or dataset.row_count) and not bool(feature_columns)
        needs_keep_feature_upgrade = upgraded_keep_features != raw_keep_features
        needs_column_upgrade = "Load" in feature_columns and any(column not in feature_columns for column in LOAD_RANGE_COLUMN_NAMES)
        needs_row_upgrade = bool(rows) and any(
            ("Load" in row) and any(column not in row for column in LOAD_RANGE_COLUMN_NAMES)
            for row in rows[:10]
            if isinstance(row, dict)
        )

        if not (
            needs_missing_feature_config
            or needs_missing_feature_columns
            or needs_keep_feature_upgrade
            or needs_column_upgrade
            or needs_row_upgrade
        ):
            return dataset

        feature_config = dict(config_payload.get("feature_config") or {})
        feature_config["keep_features"] = upgraded_keep_features
        config_payload["feature_config"] = feature_config
        normalized_options = self._normalize_options(config_payload)

        source_scope = summary_payload.get("source_scope") or {}
        source_scope_values = {
            "group_id": dataset.group_id,
            "scope_type": dataset.source_scope_type,
            "scope_key": dataset.source_scope_key,
            "workspace_id": dataset.workspace_id if dataset.source_scope_type == "workspace" else None,
        }
        records = await self._load_scope_records(session, source_scope_values)
        base_rows = [self._serialize_record(record) for record in records]
        cleaned_rows, cleaning_summary = self._clean_rows(base_rows, target_key=dataset.target_key, options=normalized_options)
        matrix_payload = self._build_matrix_payload(cleaned_rows, target_key=dataset.target_key, options=normalized_options)
        target = TARGET_DEFINITIONS.get(dataset.target_key) or TARGET_DEFINITIONS["cof"]
        resolved_label = source_scope.get("label") or ("Group library" if dataset.source_scope_key == "group_library" else "Current workspace")

        dataset.row_count = len(matrix_payload["rows"])
        dataset.config_json = json.dumps(normalized_options, ensure_ascii=False)
        dataset.summary_json = json.dumps({
            "summary": {
                **cleaning_summary,
                "final_feature_count": len(matrix_payload["feature_columns"]),
                "final_feature_columns": matrix_payload["feature_columns"],
            },
            "source_scope": {
                "requested_mode": source_scope.get("requested_mode") or normalized_options.get("source_mode", "current_scope"),
                "resolved_scope_key": dataset.source_scope_key,
                "resolved_scope_type": dataset.source_scope_type,
                "label": resolved_label,
                "used_fallback": bool(source_scope.get("used_fallback", False)),
            },
            "feature_coverage": matrix_payload["feature_coverage"],
            "target": {
                "key": dataset.target_key,
                "label": target["label"],
                "column_name": matrix_payload["target_column"],
            },
            "pca_info": matrix_payload["pca_info"],
            "matrix_columns": matrix_payload["matrix_columns"],
            "feature_columns": matrix_payload["feature_columns"],
            "target_column": matrix_payload["target_column"],
        }, ensure_ascii=False)
        dataset.rows_json = json.dumps(matrix_payload["rows"], ensure_ascii=False)
        await session.commit()
        await session.refresh(dataset)
        return dataset

    def _upgrade_legacy_keep_features(self, keep_features: list[str]) -> list[str]:
        values = [str(item).strip() for item in keep_features if str(item or "").strip()]
        if "load" not in values:
            return values

        upgraded: list[str] = []
        inserted = False
        for value in values:
            if value not in upgraded:
                upgraded.append(value)
            if value == "load" and not inserted:
                for extra in LOAD_RANGE_FEATURE_KEYS:
                    if extra not in upgraded:
                        upgraded.append(extra)
                inserted = True
        return upgraded

    def _normalize_options(self, options: dict[str, Any] | None) -> dict[str, Any]:
        merged = {**DEFAULT_CLEANING_WORKBENCH_OPTIONS, **(options or {})}
        source_mode = str(merged.get("source_mode") or DEFAULT_CLEANING_OPTIONS["source_mode"]).strip().lower()
        if source_mode not in {"current_scope", "group_library", "group_library_fallback"}:
            source_mode = DEFAULT_CLEANING_OPTIONS["source_mode"]
        strategy = str(merged.get("missing_value_strategy") or "median").strip().lower()
        if strategy not in {"keep", "median", "zero"}:
            strategy = "median"
        raw_feature_config = merged.get("feature_config") or {}
        feature_config = {**DEFAULT_FEATURE_CONFIG, **raw_feature_config}
        keep_features_source = raw_feature_config.get("keep_features", DEFAULT_FEATURE_CONFIG["keep_features"])
        keep_features = [str(item).strip() for item in keep_features_source]
        keep_features = [item for item in keep_features if item in PROCESS_FEATURE_LOOKUP]
        feature_config["keep_features"] = keep_features
        feature_config["use_pca"] = bool(feature_config.get("use_pca", False))
        feature_config["n_components"] = max(2, min(30, int(feature_config.get("n_components", DEFAULT_FEATURE_CONFIG["n_components"]) or DEFAULT_FEATURE_CONFIG["n_components"])))
        merged["source_mode"] = source_mode
        merged["training_view"] = normalize_training_view(merged.get("training_view"))
        merged["missing_value_strategy"] = strategy
        merged["drop_missing_target"] = bool(merged.get("drop_missing_target", True))
        merged["require_dual_smiles"] = bool(merged.get("require_dual_smiles", True))
        merged["require_valid_smiles"] = bool(merged.get("require_valid_smiles", True))
        merged["remove_target_outliers"] = bool(merged.get("remove_target_outliers", False))
        merged["iqr_multiplier"] = max(0.5, min(5.0, float(merged.get("iqr_multiplier", 1.5) or 1.5)))
        merged["feature_config"] = feature_config
        return merged

    def _dataset_kind(self, config_payload: dict[str, Any], summary_payload: dict[str, Any]) -> str:
        return str(summary_payload.get("dataset_kind") or config_payload.get("dataset_kind") or "cleaned_scope").strip().lower()

    def _build_imported_dataset_config(
        self,
        *,
        filename: str,
        target_column: str,
        feature_columns: list[str],
        identifier_columns: list[str],
        dataset_kind: str = IMPORTED_DATASET_KIND,
    ) -> dict[str, Any]:
        feature_config = dict(DEFAULT_FEATURE_CONFIG)
        feature_config["keep_features"] = self._upgrade_legacy_keep_features(list(DEFAULT_FEATURE_CONFIG["keep_features"]))
        return {
            **DEFAULT_CLEANING_WORKBENCH_OPTIONS,
            "feature_config": feature_config,
            "dataset_kind": dataset_kind,
            "import_config": {
                "filename": filename,
                "target_column": target_column,
                "feature_columns": list(feature_columns),
                "identifier_columns": list(identifier_columns),
            },
        }

    async def _find_existing_imported_dataset(
        self,
        session: AsyncSession,
        *,
        scope: RequestScope,
        dataset_kind: str,
        filename: str,
    ) -> CleanedDataset | None:
        stmt = (
            select(CleanedDataset)
            .where(
                CleanedDataset.group_id == scope.group_id,
                CleanedDataset.scope_key == scope.scope_key,
                CleanedDataset.target_key == "cof",
            )
            .order_by(CleanedDataset.created_at.desc(), CleanedDataset.id.desc())
        )
        result = await session.execute(stmt)
        for dataset in result.scalars().all():
            try:
                summary_payload = json.loads(dataset.summary_json or "{}")
            except Exception:
                continue
            metadata = summary_payload.get("import_metadata") or {}
            if (
                str(summary_payload.get("dataset_kind") or "").strip() == dataset_kind
                and str(metadata.get("filename") or "").strip() == filename
            ):
                return await self.upgrade_dataset_if_needed(session, dataset)
        return None

    def _build_imported_csv_payload(
        self,
        csv_text: str,
        *,
        filename: str,
        target_column: str | None,
        scope: RequestScope,
    ) -> dict[str, Any]:
        text = str(csv_text or "").lstrip("\ufeff")
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = [self._normalize_import_column_name(value) for value in (reader.fieldnames or [])]
        fieldnames = [value for value in fieldnames if value]
        if not fieldnames:
            raise ValueError("The CSV file does not contain a header row.")

        raw_rows: list[dict[str, str]] = []
        for raw_row in reader:
            if not isinstance(raw_row, dict):
                continue
            normalized_row: dict[str, str] = {}
            has_value = False
            for original_key, value in raw_row.items():
                key = self._normalize_import_column_name(original_key)
                if not key:
                    continue
                cell = str(value or "").strip()
                if cell:
                    has_value = True
                normalized_row[key] = cell
            if has_value:
                raw_rows.append(normalized_row)

        if not raw_rows:
            raise ValueError("The CSV file does not contain any data rows.")

        resolved_target_column = self._resolve_import_target_column(fieldnames, target_column)
        feature_columns, identifier_columns = self._infer_import_feature_columns(raw_rows, fieldnames, resolved_target_column)
        if not feature_columns:
            raise ValueError("The CSV file does not contain any numeric feature columns after excluding the target column.")

        rows: list[dict[str, Any]] = []
        target_ready_records = 0
        for raw_row in raw_rows:
            row: dict[str, Any] = {}
            for column in fieldnames:
                raw_value = str(raw_row.get(column) or "").strip()
                if column == resolved_target_column or column in feature_columns:
                    row[column] = self._parse_import_float(raw_value)
                else:
                    row[column] = raw_value or None
            if self._safe_import_float(row.get(resolved_target_column)) is not None:
                target_ready_records += 1
            rows.append(row)

        target_payload = self._build_import_target_payload(resolved_target_column)
        scope_label = scope.workspace.name if scope.workspace else "Group library"
        summary = {
            "raw_records": len(rows),
            "target_ready_records": target_ready_records,
            "chemistry_ready_records": len(rows),
            "training_ready_records": target_ready_records,
            "missing_value_repairs": {},
            "outliers_detected": 0,
            "outliers_removed": 0,
            "dropped_by_reason": {
                "missing_target": max(0, len(rows) - target_ready_records),
            },
            "rules": {
                "import_mode": IMPORTED_DATASET_KIND,
                "filename": filename,
                "target_column": resolved_target_column,
                "identifier_columns": identifier_columns,
                "numeric_feature_columns": feature_columns,
            },
            "final_feature_count": len(feature_columns),
            "final_feature_columns": feature_columns,
        }

        return {
            "rows": rows,
            "summary": summary,
            "source_scope": {
                "requested_mode": IMPORTED_DATASET_KIND,
                "resolved_scope_key": scope.scope_key,
                "resolved_scope_type": scope.scope_type,
                "label": f"Imported CSV ({scope_label})",
                "used_fallback": False,
            },
            "feature_coverage": [
                {
                    "key": column,
                    "label": column,
                    "group": self._import_feature_group(column),
                    "available_count": sum(1 for row in rows if self._safe_import_float(row.get(column)) is not None),
                    "coverage": (
                        sum(1 for row in rows if self._safe_import_float(row.get(column)) is not None) / len(rows)
                        if rows
                        else 0.0
                    ),
                }
                for column in feature_columns
            ],
            "target": target_payload,
            "matrix_columns": fieldnames,
            "feature_columns": feature_columns,
            "target_column": resolved_target_column,
            "import_metadata": {
                "filename": filename,
                "original_columns": fieldnames,
                "identifier_columns": identifier_columns,
                "feature_columns": feature_columns,
                "row_count": len(rows),
            },
        }

    def _normalize_import_column_name(self, value: Any) -> str:
        return str(value or "").replace("\ufeff", "").strip()

    def _normalize_import_lookup_key(self, value: str | None) -> str:
        text = str(value or "").strip().lower().replace("μ", "mu").replace("µ", "mu")
        return re.sub(r"[^a-z0-9]+", "", text)

    def _resolve_import_target_column(self, fieldnames: list[str], requested: str | None) -> str:
        if requested:
            requested_key = self._normalize_import_lookup_key(requested)
            for fieldname in fieldnames:
                if self._normalize_import_lookup_key(fieldname) == requested_key:
                    return fieldname
            raise ValueError(f"Target column '{requested}' was not found in the CSV header.")

        for fieldname in fieldnames:
            if self._normalize_import_lookup_key(fieldname) in IMPORTED_TARGET_ALIASES:
                return fieldname

        for fieldname in fieldnames:
            normalized = self._normalize_import_lookup_key(fieldname)
            if "friction" in normalized and ("coefficient" in normalized or normalized.endswith("cof")):
                return fieldname

        return fieldnames[-1]

    def _infer_import_feature_columns(
        self,
        raw_rows: list[dict[str, str]],
        fieldnames: list[str],
        target_column: str,
    ) -> tuple[list[str], list[str]]:
        feature_columns: list[str] = []
        identifier_columns: list[str] = []

        for fieldname in fieldnames:
            if fieldname == target_column:
                continue
            if self._is_import_reserved_metadata_column(fieldname):
                identifier_columns.append(fieldname)
                continue
            if fieldname.startswith("__"):
                identifier_columns.append(fieldname)
                continue
            values = [str(row.get(fieldname) or "").strip() for row in raw_rows]
            non_empty_values = [value for value in values if value]
            if not non_empty_values:
                identifier_columns.append(fieldname)
                continue

            numeric_count = sum(1 for value in non_empty_values if self._parse_import_float(value) is not None)
            if numeric_count / len(non_empty_values) >= 0.95:
                feature_columns.append(fieldname)
            else:
                identifier_columns.append(fieldname)

        return feature_columns, identifier_columns

    def _is_import_reserved_metadata_column(self, fieldname: str) -> bool:
        normalized = self._normalize_import_lookup_key(fieldname)
        return normalized in IMPORT_RESERVED_METADATA_COLUMNS

    def _apply_wff_thesis_metadata(self, payload: dict[str, Any], *, dataset_key: str, filename: str) -> None:
        rows = payload["rows"]
        if not rows:
            return

        external_indices = {
            index
            for index, row in enumerate(rows)
            if not str(row.get("stratify_label") or "").strip()
        }
        if dataset_key == "dataset_b":
            test_indices = {
                index
                for index, row in enumerate(rows)
                if index not in external_indices and self._safe_import_float(row.get("friction_pred")) is not None
            }
        else:
            test_count = 50
            non_external = [index for index in range(len(rows)) if index not in external_indices]
            test_indices = set(non_external[-test_count:]) if len(non_external) > test_count else set()

        split_counts = {"train": 0, "test": 0, "external": 0}
        for index, row in enumerate(rows):
            if index in external_indices:
                split = "external"
            elif index in test_indices:
                split = "test"
            else:
                split = "train"
            row["__thesis_split"] = split
            row["__wff_row_index"] = index
            split_counts[split] += 1

        for column in ("__thesis_split", "__wff_row_index"):
            if column not in payload["matrix_columns"]:
                payload["matrix_columns"].append(column)
        metadata = payload["import_metadata"]
        for column in ("__thesis_split", "__wff_row_index"):
            if column not in metadata["identifier_columns"]:
                metadata["identifier_columns"].append(column)
        metadata.update(
            {
                "dataset_kind": WFF_THESIS_DATASET_KIND,
                "wff_dataset_key": dataset_key,
                "filename": filename,
                "thesis_fixed_split": True,
                "thesis_split_counts": split_counts,
                "reserved_metadata_columns": sorted(
                    column
                    for column in payload["matrix_columns"]
                    if self._is_import_reserved_metadata_column(column) or column.startswith("__")
                ),
            }
        )
        payload["summary"]["rules"]["training_view"] = "all"
        payload["summary"]["rules"]["thesis_fixed_split"] = True
        payload["summary"]["rules"]["thesis_split_counts"] = split_counts
        payload["summary"]["rules"]["dataset_kind"] = WFF_THESIS_DATASET_KIND
        payload["source_scope"]["label"] = "WFF thesis data"

    def _parse_import_float(self, value: Any) -> float | None:
        text = "" if value is None else str(value).strip()
        if not text:
            return None
        if text.lower() in {"na", "n/a", "none", "null", "nan"}:
            return None
        try:
            numeric = float(text)
        except (TypeError, ValueError):
            return None
        if np.isnan(numeric) or np.isinf(numeric):
            return None
        return float(numeric)

    def _safe_import_float(self, value: Any) -> float | None:
        return self._parse_import_float(value)

    def _build_import_target_payload(self, target_column: str) -> dict[str, Any]:
        normalized = self._normalize_import_lookup_key(target_column)
        if normalized in IMPORTED_TARGET_ALIASES:
            return {
                "key": "cof",
                "label": TARGET_DEFINITIONS["cof"]["label"],
                "column_name": target_column,
            }
        return {
            "key": normalized or "imported_target",
            "label": target_column.replace("_", " "),
            "column_name": target_column,
        }

    def _import_feature_group(self, column: str) -> str:
        lowered = str(column or "").strip().lower()
        if lowered.startswith("cation_"):
            return "Cation descriptors"
        if lowered.startswith("anion_"):
            return "Anion descriptors"
        if lowered.startswith("compound_"):
            return "Compound encoding"
        if lowered.startswith("surface_"):
            return "Surface encoding"
        if lowered in {"roughness", "potential/v", "sliding velocity", "t/k", "mol radio"}:
            return "Operating conditions"
        return "Imported features"

    async def _resolve_source_records(
        self,
        session: AsyncSession,
        scope_filter_values: dict[str, Any],
        options: dict[str, Any],
    ) -> dict[str, Any]:
        requested_scope = dict(scope_filter_values)
        records = await self._load_scope_records(session, requested_scope)
        resolved_scope = requested_scope

        if options["source_mode"] == "group_library":
            resolved_scope = {
                "group_id": scope_filter_values["group_id"],
                "scope_type": "group_library",
                "scope_key": "group_library",
                "workspace_id": None,
            }
            records = await self._load_scope_records(session, resolved_scope)
        elif options["source_mode"] == "group_library_fallback" and not records:
            resolved_scope = {
                "group_id": scope_filter_values["group_id"],
                "scope_type": "group_library",
                "scope_key": "group_library",
                "workspace_id": None,
            }
            records = await self._load_scope_records(session, resolved_scope)

        label = "Group library" if resolved_scope["scope_key"] == "group_library" else "Current workspace"
        return {
            "records": records,
            "source_scope": {
                "requested_mode": options["source_mode"],
                "resolved_scope_key": resolved_scope["scope_key"],
                "resolved_scope_type": resolved_scope["scope_type"],
                "label": label,
                "used_fallback": resolved_scope["scope_key"] != requested_scope["scope_key"],
            },
        }

    async def _load_scope_records(self, session: AsyncSession, scope_filter_values: dict[str, Any]) -> list[TribologyData]:
        stmt = (
            select(TribologyData)
            .join(TribologyData.literature)
            .options(selectinload(TribologyData.literature))
            .where(*literature_scope_conditions(scope_filter_values))
            .order_by(TribologyData.id.asc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())

    def _serialize_record(self, record: TribologyData) -> dict[str, Any]:
        row = {
            "record_id": record.id,
            "literature_id": record.literature_id,
            "material_name": record.material_name,
            "lubricant": record.lubricant,
            "lubricant_components": getattr(record, "lubricant_components_json", None),
            "mol_ratio": record.mol_ratio,
            "confidence": record.confidence,
            "cof_value": record.cof_value,
            "cation": record.cation,
            "anion": record.anion,
            "cation_smiles": record.cation_smiles,
            "anion_smiles": record.anion_smiles,
            "temperature": record.temperature,
            "speed_value": record.speed_value,
            "speed_conditions": getattr(record, "speed_conditions_json", None),
            "load_value": record.load_value,
            "load_raw": record.load_raw,
            "load_conditions": getattr(record, "load_conditions_json", None),
            "potential": record.potential,
            "water_content": record.water_content,
            "film_thickness": record.film_thickness,
            "regime": getattr(record, "regime", None),
            "tribological_system": getattr(record, "tribological_system_json", None),
            "review_status": getattr(record, "review_status", None),
            "record_origin": getattr(record, "record_origin", None),
            "field_evidence_json": getattr(record, "field_evidence_json", None),
            "source": record.source,
            "source_page": record.source_page,
            "source_figure": record.source_figure,
            "evidence": record.evidence,
            "probe_material": record.probe_material,
            "substrate_material": record.substrate_material,
            "substrate_coating": record.substrate_coating,
            "probe_roughness": record.probe_roughness,
            "substrate_roughness": record.substrate_roughness,
            "surface_roughness": record.surface_roughness,
            "alkyl_chain_length": record.alkyl_chain_length,
            "normalized_temperature_c": _feature_value({
                "normalized_temperature_c": None,
                "temperature": record.temperature,
            }, "temperature"),
            "normalized_speed_mps": _feature_value({
                "normalized_speed_mps": None,
                "speed_value": record.speed_value,
                "speed_conditions": getattr(record, "speed_conditions_json", None),
            }, "speed"),
            "normalized_load_n": _feature_value({
                "normalized_load_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "load"),
            "normalized_system_total_load_n": _feature_value({
                "normalized_system_total_load_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "system_total_load"),
            "normalized_contact_load_per_unit_n": _feature_value({
                "normalized_contact_load_per_unit_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "contact_load_per_unit"),
            "normalized_load_min_n": _feature_value({
                "normalized_load_min_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "load_min"),
            "normalized_load_max_n": _feature_value({
                "normalized_load_max_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "load_max"),
            "normalized_load_span_n": _feature_value({
                "normalized_load_span_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "load_span"),
            "normalized_load_is_range": _feature_value({
                "normalized_load_is_range": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
                "load_conditions": getattr(record, "load_conditions_json", None),
            }, "load_is_range"),
            "normalized_potential_v": _feature_value({
                "normalized_potential_v": None,
                "potential": record.potential,
            }, "potential"),
            "normalized_water_content_ppm": _feature_value({
                "normalized_water_content_ppm": None,
                "water_content": record.water_content,
            }, "water_content"),
            "normalized_il_additive_mol_fraction": _feature_value({
                "normalized_il_additive_mol_fraction": None,
                "lubricant_components": getattr(record, "lubricant_components_json", None),
            }, "il_additive_mol_fraction"),
            "normalized_base_oil_mol_fraction": _feature_value({
                "normalized_base_oil_mol_fraction": None,
                "lubricant_components": getattr(record, "lubricant_components_json", None),
            }, "base_oil_mol_fraction"),
            "normalized_film_thickness_nm": _feature_value({
                "normalized_film_thickness_nm": None,
                "film_thickness": record.film_thickness,
            }, "film_thickness"),
            "normalized_alkyl_chain_length": _feature_value({
                "normalized_alkyl_chain_length": None,
                "alkyl_chain_length": record.alkyl_chain_length,
            }, "alkyl_chain_length"),
            "repaired_fields": [],
            "is_target_outlier": False,
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

    def _parse_json_mapping(self, value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str) and value.strip():
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _field_has_grounded_evidence(self, field_map: dict[str, Any], key: str) -> bool:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            return False
        if str(entry.get("grounding_mode") or "").strip().lower() in {"inferred", "derived"}:
            return True
        status = str(entry.get("status") or "").strip().lower()
        if status == "grounded":
            return True
        evidence = entry.get("evidence")
        if not isinstance(evidence, dict):
            return False
        return bool(evidence.get("page") and (evidence.get("bbox") or evidence.get("quote") or evidence.get("source_label")))

    def _field_has_extracted_value(self, row: dict[str, Any], key: str, entry: dict[str, Any]) -> bool:
        def present(value: Any) -> bool:
            if _safe_float(value) is not None:
                return True
            text = str(value or "").strip()
            return bool(text and text.lower() not in {"-", "--", "na", "n/a", "none", "null", "unknown", "未记录", "不详"})

        if present(entry.get("value")):
            return True

        field_lookup = {
            "material": ("material_name",),
            "ionic_liquid": ("lubricant", "lubricant_components"),
            "cof": ("cof_value",),
            "load": ("normalized_load_n", "load_value", "load_raw", "load_conditions"),
            "speed": ("normalized_speed_mps", "speed_value", "speed_conditions"),
            "temperature": ("normalized_temperature_c", "temperature"),
            "potential": ("normalized_potential_v", "potential"),
            "water_content": ("normalized_water_content_ppm", "water_content"),
            "film_thickness": ("normalized_film_thickness_nm", "film_thickness"),
            "surface_roughness": ("surface_roughness", "probe_roughness", "substrate_roughness"),
            "roughness": ("surface_roughness", "probe_roughness", "substrate_roughness"),
        }
        return any(present(row.get(field)) for field in field_lookup.get(key, ()))

    def _record_missing_evidence(self, row: dict[str, Any]) -> bool:
        status = str(row.get("review_status") or "").strip().lower()
        if status in {"flagged", "needs_evidence"}:
            return True
        field_map = self._parse_json_mapping(row.get("field_evidence_json"))
        if field_map:
            required = (
                "material",
                "ionic_liquid",
                "cof",
                "load",
                "speed",
                "temperature",
                "potential",
                "water_content",
                "film_thickness",
                "surface_roughness",
                "roughness",
            )
            return any(
                self._field_has_extracted_value(row, key, entry)
                and not self._field_has_grounded_evidence(field_map, key)
                for key in required
                if isinstance((entry := field_map.get(key)), dict)
            )
        return not bool(row.get("source_page") or str(row.get("source") or row.get("source_figure") or row.get("evidence") or "").strip())

    def _mixture_ratio_gap(self, row: dict[str, Any]) -> bool:
        components = normalize_lubricant_components(row.get("lubricant_components"))
        mol_ratio = str(row.get("mol_ratio") or "").strip()
        lubricant = str(row.get("lubricant") or "").strip().lower()
        if mol_ratio and not components:
            return True
        if components:
            return any(
                component.get("fraction") in (None, "")
                or not str(component.get("unit") or "").strip()
                for component in components
            )
        return bool("oil" in lubricant and ("[" in lubricant or "ionic" in lubricant))

    def _condition_collision_diagnostics(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            key = (
                row.get("material_name"),
                row.get("lubricant"),
                row.get("mol_ratio"),
                row.get("temperature"),
                row.get("speed_value"),
                row.get("load_value") or row.get("load_raw"),
                row.get("potential"),
                row.get("water_content"),
                row.get("experiment_method"),
            )
            groups[key].append(row)

        collision_groups = 0
        collision_records = 0
        for members in groups.values():
            if len(members) < 2:
                continue
            cof_values = {
                round(float(value), 6)
                for value in (_safe_float(member.get("cof_value")) for member in members)
                if value is not None
            }
            if len(cof_values) <= 1:
                continue
            collision_groups += 1
            collision_records += len(members)
        return {
            "condition_collision_groups": collision_groups,
            "condition_collision_records": collision_records,
        }

    def _smiles_validation(
        self,
        smiles: Any,
        cache: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        text = str(smiles or "").strip()
        if not text:
            return {"status": "missing", "canonical": None}
        if text in cache:
            return cache[text]

        if not RDKIT_DESCRIPTOR_AVAILABLE or Chem is None:
            result = {"status": "unchecked", "canonical": text}
            cache[text] = result
            return result

        try:
            mol = Chem.MolFromSmiles(text)
        except Exception:
            mol = None

        if mol is None:
            result = {"status": "invalid", "canonical": None}
        else:
            try:
                canonical = Chem.MolToSmiles(mol, canonical=True)
            except Exception:
                canonical = text
            result = {"status": "valid", "canonical": canonical}
        cache[text] = result
        return result

    def _row_has_valid_dual_smiles(
        self,
        row: dict[str, Any],
        cache: dict[str, dict[str, Any]],
    ) -> bool:
        if not RDKIT_DESCRIPTOR_AVAILABLE or Chem is None:
            return bool(str(row.get("cation_smiles") or "").strip() and str(row.get("anion_smiles") or "").strip())
        cation = self._smiles_validation(row.get("cation_smiles"), cache)
        anion = self._smiles_validation(row.get("anion_smiles"), cache)
        return cation["status"] == "valid" and anion["status"] == "valid"

    def _build_smiles_screening_summary(
        self,
        rows: list[dict[str, Any]],
        cache: dict[str, dict[str, Any]],
        *,
        require_dual_smiles: bool,
        require_valid_smiles: bool,
    ) -> dict[str, Any]:
        missing_cation = 0
        missing_anion = 0
        invalid_cation = 0
        invalid_anion = 0
        dual_smiles_records = 0
        descriptor_ready_records = 0
        canonicalized_cations = 0
        canonicalized_anions = 0
        unique_cations: set[str] = set()
        unique_anions: set[str] = set()

        for row in rows:
            cation_text = str(row.get("cation_smiles") or "").strip()
            anion_text = str(row.get("anion_smiles") or "").strip()
            if not cation_text:
                missing_cation += 1
            if not anion_text:
                missing_anion += 1
            if cation_text and anion_text:
                dual_smiles_records += 1

            cation_status = self._smiles_validation(cation_text, cache)
            anion_status = self._smiles_validation(anion_text, cache)
            if cation_status["status"] == "invalid":
                invalid_cation += 1
            if anion_status["status"] == "invalid":
                invalid_anion += 1
            if cation_status["status"] == "valid":
                canonical = str(cation_status.get("canonical") or cation_text)
                unique_cations.add(canonical)
                if canonical and canonical != cation_text:
                    canonicalized_cations += 1
            elif cation_text:
                unique_cations.add(cation_text)
            if anion_status["status"] == "valid":
                canonical = str(anion_status.get("canonical") or anion_text)
                unique_anions.add(canonical)
                if canonical and canonical != anion_text:
                    canonicalized_anions += 1
            elif anion_text:
                unique_anions.add(anion_text)

            if self._row_has_valid_dual_smiles(row, cache):
                descriptor_ready_records += 1

        invalid_records = sum(
            1
            for row in rows
            if (
                self._smiles_validation(row.get("cation_smiles"), cache)["status"] == "invalid"
                or self._smiles_validation(row.get("anion_smiles"), cache)["status"] == "invalid"
            )
        )

        return {
            "rdkit_available": bool(RDKIT_DESCRIPTOR_AVAILABLE and Chem is not None),
            "require_dual_smiles": require_dual_smiles,
            "require_valid_smiles": require_valid_smiles,
            "input_records": len(rows),
            "dual_smiles_records": dual_smiles_records,
            "descriptor_ready_records": descriptor_ready_records,
            "missing_cation_smiles": missing_cation,
            "missing_anion_smiles": missing_anion,
            "invalid_cation_smiles": invalid_cation,
            "invalid_anion_smiles": invalid_anion,
            "invalid_smiles_records": invalid_records,
            "unique_cations": len(unique_cations),
            "unique_anions": len(unique_anions),
            "canonicalized_cations": canonicalized_cations,
            "canonicalized_anions": canonicalized_anions,
        }

    def _quality_gate_summary(
        self,
        rows: list[dict[str, Any]],
        scoped_rows: list[dict[str, Any]],
        *,
        options: dict[str, Any],
    ) -> dict[str, Any]:
        feature_gaps: dict[str, int] = {}
        for key in options["feature_config"]["keep_features"]:
            definition = PROCESS_FEATURE_LOOKUP.get(key)
            if not definition:
                continue
            normalized_field = definition["normalized_field"]
            feature_gaps[key] = sum(1 for row in scoped_rows if _safe_float(row.get(normalized_field)) is None)

        collision = self._condition_collision_diagnostics(scoped_rows)
        approved_statuses = {"approved", "accepted"}
        return {
            "pending_review_records": sum(1 for row in scoped_rows if str(row.get("review_status") or "").strip().lower() not in approved_statuses),
            "blocked_review_records": sum(1 for row in scoped_rows if str(row.get("review_status") or "").strip().lower() in {"flagged", "needs_evidence"}),
            "missing_evidence_records": sum(1 for row in scoped_rows if self._record_missing_evidence(row)),
            "low_confidence_records": sum(
                1
                for row in scoped_rows
                if (confidence := _safe_float(row.get("confidence"))) is not None and confidence < 0.8
            ),
            "mixture_ratio_gaps": sum(1 for row in scoped_rows if self._mixture_ratio_gap(row)),
            "feature_gaps": feature_gaps,
            "structured_condition_gaps": sum(feature_gaps.get(key, 0) for key in ("load", "speed", "potential", "temperature")),
            **collision,
        }

    def _clean_rows(self, rows: list[dict[str, Any]], *, target_key: str, options: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        target_def = TARGET_DEFINITIONS[target_key]
        raw_count = len(rows)
        training_view = normalize_training_view(options.get("training_view"))
        view_ready_rows = [row for row in rows if record_matches_training_view(row, training_view)]
        scoped_rows = view_ready_rows if training_view != "all" else rows
        target_ready_rows = [row for row in scoped_rows if _safe_float(row.get(target_def["field"])) is not None]
        smiles_cache: dict[str, dict[str, Any]] = {}
        smiles_screening = self._build_smiles_screening_summary(
            scoped_rows,
            smiles_cache,
            require_dual_smiles=bool(options["require_dual_smiles"]),
            require_valid_smiles=bool(options["require_valid_smiles"]),
        )
        smiles_ready_rows = [
            row for row in scoped_rows if self._row_has_valid_dual_smiles(row, smiles_cache)
        ]

        working_rows = [dict(row) for row in scoped_rows]
        if options["drop_missing_target"]:
            working_rows = [row for row in working_rows if _safe_float(row.get(target_def["field"])) is not None]
        if options["require_dual_smiles"]:
            working_rows = [
                row for row in working_rows
                if str(row.get("cation_smiles") or "").strip() and str(row.get("anion_smiles") or "").strip()
            ]
        if options["require_valid_smiles"]:
            working_rows = [
                row for row in working_rows
                if self._row_has_valid_dual_smiles(row, smiles_cache)
            ]

        repair_counts = self._apply_missing_value_strategy(
            working_rows,
            options["missing_value_strategy"],
            options["feature_config"]["keep_features"],
        )
        outlier_count = self._flag_outliers(working_rows, target_def["field"], options["iqr_multiplier"])
        if options["remove_target_outliers"]:
            working_rows = [row for row in working_rows if not row.get("is_target_outlier")]
        quality_gates = self._quality_gate_summary(rows, scoped_rows, options=options)

        summary = {
            "raw_records": raw_count,
            "view_ready_records": len(view_ready_rows),
            "target_ready_records": len(target_ready_rows),
            "chemistry_ready_records": len(smiles_ready_rows),
            "training_ready_records": len(working_rows),
            "missing_value_repairs": repair_counts,
            "outliers_detected": outlier_count,
            "outliers_removed": outlier_count if options["remove_target_outliers"] else 0,
            "smiles_screening": smiles_screening,
            "dropped_by_reason": {
                "missing_target": sum(1 for row in scoped_rows if _safe_float(row.get(target_def["field"])) is None),
                "missing_cation_smiles": sum(1 for row in scoped_rows if not str(row.get("cation_smiles") or "").strip()),
                "missing_anion_smiles": sum(1 for row in scoped_rows if not str(row.get("anion_smiles") or "").strip()),
                "invalid_cation_smiles": smiles_screening["invalid_cation_smiles"],
                "invalid_anion_smiles": smiles_screening["invalid_anion_smiles"],
                "outside_training_view": 0 if training_view == "all" else max(0, raw_count - len(view_ready_rows)),
            },
            "quality_gates": quality_gates,
            "rules": {
                "training_view": training_view,
                "drop_missing_target": options["drop_missing_target"],
                "require_dual_smiles": options["require_dual_smiles"],
                "require_valid_smiles": options["require_valid_smiles"],
                "missing_value_strategy": options["missing_value_strategy"],
                "remove_target_outliers": options["remove_target_outliers"],
                "iqr_multiplier": options["iqr_multiplier"],
                "feature_config": options["feature_config"],
            },
        }
        return working_rows, summary

    def _apply_missing_value_strategy(self, rows: list[dict[str, Any]], strategy: str, keep_features: list[str]) -> dict[str, int]:
        selected_fields = {
            PROCESS_FEATURE_LOOKUP[key]["normalized_field"]
            for key in keep_features
            if key in PROCESS_FEATURE_LOOKUP
        }
        repair_counts = {field: 0 for field, _label, _key in NUMERIC_PREVIEW_FIELDS if field in selected_fields}
        if strategy == "keep" or not rows:
            return repair_counts

        medians: dict[str, float] = {}
        for field, _label, _key in NUMERIC_PREVIEW_FIELDS:
            if field not in selected_fields:
                continue
            values = [_safe_float(row.get(field)) for row in rows]
            usable_values = [value for value in values if value is not None]
            if usable_values:
                medians[field] = float(np.median(usable_values))

        for row in rows:
            for field, _label, _key in NUMERIC_PREVIEW_FIELDS:
                if field not in selected_fields:
                    continue
                if _safe_float(row.get(field)) is not None:
                    continue
                replacement: float | None = None
                if strategy == "median":
                    replacement = medians.get(field)
                elif strategy == "zero":
                    replacement = 0.0
                if replacement is None:
                    continue
                row[field] = replacement
                row.setdefault("repaired_fields", []).append(field)
                repair_counts[field] += 1
        return repair_counts

    def _flag_outliers(self, rows: list[dict[str, Any]], target_field: str, multiplier: float) -> int:
        values = [_safe_float(row.get(target_field)) for row in rows]
        usable = np.array([value for value in values if value is not None], dtype=float)
        if usable.size < 4:
            return 0
        q1 = float(np.percentile(usable, 25))
        q3 = float(np.percentile(usable, 75))
        iqr = q3 - q1
        if iqr <= 0:
            return 0
        lower = q1 - multiplier * iqr
        upper = q3 + multiplier * iqr
        count = 0
        for row in rows:
            value = _safe_float(row.get(target_field))
            row["is_target_outlier"] = value is not None and (value < lower or value > upper)
            if row["is_target_outlier"]:
                count += 1
        return count

    @staticmethod
    def _parse_roughness_nm(raw: Any) -> float | None:
        return parse_roughness_nm(raw)

    @staticmethod
    def _normalize_surface_text(value: Any) -> str:
        text = str(value or "").strip().lower()
        text = text.replace("（", "(").replace("）", ")")
        text = re.sub(r"\s+", " ", text)
        return text

    @classmethod
    def _surface_descriptor_key(cls, row: dict[str, Any]) -> str | None:
        preferred_fields = (
            "substrate_material",
            "substrate_coating",
            "material_name",
            "surface",
            "surface_material",
        )
        fallback_fields = ("probe_material",)
        for field in (*preferred_fields, *fallback_fields):
            text = cls._normalize_surface_text(row.get(field))
            if not text:
                continue
            compact = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", text)
            for key, aliases in SURFACE_DESCRIPTOR_ALIASES:
                for alias in aliases:
                    alias_text = cls._normalize_surface_text(alias)
                    alias_compact = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", alias_text)
                    if alias_text and alias_text in text:
                        return key
                    if alias_compact and alias_compact in compact:
                        return key
        return None

    @classmethod
    def _surface_descriptor_entry(cls, row: dict[str, Any]) -> dict[str, Any] | None:
        key = cls._surface_descriptor_key(row)
        if key is None:
            return None
        return SURFACE_DESCRIPTOR_LOOKUP.get(key)

    @staticmethod
    def _builder_surface_descriptor_value(row: dict[str, Any], descriptor_key: str) -> float | None:
        entry = ModelCleaningService._surface_descriptor_entry(row)
        if entry is None:
            return None
        return _safe_float(entry.get(descriptor_key))

    @staticmethod
    def _builder_surface_roughness_value(row: dict[str, Any]) -> float | None:
        value = composite_roughness_nm(
            row.get("probe_roughness"),
            row.get("substrate_roughness"),
            method="rms",
            legacy_surface_roughness=row.get("surface_roughness"),
        )
        if value is not None:
            return value
        return ModelCleaningService._builder_surface_descriptor_value(row, "rq_nm")

    @staticmethod
    def _builder_probe_roughness_value(row: dict[str, Any]) -> float | None:
        return ModelCleaningService._parse_roughness_nm(row.get("probe_roughness"))

    @staticmethod
    def _builder_substrate_roughness_value(row: dict[str, Any]) -> float | None:
        return ModelCleaningService._parse_roughness_nm(row.get("substrate_roughness") or row.get("surface_roughness"))

    @staticmethod
    def _builder_film_thickness_value(row: dict[str, Any]) -> float | None:
        for field in ("normalized_film_thickness_nm", "film_thickness", DATASET_BUILDER_FILM_THICKNESS_COLUMN):
            value = _safe_float(row.get(field))
            if value is not None:
                return value
        return None

    def _build_dataset_builder_payload(self, rows: list[dict[str, Any]], *, target_key: str) -> dict[str, Any]:
        target_field = TARGET_DEFINITIONS[target_key]["field"]
        target_column = DATASET_BUILDER_TARGET_COLUMN
        macro_columns = [feature["column_name"] for feature in DATASET_BUILDER_MACRO_FEATURES]
        descriptor_columns = [
            *[f"Cation_{spec['name']}" for spec in ION_DESCRIPTOR_SPECS],
            *[f"Anion_{spec['name']}" for spec in ION_DESCRIPTOR_SPECS],
        ]
        cation_cache: dict[str, dict[str, float | None]] = {}
        anion_cache: dict[str, dict[str, float | None]] = {}
        builder_rows: list[dict[str, Any]] = []

        for row in rows:
            builder_row: dict[str, Any] = {
                "__record_id": row.get("record_id"),
                "__literature_id": row.get("literature_id"),
                "__confidence": self._jsonable_number(row.get("confidence")),
                "__cation": row.get("cation"),
                "__anion": row.get("anion"),
                "__cation_smiles": row.get("cation_smiles"),
                "__anion_smiles": row.get("anion_smiles"),
                "__experiment_scale": row.get("experiment_scale"),
                "__experiment_method": row.get("experiment_method"),
                "__measurement_type": row.get("measurement_type"),
                "__training_view": row.get("training_view"),
                target_column: self._jsonable_number(row.get(target_field)),
            }
            cation_descriptors = self._descriptor_block_from_smiles(row.get("cation_smiles"), prefix="Cation", cache=cation_cache)
            anion_descriptors = self._descriptor_block_from_smiles(row.get("anion_smiles"), prefix="Anion", cache=anion_cache)
            builder_row.update(cation_descriptors)
            builder_row.update(anion_descriptors)
            for feature in DATASET_BUILDER_MACRO_FEATURES:
                builder_row[feature["column_name"]] = self._jsonable_number(feature["getter"](row))
            builder_rows.append(builder_row)

        descriptor_generation = self._build_descriptor_generation_summary(rows, builder_rows, descriptor_columns)
        screening = self._build_builder_screening(builder_rows, descriptor_columns, macro_columns, target_column)
        subsets = self._build_builder_subsets(builder_rows, descriptor_columns, macro_columns, target_column)

        return {
            "target_column": target_column,
            "descriptor_columns": descriptor_columns,
            "macro_columns": macro_columns,
            "rows": len(builder_rows),
            "descriptor_generation": descriptor_generation,
            "screening": screening,
            "subsets": subsets,
        }

    def _build_descriptor_generation_summary(
        self,
        source_rows: list[dict[str, Any]],
        builder_rows: list[dict[str, Any]],
        descriptor_columns: list[str],
    ) -> dict[str, Any]:
        total = len(builder_rows)
        macro_features = []
        for feature in DATASET_BUILDER_MACRO_FEATURES:
            available_count = sum(1 for row in builder_rows if _safe_float(row.get(feature["column_name"])) is not None)
            macro_features.append({
                "key": feature["key"],
                "label": feature["label"],
                "column_name": feature["column_name"],
                "group": feature["group"],
                "available_count": available_count,
                "coverage": available_count / total if total else 0.0,
            })

        surface_descriptor_source = self._build_surface_descriptor_source_summary(source_rows)

        return {
            "input_rows": len(source_rows),
            "usable_rows": total,
            "descriptor_count": len(descriptor_columns),
            "macro_feature_count": len(DATASET_BUILDER_MACRO_FEATURES),
            "fingerprint_bits_per_ion": 256,
            "total_fingerprint_bits": 512,
            "descriptor_blocks": [
                {"label": "Cation descriptors", "count": len(ION_DESCRIPTOR_SPECS)},
                {"label": "Anion descriptors", "count": len(ION_DESCRIPTOR_SPECS)},
            ],
            "macro_features": macro_features,
            "surface_descriptor_source": surface_descriptor_source,
            "rdkit_enabled": RDKIT_DESCRIPTOR_AVAILABLE,
        }

    def _build_surface_descriptor_source_summary(self, source_rows: list[dict[str, Any]]) -> dict[str, Any]:
        surface_counts: dict[str, int] = defaultdict(int)
        unmatched_examples: list[str] = []
        unmatched_seen: set[str] = set()

        for row in source_rows:
            key = self._surface_descriptor_key(row)
            if key is not None:
                surface_counts[key] += 1
                continue
            candidate = next(
                (
                    str(row.get(field) or "").strip()
                    for field in ("substrate_material", "substrate_coating", "material_name", "surface", "probe_material")
                    if str(row.get(field) or "").strip()
                ),
                "",
            )
            if candidate and candidate not in unmatched_seen and len(unmatched_examples) < 8:
                unmatched_seen.add(candidate)
                unmatched_examples.append(candidate)

        matched_rows = sum(surface_counts.values())
        matched_surfaces = [
            {
                "key": key,
                "label": SURFACE_DESCRIPTOR_LOOKUP[key]["label"],
                "count": count,
            }
            for key, count in sorted(
                surface_counts.items(),
                key=lambda item: (-item[1], SURFACE_DESCRIPTOR_LOOKUP[item[0]]["label"]),
            )
        ]

        return {
            "source": "WFF thesis surface descriptor codebook, seeded from local paper backup datasets.",
            "note": "Legacy backup columns appear gamma/sigma-swapped; generated fields follow Table 2.1 meanings.",
            "input_rows": len(source_rows),
            "matched_rows": matched_rows,
            "coverage": matched_rows / len(source_rows) if source_rows else 0.0,
            "matched_surfaces": matched_surfaces,
            "unmatched_examples": unmatched_examples,
        }

    def _build_builder_screening(
        self,
        builder_rows: list[dict[str, Any]],
        descriptor_columns: list[str],
        macro_columns: list[str],
        target_column: str,
    ) -> dict[str, Any]:
        feature_columns = [*macro_columns, *descriptor_columns]
        series_map = {
            column: [row.get(column) for row in builder_rows]
            for column in [target_column, *feature_columns]
        }

        target_correlations: list[dict[str, Any]] = []
        correlation_lookup: dict[tuple[str, str], float | None] = {}
        for left in [target_column, *feature_columns]:
            for right in [target_column, *feature_columns]:
                if (right, left) in correlation_lookup:
                    correlation_lookup[(left, right)] = correlation_lookup[(right, left)]
                    continue
                correlation_lookup[(left, right)] = self._pairwise_pearson(series_map[left], series_map[right])

        for column in feature_columns:
            correlation = correlation_lookup[(column, target_column)]
            if correlation is None:
                continue
            target_correlations.append({
                "feature": column,
                "correlation": round(float(correlation), 4),
                "abs_correlation": round(abs(float(correlation)), 4),
            })

        target_correlations.sort(key=lambda item: item["abs_correlation"], reverse=True)

        display_features = [target_column]
        for column in [*SURFACE_MACRO_COLUMNS, DATASET_BUILDER_FILM_THICKNESS_COLUMN]:
            if column in feature_columns and column not in display_features:
                display_features.append(column)
        for item in target_correlations:
            if item["feature"] not in display_features:
                display_features.append(item["feature"])
            if len(display_features) >= 28:
                break

        heatmap_matrix: list[list[float | None]] = []
        heatmap_cells: list[dict[str, Any]] = []
        for row_index, left in enumerate(display_features):
            row_values: list[float | None] = []
            for col_index, right in enumerate(display_features):
                value = correlation_lookup.get((left, right))
                normalized_value = None if value is None else round(float(value), 4)
                row_values.append(normalized_value)
                heatmap_cells.append({
                    "x": col_index,
                    "y": row_index,
                    "value": normalized_value,
                })
            heatmap_matrix.append(row_values)

        ionic_collinearity_groups = self._find_correlation_groups(
            descriptor_columns,
            correlation_lookup,
            threshold=0.88,
            prefixes=("Cation_", "Anion_"),
        )
        surface_bias_alerts = self._build_surface_bias_alerts(correlation_lookup)
        max_target_corr = max((item["abs_correlation"] for item in target_correlations), default=0.0)
        nonlinear_recommendation = {
            "recommended": max_target_corr < 0.45,
            "reason": (
                "Most single descriptors have weak linear correlation with μ, so a nonlinear model is recommended."
                if max_target_corr < 0.45
                else "Several descriptors already show moderate linear association with μ."
            ),
            "algorithms": ["CatBoost", "Random Forest", "Gradient Boosting"],
        }
        feature_importance = self._build_feature_importance_ranking(builder_rows, feature_columns, target_column)

        return {
            "feature_count": len(feature_columns),
            "analyzable_rows": len(builder_rows),
            "target_label": TARGET_DEFINITIONS["cof"]["label"],
            "heatmap": {
                "features": display_features,
                "matrix": heatmap_matrix,
                "cells": heatmap_cells,
            },
            "feature_importance": feature_importance,
            "strongest_to_target": target_correlations[:12],
            "ionic_collinearity_groups": ionic_collinearity_groups,
            "surface_bias_alerts": surface_bias_alerts,
            "nonlinear_recommendation": nonlinear_recommendation,
            "requires_surface_stratified_split": bool(surface_bias_alerts),
        }

    def _build_feature_importance_ranking(
        self,
        builder_rows: list[dict[str, Any]],
        feature_columns: list[str],
        target_column: str,
    ) -> dict[str, Any]:
        paired_rows = [
            row
            for row in builder_rows
            if _safe_float(row.get(target_column)) is not None
        ]
        if len(paired_rows) < 8:
            return {
                "available": False,
                "method": "RandomForestRegressor",
                "reason": "At least 8 target-ready rows are required for a stable feature-importance preview.",
                "features": [],
            }

        usable_features = [
            feature
            for feature in feature_columns
            if any(_safe_float(row.get(feature)) is not None for row in paired_rows)
        ]
        if len(usable_features) < 2:
            return {
                "available": False,
                "method": "RandomForestRegressor",
                "reason": "Not enough numeric descriptor columns are available for feature-importance preview.",
                "features": [],
            }

        matrix = np.array(
            [
                [
                    np.nan if _safe_float(row.get(feature)) is None else float(_safe_float(row.get(feature)))
                    for feature in usable_features
                ]
                for row in paired_rows
            ],
            dtype=float,
        )
        target = np.array([float(_safe_float(row.get(target_column))) for row in paired_rows], dtype=float)

        try:
            matrix = SimpleImputer(strategy="median").fit_transform(matrix)
            model = RandomForestRegressor(
                n_estimators=80,
                max_depth=6,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=1,
            )
            model.fit(matrix, target)
        except Exception as exc:
            return {
                "available": False,
                "method": "RandomForestRegressor",
                "reason": f"Feature-importance preview failed: {exc}",
                "features": [],
            }

        ranked = sorted(
            [
                {
                    "feature": feature,
                    "importance": round(float(importance), 6),
                }
                for feature, importance in zip(usable_features, model.feature_importances_)
            ],
            key=lambda item: item["importance"],
            reverse=True,
        )
        for index, item in enumerate(ranked, start=1):
            item["rank"] = index

        return {
            "available": True,
            "method": "RandomForestRegressor",
            "reason": None,
            "features": ranked[:40],
        }

    def _build_builder_subsets(
        self,
        builder_rows: list[dict[str, Any]],
        descriptor_columns: list[str],
        macro_columns: list[str],
        target_column: str,
    ) -> dict[str, Any]:
        dataset_a_feature_columns = [
            column for column in [*macro_columns, *descriptor_columns]
            if column != DATASET_BUILDER_FILM_THICKNESS_COLUMN
        ]
        dataset_b_feature_columns = [*macro_columns, *descriptor_columns]
        dataset_a_columns = [*DATASET_BUILDER_IDENTIFIER_COLUMNS, target_column, *dataset_a_feature_columns]
        dataset_b_columns = [*DATASET_BUILDER_IDENTIFIER_COLUMNS, target_column, *dataset_b_feature_columns]

        dataset_a_rows = [
            {column: row.get(column) for column in dataset_a_columns}
            for row in builder_rows
        ]
        dataset_b_rows = [
            {column: row.get(column) for column in dataset_b_columns}
            for row in builder_rows
            if _safe_float(row.get(DATASET_BUILDER_FILM_THICKNESS_COLUMN)) is not None
        ]

        return {
            "dataset_a": {
                "name": "Dataset-A",
                "description": "General pool without interfacial film thickness h.",
                "target_column": target_column,
                "columns": dataset_a_columns,
                "rows": dataset_a_rows,
                "row_count": len(dataset_a_rows),
                "feature_count": len(dataset_a_feature_columns),
                "preview_rows": dataset_a_rows[:12],
            },
            "dataset_b": {
                "name": "Dataset-B",
                "description": "Mechanism pool including interfacial film thickness h.",
                "target_column": target_column,
                "columns": dataset_b_columns,
                "rows": dataset_b_rows,
                "row_count": len(dataset_b_rows),
                "feature_count": len(dataset_b_feature_columns),
                "preview_rows": dataset_b_rows[:12],
            },
        }

    def _descriptor_block_from_smiles(
        self,
        smiles: Any,
        *,
        prefix: str,
        cache: dict[str, dict[str, float | None]],
    ) -> dict[str, float | None]:
        text = str(smiles or "").strip()
        if not text:
            return {f"{prefix}_{spec['name']}": None for spec in ION_DESCRIPTOR_SPECS}
        if text not in cache:
            cache[text] = self._compute_descriptor_block(text, prefix)
        return dict(cache[text])

    def _compute_descriptor_block(self, smiles: str, prefix: str) -> dict[str, float | None]:
        if not RDKIT_DESCRIPTOR_AVAILABLE or Chem is None:
            return {f"{prefix}_{spec['name']}": None for spec in ION_DESCRIPTOR_SPECS}

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return {f"{prefix}_{spec['name']}": None for spec in ION_DESCRIPTOR_SPECS}

        descriptor_values: dict[str, float | None] = {}
        for spec in ION_DESCRIPTOR_SPECS:
            try:
                value = spec["fn"](mol)
            except Exception:
                value = None
            descriptor_values[f"{prefix}_{spec['name']}"] = self._jsonable_number(value)
        return descriptor_values

    def _find_correlation_groups(
        self,
        features: list[str],
        correlation_lookup: dict[tuple[str, str], float | None],
        *,
        threshold: float,
        prefixes: tuple[str, ...],
    ) -> list[dict[str, Any]]:
        groups: list[dict[str, Any]] = []
        for prefix in prefixes:
            scoped = [feature for feature in features if feature.startswith(prefix)]
            adjacency: dict[str, set[str]] = defaultdict(set)
            for left_index, left in enumerate(scoped):
                for right in scoped[left_index + 1:]:
                    value = correlation_lookup.get((left, right))
                    if value is None or abs(value) < threshold:
                        continue
                    adjacency[left].add(right)
                    adjacency[right].add(left)

            visited: set[str] = set()
            for feature in scoped:
                if feature in visited or not adjacency.get(feature):
                    continue
                stack = [feature]
                component: list[str] = []
                while stack:
                    current = stack.pop()
                    if current in visited:
                        continue
                    visited.add(current)
                    component.append(current)
                    stack.extend(adjacency.get(current, []))
                if len(component) < 2:
                    continue
                component.sort()
                strongest = max(
                    abs(correlation_lookup.get((left, right)) or 0.0)
                    for left_index, left in enumerate(component)
                    for right in component[left_index + 1:]
                )
                groups.append({
                    "label": f"{prefix.rstrip('_')} descriptor block",
                    "features": component[:8],
                    "size": len(component),
                    "max_abs_correlation": round(float(strongest), 4),
                })

        groups.sort(key=lambda item: (item["size"], item["max_abs_correlation"]), reverse=True)
        return groups[:6]

    def _build_surface_bias_alerts(
        self,
        correlation_lookup: dict[tuple[str, str], float | None],
    ) -> list[dict[str, Any]]:
        alerts: list[dict[str, Any]] = []
        for left_index, left in enumerate(SURFACE_MACRO_COLUMNS):
            for right in SURFACE_MACRO_COLUMNS[left_index + 1:]:
                value = correlation_lookup.get((left, right))
                if value is None or abs(value) < 0.95:
                    continue
                alerts.append({
                    "features": [left, right],
                    "correlation": round(float(value), 4),
                    "message": "Surface descriptors are nearly collinear. Use stricter cross-surface validation in downstream modeling.",
                })
        return alerts

    def _pairwise_pearson(self, left_values: list[Any], right_values: list[Any]) -> float | None:
        paired = [
            (float(left), float(right))
            for left, right in zip(left_values, right_values)
            if _safe_float(left) is not None and _safe_float(right) is not None
        ]
        if len(paired) < 3:
            return None
        left_array = np.array([item[0] for item in paired], dtype=float)
        right_array = np.array([item[1] for item in paired], dtype=float)
        if np.std(left_array) == 0 or np.std(right_array) == 0:
            return None
        correlation = float(np.corrcoef(left_array, right_array)[0, 1])
        if math.isnan(correlation) or math.isinf(correlation):
            return None
        return correlation

    def _build_matrix_payload(self, rows: list[dict[str, Any]], *, target_key: str, options: dict[str, Any]) -> dict[str, Any]:
        target_column = target_column_name(target_key)
        keep_features = list(options["feature_config"]["keep_features"])
        total = len(rows)

        process_columns = [PROCESS_FEATURE_LOOKUP[key]["column_name"] for key in keep_features if key in PROCESS_FEATURE_LOOKUP]
        process_coverage = [
            {
                "key": key,
                "label": PROCESS_FEATURE_LOOKUP[key]["label"],
                "group": PROCESS_FEATURE_LOOKUP[key]["group"],
                "available_count": sum(
                    1
                    for row in rows
                    if _safe_float(row.get(PROCESS_FEATURE_LOOKUP[key]["normalized_field"])) is not None
                ),
                "coverage": (
                    sum(1 for row in rows if _safe_float(row.get(PROCESS_FEATURE_LOOKUP[key]["normalized_field"])) is not None) / total
                    if total
                    else 0.0
                ),
            }
            for key in keep_features
            if key in PROCESS_FEATURE_LOOKUP
        ]

        cation_matrix = np.vstack([_fingerprint_from_smiles(row.get("cation_smiles")) for row in rows]) if rows else np.zeros((0, 256), dtype=np.float32)
        anion_matrix = np.vstack([_fingerprint_from_smiles(row.get("anion_smiles")) for row in rows]) if rows else np.zeros((0, 256), dtype=np.float32)
        combined_fingerprint = np.concatenate([cation_matrix, anion_matrix], axis=1) if rows else np.zeros((0, 512), dtype=np.float32)

        feature_coverage: list[dict[str, Any]] = []
        pca_info = {
            "enabled": bool(options["feature_config"]["use_pca"]),
            "requested_components": int(options["feature_config"]["n_components"]),
            "actual_components": 0,
            "explained_variance_ratio": None,
        }
        fingerprint_columns: list[str] = []
        fingerprint_matrix = np.zeros((len(rows), 0), dtype=np.float32)

        if options["feature_config"]["use_pca"]:
            requested_components = int(options["feature_config"]["n_components"])
            if rows:
                actual_components = min(requested_components, combined_fingerprint.shape[0], combined_fingerprint.shape[1])
                actual_components = max(1, actual_components)
                pca = PCA(n_components=actual_components, random_state=42)
                fingerprint_matrix = pca.fit_transform(combined_fingerprint).astype(np.float32)
                pca_info["actual_components"] = actual_components
                pca_info["explained_variance_ratio"] = float(np.sum(pca.explained_variance_ratio_))
            else:
                pca_info["actual_components"] = requested_components
                fingerprint_matrix = np.zeros((0, requested_components), dtype=np.float32)

            fingerprint_columns = [f"PCA_{index + 1}" for index in range(pca_info["actual_components"])]
            feature_coverage.extend(
                {
                    "key": f"fp_pca_{index + 1}",
                    "label": f"FP_PCA_{index + 1}",
                    "group": "Molecular",
                    "available_count": total,
                    "coverage": 1.0 if total else 0.0,
                }
                for index in range(pca_info["actual_components"])
            )
        else:
            cation_count = sum(1 for row in rows if str(row.get("cation_smiles") or "").strip())
            anion_count = sum(1 for row in rows if str(row.get("anion_smiles") or "").strip())
            fingerprint_columns = [f"Cation_FP_{index + 1:03d}" for index in range(cation_matrix.shape[1])]
            fingerprint_columns.extend(f"Anion_FP_{index + 1:03d}" for index in range(anion_matrix.shape[1]))
            fingerprint_matrix = combined_fingerprint
            feature_coverage.extend(
                [
                    {
                        "key": MOLECULAR_FEATURE_DEFINITIONS[0]["key"],
                        "label": MOLECULAR_FEATURE_DEFINITIONS[0]["label"],
                        "group": MOLECULAR_FEATURE_DEFINITIONS[0]["group"],
                        "available_count": cation_count,
                        "coverage": cation_count / total if total else 0.0,
                    },
                    {
                        "key": MOLECULAR_FEATURE_DEFINITIONS[1]["key"],
                        "label": MOLECULAR_FEATURE_DEFINITIONS[1]["label"],
                        "group": MOLECULAR_FEATURE_DEFINITIONS[1]["group"],
                        "available_count": anion_count,
                        "coverage": anion_count / total if total else 0.0,
                    },
                ]
            )

        feature_coverage.extend(process_coverage)
        feature_columns = [*process_columns, *fingerprint_columns]
        matrix_columns = [target_column, *feature_columns]
        matrix_rows = [self._matrix_row(row, target_column, keep_features, process_columns, fingerprint_columns, fingerprint_matrix[index]) for index, row in enumerate(rows)]

        return {
            "target_column": target_column,
            "feature_columns": feature_columns,
            "matrix_columns": matrix_columns,
            "rows": matrix_rows,
            "feature_coverage": feature_coverage,
            "pca_info": pca_info,
        }

    def _matrix_row(
        self,
        row: dict[str, Any],
        target_column: str,
        keep_features: list[str],
        process_columns: list[str],
        fingerprint_columns: list[str],
        fingerprint_values: np.ndarray,
    ) -> dict[str, Any]:
        matrix_row: dict[str, Any] = {
            target_column: self._jsonable_number(row.get("cof_value")),
            "__record_id": row.get("record_id"),
            "__literature_id": row.get("literature_id"),
            "__confidence": self._jsonable_number(row.get("confidence")),
            "__experiment_scale": row.get("experiment_scale"),
            "__experiment_method": row.get("experiment_method"),
            "__measurement_type": row.get("measurement_type"),
            "__training_view": row.get("training_view"),
        }
        for key, column_name in zip(keep_features, process_columns):
            matrix_row[column_name] = self._jsonable_number(row.get(PROCESS_FEATURE_LOOKUP[key]["normalized_field"]))
        for column_name, value in zip(fingerprint_columns, fingerprint_values.tolist()):
            matrix_row[column_name] = self._jsonable_number(value)
        return matrix_row

    def _jsonable_number(self, value: Any) -> float | None:
        numeric = _safe_float(value)
        if numeric is None:
            return None
        return float(numeric)

    def _dataset_to_summary(self, dataset: CleanedDataset) -> dict[str, Any]:
        summary_payload = json.loads(dataset.summary_json)
        return {
            "id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "target_key": dataset.target_key,
            "row_count": dataset.row_count,
            "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
            "source_scope": summary_payload.get("source_scope", {}),
            "summary": summary_payload.get("summary", {}),
            "feature_coverage": summary_payload.get("feature_coverage", []),
            "target": summary_payload.get("target", {}),
            "pca_info": summary_payload.get("pca_info"),
            "matrix_columns": summary_payload.get("matrix_columns", []),
            "feature_columns": summary_payload.get("feature_columns", []),
            "target_column": summary_payload.get("target_column"),
            "dataset_kind": summary_payload.get("dataset_kind", "cleaned_scope"),
            "import_metadata": summary_payload.get("import_metadata"),
        }

_model_cleaning_service: ModelCleaningService | None = None


def get_model_cleaning_service() -> ModelCleaningService:
    global _model_cleaning_service
    if _model_cleaning_service is None:
        _model_cleaning_service = ModelCleaningService()
    return _model_cleaning_service

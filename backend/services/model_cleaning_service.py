from __future__ import annotations

import csv
import io
import json
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import CleanedDataset, TribologyData
from security import AuthPrincipal, RequestScope, ensure_scope_writable, literature_scope_conditions
from services.model_training_service import (
    DEFAULT_CLEANING_OPTIONS,
    FEATURE_DEFINITIONS,
    TARGET_DEFINITIONS,
    _feature_value,
    _safe_float,
)


DEFAULT_CLEANING_WORKBENCH_OPTIONS = {
    **DEFAULT_CLEANING_OPTIONS,
    "missing_value_strategy": "median",
    "remove_target_outliers": False,
    "iqr_multiplier": 1.5,
}

NUMERIC_PREVIEW_FIELDS = [
    ("normalized_temperature_c", "Temperature (C)"),
    ("normalized_speed_mps", "Speed (m/s)"),
    ("normalized_load_n", "Load (N)"),
    ("normalized_potential_v", "Potential (V)"),
    ("normalized_water_content_ppm", "Water Content (ppm)"),
    ("normalized_film_thickness_nm", "Film Thickness (nm)"),
    ("normalized_alkyl_chain_length", "Alkyl Chain Length"),
]

CSV_EXPORT_FIELDS = [
    "record_id",
    "literature_id",
    "material_name",
    "lubricant",
    "cof_value",
    "cation_smiles",
    "anion_smiles",
    "temperature",
    "normalized_temperature_c",
    "speed_value",
    "normalized_speed_mps",
    "load_raw",
    "normalized_load_n",
    "potential",
    "normalized_potential_v",
    "water_content",
    "normalized_water_content_ppm",
    "film_thickness",
    "normalized_film_thickness_nm",
    "alkyl_chain_length",
    "normalized_alkyl_chain_length",
    "confidence",
    "is_target_outlier",
    "repaired_fields",
]


class ModelCleaningService:
    async def preview_cleaning(
        self,
        session: AsyncSession,
        scope_filter_values: dict[str, Any],
        *,
        target_key: str = "cof",
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_options = self._normalize_options(options)
        target = TARGET_DEFINITIONS.get(target_key)
        if not target:
            raise ValueError(f"Unsupported target '{target_key}'.")

        resolved = await self._resolve_source_records(session, scope_filter_values, normalized_options)
        base_rows = [self._serialize_record(record) for record in resolved["records"]]
        cleaned_rows, cleaning_summary = self._clean_rows(base_rows, target_key=target_key, options=normalized_options)

        return {
            "target": {"key": target_key, "label": target["label"]},
            "options": normalized_options,
            "source_scope": resolved["source_scope"],
            "summary": cleaning_summary,
            "feature_coverage": self._feature_coverage(cleaned_rows),
            "rows": cleaned_rows,
            "preview_rows": cleaned_rows[:25],
            "normalization_preview": cleaned_rows[:12],
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
            }, ensure_ascii=False),
            rows_json=json.dumps(rows, ensure_ascii=False),
        )
        session.add(dataset)
        await session.commit()
        await session.refresh(dataset)
        return dataset

    async def list_datasets(self, session: AsyncSession, scope: RequestScope) -> list[dict[str, Any]]:
        stmt = (
            select(CleanedDataset)
            .where(CleanedDataset.group_id == scope.group_id, CleanedDataset.scope_key == scope.scope_key)
            .order_by(CleanedDataset.created_at.desc(), CleanedDataset.id.desc())
        )
        result = await session.execute(stmt)
        datasets = result.scalars().all()
        return [self._dataset_to_summary(item) for item in datasets]

    async def get_dataset(self, session: AsyncSession, dataset_id: int) -> CleanedDataset | None:
        return await session.get(CleanedDataset, dataset_id)

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
            "rows": rows,
            "config": json.loads(dataset.config_json),
        }

    def export_dataset_csv(self, dataset: CleanedDataset) -> str:
        rows = json.loads(dataset.rows_json)
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=CSV_EXPORT_FIELDS)
        writer.writeheader()
        for row in rows:
            export_row = dict(row)
            export_row["repaired_fields"] = ",".join(export_row.get("repaired_fields", []))
            writer.writerow({field: export_row.get(field) for field in CSV_EXPORT_FIELDS})
        return output.getvalue()

    def _normalize_options(self, options: dict[str, Any] | None) -> dict[str, Any]:
        merged = {**DEFAULT_CLEANING_WORKBENCH_OPTIONS, **(options or {})}
        source_mode = str(merged.get("source_mode") or DEFAULT_CLEANING_OPTIONS["source_mode"]).strip().lower()
        if source_mode not in {"current_scope", "group_library", "group_library_fallback"}:
            source_mode = DEFAULT_CLEANING_OPTIONS["source_mode"]
        strategy = str(merged.get("missing_value_strategy") or "median").strip().lower()
        if strategy not in {"keep", "median", "zero"}:
            strategy = "median"
        merged["source_mode"] = source_mode
        merged["missing_value_strategy"] = strategy
        merged["drop_missing_target"] = bool(merged.get("drop_missing_target", True))
        merged["require_dual_smiles"] = bool(merged.get("require_dual_smiles", True))
        merged["remove_target_outliers"] = bool(merged.get("remove_target_outliers", False))
        merged["iqr_multiplier"] = max(0.5, min(5.0, float(merged.get("iqr_multiplier", 1.5) or 1.5)))
        return merged

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
            "confidence": record.confidence,
            "cof_value": record.cof_value,
            "cation_smiles": record.cation_smiles,
            "anion_smiles": record.anion_smiles,
            "temperature": record.temperature,
            "speed_value": record.speed_value,
            "load_value": record.load_value,
            "load_raw": record.load_raw,
            "potential": record.potential,
            "water_content": record.water_content,
            "film_thickness": record.film_thickness,
            "alkyl_chain_length": record.alkyl_chain_length,
            "normalized_temperature_c": _feature_value({
                "normalized_temperature_c": None,
                "temperature": record.temperature,
            }, "temperature"),
            "normalized_speed_mps": _feature_value({
                "normalized_speed_mps": None,
                "speed_value": record.speed_value,
            }, "speed"),
            "normalized_load_n": _feature_value({
                "normalized_load_n": None,
                "load_value": record.load_value,
                "load_raw": record.load_raw,
            }, "load"),
            "normalized_potential_v": _feature_value({
                "normalized_potential_v": None,
                "potential": record.potential,
            }, "potential"),
            "normalized_water_content_ppm": _feature_value({
                "normalized_water_content_ppm": None,
                "water_content": record.water_content,
            }, "water_content"),
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
        return row

    def _clean_rows(self, rows: list[dict[str, Any]], *, target_key: str, options: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        target_def = TARGET_DEFINITIONS[target_key]
        raw_count = len(rows)
        target_ready_rows = [row for row in rows if _safe_float(row.get(target_def["field"])) is not None]
        smiles_ready_rows = [
            row for row in rows if str(row.get("cation_smiles") or "").strip() and str(row.get("anion_smiles") or "").strip()
        ]

        working_rows = [dict(row) for row in rows]
        if options["drop_missing_target"]:
            working_rows = [row for row in working_rows if _safe_float(row.get(target_def["field"])) is not None]
        if options["require_dual_smiles"]:
            working_rows = [
                row for row in working_rows
                if str(row.get("cation_smiles") or "").strip() and str(row.get("anion_smiles") or "").strip()
            ]

        repair_counts = self._apply_missing_value_strategy(working_rows, options["missing_value_strategy"])
        outlier_count = self._flag_outliers(working_rows, target_def["field"], options["iqr_multiplier"])
        if options["remove_target_outliers"]:
            working_rows = [row for row in working_rows if not row.get("is_target_outlier")]

        summary = {
            "raw_records": raw_count,
            "target_ready_records": len(target_ready_rows),
            "chemistry_ready_records": len(smiles_ready_rows),
            "training_ready_records": len(working_rows),
            "missing_value_repairs": repair_counts,
            "outliers_detected": outlier_count,
            "outliers_removed": outlier_count if options["remove_target_outliers"] else 0,
            "dropped_by_reason": {
                "missing_target": sum(1 for row in rows if _safe_float(row.get(target_def["field"])) is None),
                "missing_cation_smiles": sum(1 for row in rows if not str(row.get("cation_smiles") or "").strip()),
                "missing_anion_smiles": sum(1 for row in rows if not str(row.get("anion_smiles") or "").strip()),
            },
            "rules": {
                "drop_missing_target": options["drop_missing_target"],
                "require_dual_smiles": options["require_dual_smiles"],
                "missing_value_strategy": options["missing_value_strategy"],
                "remove_target_outliers": options["remove_target_outliers"],
                "iqr_multiplier": options["iqr_multiplier"],
            },
        }
        return working_rows, summary

    def _apply_missing_value_strategy(self, rows: list[dict[str, Any]], strategy: str) -> dict[str, int]:
        repair_counts = {field: 0 for field, _ in NUMERIC_PREVIEW_FIELDS}
        if strategy == "keep" or not rows:
            return repair_counts

        medians: dict[str, float] = {}
        for field, _label in NUMERIC_PREVIEW_FIELDS:
            values = [_safe_float(row.get(field)) for row in rows]
            usable_values = [value for value in values if value is not None]
            if usable_values:
                medians[field] = float(np.median(usable_values))

        for row in rows:
            for field, _label in NUMERIC_PREVIEW_FIELDS:
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

    def _feature_coverage(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        feature_rows = []
        total = len(rows)
        for feature in FEATURE_DEFINITIONS:
            key = feature["key"]
            if key == "cation_fingerprint":
                available = sum(1 for row in rows if str(row.get("cation_smiles") or "").strip())
            elif key == "anion_fingerprint":
                available = sum(1 for row in rows if str(row.get("anion_smiles") or "").strip())
            else:
                available = sum(1 for row in rows if _safe_float(_feature_value(row, key)) is not None)
            feature_rows.append({
                "key": key,
                "label": feature["label"],
                "group": feature["group"],
                "available_count": available,
                "coverage": available / total if total else 0.0,
            })
        return feature_rows

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
        }

_model_cleaning_service: ModelCleaningService | None = None


def get_model_cleaning_service() -> ModelCleaningService:
    global _model_cleaning_service
    if _model_cleaning_service is None:
        _model_cleaning_service = ModelCleaningService()
    return _model_cleaning_service

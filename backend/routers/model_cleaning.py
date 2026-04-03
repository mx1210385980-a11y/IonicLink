from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from models.db_models import CleanedDataset, Literature, TribologyData
from security import (
    AuthPrincipal,
    RequestScope,
    get_current_principal,
    get_request_scope,
    require_cleaned_dataset_access,
)
from services.model_cleaning_service import DEFAULT_CLEANING_WORKBENCH_OPTIONS, get_model_cleaning_service

router = APIRouter(
    prefix="/api/model-cleaning",
    tags=["Model Cleaning"],
    responses={404: {"description": "Not found"}},
)
logger = logging.getLogger(__name__)


def _raise_internal_error(action: str, exc: Exception) -> None:
    logger.exception("%s failed", action)
    raise HTTPException(status_code=500, detail=f"{action} failed.") from exc


def _imported_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _imported_number_text(value: object, unit: str = "") -> str | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return _imported_text(value)
    text = str(int(numeric)) if numeric.is_integer() else str(numeric)
    return f"{text}{unit}"


def _pick_imported_row_value(row: dict, *keys: str) -> str | None:
    for key in keys:
        if key in row:
            value = _imported_text(row.get(key))
            if value:
                return value
    return None


def _compose_imported_lubricant(cation: str | None, anion: str | None, compound: str | None, row_index: int) -> str:
    il_pair = " ".join(part for part in [cation, anion] if part)
    if compound and compound.lower() != "zero":
        return f"{il_pair} / {compound}" if il_pair else compound
    if il_pair:
        return il_pair
    return f"Imported dataset row {row_index}"


async def _materialize_imported_dataset_records(
    session: AsyncSession,
    *,
    dataset: CleanedDataset,
    principal: AuthPrincipal,
    scope: RequestScope,
) -> tuple[int, int]:
    summary_payload = json.loads(dataset.summary_json or "{}")
    if str(summary_payload.get("dataset_kind") or "").strip().lower() != "imported_csv":
        return 0, 0

    rows = json.loads(dataset.rows_json or "[]")
    if not isinstance(rows, list) or not rows:
        return 0, 0

    target_column = str(summary_payload.get("target_column") or "").strip()
    if not target_column:
        raise ValueError("Imported dataset is missing the target column metadata.")

    import_metadata = summary_payload.get("import_metadata") or {}
    source_filename = str(import_metadata.get("filename") or f"dataset-{dataset.id}.csv").strip()
    synthetic_doi = f"dataset-import:{dataset.id}"
    stmt = select(Literature).where(
        Literature.group_id == scope.group_id,
        Literature.scope_key == scope.scope_key,
        Literature.doi == synthetic_doi,
    )
    literature = (await session.execute(stmt)).scalar_one_or_none()

    if literature is None:
        literature = Literature(
            doi=synthetic_doi,
            title=f"Imported Dataset: {dataset.name}",
            authors="IonicLink Dataset Import",
            journal="Workspace Imported Dataset",
            year=datetime.utcnow().year,
            group_id=scope.group_id,
            workspace_id=scope.workspace.id if scope.workspace else None,
            created_by_user_id=principal.user.id,
            scope_type=scope.scope_type,
            scope_key=scope.scope_key,
            status="completed",
        )
        session.add(literature)
        await session.flush()
    else:
        literature.title = f"Imported Dataset: {dataset.name}"
        literature.authors = "IonicLink Dataset Import"
        literature.journal = "Workspace Imported Dataset"
        literature.year = literature.year or datetime.utcnow().year
        literature.workspace_id = scope.workspace.id if scope.workspace else None
        literature.created_by_user_id = principal.user.id
        literature.scope_type = scope.scope_type
        literature.scope_key = scope.scope_key
        literature.status = "completed"
        await session.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))

    source_label = f"Imported CSV: {source_filename}"
    records: list[TribologyData] = []
    for index, raw_row in enumerate(rows, start=1):
        if not isinstance(raw_row, dict):
            continue
        cof_value = raw_row.get(target_column)
        try:
            cof_numeric = float(cof_value)
        except (TypeError, ValueError):
            continue

        cation = _pick_imported_row_value(raw_row, "Cation", "cation")
        anion = _pick_imported_row_value(raw_row, "anion", "Anion")
        compound = _pick_imported_row_value(raw_row, "compound", "Compound")
        surface = _pick_imported_row_value(raw_row, "surface", "Surface")
        roughness = _pick_imported_row_value(raw_row, "Roughness", "roughness")
        potential = _imported_number_text(raw_row.get("potential/V"), " V")
        speed_value = _imported_number_text(raw_row.get("sliding velocity"))
        temperature = _imported_number_text(raw_row.get("T/K"), " K")
        mol_ratio = _imported_number_text(raw_row.get("mol radio"))
        lubricant = _compose_imported_lubricant(cation, anion, compound, index)
        material_name = surface or compound or f"Imported surface {index}"

        records.append(
            TribologyData(
                literature_id=literature.id,
                material_name=material_name,
                lubricant=lubricant,
                cof_value=cof_numeric,
                cof_raw=_imported_number_text(cof_value),
                speed_value=speed_value,
                temperature=temperature,
                potential=potential,
                substrate_material=surface,
                substrate_roughness=roughness,
                surface_roughness=roughness,
                mol_ratio=mol_ratio,
                cation=cation,
                anion=anion,
                evidence=f"Imported row {index} from {source_filename}",
                source=source_label,
                source_figure=f"Row {index}",
                confidence=1.0,
            )
        )

    session.add_all(records)
    await session.commit()
    return literature.id, len(records)


class FeatureConfigPayload(BaseModel):
    use_pca: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["feature_config"]["use_pca"]
    n_components: int = Field(
        DEFAULT_CLEANING_WORKBENCH_OPTIONS["feature_config"]["n_components"],
        ge=2,
        le=30,
    )
    keep_features: list[str] = Field(default_factory=lambda: list(DEFAULT_CLEANING_WORKBENCH_OPTIONS["feature_config"]["keep_features"]))


class CleaningOptionPayload(BaseModel):
    source_mode: str = DEFAULT_CLEANING_WORKBENCH_OPTIONS["source_mode"]
    drop_missing_target: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["drop_missing_target"]
    require_dual_smiles: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["require_dual_smiles"]
    missing_value_strategy: str = DEFAULT_CLEANING_WORKBENCH_OPTIONS["missing_value_strategy"]
    remove_target_outliers: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["remove_target_outliers"]
    iqr_multiplier: float = Field(DEFAULT_CLEANING_WORKBENCH_OPTIONS["iqr_multiplier"], ge=0.5, le=5.0)
    feature_config: FeatureConfigPayload = Field(default_factory=FeatureConfigPayload)


class SaveCleanedDatasetPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(None, max_length=500)
    target_key: str = "cof"
    cleaning_options: CleaningOptionPayload = Field(default_factory=CleaningOptionPayload)


@router.get("/defaults", response_model=dict)
async def get_cleaning_defaults():
    return {
        "defaults": DEFAULT_CLEANING_WORKBENCH_OPTIONS,
    }


@router.post("/preview", response_model=dict)
async def preview_cleaning(
    payload: CleaningOptionPayload,
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        return await get_model_cleaning_service().preview_cleaning(
            session,
            {
                "group_id": scope.group_id,
                "scope_type": scope.scope_type,
                "scope_key": scope.scope_key,
                "workspace_id": scope.workspace.id if scope.workspace else None,
            },
            target_key="cof",
            options=payload.dict(),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Preview cleaning", exc)


@router.get("/datasets", response_model=dict)
async def list_cleaned_datasets(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        items = await get_model_cleaning_service().list_datasets(session, scope)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("List cleaned datasets", exc)


@router.post("/datasets", response_model=dict)
async def save_cleaned_dataset(
    payload: SaveCleanedDatasetPayload,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        dataset = await get_model_cleaning_service().save_dataset(
            session,
            principal=principal,
            scope=scope,
            name=payload.name,
            description=payload.description,
            target_key=payload.target_key,
            options=payload.cleaning_options.dict(),
        )
        full_dataset = await require_cleaned_dataset_access(session, principal, dataset.id, write=True)
        full_dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, full_dataset)
        return {"dataset": get_model_cleaning_service().dataset_payload(full_dataset)}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Save cleaned dataset", exc)


@router.post("/datasets/import-csv", response_model=dict)
async def import_cleaned_dataset_csv(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str | None = Form(None),
    target_column: str | None = Form(None),
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        raw_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Failed to read uploaded CSV file.") from exc

    csv_text = None
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            csv_text = raw_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if csv_text is None:
        raise HTTPException(status_code=400, detail="The uploaded file is not a supported text CSV encoding.")

    try:
        dataset = await get_model_cleaning_service().import_csv_dataset(
            session,
            principal=principal,
            scope=scope,
            name=name,
            description=description,
            csv_text=csv_text,
            filename=file.filename or "imported.csv",
            target_column=target_column,
        )
        await _materialize_imported_dataset_records(
            session,
            dataset=dataset,
            principal=principal,
            scope=scope,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Import cleaned dataset CSV", exc)

    dataset = await require_cleaned_dataset_access(session, principal, dataset.id, write=True)
    return {"dataset": get_model_cleaning_service().dataset_payload(dataset)}


@router.get("/datasets/{dataset_id}", response_model=dict)
async def get_cleaned_dataset(
    dataset_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        dataset = await require_cleaned_dataset_access(session, principal, dataset_id)
        dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, dataset)
        return {"dataset": get_model_cleaning_service().dataset_payload(dataset)}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get cleaned dataset", exc)


@router.get("/datasets/{dataset_id}/export")
async def export_cleaned_dataset(
    dataset_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        dataset = await require_cleaned_dataset_access(session, principal, dataset_id)
        dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, dataset)
        csv_text = get_model_cleaning_service().export_dataset_csv(dataset)
        filename = f"cleaned-dataset-{dataset.id}.csv"
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Export cleaned dataset", exc)

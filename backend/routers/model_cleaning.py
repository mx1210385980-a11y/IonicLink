from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from models.db_models import CleanedDataset
from security import (
    AuthPrincipal,
    RequestScope,
    get_current_principal,
    get_request_scope,
    require_cleaned_dataset_access,
)
from services.activity_logging_service import log_activity
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
    training_view: str = DEFAULT_CLEANING_WORKBENCH_OPTIONS["training_view"]
    drop_missing_target: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["drop_missing_target"]
    require_dual_smiles: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["require_dual_smiles"]
    require_valid_smiles: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["require_valid_smiles"]
    missing_value_strategy: str = DEFAULT_CLEANING_WORKBENCH_OPTIONS["missing_value_strategy"]
    remove_target_outliers: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["remove_target_outliers"]
    iqr_multiplier: float = Field(DEFAULT_CLEANING_WORKBENCH_OPTIONS["iqr_multiplier"], ge=0.5, le=5.0)
    feature_config: FeatureConfigPayload = Field(default_factory=FeatureConfigPayload)


class SaveCleanedDatasetPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(None, max_length=500)
    target_key: str = "cof"
    cleaning_options: CleaningOptionPayload = Field(default_factory=CleaningOptionPayload)


class UpdateCleanedDatasetPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(None, max_length=500)


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
    request: Request,
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
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="clean_data",
            action_detail={
                "dataset_id": full_dataset.id,
                "dataset_name": full_dataset.name,
                "row_count": full_dataset.row_count,
            },
            resource_type="cleaned_dataset",
            resource_id=full_dataset.id,
            request=request,
        )
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
    request: Request = None,
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Import cleaned dataset CSV", exc)

    dataset = await require_cleaned_dataset_access(session, principal, dataset.id, write=True)
    await log_activity(
        db=session,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="clean_data",
        action_detail={
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "row_count": dataset.row_count,
            "mode": "import_csv",
        },
        resource_type="cleaned_dataset",
        resource_id=dataset.id,
        request=request,
    )
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


@router.patch("/datasets/{dataset_id}", response_model=dict)
async def update_cleaned_dataset(
    dataset_id: int,
    payload: UpdateCleanedDatasetPayload,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        dataset = await require_cleaned_dataset_access(session, principal, dataset_id, write=True)
        dataset = await get_model_cleaning_service().update_dataset_metadata(
            session,
            dataset,
            name=payload.name,
            description=payload.description,
        )
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="edit_dataset",
            action_detail={
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
            },
            resource_type="cleaned_dataset",
            resource_id=dataset.id,
            request=request,
        )
        return {"dataset": get_model_cleaning_service().dataset_payload(dataset)}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Update cleaned dataset", exc)


@router.delete("/datasets/{dataset_id}", response_model=dict)
async def delete_cleaned_dataset(
    dataset_id: int,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        dataset = await require_cleaned_dataset_access(session, principal, dataset_id, write=True)
        dataset_name = dataset.name
        row_count = dataset.row_count
        await get_model_cleaning_service().delete_dataset(session, dataset)
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="delete_dataset",
            action_detail={
                "dataset_id": dataset_id,
                "dataset_name": dataset_name,
                "row_count": row_count,
            },
            resource_type="cleaned_dataset",
            resource_id=dataset_id,
            request=request,
        )
        return {"success": True, "dataset_id": dataset_id}
    except HTTPException:
        raise
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Delete cleaned dataset", exc)


@router.get("/datasets/{dataset_id}/export")
async def export_cleaned_dataset(
    dataset_id: int,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        dataset = await require_cleaned_dataset_access(session, principal, dataset_id)
        dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, dataset)
        csv_text = get_model_cleaning_service().export_dataset_csv(dataset)
        filename = f"cleaned-dataset-{dataset.id}.csv"
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="export_dataset",
            action_detail={
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
                "row_count": dataset.row_count,
                "filename": filename,
            },
            resource_type="cleaned_dataset",
            resource_id=dataset.id,
            request=request,
        )
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Export cleaned dataset", exc)

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
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


class CleaningOptionPayload(BaseModel):
    source_mode: str = DEFAULT_CLEANING_WORKBENCH_OPTIONS["source_mode"]
    drop_missing_target: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["drop_missing_target"]
    require_dual_smiles: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["require_dual_smiles"]
    missing_value_strategy: str = DEFAULT_CLEANING_WORKBENCH_OPTIONS["missing_value_strategy"]
    remove_target_outliers: bool = DEFAULT_CLEANING_WORKBENCH_OPTIONS["remove_target_outliers"]
    iqr_multiplier: float = Field(DEFAULT_CLEANING_WORKBENCH_OPTIONS["iqr_multiplier"], ge=0.5, le=5.0)


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


@router.get("/datasets", response_model=dict)
async def list_cleaned_datasets(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    items = await get_model_cleaning_service().list_datasets(session, scope)
    return {"items": items}


@router.post("/datasets", response_model=dict)
async def save_cleaned_dataset(
    payload: SaveCleanedDatasetPayload,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
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
    return {"dataset": get_model_cleaning_service().dataset_payload(full_dataset)}


@router.get("/datasets/{dataset_id}", response_model=dict)
async def get_cleaned_dataset(
    dataset_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    dataset = await require_cleaned_dataset_access(session, principal, dataset_id)
    return {"dataset": get_model_cleaning_service().dataset_payload(dataset)}


@router.get("/datasets/{dataset_id}/export")
async def export_cleaned_dataset(
    dataset_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    dataset = await require_cleaned_dataset_access(session, principal, dataset_id)
    csv_text = get_model_cleaning_service().export_dataset_csv(dataset)
    filename = f"cleaned-dataset-{dataset.id}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

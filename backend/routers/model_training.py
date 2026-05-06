from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from security import AuthPrincipal, RequestScope, decode_token, get_current_principal, get_request_scope
from security import require_cleaned_dataset_access
from services.activity_logging_service import log_activity
from services.model_cleaning_service import get_model_cleaning_service
from services.model_training_service import (
    DEFAULT_CLEANING_OPTIONS,
    DEFAULT_DATA_OPTIONS,
    DEFAULT_HYPERPARAMETERS,
    target_column_name,
    get_model_training_service,
)

router = APIRouter(
    prefix="/api/model-training",
    tags=["Model Training"],
    responses={404: {"description": "Not found"}},
)
logger = logging.getLogger(__name__)


def _raise_internal_error(action: str, exc: Exception) -> None:
    logger.exception("%s failed", action)
    raise HTTPException(status_code=500, detail=f"{action} failed.") from exc

class HyperparameterPayload(BaseModel):
    n_estimators: int = Field(DEFAULT_HYPERPARAMETERS["n_estimators"], ge=20, le=300)
    learning_rate: float = Field(DEFAULT_HYPERPARAMETERS["learning_rate"], ge=0.01, le=0.3)
    max_depth: int = Field(DEFAULT_HYPERPARAMETERS["max_depth"], ge=1, le=8)
    l2_leaf_reg: float = Field(DEFAULT_HYPERPARAMETERS["l2_leaf_reg"], ge=0.0, le=20.0)
    random_strength: float = Field(DEFAULT_HYPERPARAMETERS["random_strength"], ge=0.0, le=10.0)


class DataOptionPayload(BaseModel):
    validation_split: float = Field(DEFAULT_DATA_OPTIONS["validation_split"], ge=0.1, le=0.4)
    min_confidence: float = Field(DEFAULT_DATA_OPTIONS["min_confidence"], ge=0.0, le=1.0)
    max_records: int | None = Field(DEFAULT_DATA_OPTIONS["max_records"], ge=10, le=500)
    random_seed: int = Field(DEFAULT_DATA_OPTIONS["random_seed"], ge=1, le=9999)
    split_strategy: str = DEFAULT_DATA_OPTIONS["split_strategy"]
    cv_folds: int = Field(DEFAULT_DATA_OPTIONS["cv_folds"], ge=3, le=8)


class CleaningOptionPayload(BaseModel):
    source_mode: str = DEFAULT_CLEANING_OPTIONS["source_mode"]
    training_view: str = DEFAULT_CLEANING_OPTIONS["training_view"]
    drop_missing_target: bool = DEFAULT_CLEANING_OPTIONS["drop_missing_target"]
    require_dual_smiles: bool = DEFAULT_CLEANING_OPTIONS["require_dual_smiles"]


class TrainingStartPayload(BaseModel):
    target: str = target_column_name("cof")
    algorithm: str = "gradient_boosting"
    hyperparameters: HyperparameterPayload = Field(default_factory=HyperparameterPayload)
    data_options: DataOptionPayload = Field(default_factory=DataOptionPayload)
    cleaned_dataset_id: int | None = None
    tune: bool = False  # 启用后会先做超参数网格搜索，再用最佳参数训练


class RegisterModelPayload(BaseModel):
    name: str | None = None
    description: str | None = None
    is_recommended: bool = False


class ModelPredictionPayload(BaseModel):
    cleaned_dataset_id: int


@router.get("/summary", response_model=dict)
async def get_training_summary(
    cleaned_dataset_id: int | None = Query(None),
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        scope_filter_values = {
            "group_id": scope.group_id,
            "scope_type": scope.scope_type,
            "scope_key": scope.scope_key,
            "workspace_id": scope.workspace.id if scope.workspace else None,
        }
        if cleaned_dataset_id is not None:
            dataset = await require_cleaned_dataset_access(session, principal, cleaned_dataset_id)
            dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, dataset)
            return get_model_training_service().summarize_saved_dataset(dataset)
        return await get_model_training_service().summarize_scope(
            session,
            scope_filter_values=scope_filter_values,
            cleaning_options=DEFAULT_CLEANING_OPTIONS,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Get training summary", exc)


@router.post("/cleaning/summary", response_model=dict)
async def get_cleaning_summary(
    payload: CleaningOptionPayload,
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        scope_filter_values = {
            "group_id": scope.group_id,
            "scope_type": scope.scope_type,
            "scope_key": scope.scope_key,
            "workspace_id": scope.workspace.id if scope.workspace else None,
        }
        return await get_model_training_service().summarize_scope(
            session,
            scope_filter_values=scope_filter_values,
            cleaning_options=payload.dict(),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Get cleaning summary", exc)


@router.post("/preview", response_model=dict)
async def preview_training_plan(
    payload: TrainingStartPayload,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        if payload.cleaned_dataset_id is None:
            raise HTTPException(status_code=400, detail="Select a saved cleaned dataset before previewing training.")
        saved_dataset = await require_cleaned_dataset_access(session, principal, payload.cleaned_dataset_id)
        saved_dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, saved_dataset)
        return get_model_training_service().preview_saved_training_plan(saved_dataset, payload.dict())
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Preview training plan", exc)


@router.post("/start", response_model=dict)
async def start_training(
    payload: TrainingStartPayload,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        saved_dataset = None
        if payload.cleaned_dataset_id is None:
            raise HTTPException(status_code=400, detail="Select a saved cleaned dataset before starting training.")
        saved_dataset = await require_cleaned_dataset_access(session, principal, payload.cleaned_dataset_id)
        saved_dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, saved_dataset)
        task = await get_model_training_service().create_training_task(
            session,
            scope_filter_values={
                "group_id": scope.group_id,
                "scope_type": scope.scope_type,
                "scope_key": scope.scope_key,
                "workspace_id": scope.workspace.id if scope.workspace else None,
            },
            owner_user_id=principal.user.id,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
            config=payload.dict(),
            saved_dataset=saved_dataset,
        )

        # 记录模型训练活动
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="train_model",
            action_detail={
                "task_id": task.task_id,
                "target": payload.target,
                "algorithm": payload.algorithm,
                "cleaned_dataset_id": payload.cleaned_dataset_id,
            },
            resource_type="model_training",
            request=request,
        )

        return {"task": task.snapshot(include_history=True)}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Start training", exc)


@router.get("/tasks/{task_id}", response_model=dict)
async def get_training_task(
    task_id: str,
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        task = get_model_training_service().get_task(task_id, principal.user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training task not found.") from exc
    except Exception as exc:
        _raise_internal_error("Get training task", exc)
    return {"task": task.snapshot(include_history=True)}


@router.get("/runs", response_model=dict)
async def list_training_runs(
    limit: int = Query(12, ge=1, le=50),
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        items = await get_model_training_service().list_runs(
            session,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
            limit=limit,
        )
        return {"items": items}
    except Exception as exc:
        _raise_internal_error("List training runs", exc)


@router.get("/runs/{task_id}", response_model=dict)
async def get_training_run(
    task_id: str,
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        task = await get_model_training_service().get_run(
            session,
            task_id=task_id,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
        )
        if task is None:
            raise HTTPException(status_code=404, detail="Training run not found.")
        return {"task": task}
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get training run", exc)


@router.post("/runs/{task_id}/register", response_model=dict)
async def register_training_run(
    task_id: str,
    payload: RegisterModelPayload,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        item = await get_model_training_service().register_run(
            session,
            task_id=task_id,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
            owner_user_id=principal.user.id,
            workspace_id=scope.workspace.id if scope.workspace else None,
            scope_type=scope.scope_type,
            name=payload.name,
            description=payload.description,
            is_recommended=payload.is_recommended,
        )
        return {"model": item}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training run not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Register training run", exc)


@router.get("/registry", response_model=dict)
async def list_registered_models(
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        items = await get_model_training_service().list_registered_models(
            session,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
        )
        return {"items": items}
    except Exception as exc:
        _raise_internal_error("List registered models", exc)


@router.delete("/registry/{registry_id}", response_model=dict)
async def delete_registered_model(
    registry_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        await get_model_training_service().delete_registered_model(
            session,
            registry_id=registry_id,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
        )
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Registered model not found.") from exc
    except Exception as exc:
        _raise_internal_error("Delete registered model", exc)


@router.post("/registry/{registry_id}/recommend", response_model=dict)
async def set_recommended_registered_model(
    registry_id: int,
    recommended: bool = Query(True),
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        item = await get_model_training_service().set_recommended_registered_model(
            session,
            registry_id=registry_id,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
            recommended=recommended,
        )
        return {"model": item}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Registered model not found.") from exc
    except Exception as exc:
        _raise_internal_error("Set recommended registered model", exc)


@router.post("/registry/{registry_id}/predict", response_model=dict)
async def predict_with_registered_model(
    registry_id: int,
    payload: ModelPredictionPayload,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        target_dataset = await require_cleaned_dataset_access(session, principal, payload.cleaned_dataset_id)
        target_dataset = await get_model_cleaning_service().upgrade_dataset_if_needed(session, target_dataset)
        result = await get_model_training_service().predict_with_registered_model(
            session,
            registry_id=registry_id,
            group_id=principal.group.id,
            scope_key=scope.scope_key,
            target_dataset=target_dataset,
        )
        return {"prediction": result}
    except HTTPException:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Registered model not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Predict with registered model", exc)


@router.post("/tasks/{task_id}/cancel", response_model=dict)
async def cancel_training_task(
    task_id: str,
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        task = get_model_training_service().cancel_task(task_id, principal.user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training task not found.") from exc
    except Exception as exc:
        _raise_internal_error("Cancel training task", exc)
    return {"task": task.snapshot(include_history=True)}


@router.websocket("/ws/{task_id}")
async def training_websocket(
    websocket: WebSocket,
    task_id: str,
    token: str = Query(...),
):
    try:
        payload = decode_token(token)
        requester_user_id = int(payload.get("sub") or 0)
    except Exception:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    try:
        task, queue = get_model_training_service().register_subscriber(task_id, requester_user_id)
    except KeyError:
        await websocket.close(code=4404, reason="Training task not found")
        return

    await websocket.accept()
    await websocket.send_json({"type": "task.snapshot", "task": task.snapshot(include_history=True)})

    terminal_event_types = {"task.completed", "task.failed", "task.cancelled"}

    try:
        while True:
            if task.status in {"completed", "failed", "cancelled"} and queue.empty():
                break
            event = await queue.get()
            await websocket.send_json(event)
            if event.get("type") in terminal_event_types:
                break
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        get_model_training_service().unregister_subscriber(task, queue)

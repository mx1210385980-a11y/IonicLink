from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from security import AuthPrincipal, RequestScope, decode_token, get_current_principal, get_request_scope
from services.model_training_service import (
    DEFAULT_DATA_OPTIONS,
    DEFAULT_FEATURE_SELECTION,
    DEFAULT_HYPERPARAMETERS,
    get_model_training_service,
)

router = APIRouter(
    prefix="/api/model-training",
    tags=["Model Training"],
    responses={404: {"description": "Not found"}},
)


class FeatureSelectionPayload(BaseModel):
    cation_fingerprint: bool = DEFAULT_FEATURE_SELECTION["cation_fingerprint"]
    anion_fingerprint: bool = DEFAULT_FEATURE_SELECTION["anion_fingerprint"]
    temperature: bool = DEFAULT_FEATURE_SELECTION["temperature"]
    speed: bool = DEFAULT_FEATURE_SELECTION["speed"]
    load: bool = DEFAULT_FEATURE_SELECTION["load"]
    potential: bool = DEFAULT_FEATURE_SELECTION["potential"]
    water_content: bool = DEFAULT_FEATURE_SELECTION["water_content"]
    film_thickness: bool = DEFAULT_FEATURE_SELECTION["film_thickness"]
    alkyl_chain_length: bool = DEFAULT_FEATURE_SELECTION["alkyl_chain_length"]


class HyperparameterPayload(BaseModel):
    n_estimators: int = Field(DEFAULT_HYPERPARAMETERS["n_estimators"], ge=20, le=300)
    learning_rate: float = Field(DEFAULT_HYPERPARAMETERS["learning_rate"], ge=0.01, le=0.3)
    max_depth: int = Field(DEFAULT_HYPERPARAMETERS["max_depth"], ge=1, le=8)


class DataOptionPayload(BaseModel):
    validation_split: float = Field(DEFAULT_DATA_OPTIONS["validation_split"], ge=0.1, le=0.4)
    min_confidence: float = Field(DEFAULT_DATA_OPTIONS["min_confidence"], ge=0.0, le=1.0)
    max_records: int | None = Field(DEFAULT_DATA_OPTIONS["max_records"], ge=10, le=500)
    random_seed: int = Field(DEFAULT_DATA_OPTIONS["random_seed"], ge=1, le=9999)


class TrainingStartPayload(BaseModel):
    target: str = "cof"
    algorithm: str = "gradient_boosting"
    features: FeatureSelectionPayload = Field(default_factory=FeatureSelectionPayload)
    hyperparameters: HyperparameterPayload = Field(default_factory=HyperparameterPayload)
    data_options: DataOptionPayload = Field(default_factory=DataOptionPayload)


@router.get("/summary", response_model=dict)
async def get_training_summary(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    return await get_model_training_service().summarize_scope(session, scope_filter_values={
        "group_id": scope.group_id,
        "scope_type": scope.scope_type,
        "scope_key": scope.scope_key,
        "workspace_id": scope.workspace.id if scope.workspace else None,
    })


@router.post("/start", response_model=dict)
async def start_training(
    payload: TrainingStartPayload,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
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
    )
    return {"task": task.snapshot(include_history=True)}


@router.get("/tasks/{task_id}", response_model=dict)
async def get_training_task(
    task_id: str,
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        task = get_model_training_service().get_task(task_id, principal.user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training task not found.") from exc
    return {"task": task.snapshot(include_history=True)}


@router.post("/tasks/{task_id}/cancel", response_model=dict)
async def cancel_training_task(
    task_id: str,
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        task = get_model_training_service().cancel_task(task_id, principal.user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training task not found.") from exc
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

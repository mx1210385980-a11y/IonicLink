from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db_session
from models.db_models import User
from security import (
    ALL_ROLES,
    AuthPrincipal,
    ROLE_GROUP_ADMIN,
    ROLE_PRINCIPAL_INVESTIGATOR,
    create_access_token,
    ensure_personal_workspace,
    get_current_principal,
    group_library_scope_summary,
    hash_password,
    is_admin,
    list_accessible_workspaces,
    scope_summary_from_workspace,
    verify_password,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=80)
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=120, alias="displayName")
    role: str = Field("researcher")

    class Config:
        populate_by_name = True


def _user_payload(principal: AuthPrincipal, workspaces: list[Any]) -> dict[str, Any]:
    available_scopes = [scope_summary_from_workspace(principal, workspace) for workspace in workspaces]
    available_scopes.append(group_library_scope_summary(principal))
    personal_workspace_id = principal.personal_workspace.id if principal.personal_workspace else None

    return {
        "id": principal.user.id,
        "username": principal.user.username,
        "displayName": principal.user.display_name,
        "role": principal.user.role,
        "group": {
            "id": principal.group.id,
            "name": principal.group.name,
            "slug": principal.group.slug,
        },
        "personalWorkspaceId": personal_workspace_id,
        "availableScopes": available_scopes,
    }


def _assert_admin(principal: AuthPrincipal) -> None:
    if principal.user.role not in {ROLE_PRINCIPAL_INVESTIGATOR, ROLE_GROUP_ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")


@router.post("/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db_session)):
    stmt = (
        select(User)
        .options(selectinload(User.group), selectinload(User.workspaces))
        .where(User.username == payload.username)
    )
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.group:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not attached to a research group")

    personal_workspace = next((workspace for workspace in user.workspaces if workspace.is_personal), None)
    principal = AuthPrincipal(user=user, group=user.group, personal_workspace=personal_workspace)
    workspaces = await list_accessible_workspaces(db, principal)
    return {
        "accessToken": create_access_token(user),
        "tokenType": "bearer",
        "user": _user_payload(principal, workspaces),
    }


@router.get("/me")
async def me(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    workspaces = await list_accessible_workspaces(db, principal)
    return _user_payload(principal, workspaces)


@router.get("/users")
async def list_users(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    _assert_admin(principal)
    stmt = (
        select(User)
        .where(User.group_id == principal.group.id)
        .order_by(User.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": user.id,
                "username": user.username,
                "displayName": user.display_name,
                "role": user.role,
                "isActive": user.is_active,
                "createdAt": user.created_at,
            }
            for user in rows
        ]
    }


@router.post("/users")
async def create_user(
    payload: CreateUserRequest,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    _assert_admin(principal)

    role = str(payload.role or "").strip()
    if role not in ALL_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    existing = (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = User(
        username=payload.username.strip(),
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        role=role,
        group_id=principal.group.id,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    workspace = await ensure_personal_workspace(db, user)
    await db.commit()
    await db.refresh(user)

    return {
        "success": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
            "role": user.role,
            "workspaceId": workspace.id,
        },
    }

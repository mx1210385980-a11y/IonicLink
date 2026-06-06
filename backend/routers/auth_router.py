from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db_session
from models.db_models import ResearchGroup, User
from security import (
    ALL_ROLES,
    AuthPrincipal,
    DEFAULT_GROUP_NAME,
    DEFAULT_GROUP_SLUG,
    DEFAULT_PUBLIC_DISPLAY_NAME,
    DEFAULT_PUBLIC_USERNAME,
    ROLE_GROUP_ADMIN,
    ROLE_PRINCIPAL_INVESTIGATOR,
    ROLE_RESEARCHER,
    ROLE_WORKSPACE_RESEARCHER,
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
from services.activity_logging_service import log_activity


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


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=120, alias="displayName")
    role: str | None = None

    class Config:
        populate_by_name = True


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128, alias="newPassword")

    class Config:
        populate_by_name = True


def _user_payload(principal: AuthPrincipal, _workspaces: list[Any]) -> dict[str, Any]:
    available_scopes = []
    if principal.user.role != ROLE_WORKSPACE_RESEARCHER:
        available_scopes.append(group_library_scope_summary(principal))

    seen_scope_keys = {scope["key"] for scope in available_scopes}
    for workspace in _workspaces:
        scope_summary = scope_summary_from_workspace(principal, workspace)
        if scope_summary["key"] in seen_scope_keys:
            continue
        available_scopes.append(scope_summary)
        seen_scope_keys.add(scope_summary["key"])

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
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db_session)):
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

    # 记录登录活动
    await log_activity(
        db=db,
        user_id=user.id,
        group_id=user.group_id,
        action_type="login",
        request=request,
    )

    return {
        "accessToken": create_access_token(user),
        "tokenType": "bearer",
        "user": _user_payload(principal, workspaces),
    }


@router.post("/public-session")
async def public_session(db: AsyncSession = Depends(get_db_session)):
    group = (
        await db.execute(select(ResearchGroup).where(ResearchGroup.slug == DEFAULT_GROUP_SLUG))
    ).scalar_one_or_none()
    if not group:
        group = ResearchGroup(name=DEFAULT_GROUP_NAME, slug=DEFAULT_GROUP_SLUG)
        db.add(group)
        await db.flush()

    stmt = (
        select(User)
        .options(selectinload(User.group), selectinload(User.workspaces))
        .where(User.username == DEFAULT_PUBLIC_USERNAME)
    )
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user:
        user = User(
            username=DEFAULT_PUBLIC_USERNAME,
            display_name=DEFAULT_PUBLIC_DISPLAY_NAME,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            role=ROLE_RESEARCHER,
            is_active=True,
            group_id=group.id,
        )
        db.add(user)
        await db.flush()
    else:
        user.display_name = DEFAULT_PUBLIC_DISPLAY_NAME
        user.role = ROLE_RESEARCHER
        user.is_active = True
        user.group_id = group.id

    workspace = await ensure_personal_workspace(
        db,
        user,
        name="Public Extraction Workspace",
        description="Shared workspace for no-login extraction sessions",
    )
    await db.commit()

    await db.refresh(user, attribute_names=["group", "workspaces"])
    personal_workspace = next((item for item in user.workspaces if item.is_personal), workspace)
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


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """更新用户信息（显示名、角色）"""
    _assert_admin(principal)

    # 查找用户
    stmt = select(User).where(User.id == user_id, User.group_id == principal.group.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # 不能修改自己的角色
    if user.id == principal.user.id and payload.role and payload.role != user.role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")

    # 更新字段
    if payload.display_name:
        user.display_name = payload.display_name.strip()

    if payload.role:
        if payload.role not in ALL_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
        user.role = payload.role

    await db.commit()
    await db.refresh(user)

    return {
        "success": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
            "role": user.role,
            "isActive": user.is_active,
        },
    }


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """删除用户"""
    _assert_admin(principal)

    # 不能删除自己
    if user_id == principal.user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")

    # 查找用户
    stmt = select(User).where(User.id == user_id, User.group_id == principal.group.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    await db.delete(user)
    await db.commit()

    return {"success": True, "message": f"User {user.username} deleted"}


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """重置用户密码"""
    _assert_admin(principal)

    # 查找用户
    stmt = select(User).where(User.id == user_id, User.group_id == principal.group.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.password_hash = hash_password(payload.new_password)
    await db.commit()

    return {"success": True, "message": f"Password reset for {user.username}"}


@router.post("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: int,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """启用/禁用用户账户"""
    _assert_admin(principal)

    # 不能禁用自己
    if user_id == principal.user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot disable yourself")

    # 查找用户
    stmt = select(User).where(User.id == user_id, User.group_id == principal.group.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_active = not user.is_active
    await db.commit()
    await db.refresh(user)

    return {
        "success": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "isActive": user.is_active,
        },
        "message": f"User {user.username} {'enabled' if user.is_active else 'disabled'}",
    }

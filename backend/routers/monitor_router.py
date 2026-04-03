"""
监控API路由

提供用户活动监控、使用统计等功能，仅管理员可访问
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from security import AuthPrincipal, get_current_principal, is_admin
from services.activity_logging_service import (
    ACTION_TYPES,
    get_all_users_statistics,
    get_group_activity_summary,
    get_user_activity_summary,
    get_user_activity_timeline,
)

router = APIRouter(prefix="/api/monitor", tags=["monitoring"])


def _assert_admin(principal: AuthPrincipal) -> None:
    """检查管理员权限"""
    if not is_admin(principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin permission required"
        )


class UserUsageStatsResponse(BaseModel):
    """用户使用统计响应"""
    user_id: int
    username: str
    display_name: str
    role: str
    is_active: bool
    created_at: Optional[str]
    login_count: int
    upload_count: int
    extraction_count: int
    record_view_count: int
    record_edit_count: int
    sync_count: int
    model_training_count: int
    total_activities: int
    last_activity_at: Optional[str]


class ActivityLogEntryResponse(BaseModel):
    """活动日志条目响应"""
    id: int
    action_type: str
    action_label: str
    action_detail: Optional[dict]
    resource_type: Optional[str]
    resource_id: Optional[int]
    ip_address: Optional[str]
    created_at: Optional[str]


@router.get("/users")
async def get_monitor_users(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取研究组内所有用户的使用统计

    仅管理员可访问
    """
    _assert_admin(principal)

    users_stats = await get_all_users_statistics(db, principal.group.id)

    return {"items": users_stats}


@router.get("/users/{user_id}/stats")
async def get_user_stats(
    user_id: int,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取单个用户的详细统计

    仅管理员可访问
    """
    _assert_admin(principal)

    stats = await get_user_activity_summary(db, user_id)

    return stats


@router.get("/users/{user_id}/timeline")
async def get_user_timeline(
    user_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取用户活动时间线（分页）

    仅管理员可访问
    """
    _assert_admin(principal)

    timeline = await get_user_activity_timeline(db, user_id, skip, limit)

    return timeline


@router.get("/summary")
async def get_group_summary(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
):
    """
    获取研究组整体活动统计

    仅管理员可访问
    """
    _assert_admin(principal)

    summary = await get_group_activity_summary(db, principal.group.id)

    return summary


@router.get("/action-types")
async def get_action_types(
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    获取所有可用的操作类型定义

    仅管理员可访问
    """
    _assert_admin(principal)

    return {
        "action_types": [
            {"key": key, "label": label}
            for key, label in ACTION_TYPES.items()
        ]
    }

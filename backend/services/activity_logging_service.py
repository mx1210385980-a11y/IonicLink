"""
用户活动日志服务

记录用户操作并提供统计查询功能，用于Monitor页面展示
"""

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Request
from sqlalchemy import func, select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import UserActivityLog, User


# 操作类型定义
ACTION_TYPES = {
    "login": "用户登录",
    "logout": "用户登出",
    "upload_pdf": "上传PDF文件",
    "extract_data": "数据提取",
    "view_record": "查看记录",
    "edit_record": "编辑记录",
    "delete_record": "删除记录",
    "sync_data": "同步数据",
    "train_model": "模型训练",
    "clean_data": "数据清洗",
    "export_dataset": "导出数据集",
    "view_dashboard": "访问仪表板",
    "view_literature": "查看文献",
    "create_user": "创建用户",
    "update_user": "更新用户",
    "delete_user": "删除用户",
}


async def log_activity(
    db: AsyncSession,
    user_id: int,
    group_id: int,
    action_type: str,
    action_detail: Optional[Dict[str, Any]] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    request: Optional[Request] = None,
) -> UserActivityLog:
    """
    记录用户活动

    Args:
        db: 数据库会话
        user_id: 用户ID
        group_id: 研究组ID
        action_type: 操作类型
        action_detail: 操作详情（字典，会被序列化为JSON）
        resource_type: 资源类型
        resource_id: 资源ID
        request: FastAPI请求对象，用于获取IP和User-Agent
    """
    ip_address = None
    user_agent = None

    if request:
        # 获取真实IP（考虑代理）
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            ip_address = forwarded.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else None

        user_agent = request.headers.get("User-Agent", "")[:500]

    log_entry = UserActivityLog(
        user_id=user_id,
        group_id=group_id,
        action_type=action_type,
        action_detail=json.dumps(action_detail) if action_detail else None,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    db.add(log_entry)
    await db.commit()
    await db.refresh(log_entry)

    return log_entry


async def get_user_activity_summary(
    db: AsyncSession,
    user_id: int,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    获取单个用户的活动统计

    Returns:
        包含各类操作统计的字典
    """
    conditions = [UserActivityLog.user_id == user_id]

    if start_date:
        conditions.append(UserActivityLog.created_at >= start_date)
    if end_date:
        conditions.append(UserActivityLog.created_at <= end_date)

    # 统计各类操作次数
    stmt = select(
        UserActivityLog.action_type,
        func.count(UserActivityLog.id).label("count")
    ).where(
        and_(*conditions)
    ).group_by(
        UserActivityLog.action_type
    )

    result = await db.execute(stmt)
    counts = {row.action_type: row.count for row in result.all()}

    # 获取最后活动时间
    last_activity_stmt = select(
        func.max(UserActivityLog.created_at)
    ).where(
        UserActivityLog.user_id == user_id
    )
    last_activity_result = await db.execute(last_activity_stmt)
    last_activity_at = last_activity_result.scalar()

    return {
        "login_count": counts.get("login", 0),
        "upload_count": counts.get("upload_pdf", 0),
        "extraction_count": counts.get("extract_data", 0),
        "record_view_count": counts.get("view_record", 0),
        "record_edit_count": counts.get("edit_record", 0),
        "sync_count": counts.get("sync_data", 0),
        "model_training_count": counts.get("train_model", 0),
        "total_activities": sum(counts.values()),
        "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
    }


async def get_all_users_statistics(
    db: AsyncSession,
    group_id: int,
) -> List[Dict[str, Any]]:
    """
    获取研究组内所有用户的使用统计

    Returns:
        用户统计列表
    """
    # 获取组内所有用户
    users_stmt = select(User).where(User.group_id == group_id)
    users_result = await db.execute(users_stmt)
    users = users_result.scalars().all()

    result = []
    for user in users:
        # 获取用户的活动统计
        stats = await get_user_activity_summary(db, user.id)

        result.append({
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            **stats,
        })

    # 按总活动数排序
    result.sort(key=lambda x: x["total_activities"], reverse=True)

    return result


async def get_user_activity_timeline(
    db: AsyncSession,
    user_id: int,
    skip: int = 0,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    获取用户活动时间线（分页）

    Returns:
        包含活动列表和总数的字典
    """
    # 获取总数
    count_stmt = select(func.count(UserActivityLog.id)).where(
        UserActivityLog.user_id == user_id
    )
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    # 获取分页数据
    stmt = select(UserActivityLog).where(
        UserActivityLog.user_id == user_id
    ).order_by(
        desc(UserActivityLog.created_at)
    ).offset(skip).limit(limit)

    result = await db.execute(stmt)
    logs = result.scalars().all()

    items = []
    for log in logs:
        items.append({
            "id": log.id,
            "action_type": log.action_type,
            "action_label": ACTION_TYPES.get(log.action_type, log.action_type),
            "action_detail": json.loads(log.action_detail) if log.action_detail else None,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "ip_address": log.ip_address,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        })

    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


async def get_group_activity_summary(
    db: AsyncSession,
    group_id: int,
) -> Dict[str, Any]:
    """
    获取研究组整体活动统计

    Returns:
        包含组级统计的字典
    """
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    # 总用户数
    user_count_stmt = select(func.count(User.id)).where(User.group_id == group_id)
    user_count_result = await db.execute(user_count_stmt)
    total_users = user_count_result.scalar() or 0

    # 今日活跃用户
    today_active_stmt = select(
        func.count(func.distinct(UserActivityLog.user_id))
    ).where(
        and_(
            UserActivityLog.group_id == group_id,
            UserActivityLog.created_at >= today_start
        )
    )
    today_active_result = await db.execute(today_active_stmt)
    active_users_today = today_active_result.scalar() or 0

    # 本周活跃用户
    week_active_stmt = select(
        func.count(func.distinct(UserActivityLog.user_id))
    ).where(
        and_(
            UserActivityLog.group_id == group_id,
            UserActivityLog.created_at >= week_start
        )
    )
    week_active_result = await db.execute(week_active_stmt)
    active_users_week = week_active_result.scalar() or 0

    # 各类操作总数
    action_counts_stmt = select(
        UserActivityLog.action_type,
        func.count(UserActivityLog.id).label("count")
    ).where(
        UserActivityLog.group_id == group_id
    ).group_by(
        UserActivityLog.action_type
    )
    action_counts_result = await db.execute(action_counts_stmt)
    action_counts = {row.action_type: row.count for row in action_counts_result.all()}

    # 过去7天每天的活动数
    activity_by_day = []
    for i in range(7):
        day_start = today_start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)

        day_count_stmt = select(
            func.count(UserActivityLog.id)
        ).where(
            and_(
                UserActivityLog.group_id == group_id,
                UserActivityLog.created_at >= day_start,
                UserActivityLog.created_at < day_end
            )
        )
        day_count_result = await db.execute(day_count_stmt)
        day_count = day_count_result.scalar() or 0

        activity_by_day.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "count": day_count,
        })

    activity_by_day.reverse()  # 按时间正序

    return {
        "total_users": total_users,
        "active_users_today": active_users_today,
        "active_users_week": active_users_week,
        "total_uploads": action_counts.get("upload_pdf", 0),
        "total_extractions": action_counts.get("extract_data", 0),
        "total_records_viewed": action_counts.get("view_record", 0),
        "total_model_trainings": action_counts.get("train_model", 0),
        "activity_by_day": activity_by_day,
    }

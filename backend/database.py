"""Async database configuration for IonicLink."""

from __future__ import annotations

import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from services.migration_service import CURRENT_SCHEMA_REVISION, format_schema_error, inspect_schema, repair_schema, stamp_schema_revision

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'ioniclink.db')}"

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def _ensure_bootstrap_security_state() -> None:
    from sqlalchemy import select

    from models.db_models import Literature, ResearchGroup, User
    from security import (
        DEFAULT_ADMIN_DISPLAY_NAME,
        DEFAULT_ADMIN_PASSWORD,
        DEFAULT_ADMIN_USERNAME,
        DEFAULT_GROUP_NAME,
        DEFAULT_GROUP_SLUG,
        ROLE_PRINCIPAL_INVESTIGATOR,
        build_scope_key,
        ensure_personal_workspace,
        hash_password,
    )

    async with async_session_maker() as session:
        group = (
            await session.execute(select(ResearchGroup).where(ResearchGroup.slug == DEFAULT_GROUP_SLUG))
        ).scalar_one_or_none()
        if not group:
            group = ResearchGroup(name=DEFAULT_GROUP_NAME, slug=DEFAULT_GROUP_SLUG)
            session.add(group)
            await session.flush()

        admin = (
            await session.execute(select(User).where(User.username == DEFAULT_ADMIN_USERNAME))
        ).scalar_one_or_none()
        if not admin:
            admin = User(
                username=DEFAULT_ADMIN_USERNAME,
                display_name=DEFAULT_ADMIN_DISPLAY_NAME,
                password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
                role=ROLE_PRINCIPAL_INVESTIGATOR,
                is_active=True,
                group_id=group.id,
            )
            session.add(admin)
            await session.flush()
        elif not admin.group_id:
            admin.group_id = group.id

        workspace = await ensure_personal_workspace(session, admin)
        await session.flush()

        await session.execute(
            text(
                """
                UPDATE literature
                SET
                    group_id = COALESCE(group_id, :group_id),
                    created_by_user_id = COALESCE(created_by_user_id, :user_id),
                    scope_type = CASE
                        WHEN workspace_id IS NULL THEN COALESCE(scope_type, 'group_library')
                        ELSE 'workspace'
                    END,
                    scope_key = CASE
                        WHEN workspace_id IS NULL THEN 'group_library'
                        ELSE 'workspace:' || workspace_id
                    END
                WHERE group_id IS NULL OR created_by_user_id IS NULL OR scope_key IS NULL OR scope_key = ''
                """
            ),
            {"group_id": group.id, "user_id": admin.id},
        )
        await session.execute(
            text(
                """
                UPDATE literature
                SET scope_key = :scope_key
                WHERE scope_type = 'group_library' AND (scope_key IS NULL OR scope_key = '')
                """
            ),
            {"scope_key": build_scope_key("group_library")},
        )
        await session.commit()


async def init_db():
    """Initialize database connection and verify schema state."""
    async with engine.begin() as conn:
        from models.db_models import (
            DiffusionCandidate,
            DiffusionFeatureSet,
            DiffusionRecord,
            ExtractionCandidate,
            ExtractionRun,
            Literature,
            ModelTrainingRun,
            RegisteredModel,
            ResearchGroup,
            TribologyData,
            User,
            Workspace,
        )
        schema_state = await inspect_schema(conn, Base.metadata)
        existing_tables = [name for name in schema_state["table_names"] if name != "alembic_version"]

        if not existing_tables:
            await conn.run_sync(Base.metadata.create_all)
            await stamp_schema_revision(conn, CURRENT_SCHEMA_REVISION)
        else:
            if schema_state["missing_tables"] or schema_state["missing_columns"]:
                await repair_schema(conn, Base.metadata, schema_state)
                schema_state = await inspect_schema(conn, Base.metadata)
                if schema_state["missing_tables"] or schema_state["missing_columns"]:
                    raise RuntimeError(format_schema_error(schema_state))
            if schema_state.get("revision") != CURRENT_SCHEMA_REVISION:
                await stamp_schema_revision(conn, CURRENT_SCHEMA_REVISION)

    await _ensure_bootstrap_security_state()


async def get_db_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session


get_db = get_db_session

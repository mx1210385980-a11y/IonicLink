"""Async database configuration for IonicLink."""

from __future__ import annotations

import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

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


async def _table_columns(conn, table_name: str) -> set[str]:
    result = await conn.execute(text(f"PRAGMA table_info('{table_name}')"))
    return {str(row[1]) for row in result.fetchall()}


async def _index_definitions(conn, table_name: str) -> dict[str, bool]:
    result = await conn.execute(text(f"PRAGMA index_list('{table_name}')"))
    return {str(row[1]): bool(row[2]) for row in result.fetchall()}


async def _ensure_literature_scope_schema(conn) -> None:
    columns = await _table_columns(conn, "literature")
    indexes = await _index_definitions(conn, "literature")
    required_columns = {"group_id", "workspace_id", "created_by_user_id", "scope_type", "scope_key"}
    legacy_unique_doi = indexes.get("ix_literature_doi", False)

    if required_columns.issubset(columns) and not legacy_unique_doi:
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_group_id ON literature (group_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_workspace_id ON literature (workspace_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_scope_type ON literature (scope_type)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_created_by_user_id ON literature (created_by_user_id)"))
        await conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_literature_scope_doi ON literature (group_id, scope_key, doi)")
        )
        return

    await conn.execute(text("PRAGMA foreign_keys=OFF"))
    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS literature__new (
                id INTEGER NOT NULL PRIMARY KEY,
                doi VARCHAR(100) NOT NULL,
                title VARCHAR(500) NOT NULL,
                authors TEXT NOT NULL,
                journal VARCHAR(200) NOT NULL,
                issn VARCHAR(20),
                year INTEGER NOT NULL,
                volume VARCHAR(20),
                issue VARCHAR(20),
                pages VARCHAR(50),
                content TEXT,
                file_path VARCHAR(500),
                group_id INTEGER,
                workspace_id INTEGER,
                created_by_user_id INTEGER,
                scope_type VARCHAR(32) NOT NULL DEFAULT 'group_library',
                scope_key VARCHAR(64) NOT NULL DEFAULT 'group_library',
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                error_message TEXT,
                created_at DATETIME NOT NULL,
                FOREIGN KEY(group_id) REFERENCES research_groups(id),
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
                FOREIGN KEY(created_by_user_id) REFERENCES users(id)
            )
            """
        )
    )
    await conn.execute(
        text(
            """
            INSERT INTO literature__new (
                id, doi, title, authors, journal, issn, year, volume, issue, pages,
                content, file_path, group_id, workspace_id, created_by_user_id,
                scope_type, scope_key, status, error_message, created_at
            )
            SELECT
                id,
                doi,
                title,
                authors,
                journal,
                issn,
                year,
                volume,
                issue,
                pages,
                content,
                file_path,
                NULL,
                NULL,
                NULL,
                'group_library',
                'group_library',
                status,
                error_message,
                created_at
            FROM literature
            """
        )
    )
    await conn.execute(text("DROP TABLE literature"))
    await conn.execute(text("ALTER TABLE literature__new RENAME TO literature"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_doi ON literature (doi)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_status ON literature (status)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_group_id ON literature (group_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_workspace_id ON literature (workspace_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_scope_type ON literature (scope_type)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_literature_created_by_user_id ON literature (created_by_user_id)"))
    await conn.execute(
        text("CREATE UNIQUE INDEX IF NOT EXISTS uq_literature_scope_doi ON literature (group_id, scope_key, doi)")
    )
    await conn.execute(text("PRAGMA foreign_keys=ON"))


async def _run_additive_migrations(conn) -> None:
    additive_migrations = [
        "ALTER TABLE tribology_data ADD COLUMN evidence_page INTEGER",
        "ALTER TABLE tribology_data ADD COLUMN evidence_bbox VARCHAR(200)",
        "ALTER TABLE tribology_data ADD COLUMN source VARCHAR(200)",
        "ALTER TABLE tribology_data ADD COLUMN source_page INTEGER",
        "ALTER TABLE tribology_data ADD COLUMN source_figure VARCHAR(120)",
    ]

    for stmt in additive_migrations:
        try:
            await conn.execute(text(stmt))
        except Exception:
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
    """Initialize database and run lightweight migrations."""
    async with engine.begin() as conn:
        from models.db_models import (
            ExtractionCandidate,
            ExtractionRun,
            Literature,
            ResearchGroup,
            TribologyData,
            User,
            Workspace,
        )

        await conn.run_sync(Base.metadata.create_all)
        await _ensure_literature_scope_schema(conn)
        await _run_additive_migrations(conn)

    await _ensure_bootstrap_security_state()


async def get_db_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session


get_db = get_db_session

"""Async database configuration for IonicLink."""

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


async def init_db():
    """Initialize database and run lightweight additive migrations."""
    async with engine.begin() as conn:
        from models.db_models import ExtractionCandidate, ExtractionRun, Literature, TribologyData

        await conn.run_sync(Base.metadata.create_all)

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
                # SQLite raises when the column already exists.
                pass


async def get_db_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session


get_db = get_db_session

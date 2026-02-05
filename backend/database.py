"""
Database configuration for IonicLink
使用 SQLite + SQLAlchemy (async) 进行数据持久化
"""

import os
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# 确保 data 目录存在
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# SQLite 数据库 URL
DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'ioniclink.db')}"

# 创建异步引擎
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # 设为 True 可查看 SQL 日志
    future=True
)

# 创建异步 Session 工厂
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    """SQLAlchemy ORM 基类"""
    pass


async def init_db():
    """初始化数据库，创建所有表"""
    async with engine.begin() as conn:
        # 导入所有模型以确保它们被注册
        from models.db_models import Literature, TribologyData
        await conn.run_sync(Base.metadata.create_all)


async def get_db_session() -> AsyncSession:
    """获取数据库会话的依赖项"""
    async with async_session_maker() as session:
        yield session


# Alias for FastAPI Depends() compatibility
get_db = get_db_session

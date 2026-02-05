from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import extraction, sync_router, data_explorer
from database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化数据库
    await init_db()
    print("✓ 数据库初始化完成")
    yield
    # 关闭时清理资源（如需要）


app = FastAPI(
    title="IonicLink - 离子液体润滑文献数据提取助手",
    description="一个小而美的文献数据提取工具，专注于离子液体润滑领域",
    version="1.0.0",
    lifespan=lifespan
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(extraction.router)
app.include_router(sync_router.router)
app.include_router(data_explorer.router)


@app.get("/")
async def root():
    return {
        "name": "IonicLink API",
        "version": "1.0.0",
        "description": "离子液体润滑文献数据提取助手"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


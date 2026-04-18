import logging
import os
from contextlib import asynccontextmanager
from importlib import import_module

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from logging_config import setup_logging
from services.agent_runtime_service import get_agent_runtime
from services.literature_monitor_service import get_literature_monitor_service

setup_logging()
logger = logging.getLogger(__name__)


def _include_router_module(
    app: FastAPI,
    module_name: str,
    *,
    optional: bool = False,
    attr_name: str = "router",
) -> None:
    try:
        module = import_module(module_name)
    except Exception:
        if optional:
            logger.exception("Skipping optional router %s because import failed", module_name)
            return
        raise

    app.include_router(getattr(module, attr_name))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle hooks."""
    logger.info("Initializing application resources")
    await init_db()
    get_agent_runtime()
    literature_monitor = get_literature_monitor_service()
    await literature_monitor.start()
    logger.info("Application startup complete")
    yield
    await literature_monitor.stop()
    logger.info("Application shutdown complete")


app = FastAPI(
    title="IonicLink - Ionic Liquid Tribology Extraction Assistant",
    description="Ionic liquid tribology literature extraction assistant",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration (env-driven)
cors_allow_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
    if o.strip()
]
cors_allow_credentials = os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true"

# Browsers reject credentials when origin is wildcard; disable credentials in that case.
if cors_allow_credentials and cors_allow_origins == ["*"]:
    cors_allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_credentials=cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

_include_router_module(app, "routers.extraction")
_include_router_module(app, "routers.sync_router")
_include_router_module(app, "routers.data_explorer")
_include_router_module(app, "routers.mentor_progress")
_include_router_module(app, "routers.model_cleaning", optional=True)
_include_router_module(app, "routers.model_training", optional=True)
_include_router_module(app, "routers.agent_system")
_include_router_module(app, "routers.auth_router")
_include_router_module(app, "routers.monitor_router")


@app.get("/")
async def root():
    return {
        "name": "IonicLink API",
        "version": "1.0.0",
        "description": "Ionic liquid tribology literature extraction assistant",
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

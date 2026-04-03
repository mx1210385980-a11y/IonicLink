import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from logging_config import setup_logging
from routers import agent_system, auth_router, data_explorer, extraction, model_cleaning, model_training, monitor_router, sync_router
from services.agent_runtime_service import get_agent_runtime

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle hooks."""
    logger.info("Initializing application resources")
    await init_db()
    get_agent_runtime()
    logger.info("Application startup complete")
    yield
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

app.include_router(extraction.router)
app.include_router(sync_router.router)
app.include_router(data_explorer.router)
app.include_router(model_cleaning.router)
app.include_router(model_training.router)
app.include_router(agent_system.router)
app.include_router(auth_router.router)
app.include_router(monitor_router.router)


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

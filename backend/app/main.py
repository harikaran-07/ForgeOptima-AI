"""ForgeOptima AI — FastAPI application entrypoint."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from .api import (
    ai,
    analytics,
    anomalies,
    furnace,
    heats,
    models,
    optimize,
    predict,
    reports,
    settings as settings_api,
    twin,
)
from .core.config import settings
from .core.database import Base, SessionLocal, engine
from .core.logging import configure_logging, get_logger
from .ml.registry import registry
from .models import HeatRecord

configure_logging()
log = get_logger("forgeoptima")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    log.info("Database ready (%s)", "sqlite" if settings.database_url.startswith("sqlite") else "postgresql")
    if registry.is_ready():
        log.info("ML models loaded (version %s)", registry.version)
    else:
        log.warning("No trained model artifacts found — run `python -m scripts.seed` to generate data and train.")
    try:
        with SessionLocal() as session:
            count = session.scalar(select(func.count(HeatRecord.id))) or 0
        log.info("Heat records in database: %s", count)
    except Exception as exc:  # pragma: no cover
        log.warning("Could not count heat records: %s", exc)
    yield
    log.info("Shutting down ForgeOptima AI backend")


app = FastAPI(
    title="ForgeOptima AI",
    description=(
        "AI-powered industrial induction furnace optimization and predictive intelligence platform. "
        "Decision support only — this system does not control furnace equipment."
    ),
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

_buckets: dict[str, deque[float]] = defaultdict(deque)
_WINDOW = 60.0


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    """Simple in-memory sliding window, per client IP."""
    if request.url.path.startswith(("/docs", "/openapi.json", "/api/health")):
        return await call_next(request)
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    bucket = _buckets[ip]
    while bucket and now - bucket[0] > _WINDOW:
        bucket.popleft()
    if len(bucket) >= settings.rate_limit_per_minute:
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Please slow down and retry shortly."},
            headers={"Retry-After": "30"},
        )
    bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. The failure was logged for review."},
    )


for router in (
    furnace.router,
    heats.router,
    predict.router,
    optimize.router,
    twin.router,
    anomalies.router,
    ai.router,
    analytics.router,
    reports.router,
    models.router,
    settings_api.router,
):
    app.include_router(router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root():
    return {
        "name": "ForgeOptima AI",
        "tagline": "Predict Smarter. Optimize Energy. Melt Efficiently.",
        "assistant": "SHAKTHI AI",
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
    }


@app.get(f"{settings.api_prefix}/health")
def health():
    models_ready = registry.is_ready()
    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
        "models_ready": models_ready,
        "model_version": registry.version,
        "database": "sqlite" if settings.database_url.startswith("sqlite") else "postgresql",
    }

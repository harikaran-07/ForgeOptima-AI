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
from .models import Furnace, HeatRecord, PowerProfile, User

configure_logging()
log = get_logger("forgeoptima")


def _init_reference_data_background():
    """Initializes seed users, furnace, profiles, and initial heats in background."""
    try:
        with SessionLocal() as session:
            if not session.scalar(select(User).limit(1)):
                session.add(User(email="admin@forgeoptima.ai", full_name="Hari Kumar", role="admin"))
                session.add(User(email="engineer@forgeoptima.ai", full_name="Plant Engineer", role="engineer"))
                session.add(User(email="operator@forgeoptima.ai", full_name="Shift Operator", role="operator"))
                session.commit()
            if not session.scalar(select(Furnace).limit(1)):
                session.add(
                    Furnace(
                        name="IF-01",
                        code="IF01",
                        location="Plant 1 — Melt Shop, Bay 2",
                        capacity_kg=5000,
                        rated_power_kw=3500,
                        min_power_kw=350,
                        max_power_kw=3200,
                        nominal_voltage_v=760,
                        status="idle",
                    )
                )
                session.commit()
            if not session.scalar(select(PowerProfile).limit(1)):
                for grade in ["MS", "SS304", "Cast Iron"]:
                    session.add(
                        PowerProfile(
                            name=f"Standard ramp — {grade}",
                            metal_grade=grade,
                            description="Ramp to 70% power, hold through melt, taper before tap.",
                            steps=[
                                {"until_progress": 8, "power_kw": 1400},
                                {"until_progress": 85, "power_kw": 2100},
                                {"until_progress": 100, "power_kw": 1850},
                            ],
                            is_engineer_approved=True,
                            is_experimental=False,
                        )
                    )
                session.commit()
            count = session.scalar(select(func.count(HeatRecord.id))) or 0
            if count == 0:
                from pathlib import Path
                heats_csv = Path(settings.dataset_path)
                if heats_csv.exists():
                    log.info("Populating initial heats from %s in background...", heats_csv.name)
                    import pandas as pd
                    from datetime import datetime, timezone
                    df = pd.read_csv(heats_csv)
                    furnace = session.scalar(select(Furnace).limit(1))
                    records = []
                    for _, row in df.iterrows():
                        st = datetime.fromisoformat(str(row["heat_started_at"]))
                        if st.tzinfo is None:
                            st = st.replace(tzinfo=timezone.utc)
                        cp = (
                            datetime.fromisoformat(str(row["heat_completed_at"]))
                            if pd.notna(row.get("heat_completed_at"))
                            else None
                        )
                        if cp and cp.tzinfo is None:
                            cp = cp.replace(tzinfo=timezone.utc)
                        records.append(
                            HeatRecord(
                                heat_id=str(row["heat_id"]),
                                furnace_id=furnace.id if furnace else 1,
                                metal_grade=str(row["metal_grade"]),
                                charge_weight_kg=float(row["charge_weight_kg"]),
                                initial_temp_c=float(row["initial_temp_c"]),
                                target_temp_c=float(row["target_temp_c"]),
                                power_kw=float(row["power_kw"]),
                                current_a=float(row["current_a"]),
                                voltage_v=float(row["voltage_v"]),
                                melting_time_min=float(row["melting_time_min"]),
                                energy_kwh=float(row["energy_kwh"]),
                                ambient_temp_c=float(row["ambient_temp_c"]),
                                power_factor=float(row.get("power_factor", 0.92)),
                                heat_status=str(row["heat_status"]),
                                source="synthetic",
                                is_synthetic=True,
                                heat_started_at=st,
                                heat_completed_at=cp,
                            )
                        )
                    session.add_all(records)
                    session.commit()
                    count = session.scalar(select(func.count(HeatRecord.id))) or 0
                    log.info("Auto-populated %s heats into database in background.", count)
            log.info("Heat records in database: %s", count)
    except Exception as exc:  # pragma: no cover
        log.warning("Background reference data initialization notice: %s", exc)

    if registry.is_ready():
        log.info("ML models loaded (version %s)", registry.version)
    else:
        log.info("Attempting background model training...")
        try:
            from .ml.training import train_all
            train_all()
            registry.reload()
            if registry.is_ready():
                log.info("ML models auto-trained and loaded (version %s)", registry.version)
        except Exception as train_exc:
            log.warning("Could not auto-train models: %s", train_exc)


def _init_database_and_models_background():
    """Performs schema verification, reference seeding, and ML model checks in background."""
    try:
        Base.metadata.create_all(bind=engine)
        # Ensure session_id column exists on ai_conversations for multi-user support
        try:
            with engine.connect() as conn:
                from sqlalchemy import text
                conn.execute(text("ALTER TABLE ai_conversations ADD COLUMN session_id VARCHAR(64)"))
                conn.commit()
        except Exception:
            pass
        log.info("Database schema verified (%s)", "sqlite" if settings.database_url.startswith("sqlite") else "postgresql")
    except Exception as db_exc:
        log.error("Database connection initialization failed: %s", db_exc)

    _init_reference_data_background()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio
    log.info("Starting ForgeOptima AI backend (version %s)", settings.app_version)
    # Zero blocking I/O before yield so Uvicorn binds to $PORT in < 50ms
    asyncio.create_task(asyncio.to_thread(_init_database_and_models_background))
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
    allow_origin_regex=r"^https://.*\.vercel\.app$",
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

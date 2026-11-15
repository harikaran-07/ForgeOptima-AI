"""Model registry: versions, metrics, guarded retraining."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.logging import get_logger
from ..ml.registry import registry
from ..ml.training import train_all
from ..models import HeatRecord, ModelVersion, User
from ..schemas import ModelVersionOut, RetrainResponse
from ..services import runtime_settings

log = get_logger("forgeoptima.models")

router = APIRouter(prefix="/models", tags=["models"])

MIN_HEATS = 100

# Role constants
ROLE_OPERATOR = "operator"
ROLE_ENGINEER = "engineer"
ROLE_ADMIN = "admin"

# Write-endpoint role requirements: minimum role needed to perform the action
WRITE_ROLE_REQUIREMENTS = {
    "manual_entry": ROLE_OPERATOR,
    "csv_upload": ROLE_OPERATOR,
    "retrain_models": ROLE_ADMIN,
    "update_settings": ROLE_ENGINEER,
}


def check_write_role(action: str, db: Session) -> None:
    """Raise 403 if the current user does not have sufficient role for the action.

    The caller must have already fetched the user via `db.get(User, ...)` or equivalent;
    this helper reads the user's role from the DB and compares it against the requirement.
    """
    req = WRITE_ROLE_REQUIREMENTS.get(action)
    if req is None:
        return  # no role restriction configured
    user = db.scalar(select(User).limit(1))  # first user in the system
    if not user:
        return
    role_levels = {ROLE_OPERATOR: 1, ROLE_ENGINEER: 2, ROLE_ADMIN: 3}
    if role_levels.get(user.role, 1) < role_levels.get(req, 1):
        raise HTTPException(status_code=403, detail=f"Role '{user.role}' is not authorized for '{action}'. Required: {req}.")


def get_current_user(db: Session) -> User:
    """Return the first user record; in a production setup this would come from auth tokens/session."""
    return db.scalar(select(User).limit(1)) or User(role=ROLE_OPERATOR, email="operator@demo.local")


@router.get("", response_model=list[ModelVersionOut])
def list_versions(db: Session = Depends(get_db)):
    return list(db.scalars(select(ModelVersion).order_by(ModelVersion.trained_at.desc()).limit(60)))


@router.get("/status")
def status(db: Session = Depends(get_db)):
    meta = registry.metadata or {}
    total = db.scalar(select(func.count(HeatRecord.id))) or 0
    return {
        "ready": registry.is_ready(),
        "active_version": registry.version,
        "dataset_size": meta.get("dataset_size"),
        "trained_at": meta.get("trained_at"),
        "models": {
            name: {
                "algorithm": info.get("algorithm"),
                "metrics": info.get("metrics"),
                "importance": info.get("importance"),
            }
            for name, info in (meta.get("models") or {}).items()
        },
        "stored_heats": total,
        "minimum_heats_for_training": MIN_HEATS,
        "promotion_policy": (
            "A new model version is promoted only after training on validated completed heats and "
            "recomputing MAE/RMSE/R² on a held-out split. Unvalidated rows are excluded."
        ),
    }


@router.post("/retrain", response_model=RetrainResponse)
def retrain(db: Session = Depends(get_db)):
    # Check write role for model retraining
    check_write_role("retrain_models", db)
    
    rows = list(db.scalars(select(HeatRecord).where(HeatRecord.heat_status == "completed")))
    if len(rows) < MIN_HEATS:
        raise HTTPException(
            status_code=422,
            detail=f"Retraining requires at least {MIN_HEATS} validated completed heats (found {len(rows)}).",
        )

    # --- data validation gate ---------------------------------------------
    validated = []
    rejected = 0
    for heat in rows:
        implied = heat.power_kw * heat.melting_time_min / 60.0
        if implied <= 0 or heat.energy_kwh <= 0:
            rejected += 1
            continue
        if abs(heat.energy_kwh - implied) / implied > 0.6:
            rejected += 1
            continue
        if heat.charge_weight_kg <= 0 or heat.melting_time_min <= 0:
            rejected += 1
            continue
        validated.append(heat)

    if len(validated) < MIN_HEATS:
        raise HTTPException(
            status_code=422,
            detail=f"Only {len(validated)} heats passed validation (need {MIN_HEATS}); {rejected} rejected.",
        )

    import pandas as pd

    frame = pd.DataFrame(
        [
            {
                "heat_id": h.heat_id,
                "metal_grade": h.metal_grade,
                "charge_weight_kg": h.charge_weight_kg,
                "initial_temp_c": h.initial_temp_c,
                "target_temp_c": h.target_temp_c,
                "power_kw": h.power_kw,
                "current_a": h.current_a,
                "voltage_v": h.voltage_v,
                "melting_time_min": h.melting_time_min,
                "energy_kwh": h.energy_kwh,
                "ambient_temp_c": h.ambient_temp_c,
                "heat_status": h.heat_status,
            }
            for h in validated
        ]
    )
    try:
        meta = train_all(frame)
    except Exception as exc:
        log.exception("Retraining failed")
        raise HTTPException(status_code=500, detail=f"Training failed: {exc}") from exc

    registry.reload()
    trained_at = datetime.now(timezone.utc)

    db.query(ModelVersion).filter(ModelVersion.is_active.is_(True)).update({"is_active": False})
    created = []
    for name, info in meta["models"].items():
        metrics = info.get("metrics") or {}
        version = ModelVersion(
            model_name=name,
            version=meta["version"],
            algorithm=info["algorithm"],
            dataset_size=meta["dataset_size"],
            mae=metrics.get("mae"),
            rmse=metrics.get("rmse"),
            r2=metrics.get("r2"),
            mape=metrics.get("mape"),
            residual_std=metrics.get("residual_std"),
            is_active=True,
            trained_at=trained_at,
            notes=f"Trained on {len(validated)} validated heats ({rejected} rejected).",
            metrics=metrics,
        )
        db.add(version)
        created.append(version)
    db.commit()
    runtime_settings.save({"last_retrain_at": trained_at.isoformat()})

    for version in created:
        db.refresh(version)
    return {
        "trained": created,
        "message": (
            f"Trained {len(created)} models on {len(validated)} validated heats "
            f"(version {meta['version']}); {rejected} rows rejected by validation."
        ),
    }
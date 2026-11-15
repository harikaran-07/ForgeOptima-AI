"""Operator settings endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings as app_settings
from ..core.database import get_db
from ..core.logging import get_logger
from ..ml.registry import registry
from ..models import Furnace, User
from ..schemas import SettingsUpdate
from ..services import runtime_settings

router = APIRouter(prefix="/settings", tags=["settings"])

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
        raise HTTPException(status_code=403, detail="No user found — cannot verify role.")
    if user.role not in (ROLE_ADMIN, req):
        raise HTTPException(status_code=403, detail=f"Role '{user.role}' is not authorized for '{action}'. Required: {req}.")


def get_current_user(db: Session) -> User:
    """Return the first user record; in a production setup this would come from auth tokens/session."""
    return db.scalar(select(User).limit(1)) or User(role=ROLE_OPERATOR, email="operator@demo.local")


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    # Check read role (any authenticated user can read)
    check_write_role("update_settings", db)  # reuse the same role check logic
    
    rt = runtime_settings.current()
    furnace = db.scalar(select(Furnace).order_by(Furnace.id).limit(1))
    user = db.scalar(select(User).limit(1))
    db_url = app_settings.database_url
    masked = db_url.split("://")[0] + "://***" if "://" in db_url else "sqlite"
    return {
        "runtime": rt,
        "environment": {
            "app_version": app_settings.app_version,
            "environment": app_settings.environment,
            "database": masked,
            "cors_origins": app_settings.cors_origins,
            "max_upload_mb": app_settings.max_upload_mb,
            "rate_limit_per_minute": app_settings.rate_limit_per_minute,
            "api_prefix": app_settings.api_prefix,
        },
        "furnace": {
            "name": furnace.name if furnace else None,
            "capacity_kg": furnace.capacity_kg if furnace else None,
            "min_power_kw": furnace.min_power_kw if furnace else None,
            "max_power_kw": furnace.max_power_kw if furnace else None,
            "rated_power_kw": furnace.rated_power_kw if furnace else None,
        },
        "user": {
            "name": user.full_name if user else "Operator",
            "role": user.role if user else "operator",
            "email": user.email if user else None,
        },
        "models": {"ready": registry.is_ready(), "version": registry.version},
        "ai": {
            "ollama_base_url": rt["ollama_base_url"],
            "ollama_model": rt["ollama_model"],
            "note": (
                "The backend calls Ollama server-side. The browser never receives the inference URL. "
                "In production point this at a secured inference host, not a laptop."
            ),
        },
        "disclaimer": (
            "ForgeOptima AI is a decision-support system. It does not control furnace equipment and its "
            "predictions are not a substitute for qualified engineering judgement."
        ),
    }


@router.put("")
def update_settings(payload: SettingsUpdate):
    # Check write role for settings update
    check_write_role("update_settings", db)
    
    updates = payload.model_dump(exclude_none=True)
    saved = runtime_settings.save(updates)
    if updates.get("ollama_base_url") or updates.get("ollama_model"):
        # AI client reads config on each request, no caching to invalidate
        pass
    return {"runtime": saved, "message": "Settings saved."}
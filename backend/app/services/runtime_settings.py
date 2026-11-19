"""Runtime-configurable settings that operators may change from the UI.

Persisted to backend/data/runtime_settings.json so values survive restarts
without editing code or committing secrets.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..core.config import settings
from ..core.logging import get_logger

log = get_logger(__name__)
_PATH = Path(settings.dataset_path).parent / "runtime_settings.json"

_DEFAULTS: dict[str, Any] = {
    "emission_factor_kg_per_kwh": settings.emission_factor_kg_per_kwh,
    "anomaly_threshold": settings.anomaly_threshold,
    "ai_provider": settings.ai_provider,
    "ai_model": settings.ai_model,
    "last_retrain_at": None,
}


def load() -> dict[str, Any]:
    data = dict(_DEFAULTS)
    if _PATH.exists():
        try:
            data.update(json.loads(_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError) as exc:  # pragma: no cover
            log.warning("Could not read runtime settings: %s", exc)
    return data


def save(updates: dict[str, Any]) -> dict[str, Any]:
    data = load()
    for key, value in updates.items():
        if value is not None and key in _DEFAULTS:
            data[key] = value
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    if "emission_factor_kg_per_kwh" in updates:
        from .. import schemas  # noqa: F401  (kept for import-cycle safety)

    return data


def current() -> dict[str, Any]:
    return load()

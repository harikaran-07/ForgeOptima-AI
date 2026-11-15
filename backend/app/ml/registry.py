"""Inference layer: loads trained artifacts and exposes prediction helpers.

If artifacts are missing the API responds with an explicit "model not trained"
error instead of fabricating numbers. A documented physics baseline is available
only through `baseline_estimate`, and every response using it is flagged.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ..core.config import settings
from ..core.logging import get_logger
from .features import (
    ENERGY_FEATURES,
    MELTING_FEATURES,
    TARGET_FEATURES,
    encode_grade,
    energy_frame,
    melting_frame,
    nominal_energy_per_kg,
    target_frame,
)
from .synthetic import GRADE_SPECS
from .training import MODEL_FILES, load_metadata

logger = get_logger(__name__)

_lock = threading.Lock()


class ModelNotTrained(RuntimeError):
    """Raised when artifacts are absent — the API maps this to HTTP 503."""


class ModelRegistry:
    def __init__(self) -> None:
        self._cache: dict[str, Any] = {}
        self._metadata: dict[str, Any] | None = None
        self._artifact_dir: Path = Path(settings.model_dir)
        self._loaded_version: str | None = None

    # ------------------------------------------------------------------ #
    def reload(self, artifact_dir: Path | None = None) -> None:
        with _lock:
            self._cache.clear()
            self._metadata = None
            self._loaded_version = None
            if artifact_dir:
                self._artifact_dir = Path(artifact_dir)

    @property
    def artifact_dir(self) -> Path:
        return self._artifact_dir

    @property
    def metadata(self) -> dict[str, Any] | None:
        if self._metadata is None:
            self._metadata = load_metadata(self._artifact_dir)
        return self._metadata

    @property
    def version(self) -> str:
        meta = self.metadata
        return meta.get("version", "untrained") if meta else "untrained"

    def is_ready(self) -> bool:
        return self.metadata is not None and all(
            (self._artifact_dir / name).exists() for name in MODEL_FILES.values()
        )

    def _load(self, key: str):
        if key not in self._cache:
            path = self._artifact_dir / MODEL_FILES[key]
            if not path.exists():
                raise ModelNotTrained(
                    "Model artifacts are missing. Run `python -m scripts.seed` (or POST /api/models/retrain)."
                )
            self._cache[key] = joblib.load(path)
        return self._cache[key]

    # ------------------------------------------------------------------ #
    def predict_melting_time(self, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._load("melting_time")
        X = melting_frame(payload)
        pred = float(model.predict(X)[0])
        # per-tree spread is a genuine uncertainty signal for a random forest
        tree_preds = np.array([t.predict(X.to_numpy())[0] for t in model.estimators_])
        spread = float(np.std(tree_preds))
        meta = (self.metadata or {}).get("models", {}).get("melting_time", {})
        residual = meta.get("metrics", {}).get("residual_std", spread)
        band = max(spread, residual or spread)
        elapsed = float(payload.get("elapsed_min") or 0.0)
        remaining = max(pred - elapsed, 0.0)
        return {
            "predicted_value": round(pred, 1),
            "lower_bound": round(max(pred - band, 0.0), 1),
            "upper_bound": round(pred + band, 1),
            "remaining_min": round(remaining, 1),
            "uncertainty": round(band, 2),
            "metrics": meta.get("metrics", {}),
            "importance": meta.get("importance", []),
            "algorithm": meta.get("algorithm", "RandomForestRegressor"),
            "features": X.iloc[0].to_dict(),
            "tree_spread": round(spread, 2),
        }

    def predict_energy(self, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._load("energy")
        X = energy_frame(payload)
        pred = float(model.predict(X)[0])
        meta = (self.metadata or {}).get("models", {}).get("energy", {})
        band = float(meta.get("metrics", {}).get("residual_std", pred * 0.05) or pred * 0.05)
        per_kg = pred / max(float(payload["charge_weight_kg"]), 1.0)
        return {
            "predicted_value": round(pred, 1),
            "lower_bound": round(max(pred - band, 0.0), 1),
            "upper_bound": round(pred + band, 1),
            "energy_per_kg": round(per_kg, 4),
            "uncertainty": round(band, 2),
            "metrics": meta.get("metrics", {}),
            "importance": meta.get("importance", []),
            "algorithm": meta.get("algorithm", "XGBRegressor"),
            "features": X.iloc[0].to_dict(),
        }

    def predict_time_to_target(self, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._load("time_to_target")
        X = target_frame(payload)
        pred = float(model.predict(X)[0])
        meta = (self.metadata or {}).get("models", {}).get("time_to_target", {})
        band = float(meta.get("metrics", {}).get("residual_std", 5.0) or 5.0)
        return {
            "predicted_value": round(max(pred, 0.0), 1),
            "lower_bound": round(max(pred - band, 0.0), 1),
            "upper_bound": round(pred + band, 1),
            "uncertainty": round(band, 2),
            "metrics": meta.get("metrics", {}),
            "importance": meta.get("importance", []),
            "algorithm": meta.get("algorithm", "RandomForestRegressor"),
            "features": X.iloc[0].to_dict(),
        }

    def similar_heats(self, payload: dict[str, Any], k: int = 5) -> list[dict[str, Any]]:
        bundle = self._load("similar_heats")
        grade_code = encode_grade(payload["metal_grade"])
        query = [
            float(payload["charge_weight_kg"]),
            float(payload["initial_temp_c"]),
            float(payload["target_temp_c"]),
            float(payload["power_kw"]),
            float(grade_code),
            float(
                payload.get("energy_per_kg_nominal")
                or nominal_energy_per_kg(
                    payload["metal_grade"], payload["initial_temp_c"], payload["target_temp_c"]
                )
            ),
        ]
        scaler = bundle["scaler"]
        query_frame = pd.DataFrame([query], columns=bundle["features"])
        q = scaler.transform(query_frame)
        distances = np.linalg.norm(bundle["rows_scaled"] - q, axis=1)
        order = np.argsort(distances)[:k]
        results = []
        for idx in order:
            meta = bundle["meta"][int(idx)]
            dist = float(distances[idx])
            results.append(
                {
                    "heat_id": meta["heat_id"],
                    "metal_grade": meta["metal_grade"],
                    "charge_weight_kg": round(float(meta["charge_weight_kg"]), 1),
                    "power_kw": round(float(meta["power_kw"]), 1),
                    "melting_time_min": round(float(meta["melting_time_min"]), 1),
                    "energy_kwh": round(float(meta["energy_kwh"]), 1),
                    "energy_per_kg": round(
                        float(meta["energy_kwh"]) / max(float(meta["charge_weight_kg"]), 1.0), 4
                    ),
                    "distance": round(dist, 3),
                    "similarity": round(max(0.0, 1.0 - dist / (dist + 1.0)), 3),
                }
            )
        return results

    def anomaly_score(self, indicators: dict[str, float]) -> dict[str, Any]:
        bundle = self._load("anomaly")
        features = bundle["features"]
        frame = pd.DataFrame(
            [{f: float(indicators.get(f, 0.0)) for f in features}], columns=features
        )
        scaled = bundle["scaler"].transform(frame)
        score = float(bundle["model"].decision_function(scaled)[0])
        is_anomaly = bool(bundle["model"].predict(scaled)[0] == -1)
        return {"score": round(score, 4), "is_anomaly": is_anomaly}


registry = ModelRegistry()


def baseline_estimate(metal_grade: str, charge_kg: float, initial_c: float, target_c: float, power_kw: float) -> dict[str, float]:
    """Documented physics baseline used only when models are unavailable.

    energy = mass_t * specific_energy(grade) * span_factor * 1.08 (typical loss)
    time   = energy / power * 60
    """
    spec = GRADE_SPECS.get(metal_grade, GRADE_SPECS["MS"])
    span = max(spec["target_temp_c"] - 35.0, 1.0)
    span_factor = min(max((target_c - initial_c) / span, 0.45), 1.35)
    energy = (charge_kg / 1000.0) * spec["specific_energy_kwh_per_t"] * span_factor * 1.08
    minutes = energy / max(power_kw, 1.0) * 60.0
    return {"energy_kwh": round(energy, 1), "melting_time_min": round(minutes, 1)}

"""Model training and evaluation.

Every metric reported by the API is computed here on a held-out test split —
nothing is hard-coded. Artifacts and a metadata manifest are written to
backend/artifacts/.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from ..core.config import settings
from .features import (
    ENERGY_FEATURES,
    MELTING_FEATURES,
    TARGET_FEATURES,
    build_training_frames,
    relative_importances,
)

MODEL_FILES = {
    "melting_time": "melting_time.joblib",
    "energy": "energy.joblib",
    "time_to_target": "time_to_target.joblib",
    "similar_heats": "similar_heats.joblib",
    "anomaly": "anomaly.joblib",
}


def _metrics(y_true, y_pred, n_features: int) -> dict[str, float]:
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    denom = np.where(np.abs(np.asarray(y_true)) < 1e-6, np.nan, np.abs(y_true))
    mape = float(np.nanmean(np.abs((np.asarray(y_true) - np.asarray(y_pred)) / denom)) * 100)
    residuals = np.asarray(y_true) - np.asarray(y_pred)
    # adjusted R^2 keeps small demo datasets honest
    n = len(y_true)
    adj_r2 = 1 - (1 - r2) * (n - 1) / max(n - n_features - 1, 1)
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4),
        "adjusted_r2": round(float(adj_r2), 4),
        "mape": round(mape, 2),
        "residual_std": round(float(np.std(residuals, ddof=1)), 4),
        "test_samples": int(n),
    }


def train_all(heats: pd.DataFrame, artifact_dir: Path | None = None) -> dict[str, Any]:
    artifact_dir = Path(artifact_dir or settings.model_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    completed = heats[heats["heat_status"] == "completed"].copy()
    if len(completed) < 60:
        raise ValueError(f"Insufficient training data: {len(completed)} completed heats (need >= 60)")

    X_melt, y_melt, X_energy, y_energy, X_target, y_target = build_training_frames(completed)

    Xm_tr, Xm_te, ym_tr, ym_te = train_test_split(X_melt, y_melt, test_size=0.2, random_state=42)
    Xe_tr, Xe_te, ye_tr, ye_te = train_test_split(X_energy, y_energy, test_size=0.2, random_state=42)
    Xt_tr, Xt_te, yt_tr, yt_te = train_test_split(X_target, y_target, test_size=0.2, random_state=42)

    melt_model = RandomForestRegressor(
        n_estimators=320, max_depth=14, min_samples_leaf=2, n_jobs=-1, random_state=42
    )
    melt_model.fit(Xm_tr, ym_tr)
    melt_metrics = _metrics(ym_te, melt_model.predict(Xm_te), len(MELTING_FEATURES))

    energy_model = XGBRegressor(
        n_estimators=420,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=-1,
    )
    energy_model.fit(Xe_tr, ye_tr)
    energy_metrics = _metrics(ye_te, energy_model.predict(Xe_te), len(ENERGY_FEATURES))

    target_model = RandomForestRegressor(
        n_estimators=300, max_depth=16, min_samples_leaf=2, n_jobs=-1, random_state=42
    )
    target_model.fit(Xt_tr, yt_tr)
    target_metrics = _metrics(yt_te, target_model.predict(Xt_te), len(TARGET_FEATURES))

    # Similar-heat retrieval (KNN over standardised operating features)
    knn_features = [
        "charge_weight_kg",
        "initial_temp_c",
        "target_temp_c",
        "power_kw",
        "grade_code",
        "energy_per_kg_nominal",
    ]
    knn_frame = completed.copy()
    knn_frame["temp_span_c"] = knn_frame["target_temp_c"] - knn_frame["initial_temp_c"]
    knn_frame["energy_per_kg_nominal"] = (
        knn_frame["energy_kwh"] / knn_frame["charge_weight_kg"].clip(lower=1)
    )
    from .features import GRADE_CODES  # local import avoids a cycle at module load

    knn_frame["grade_code"] = knn_frame["metal_grade"].map(GRADE_CODES).fillna(0).astype(int)
    knn_X = knn_frame[knn_features].astype(float)
    knn_pipeline = Pipeline([("scale", StandardScaler()), ("knn", KNeighborsRegressor(n_neighbors=5))])
    knn_pipeline.fit(knn_X, knn_frame["melting_time_min"].astype(float))
    knn_bundle = {
        "scaler": knn_pipeline.named_steps["scale"],
        "model": knn_pipeline.named_steps["knn"],
        "features": knn_features,
        "rows_scaled": knn_pipeline.named_steps["scale"].transform(knn_X),
        "heat_ids": knn_frame["heat_id"].tolist(),
        "meta": knn_frame[
            [
                "heat_id",
                "metal_grade",
                "charge_weight_kg",
                "power_kw",
                "melting_time_min",
                "energy_kwh",
            ]
        ].to_dict("records"),
    }

    # Anomaly detection: IsolationForest on heat-level indicators
    anomaly_features = [
        "power_kw",
        "current_a",
        "voltage_v",
        "energy_kwh",
        "melting_time_min",
        "charge_weight_kg",
        "energy_per_kg",
    ]
    af = completed.copy()
    af["energy_per_kg"] = af["energy_kwh"] / af["charge_weight_kg"].clip(lower=1)
    anomaly_frame = af[anomaly_features].astype(float)
    iso_scaler = StandardScaler().fit(anomaly_frame)
    iso = IsolationForest(n_estimators=250, contamination=0.04, random_state=42)
    iso.fit(iso_scaler.transform(anomaly_frame))
    scores = iso.decision_function(iso_scaler.transform(anomaly_frame))
    anomaly_bundle = {
        "scaler": iso_scaler,
        "model": iso,
        "features": anomaly_features,
        "score_low": float(np.percentile(scores, 4)),
        "score_median": float(np.median(scores)),
    }

    version = datetime.now(timezone.utc).strftime("%Y%m%d.%H%M")
    metadata = {
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_size": int(len(completed)),
        "models": {
            "melting_time": {
                "algorithm": "RandomForestRegressor",
                "target": "melting_time_min",
                "metrics": melt_metrics,
                "features": list(MELTING_FEATURES),
                "importance": relative_importances(melt_model, list(MELTING_FEATURES)),
            },
            "energy": {
                "algorithm": "XGBRegressor",
                "target": "energy_kwh",
                "metrics": energy_metrics,
                "features": list(ENERGY_FEATURES),
                "importance": relative_importances(energy_model, list(ENERGY_FEATURES)),
            },
            "time_to_target": {
                "algorithm": "RandomForestRegressor",
                "target": "remaining_min",
                "metrics": target_metrics,
                "features": list(TARGET_FEATURES),
                "importance": relative_importances(target_model, list(TARGET_FEATURES)),
            },
            "similar_heats": {
                "algorithm": "KNeighborsRegressor (k=5, standardised)",
                "target": "melting_time_min",
                "metrics": {},
                "features": knn_features,
                "importance": [],
            },
            "anomaly": {
                "algorithm": "IsolationForest",
                "target": "anomaly_score",
                "metrics": {"contamination": 0.04},
                "features": anomaly_features,
                "importance": [],
            },
        },
    }

    joblib.dump(melt_model, artifact_dir / MODEL_FILES["melting_time"])
    joblib.dump(energy_model, artifact_dir / MODEL_FILES["energy"])
    joblib.dump(target_model, artifact_dir / MODEL_FILES["time_to_target"])
    joblib.dump(knn_bundle, artifact_dir / MODEL_FILES["similar_heats"], compress=3)
    joblib.dump(anomaly_bundle, artifact_dir / MODEL_FILES["anomaly"], compress=3)
    (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


def load_metadata(artifact_dir: Path | None = None) -> dict[str, Any] | None:
    path = Path(artifact_dir or settings.model_dir) / "metadata.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

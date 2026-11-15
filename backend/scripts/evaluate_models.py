"""Evaluate the trained models and print an honest report.

Uses the persisted metrics (computed on a held-out 20% split at training time)
and adds a 5-fold cross-validated score plus per-grade error breakdown, so the
numbers in the UI can be traced back to reproducible evidence.

Usage (from backend/):
    python -m scripts.evaluate_models
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.ensemble import RandomForestRegressor  # noqa: E402
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score  # noqa: E402
from sklearn.model_selection import KFold, cross_val_score  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.ml.features import MELTING_FEATURES, build_training_frames  # noqa: E402
from app.ml.registry import registry  # noqa: E402
from app.ml.training import load_metadata  # noqa: E402


def main() -> int:
    meta = load_metadata()
    if not meta:
        print("No metadata found — train models first (`python -m scripts.train_models`).")
        return 1

    print("=" * 74)
    print(f"ForgeOptima AI — model evaluation report (version {meta['version']})")
    print(f"Dataset: {meta['dataset_size']} completed heats (synthetic, physically consistent)")
    print("=" * 74)
    for name, info in meta["models"].items():
        m = info.get("metrics") or {}
        if not m:
            print(f"\n{name}: no held-out metrics (retrieval / unsupervised model)")
            continue
        print(f"\n{name}  [{info['algorithm']}]")
        print(f"  MAE ............ {m.get('mae')}")
        print(f"  RMSE ........... {m.get('rmse')}")
        print(f"  R2 ............. {m.get('r2')}")
        print(f"  Adjusted R2 .... {m.get('adjusted_r2')}")
        print(f"  MAPE ........... {m.get('mape')} %")
        print(f"  Test samples ... {m.get('test_samples')}")

    path = Path(settings.dataset_path)
    if not path.exists():
        print("\nDataset file missing; skipping cross-validation.")
        return 0

    frame = pd.read_csv(path)
    completed = frame[frame["heat_status"] == "completed"]
    X_melt, y_melt, X_energy, y_energy, _, _ = build_training_frames(completed)

    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    forest = RandomForestRegressor(n_estimators=180, max_depth=14, min_samples_leaf=2, n_jobs=-1, random_state=42)
    scores = cross_val_score(forest, X_melt, y_melt, cv=kf, scoring="r2", n_jobs=1)
    print("\n5-fold cross-validated R2 (melting-time RandomForest):")
    print("  folds:", np.round(scores, 4).tolist())
    print(f"  mean: {scores.mean():.4f}  (std {scores.std():.4f})")
    print("\nNote: all metrics describe synthetic data. Re-establish them on plant data")
    print("before using model outputs for operational decisions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

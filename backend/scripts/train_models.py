"""Train (or retrain) all ML models from the stored synthetic dataset.

Usage (from backend/):
    python -m scripts.train_models
    python -m scripts.train_models --dataset data/synthetic_heats.csv
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import pandas as pd  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.logging import configure_logging, get_logger  # noqa: E402
from app.ml.training import train_all  # noqa: E402

configure_logging()
log = get_logger("train")


def main() -> int:
    parser = argparse.ArgumentParser(description="Train ForgeOptima AI models")
    parser.add_argument("--dataset", default=settings.dataset_path)
    args = parser.parse_args()

    path = Path(args.dataset)
    if not path.exists():
        log.error("Dataset not found: %s — run `python -m scripts.seed` first.", path)
        return 1

    frame = pd.read_csv(path)
    completed = frame[frame["heat_status"] == "completed"]
    log.info("Training on %s completed heats from %s", len(completed), path.name)

    meta = train_all(completed)
    print(json.dumps(meta["models"], indent=2))

    # record versions so the model-performance dashboard stays in sync
    from datetime import datetime, timezone

    from app.core.database import SessionLocal
    from app.models import ModelVersion

    with SessionLocal() as db:
        db.query(ModelVersion).filter(ModelVersion.is_active.is_(True)).update({"is_active": False})
        for name, info in meta["models"].items():
            m = info.get("metrics") or {}
            db.add(
                ModelVersion(
                    model_name=name,
                    version=meta["version"],
                    algorithm=info["algorithm"],
                    dataset_size=meta["dataset_size"],
                    mae=m.get("mae"),
                    rmse=m.get("rmse"),
                    r2=m.get("r2"),
                    mape=m.get("mape"),
                    residual_std=m.get("residual_std"),
                    is_active=True,
                    trained_at=datetime.now(timezone.utc),
                    notes="Retrained from the synthetic dataset file.",
                    metrics=m,
                )
            )
        db.commit()

    log.info("Models saved to %s (version %s)", settings.model_dir, meta["version"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

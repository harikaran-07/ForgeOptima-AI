"""Generate the synthetic dataset, load it into the database, train and evaluate models.

Usage (from backend/):
    python -m scripts.seed                 # 1200 heats, train models
    python -m scripts.seed --heats 2000 --reset
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.logging import configure_logging, get_logger  # noqa: E402
from app.ml.synthetic import GRADE_SPECS, generate_dataset  # noqa: E402
from app.ml.training import train_all  # noqa: E402
from app.models import (  # noqa: E402
    AIMessage,
    AIConversation,
    AnomalyRecord,
    EnergyAnalytic,
    Furnace,
    HeatRecord,
    ModelVersion,
    PowerProfile,
    Prediction,
    SensorReading,
    User,
)
from app.services import energy  # noqa: E402
from app.services.anomalies import analyze_all  # noqa: E402

configure_logging()
log = get_logger("seed")


def seed_reference_data(db) -> Furnace:
    if not db.query(User).first():
        db.add(User(email="operator@forgeoptima.ai", full_name="Hari Kumar", role="operator"))
        db.add(User(email="engineer@forgeoptima.ai", full_name="Plant Engineer", role="engineer"))
    furnace = db.query(Furnace).first()
    if not furnace:
        furnace = Furnace(
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
        db.add(furnace)
        db.flush()
    if not db.query(PowerProfile).first():
        for grade in ["MS", "SS304", "Cast Iron"]:
            spec = GRADE_SPECS[grade]
            db.add(
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
    db.commit()
    return furnace


def load_heats(db, furnace: Furnace, heats: pd.DataFrame, readings: pd.DataFrame, limit: int | None = None):
    heat_rows = heats if limit is None else heats.tail(limit)
    ids = set(heat_rows["heat_id"].tolist())
    by_heat: dict[str, list] = {}
    for _, row in readings.iterrows():
        if row["heat_id"] in ids:
            by_heat.setdefault(row["heat_id"], []).append(row)

    created = 0
    for _, row in heat_rows.iterrows():
        started = datetime.fromisoformat(str(row["heat_started_at"]))
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        heat = HeatRecord(
            heat_id=row["heat_id"],
            furnace_id=furnace.id,
            metal_grade=row["metal_grade"],
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
            heat_status=row["heat_status"],
            source="synthetic",
            is_synthetic=True,
            heat_started_at=started,
            heat_completed_at=datetime.fromisoformat(str(row["heat_completed_at"])),
        )
        db.add(heat)
        db.flush()
        rows = by_heat.get(row["heat_id"], [])
        # thin the trace: keep every 3rd minute, plus the final point
        if rows:
            keep_indexes = list(range(0, len(rows), 3))
            if keep_indexes[-1] != len(rows) - 1:
                keep_indexes.append(len(rows) - 1)
            keep = [rows[i] for i in keep_indexes]
        else:
            keep = []
        for r in keep:
            db.add(
                SensorReading(
                    heat_record_id=heat.id,
                    ts=datetime.fromisoformat(str(r["ts"])),
                    elapsed_min=float(r["elapsed_min"]),
                    power_kw=float(r["power_kw"]),
                    current_a=float(r["current_a"]),
                    voltage_v=float(r["voltage_v"]),
                    temperature_c=float(r["temperature_c"]),
                    energy_kwh=float(r["energy_kwh"]),
                    melt_progress=float(r["melt_progress"]),
                    charge_weight_kg=float(r["charge_weight_kg"]),
                    is_synthetic=True,
                    quality_flag=str(r.get("quality_flag", "ok")),
                )
            )
        created += 1
        if created % 250 == 0:
            db.commit()
            log.info("Loaded %s heats…", created)
    db.commit()
    return created


def record_model_versions(db, meta: dict):
    db.query(ModelVersion).filter(ModelVersion.is_active.is_(True)).update({"is_active": False})
    trained_at = datetime.now(timezone.utc)
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
                trained_at=trained_at,
                notes="Initial training run on the synthetic dataset.",
                metrics=m,
            )
        )
    db.commit()


def aggregate_energy(db):
    """Persist daily energy analytics rows (module 6/13)."""
    db.query(EnergyAnalytic).delete()
    summary = energy.series(db, granularity="day", days=320)
    for point in summary:
        db.add(
            EnergyAnalytic(
                granularity="day",
                period_date=datetime.fromisoformat(point["label"]).replace(tzinfo=timezone.utc),
                total_energy_kwh=point["energy_kwh"],
                total_charge_kg=point["charge_kg"],
                heat_count=point["heat_count"],
                co2_kg=point["co2_kg"],
                efficiency_score=0.0,
                computed_at=datetime.now(timezone.utc),
            )
        )
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed ForgeOptima AI")
    parser.add_argument("--heats", type=int, default=1200)
    parser.add_argument("--reset", action="store_true", help="Drop and recreate all tables first")
    parser.add_argument("--skip-train", action="store_true")
    args = parser.parse_args()

    if args.reset:
        log.info("Dropping all tables…")
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    data_path = Path(settings.dataset_path)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    artifacts = Path(settings.model_dir)
    artifacts.mkdir(parents=True, exist_ok=True)

    log.info("Generating %s synthetic heats…", args.heats)
    heats_df, readings_df = generate_dataset(args.heats)
    heats_df.to_csv(data_path, index=False)
    readings_df.to_csv(data_path.with_name("synthetic_readings.csv"), index=False)
    log.info("Dataset written: %s heats, %s readings", len(heats_df), len(readings_df))

    # sanity: energy must equal the integral of the power trace
    # energy must equal the rectangular integral of the 1-minute power trace
    check = readings_df.groupby("heat_id", group_keys=False).apply(
        lambda g: abs(g["energy_kwh"].iloc[-1] - g["power_kw"].sum() / 60.0),
        include_groups=False,
    )
    log.info("Energy-integral max deviation across heats: %.3f kWh", float(check.max()))

    db = SessionLocal()
    try:
        if db.query(HeatRecord).first() and not args.reset:
            log.warning("Database already has heats — skipping import (use --reset to rebuild).")
        else:
            furnace = seed_reference_data(db)
            created = load_heats(db, furnace, heats_df, readings_df)
            log.info("Imported %s heats", created)

        if not args.skip_train:
            completed = heats_df[heats_df["heat_status"] == "completed"]
            log.info("Training models on %s completed heats…", len(completed))
            meta = train_all(completed)
            record_model_versions(db, meta)
            for name, info in meta["models"].items():
                m = info.get("metrics") or {}
                if m:
                    log.info(
                        "  %-14s MAE=%-8s RMSE=%-8s R2=%-7s (test n=%s)",
                        name,
                        m.get("mae"),
                        m.get("rmse"),
                        m.get("r2"),
                        m.get("test_samples"),
                    )

        log.info("Scanning recent heats for anomalies…")
        created_anoms = analyze_all(db, limit=30, persist=True)
        log.info("Stored %s anomaly findings", len(created_anoms))
        aggregate_energy(db)
        log.info("Energy analytics aggregated")
    finally:
        db.close()

    log.info("Seed complete. Start the API with: uvicorn app.main:app --reload --port 8000")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

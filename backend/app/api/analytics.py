"""Analytics endpoints: dashboard, energy, grades, performance."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..ml.registry import registry
from ..models import HeatRecord, ModelVersion, Prediction
from ..schemas import DashboardSummary
from ..services import energy, telemetry

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(db: Session = Depends(get_db)):
    return telemetry.dashboard(db)


@router.get("/energy")
def energy_analytics(
    db: Session = Depends(get_db),
    days: int = Query(30, ge=1, le=365),
    granularity: str = Query("day", pattern="^(day|week|month)$"),
):
    return {
        "summary": energy.summarize(db, days=days),
        "series": energy.series(db, granularity=granularity, days=max(days, 45)),
        "waste_findings": energy.waste_findings(db),
        "carbon": energy.carbon_scenarios(db),
        "methodology": {
            "efficiency_score": (
                "100 × (10th-percentile energy per kg for the same grade) ÷ (actual energy per kg), clipped 0-100"
            ),
            "co2": "energy (kWh) × configured grid emission factor (kg CO2/kWh)",
            "comparison": "energy per kg vs the grade's best decile from plant history",
        },
    }


@router.get("/grades")
def grades(db: Session = Depends(get_db)):
    return {"grades": energy.grade_analytics(db), "benchmarks": energy.grade_reference(db)}


@router.get("/performance")
def performance(db: Session = Depends(get_db)):
    """Self-learning performance engine: predicted vs actual on recorded heats."""
    rows = list(
        db.scalars(
            select(Prediction)
            .where(Prediction.actual_value.is_not(None))
            .order_by(Prediction.created_at.desc())
            .limit(200)
        )
    )
    by_model: dict[str, list[Prediction]] = {}
    for row in rows:
        by_model.setdefault(row.model_name, []).append(row)

    accuracy = []
    for name, items in by_model.items():
        errors = [abs((p.actual_value or 0) - p.predicted_value) for p in items]
        mae = sum(errors) / len(errors) if errors else None
        accuracy.append(
            {
                "model_name": name,
                "samples": len(items),
                "live_mae": round(mae, 2) if mae is not None else None,
                "latest": [
                    {
                        "heat_id": p.heat_id,
                        "predicted": p.predicted_value,
                        "actual": p.actual_value,
                        "error": round((p.actual_value or 0) - p.predicted_value, 2),
                        "created_at": p.created_at,
                    }
                    for p in items[:10]
                ],
            }
        )

    versions = list(
        db.scalars(select(ModelVersion).order_by(ModelVersion.trained_at.desc()).limit(20))
    )
    pending = list(
        db.scalars(
            select(Prediction)
            .where(Prediction.actual_value.is_(None), Prediction.heat_id.is_not(None))
            .order_by(Prediction.created_at.desc())
            .limit(50)
        )
    )
    eval_candidates = []
    for p in pending:
        heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == p.heat_id))
        if not heat:
            continue
        actual = {
            "melting_time": heat.melting_time_min,
            "energy": heat.energy_kwh,
            "time_to_target": heat.melting_time_min,
        }.get(p.model_name)
        if actual is None:
            continue
        p.actual_value = actual
        p.abs_error = abs(actual - p.predicted_value)
        eval_candidates.append({"heat": heat.heat_id, "model": p.model_name})
    if eval_candidates:
        db.commit()

    retrain = {
        "recommended": len(eval_candidates) >= 25,
        "reason": (
            f"{len(eval_candidates)} prediction(s) were matched to actual results since the last evaluation."
            if eval_candidates
            else "No new labelled predictions since the last evaluation."
        ),
        "evaluated_now": len(eval_candidates),
        "policy": "New model versions require data validation and evaluation before promotion.",
    }
    return {
        "models_ready": registry.is_ready(),
        "active_version": registry.version,
        "live_accuracy": accuracy,
        "versions": [
            {
                "model_name": v.model_name,
                "version": v.version,
                "algorithm": v.algorithm,
                "dataset_size": v.dataset_size,
                "mae": v.mae,
                "rmse": v.rmse,
                "r2": v.r2,
                "trained_at": v.trained_at,
                "is_active": v.is_active,
                "metrics": v.metrics,
            }
            for v in versions
        ],
        "retraining": retrain,
    }


@router.get("/heat/{heat_id}/timeline")
def heat_timeline(heat_id: str, db: Session = Depends(get_db)):
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id))
    if not heat:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Heat not found.")
    readings = heat.readings
    return {
        "heat_id": heat_id,
        "series": [
            {
                "minute": r.elapsed_min,
                "temperature_c": r.temperature_c,
                "power_kw": r.power_kw,
                "energy_kwh": r.energy_kwh,
                "progress": r.melt_progress,
            }
            for r in readings[:: max(len(readings) // 120, 1)]
        ],
    }

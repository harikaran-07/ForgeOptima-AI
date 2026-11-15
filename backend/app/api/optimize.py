"""Power optimizer / what-if endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..ml.registry import registry
from ..models import HeatRecord, OptimizationScenario
from ..schemas import OptimizeRequest, OptimizationResponse, SimilarHeatOut
from ..services import energy, optimizer

router = APIRouter(prefix="/optimize", tags=["optimizer"])


class CompareRequest(BaseModel):
    metal_grade: str = "MS"
    charge_weight_kg: float = Field(3000, ge=100, le=10000)
    initial_temp_c: float = Field(35, ge=0, le=900)
    target_temp_c: float = Field(1550, ge=500, le=1900)
    baseline_heat_id: Optional[str] = None
    alternative_power_kw: float = Field(2000, ge=50, le=5000)


@router.get("/context")
def context(db: Session = Depends(get_db)):
    limits = optimizer.furnace_limits(db)
    grades = list(db.scalars(select(HeatRecord.metal_grade).distinct()))
    profiles = []
    for grade in sorted(g for g in grades if g):
        ref = optimizer.reference_profile(db, grade)
        if ref:
            profiles.append({"metal_grade": grade, "reference": ref})
    return {
        "limits": limits,
        "grades": sorted(g for g in grades if g),
        "reference_profiles": profiles,
        "safety_notes": optimizer.SAFETY_NOTES,
        "models_ready": registry.is_ready(),
    }


@router.post("/analyze", response_model=OptimizationResponse)
def analyze(payload: OptimizeRequest, db: Session = Depends(get_db)):
    if not registry.is_ready():
        raise HTTPException(status_code=503, detail="Prediction models are not trained; optimization is unavailable.")
    try:
        return optimizer.analyze(db, payload.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {exc}") from exc


@router.post("/compare")
def compare(payload: CompareRequest, db: Session = Depends(get_db)):
    """Compare a named historical heat against an alternative power level."""
    if not payload.baseline_heat_id:
        raise HTTPException(status_code=422, detail="baseline_heat_id is required for a what-if comparison.")
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == payload.baseline_heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {payload.baseline_heat_id} not found.")
    result = optimizer.analyze(
        db,
        {
            "metal_grade": heat.metal_grade,
            "charge_weight_kg": heat.charge_weight_kg,
            "initial_temp_c": heat.initial_temp_c,
            "target_temp_c": heat.target_temp_c,
            "current_power_kw": heat.power_kw,
            "alternative_power_kw": payload.alternative_power_kw,
        },
    )
    return {
        "baseline_heat": {
            "heat_id": heat.heat_id,
            "power_kw": heat.power_kw,
            "melting_time_min": heat.melting_time_min,
            "energy_kwh": heat.energy_kwh,
            "energy_per_kg": round(energy.energy_per_kg(heat), 4),
        },
        **result,
    }


@router.get("/scenarios")
def scenarios(db: Session = Depends(get_db), limit: int = 12):
    rows = list(
        db.scalars(select(OptimizationScenario).order_by(OptimizationScenario.created_at.desc()).limit(limit))
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "metal_grade": s.metal_grade,
            "charge_weight_kg": s.charge_weight_kg,
            "baseline_profile": s.baseline_profile,
            "alternative_profile": s.alternative_profile,
            "results": s.results,
            "created_at": s.created_at,
        }
        for s in rows
    ]

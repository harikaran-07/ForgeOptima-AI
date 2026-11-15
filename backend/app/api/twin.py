"""Digital twin endpoints (stateless-ish in-memory sessions)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import Furnace, SimulationRecord
from ..schemas import TwinStartRequest, TwinState, TwinStepRequest
from ..services.twin import STAGES, twin_store

router = APIRouter(prefix="/digital-twin", tags=["digital twin"])

MODEL_NOTE = (
    "Reduced-order predictive simulation (documented energy balance + first-order thermal lag). "
    "Not a physics-validated industrial digital twin and not suitable for control."
)


@router.get("/model")
def model_description():
    return {
        "note": MODEL_NOTE,
        "stages": STAGES,
        "assumptions": {
            "energy": "E_required = mass_t x specific_energy(grade) x temperature-span factor",
            "delivered": "dE/dt = power x efficiency / 60  (kWh per minute)",
            "temperature": "T trails the energy-implied temperature with a 3.5 min first-order lag",
            "losses": "0.02 degC/min ambient loss",
        },
    }


@router.post("/start", response_model=TwinState)
def start(payload: TwinStartRequest, db: Session = Depends(get_db)):
    furnace = db.scalar(__import__("sqlalchemy").select(Furnace).order_by(Furnace.id).limit(1))
    if furnace and not (furnace.min_power_kw <= payload.power_kw <= furnace.max_power_kw):
        raise HTTPException(
            status_code=422,
            detail=f"Power must stay within engineer-approved limits ({furnace.min_power_kw:.0f}-{furnace.max_power_kw:.0f} kW).",
        )
    session = twin_store.start(**payload.model_dump())
    db.add(
        SimulationRecord(
            session_id=session.session_id,
            metal_grade=session.metal_grade,
            charge_weight_kg=session.charge_weight_kg,
            initial_temp_c=session.initial_temp_c,
            target_temp_c=session.target_temp_c,
            power_kw=session.power_kw,
            efficiency=session.efficiency,
            status="running",
            steps=[session.history[0]],
        )
    )
    db.commit()
    return session.state()


@router.post("/step", response_model=TwinState)
def step(payload: TwinStepRequest, db: Session = Depends(get_db)):
    session = twin_store.get(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Digital twin session not found. Start a new run.")
    session.step(steps=payload.steps, power_kw=payload.power_kw)
    state = session.state()
    if state["is_complete"]:
        record = db.query(SimulationRecord).filter(SimulationRecord.session_id == payload.session_id).first()
        if record and record.status == "running":
            record.status = "completed"
            record.final_temperature_c = state["temperature_c"]
            record.total_energy_kwh = state["energy_kwh"]
            record.duration_min = state["elapsed_min"]
            record.steps = state["history"]
            db.commit()
    return state


@router.post("/stop")
def stop(payload: TwinStepRequest, db: Session = Depends(get_db)):
    session = twin_store.get(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Digital twin session not found.")
    final = session.state()
    record = db.query(SimulationRecord).filter(SimulationRecord.session_id == payload.session_id).first()
    if record and record.status == "running":
        record.status = "stopped"
        record.final_temperature_c = final["temperature_c"]
        record.total_energy_kwh = final["energy_kwh"]
        record.duration_min = final["elapsed_min"]
        record.steps = final["history"]
        db.commit()
    twin_store.stop(payload.session_id)
    return {"stopped": payload.session_id, "final": final}

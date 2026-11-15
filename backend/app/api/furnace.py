"""Furnace telemetry endpoints."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import Furnace, HeatRecord
from ..schemas import FurnaceStatus, LiveSnapshot, SimulationConfig
from ..services import telemetry
from ..services.simulation import simulator

router = APIRouter(prefix="/furnace", tags=["furnace"])


@router.get("/status", response_model=FurnaceStatus)
def furnace_status(db: Session = Depends(get_db)):
    return telemetry.status(db)


@router.get("/readings")
def furnace_readings(db: Session = Depends(get_db), limit: int = Query(120, ge=5, le=900)):
    """Readings for the live simulation if running, otherwise the latest heat trace."""
    snap = simulator.snapshot()
    if snap["running"]:
        return {
            "mode": "simulated",
            "note": "SIMULATED DATA — generated telemetry, not plant sensors.",
            "readings": simulator.readings(limit),
        }
    heat = telemetry.latest_heat(db)
    if not heat:
        return {"mode": "historical", "note": "No readings available.", "readings": []}
    from sqlalchemy import select

    from ..models import SensorReading

    rows = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.heat_record_id == heat.id)
            .order_by(SensorReading.elapsed_min)
        )
    )
    step = max(len(rows) // limit, 1)
    return {
        "mode": "historical",
        "note": f"Historical trace from heat {heat.heat_id}.",
        "heat_id": heat.heat_id,
        "readings": [
            {
                "timestamp": r.ts.isoformat(),
                "elapsed_min": round(r.elapsed_min, 2),
                "power_kw": r.power_kw,
                "current_a": r.current_a,
                "voltage_v": r.voltage_v,
                "temperature_c": r.temperature_c,
                "energy_kwh": r.energy_kwh,
                "melt_progress": r.melt_progress,
                "charge_weight_kg": r.charge_weight_kg,
                "stage": None,
                "is_synthetic": r.is_synthetic,
                "quality_flag": r.quality_flag,
            }
            for r in rows[::step]
        ],
    }


@router.post("/simulate")
def simulate(
    action: Literal["start", "pause", "resume", "reset", "configure"] = Query(...),
    config: SimulationConfig | None = None,
    db: Session = Depends(get_db),
):
    if action == "start":
        if config is None:
            config = SimulationConfig()
        furnace = db.query(Furnace).order_by(Furnace.id).first()
        if furnace and not (furnace.min_power_kw <= config.power_kw <= furnace.max_power_kw):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Power must stay within engineer-approved limits "
                    f"({furnace.min_power_kw:.0f}-{furnace.max_power_kw:.0f} kW)."
                ),
            )
        simulator.start(**config.model_dump())
    elif action == "pause":
        simulator.pause()
    elif action == "resume":
        simulator.resume()
    elif action == "reset":
        simulator.reset()
    elif action == "configure":
        if config is None:
            raise HTTPException(status_code=422, detail="Configuration payload required.")
        simulator.configure(speed=config.speed_multiplier, interval=config.interval_seconds)

    snap = simulator.snapshot()
    payload = _persist_if_complete(db)
    return {"simulation": snap, "persisted_heat": payload}


@router.get("/live")
def live(db: Session = Depends(get_db)):
    snap = simulator.snapshot()
    persisted = _persist_if_complete(db)
    return {"simulation": snap, "persisted_heat": persisted}


def _persist_if_complete(db: Session) -> str | None:
    payload = simulator.finalize_if_complete()
    if not payload:
        return None
    readings = payload.pop("readings", [])
    furnace = db.query(Furnace).order_by(Furnace.id).first()
    heat = HeatRecord(furnace_id=furnace.id if furnace else None, **payload)
    db.add(heat)
    db.flush()
    from ..models import SensorReading

    for r in readings:
        db.add(
            SensorReading(
                heat_record_id=heat.id,
                ts=__import__("datetime").datetime.fromisoformat(r["timestamp"]),
                elapsed_min=r["elapsed_min"],
                power_kw=r["power_kw"],
                current_a=r["current_a"],
                voltage_v=r["voltage_v"],
                temperature_c=r["temperature_c"],
                energy_kwh=r["energy_kwh"],
                melt_progress=r["melt_progress"],
                charge_weight_kg=r["charge_weight_kg"],
                is_synthetic=True,
            )
        )
    db.commit()
    return heat.heat_id


@router.get("/snapshot", response_model=LiveSnapshot | None)
def snapshot():
    snap = simulator.snapshot()
    if not snap["latest"]:
        return None
    latest = snap["latest"]
    from datetime import datetime

    return LiveSnapshot(
        heat_id=snap["heat_id"],
        timestamp=datetime.fromisoformat(latest["timestamp"]),
        elapsed_min=latest["elapsed_min"],
        temperature_c=latest["temperature_c"],
        target_temp_c=snap["target_temp_c"],
        power_kw=latest["power_kw"],
        current_a=latest["current_a"],
        voltage_v=latest["voltage_v"],
        charge_weight_kg=latest["charge_weight_kg"],
        energy_kwh=latest["energy_kwh"],
        melt_progress=latest["melt_progress"],
        predicted_remaining_min=0.0,
        stage=latest["stage"],
    )

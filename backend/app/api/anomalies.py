"""Anomaly detection endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import AnomalyRecord, HeatRecord, SensorReading
from ..schemas import AnomalyAnalyzeRequest, AnomalyOut, SensorQualityIssue
from ..services import anomalies as service

router = APIRouter(prefix="/anomalies", tags=["anomalies"])


@router.get("", response_model=list[AnomalyOut])
def list_anomalies(
    db: Session = Depends(get_db),
    severity: Optional[str] = Query(None, pattern="^(LOW|MEDIUM|HIGH)$"),
    limit: int = Query(100, ge=1, le=500),
):
    return service.list_anomalies(db, severity=severity, limit=limit)


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    rows = db.execute(
        select(AnomalyRecord.severity, func.count(AnomalyRecord.id)).group_by(AnomalyRecord.severity)
    ).all()
    counts = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
    for severity, count in rows:
        counts[severity] = count
    types = db.execute(
        select(AnomalyRecord.anomaly_type, func.count(AnomalyRecord.id))
        .group_by(AnomalyRecord.anomaly_type)
        .order_by(func.count(AnomalyRecord.id).desc())
    ).all()
    total = sum(counts.values())
    return {
        "counts": counts,
        "total": total,
        "by_type": [{"type": t, "count": c} for t, c in types],
        "acknowledged": db.scalar(
            select(func.count(AnomalyRecord.id)).where(AnomalyRecord.acknowledged.is_(True))
        )
        or 0,
        "method": "IsolationForest (contamination 0.04) plus explicit sensor-quality rules",
        "disclaimer": (
            "Statistical anomalies indicate readings worth inspecting. They do not diagnose equipment "
            "faults and must be confirmed by an engineer."
        ),
    }


@router.post("/analyze")
def analyze(payload: AnomalyAnalyzeRequest, db: Session = Depends(get_db)):
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == payload.heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {payload.heat_id} not found.")
    records = service.analyze_heat(db, heat, persist=payload.persist)
    quality = sensor_quality(payload.heat_id, db)
    return {
        "heat_id": payload.heat_id,
        "records": [
            {
                "anomaly_type": r.anomaly_type,
                "severity": r.severity,
                "observed_value": r.observed_value,
                "expected_value": r.expected_value,
                "deviation_pct": r.deviation_pct,
                "score": r.score,
                "explanation": r.explanation,
                "suggested_action": r.suggested_action,
            }
            for r in records
        ],
        "sensor_quality": quality,
    }


@router.post("/scan")
def scan(db: Session = Depends(get_db), limit: int = Query(30, ge=1, le=200)):
    created = service.analyze_all(db, limit=limit, persist=True)
    return {"created": len(created), "message": f"Scanned latest heats; {len(created)} new anomaly record(s) stored."}


@router.patch("/{anomaly_id}/acknowledge", response_model=AnomalyOut)
def acknowledge(anomaly_id: int, db: Session = Depends(get_db)):
    record = db.get(AnomalyRecord, anomaly_id)
    if not record:
        raise HTTPException(status_code=404, detail="Anomaly not found.")
    record.acknowledged = True
    db.commit()
    db.refresh(record)
    return record


@router.get("/quality/{heat_id}", response_model=list[SensorQualityIssue])
def sensor_quality(heat_id: str, db: Session = Depends(get_db)):
    heat = db.scalar(select(HeatRecord).where(HeatRecord.heat_id == heat_id))
    if not heat:
        raise HTTPException(status_code=404, detail=f"Heat {heat_id} not found.")
    readings = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.heat_record_id == heat.id)
            .order_by(SensorReading.elapsed_min)
        )
    )
    issues: list[dict] = []
    if not readings:
        return [{"check": "trace availability", "status": "fail", "detail": "No sensor readings stored for this heat."}]

    flagged = [r for r in readings if r.quality_flag and r.quality_flag != "ok"]
    issues.append(
        {
            "check": "flagged readings",
            "status": "fail" if flagged else "pass",
            "detail": f"{len(flagged)} of {len(readings)} readings flagged during acquisition.",
        }
    )
    gaps = [b.elapsed_min - a.elapsed_min for a, b in zip(readings, readings[1:])]
    max_gap = max(gaps) if gaps else 0
    issues.append(
        {
            "check": "sampling continuity",
            "status": "warn" if max_gap > 5 else "pass",
            "detail": f"Largest sampling gap: {max_gap:.1f} min.",
        }
    )
    drops = [a.elapsed_min for a, b in zip(readings, readings[1:]) if b.temperature_c < a.temperature_c - 25]
    issues.append(
        {
            "check": "temperature monotonicity",
            "status": "warn" if drops else "pass",
            "detail": f"{len(drops)} drop(s) greater than 25 °C during heating.",
        }
    )
    # physical plausibility of current vs power and voltage
    bad_current = 0
    for r in readings:
        if r.voltage_v <= 0:
            continue
        implied = r.power_kw * 1000 / (1.732 * r.voltage_v * 0.92)
        if implied > 0 and abs(r.current_a - implied) / implied > 0.15:
            bad_current += 1
    issues.append(
        {
            "check": "current/power consistency",
            "status": "warn" if bad_current else "pass",
            "detail": f"{bad_current} reading(s) deviate >15% from the power/voltage-implied current.",
        }
    )
    return issues

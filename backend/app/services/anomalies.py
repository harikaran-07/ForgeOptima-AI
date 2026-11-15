"""Anomaly detection: IsolationForest on heat-level indicators plus explicit
sensor-quality rules.

The model flags statistical outliers relative to the plant's own history. It is
a screening aid only: anomalies do NOT diagnose equipment faults. Each record
says what to inspect, not what is broken.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.logging import get_logger
from ..ml.registry import registry
from ..models import AnomalyRecord, HeatRecord, SensorReading
from . import energy

log = get_logger(__name__)

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


def _grade_baseline(db: Session, grade: str) -> dict[str, float]:
    heats = list(
        db.scalars(
            select(HeatRecord).where(
                HeatRecord.metal_grade == grade, HeatRecord.heat_status == "completed"
            )
        )
    )
    if not heats:
        return {}
    return {
        "power_kw": sum(h.power_kw for h in heats) / len(heats),
        "current_a": sum(h.current_a for h in heats) / len(heats),
        "voltage_v": sum(h.voltage_v for h in heats) / len(heats),
        "energy_per_kg": sum(energy.energy_per_kg(h) for h in heats) / len(heats),
        "melting_time_min": sum(h.melting_time_min for h in heats) / len(heats),
    }


def _severity(score: float, deviation_pct: float) -> str:
    if score < -0.08 or abs(deviation_pct) >= 30:
        return "HIGH"
    if score < -0.02 or abs(deviation_pct) >= 15:
        return "MEDIUM"
    return "LOW"


def analyze_heat(db: Session, heat: HeatRecord, persist: bool = True) -> list[AnomalyRecord]:
    baseline = _grade_baseline(db, heat.metal_grade)
    epk = energy.energy_per_kg(heat)
    indicators = {
        "power_kw": heat.power_kw,
        "current_a": heat.current_a,
        "voltage_v": heat.voltage_v,
        "energy_kwh": heat.energy_kwh,
        "melting_time_min": heat.melting_time_min,
        "charge_weight_kg": heat.charge_weight_kg,
        "energy_per_kg": epk,
    }

    try:
        scored = registry.anomaly_score(indicators)
        score = float(scored["score"])
    except Exception as exc:  # model not trained → rule-based only, explicitly logged
        log.warning("IsolationForest unavailable, rule checks only: %s", exc)
        score = 0.0

    findings: list[dict[str, Any]] = []

    def add(anomaly_type: str, observed: float, expected: float | None, explanation: str, action: str):
        dev = 0.0
        if expected not in (None, 0):
            dev = (observed - float(expected)) / float(expected) * 100.0
        findings.append(
            {
                "anomaly_type": anomaly_type,
                "observed_value": float(observed),
                "expected_value": float(expected) if expected is not None else None,
                "deviation_pct": round(dev, 1),
                "severity": _severity(score, dev),
                "score": round(score, 4),
                "explanation": explanation,
                "suggested_action": action,
            }
        )

    if baseline:
        if abs(indicators["power_kw"] - baseline["power_kw"]) / baseline["power_kw"] > 0.18:
            add(
                "Unusual power draw",
                indicators["power_kw"],
                baseline["power_kw"],
                "Average power for this heat is materially different from other heats of the same grade.",
                "Verify power setpoint, tap position and coil cooling; compare the power trace with the approved profile.",
            )
        if abs(indicators["current_a"] - baseline["current_a"]) / baseline["current_a"] > 0.18:
            add(
                "Current variation",
                indicators["current_a"],
                baseline["current_a"],
                "Current draw differs from the grade baseline for a comparable charge.",
                "Check current transformer readings against a clamp meter and inspect busbar connections.",
            )
        if abs(indicators["voltage_v"] - baseline["voltage_v"]) / baseline["voltage_v"] > 0.06:
            add(
                "Voltage abnormality",
                indicators["voltage_v"],
                baseline["voltage_v"],
                "Voltage is outside the normal band for this furnace configuration.",
                "Confirm tap setting and supply voltage stability; log any upstream switching activity.",
            )
        if (epk - baseline["energy_per_kg"]) / baseline["energy_per_kg"] > 0.10:
            add(
                "High specific energy",
                epk,
                baseline["energy_per_kg"],
                "Energy per kg is significantly above comparable heats of the same grade.",
                "Review holding time, charge cleanliness and lid/refractory condition before the next heat.",
            )
        if (heat.melting_time_min - baseline["melting_time_min"]) / baseline["melting_time_min"] > 0.20:
            add(
                "Abnormal melting duration",
                heat.melting_time_min,
                baseline["melting_time_min"],
                "Melting took considerably longer than comparable heats.",
                "Inspect charge mix and bridging; check that the power profile matched the approved ramp.",
            )

    # --- sensor quality checks on the stored trace -------------------------
    readings = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.heat_record_id == heat.id)
            .order_by(SensorReading.elapsed_min)
        )
    )
    if readings:
        suspect = [r for r in readings if r.quality_flag and r.quality_flag != "ok"]
        if suspect:
            add(
                "Sensor quality flag",
                len(suspect),
                None,
                f"{len(suspect)} reading(s) in this heat were flagged as implausible during acquisition.",
                "Re-check the affected instrument channel and exclude flagged points from optimisation evidence.",
            )
        drops = [
            (a.elapsed_min, a.temperature_c)
            for a, b in zip(readings, readings[1:])
            if b.temperature_c < a.temperature_c - 25 and a.elapsed_min > 2
        ]
        if drops:
            add(
                "Non-monotonic temperature",
                drops[0][1],
                None,
                "Temperature dropped sharply during an active heating period.",
                "Check thermocouple contact, compensation cable and any recorded power interruption.",
            )
        gaps = [
            b.elapsed_min - a.elapsed_min
            for a, b in zip(readings, readings[1:])
            if b.elapsed_min - a.elapsed_min > 5
        ]
        if gaps:
            add(
                "Measurement gap",
                max(gaps),
                None,
                "Sampling gap detected in the telemetry stream.",
                "Confirm logger uptime and network path to the historian.",
            )

    if not findings and score < -0.05:
        add(
            "Statistical outlier",
            heat.energy_kwh,
            (baseline.get("energy_per_kg", epk) * heat.charge_weight_kg) if baseline else None,
            "No single rule threshold was breached, but the multivariate IsolationForest score marks "
            "this heat as an outlier relative to plant history.",
            "Review the heat trace for combined deviations; no immediate action required.",
        )

    records: list[AnomalyRecord] = []
    for finding in findings:
        record = AnomalyRecord(
            heat_id=heat.heat_id,
            detected_at=datetime.now(timezone.utc),
            context={"heat_id": heat.heat_id, "grade": heat.metal_grade, "isolation_forest_score": score},
            **finding,
        )
        if persist:
            db.add(record)
        records.append(record)
    if persist:
        db.commit()
        for record in records:
            db.refresh(record)
    return records


def analyze_all(db: Session, limit: int = 40, persist: bool = True) -> list[AnomalyRecord]:
    heats = list(
        db.scalars(
            select(HeatRecord)
            .where(HeatRecord.heat_status.in_(["completed", "aborted"]))
            .order_by(HeatRecord.heat_started_at.desc())
            .limit(limit)
        )
    )
    existing = {h for h in db.scalars(select(AnomalyRecord.heat_id).distinct())}
    created: list[AnomalyRecord] = []
    for heat in heats:
        if persist and heat.heat_id in existing:
            continue
        created.extend(analyze_heat(db, heat, persist=persist))
    return created


def list_anomalies(db: Session, severity: str | None = None, limit: int = 100) -> list[AnomalyRecord]:
    stmt = select(AnomalyRecord)
    if severity:
        stmt = stmt.where(AnomalyRecord.severity == severity.upper())
    stmt = stmt.order_by(AnomalyRecord.detected_at.desc()).limit(limit)
    return sorted(list(db.scalars(stmt)), key=lambda r: (SEVERITY_ORDER.get(r.severity, 3), -r.id))

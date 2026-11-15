"""Energy intelligence: consumption analytics, efficiency scoring, emissions.

EFFICIENCY SCORE (documented, transparent):

    score = clip(100 * reference_energy_per_kg / actual_energy_per_kg, 0, 100)

where `reference_energy_per_kg` is the 10th-percentile energy per kg among
completed heats of the same metal grade (a best-practice benchmark from the
plant's own history). A heat matching the best decile of its grade scores ~100;
an average heat typically scores 85-92; a wasteful heat scores below 80.
No arbitrary weights or hidden constants are involved.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import HeatRecord
from . import runtime_settings


def _completed(db: Session, days: int | None = None, since: datetime | None = None) -> list[HeatRecord]:
    stmt = select(HeatRecord).where(HeatRecord.heat_status == "completed")
    if since is not None:
        stmt = stmt.where(HeatRecord.heat_started_at >= since)
    elif days:
        stmt = stmt.where(
            HeatRecord.heat_started_at >= datetime.now(timezone.utc) - timedelta(days=days)
        )
    return list(db.scalars(stmt.order_by(HeatRecord.heat_started_at.desc())))


def energy_per_kg(heat: HeatRecord) -> float:
    return heat.energy_kwh / max(heat.charge_weight_kg, 1.0)


def grade_reference(db: Session) -> dict[str, float]:
    """10th percentile energy/kg per grade = best-practice benchmark."""
    grouped: dict[str, list[float]] = defaultdict(list)
    for heat in _completed(db):
        grouped[heat.metal_grade].append(energy_per_kg(heat))
    refs: dict[str, float] = {}
    for grade, values in grouped.items():
        values.sort()
        idx = max(int(len(values) * 0.10) - 1, 0)
        refs[grade] = values[idx]
    return refs


def efficiency_score(actual_epk: float, reference_epk: float) -> float:
    if actual_epk <= 0:
        return 0.0
    return round(min(100.0, max(0.0, 100.0 * reference_epk / actual_epk)), 1)


def emission_factor() -> float:
    return float(runtime_settings.current()["emission_factor_kg_per_kwh"])


def summarize(db: Session, days: int = 30) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    heats = _completed(db, since=since)
    refs = grade_reference(db)
    factor = emission_factor()

    total_energy = sum(h.energy_kwh for h in heats)
    total_charge = sum(h.charge_weight_kg for h in heats)
    scores = [efficiency_score(energy_per_kg(h), refs.get(h.metal_grade, energy_per_kg(h))) for h in heats]

    by_grade: dict[str, list[float]] = defaultdict(list)
    for h in heats:
        by_grade[h.metal_grade].append(energy_per_kg(h))
    grade_avg = {g: mean(v) for g, v in by_grade.items() if v}

    best_grade = min(grade_avg, key=grade_avg.get) if grade_avg else None
    worst_grade = max(grade_avg, key=grade_avg.get) if grade_avg else None

    today = datetime.now(timezone.utc).date()
    today_heats = [h for h in _completed(db) if h.heat_started_at.date() == today]

    return {
        "total_energy_kwh": round(total_energy, 1),
        "total_charge_kg": round(total_charge, 1),
        "heat_count": len(heats),
        "avg_energy_per_heat": round(total_energy / len(heats), 1) if heats else 0.0,
        "avg_energy_per_kg": round(total_energy / total_charge, 4) if total_charge else 0.0,
        "avg_efficiency_score": round(mean(scores), 1) if scores else 0.0,
        "co2_kg": round(total_energy * factor, 1),
        "emission_factor": factor,
        "period": {
            "days": days,
            "from": since.date().isoformat(),
            "to": today.isoformat(),
        },
        "best_grade": best_grade,
        "worst_grade": worst_grade,
        "today_energy_kwh": round(sum(h.energy_kwh for h in today_heats), 1),
        "today_co2_kg": round(sum(h.energy_kwh for h in today_heats) * factor, 1),
        "today_heats": len(today_heats),
        "grade_reference_energy_per_kg": {g: round(v, 4) for g, v in refs.items()},
        "efficiency_method": (
            "score = 100 x (10th-percentile energy/kg for the same grade) / (actual energy/kg), clipped 0-100"
        ),
    }


def series(db: Session, granularity: str = "day", days: int = 45) -> list[dict[str, Any]]:
    heats = _completed(db, since=datetime.now(timezone.utc) - timedelta(days=days))
    factor = emission_factor()
    buckets: dict[str, list[HeatRecord]] = defaultdict(list)

    for heat in heats:
        dt = heat.heat_started_at
        if granularity == "month":
            key = dt.strftime("%Y-%m")
        elif granularity == "week":
            iso = dt.isocalendar()
            key = f"{iso.year}-W{iso.week:02d}"
        else:
            key = dt.strftime("%Y-%m-%d")
        buckets[key].append(heat)

    points = []
    for key in sorted(buckets):
        items = buckets[key]
        energy = sum(h.energy_kwh for h in items)
        charge = sum(h.charge_weight_kg for h in items)
        points.append(
            {
                "label": key,
                "energy_kwh": round(energy, 1),
                "charge_kg": round(charge, 1),
                "energy_per_kg": round(energy / charge, 4) if charge else 0.0,
                "co2_kg": round(energy * factor, 1),
                "heat_count": len(items),
            }
        )
    return points


def waste_findings(db: Session, limit: int = 8, min_excess_pct: float = 6.0) -> list[dict[str, Any]]:
    """Heats whose energy/kg exceeds the grade benchmark by more than min_excess_pct."""
    refs = grade_reference(db)
    findings: list[dict[str, Any]] = []
    for heat in _completed(db, days=120):
        ref = refs.get(heat.metal_grade)
        if not ref:
            continue
        actual = energy_per_kg(heat)
        excess = (actual - ref) / ref * 100.0
        if excess < min_excess_pct:
            continue
        factors: list[str] = []
        if heat.melting_time_min > 90:
            factors.append(f"long melting duration ({heat.melting_time_min:.0f} min)")
        if heat.power_kw < 0.55 * max(heat.charge_weight_kg * 0.7, 1):
            factors.append(f"low average power for the charge ({heat.power_kw:.0f} kW)")
        if heat.ambient_temp_c > 36:
            factors.append(f"high ambient temperature ({heat.ambient_temp_c:.0f} °C)")
        if heat.target_temp_c - heat.initial_temp_c > 1550:
            factors.append("wide temperature span from cold charge")
        if not factors:
            factors.append("no single dominant factor — review refractory condition and charge quality")
        findings.append(
            {
                "heat_id": heat.heat_id,
                "metal_grade": heat.metal_grade,
                "observed_energy_kwh": round(heat.energy_kwh, 1),
                "expected_energy_kwh": round(ref * heat.charge_weight_kg, 1),
                "excess_pct": round(excess, 1),
                "contributing_factors": factors,
            }
        )
    findings.sort(key=lambda f: f["excess_pct"], reverse=True)
    return findings[:limit]


def grade_analytics(db: Session) -> list[dict[str, Any]]:
    refs = grade_reference(db)
    grouped: dict[str, list[HeatRecord]] = defaultdict(list)
    for heat in _completed(db, days=180):
        grouped[heat.metal_grade].append(heat)

    results = []
    for grade, items in grouped.items():
        epk = [energy_per_kg(h) for h in items]
        best_idx = min(range(len(items)), key=lambda i: epk[i])
        results.append(
            {
                "metal_grade": grade,
                "heat_count": len(items),
                "avg_melting_time_min": round(mean(h.melting_time_min for h in items), 1),
                "avg_energy_kwh": round(mean(h.energy_kwh for h in items), 1),
                "avg_energy_per_kg": round(mean(epk), 4),
                "avg_power_kw": round(mean(h.power_kw for h in items), 1),
                "avg_efficiency_score": round(
                    mean(efficiency_score(e, refs.get(grade, e)) for e in epk), 1
                ),
                "best_heat_id": items[best_idx].heat_id,
                "best_energy_per_kg": round(epk[best_idx], 4),
            }
        )
    results.sort(key=lambda r: r["heat_count"], reverse=True)
    return results


def carbon_scenarios(db: Session, improvement_pct: float = 5.0) -> dict[str, Any]:
    """Current vs hypothetical emissions if energy per kg dropped by improvement_pct."""
    summary = summarize(db, days=30)
    total = summary["total_energy_kwh"]
    factor = emission_factor()
    reduced = total * (1 - improvement_pct / 100.0)
    return {
        "emission_factor_kg_per_kwh": factor,
        "current_co2_kg": round(total * factor, 1),
        "scenario_improvement_pct": improvement_pct,
        "scenario_co2_kg": round(reduced * factor, 1),
        "avoided_co2_kg": round((total - reduced) * factor, 1),
        "note": (
            "Estimated emissions, not verified measurements. CO2 = energy (kWh) x configured grid "
            "emission factor; actual grid intensity varies by region, time and supplier."
        ),
    }

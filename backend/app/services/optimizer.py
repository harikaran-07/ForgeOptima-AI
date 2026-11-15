"""Intelligent Power Optimizer and What-If analysis.

Safety contract:
  * Candidate power values are clipped to the furnace's engineer-approved
    min/max power. Nothing outside those limits is ever recommended.
  * The optimizer only ranks hypothetical profiles using the trained models.
    It never issues control commands and never claims verified savings.
"""
from __future__ import annotations

from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ml.registry import registry
from ..models import Furnace, HeatRecord, OptimizationScenario
from . import energy
from .twin import implied_temperature

DEFAULT_LIMITS = {"min_power_kw": 350.0, "max_power_kw": 3200.0}
SAFETY_NOTES = [
    "Decision support only — ForgeOptima AI never adjusts furnace power setpoints.",
    "All alternative profiles are experimental simulations unless marked engineer-approved.",
    "Any profile change requires review and sign-off by a qualified furnace engineer.",
    "Simulated efficiency gains are model estimates, not verified industrial savings.",
]


def furnace_limits(db: Session) -> dict[str, float]:
    furnace = db.scalar(select(Furnace).order_by(Furnace.id).limit(1))
    if not furnace:
        return dict(DEFAULT_LIMITS)
    return {
        "min_power_kw": furnace.min_power_kw,
        "max_power_kw": furnace.max_power_kw,
        "rated_power_kw": furnace.rated_power_kw,
        "capacity_kg": furnace.capacity_kg,
    }


def _temperature_curve(power_kw: float, minutes: float, initial: float, target: float, steps: int = 12) -> list[dict[str, float]]:
    curve = []
    for i in range(steps + 1):
        frac = i / steps
        progress = min(frac * 100.0, 100.0)
        curve.append(
            {
                "minute": round(minutes * frac, 1),
                "temperature_c": round(implied_temperature(progress, initial, target), 1),
                "progress": round(progress, 1),
            }
        )
    return curve


def _predict_profile(db: Session, payload: dict, power_kw: float, label: str, limits: dict[str, float]) -> dict[str, Any]:
    base = dict(payload)
    base["power_kw"] = power_kw
    melt = registry.predict_melting_time(base)
    minutes = float(melt["predicted_value"])
    energy_pred = registry.predict_energy({**base, "melting_time_min": minutes})
    kwh = float(energy_pred["predicted_value"])
    in_limits = limits["min_power_kw"] <= power_kw <= limits["max_power_kw"]
    notes = []
    if not in_limits:
        notes.append("Power is outside engineer-approved limits and was excluded from recommendations.")
    if power_kw > 0.92 * limits.get("rated_power_kw", power_kw):
        notes.append("Near rated power — sustained operation may increase coil and refractory thermal stress.")
    return {
        "label": label,
        "power_kw": round(power_kw, 1),
        "melting_time_min": round(minutes, 1),
        "energy_kwh": round(kwh, 1),
        "energy_per_kg": round(kwh / max(float(payload["charge_weight_kg"]), 1.0), 4),
        "temperature_curve": _temperature_curve(
            power_kw, minutes, payload["initial_temp_c"], payload["target_temp_c"]
        ),
        "is_within_limits": in_limits,
        "notes": notes,
    }


def _evidence(db: Session, payload: dict, limit: int = 5) -> list[dict[str, Any]]:
    try:
        return registry.similar_heats(payload, k=limit)
    except Exception:
        # fall back to grade matches when the retrieval model is unavailable
        heats = list(
            db.scalars(
                select(HeatRecord)
                .where(HeatRecord.metal_grade == payload["metal_grade"])
                .order_by(HeatRecord.energy_kwh.asc())
                .limit(limit)
            )
        )
        return [
            {
                "heat_id": h.heat_id,
                "metal_grade": h.metal_grade,
                "charge_weight_kg": h.charge_weight_kg,
                "power_kw": h.power_kw,
                "melting_time_min": h.melting_time_min,
                "energy_kwh": h.energy_kwh,
                "energy_per_kg": round(energy.energy_per_kg(h), 4),
                "distance": 0.0,
                "similarity": 0.0,
            }
            for h in heats
        ]


def analyze(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    limits = furnace_limits(db)
    current_power = float(payload["current_power_kw"])
    alternative_power = float(payload.get("alternative_power_kw") or current_power * 1.12)
    alternative_power = max(limits["min_power_kw"], min(alternative_power, limits["max_power_kw"]))

    current = _predict_profile(db, payload, current_power, "Current profile", limits)
    alternative = _predict_profile(db, payload, alternative_power, "Alternative profile", limits)

    delta_energy = alternative["energy_kwh"] - current["energy_kwh"]
    delta_time = alternative["melting_time_min"] - current["melting_time_min"]
    pct = (delta_energy / current["energy_kwh"] * 100.0) if current["energy_kwh"] else 0.0

    evidence = _evidence(db, payload)
    if evidence:
        best = min(evidence, key=lambda e: e["energy_per_kg"])
        evidence_note = (
            f"Among {len(evidence)} comparable heats, {best['heat_id']} used "
            f"{best['energy_per_kg']:.3f} kWh/kg — the lowest in the neighbour set."
        )
    else:
        evidence_note = "No comparable historical heats were found for this grade and charge."

    recommendations = []
    if delta_energy < -0.5:
        recommendations.append(
            f"At {alternative_power:.0f} kW the model estimates {abs(delta_energy):.0f} kWh less energy "
            f"({abs(pct):.1f}% reduction) with {abs(delta_time):.0f} min "
            f"{'shorter' if delta_time < 0 else 'longer'} melting time. Treat as an experimental scenario."
        )
    elif delta_energy > 0.5:
        recommendations.append(
            f"Raising power to {alternative_power:.0f} kW is not estimated to save energy "
            f"({delta_energy:+.0f} kWh); it mainly shortens melting time by {abs(delta_time):.0f} min."
        )
    else:
        recommendations.append("The two profiles are estimated to consume within 1 kWh of each other.")

    recommendations.append(evidence_note)
    recommendations.append(
        f"Keep power within {limits['min_power_kw']:.0f}-{limits['max_power_kw']:.0f} kW "
        "(engineer-approved furnace envelope)."
    )

    scenario = OptimizationScenario(
        name=f"What-if {payload['metal_grade']} {payload['charge_weight_kg']:.0f}kg",
        metal_grade=payload["metal_grade"],
        charge_weight_kg=payload["charge_weight_kg"],
        baseline_profile={"power_kw": current_power},
        alternative_profile={"power_kw": alternative_power},
        results={
            "delta_energy_kwh": round(delta_energy, 1),
            "delta_time_min": round(delta_time, 1),
        },
    )
    db.add(scenario)
    db.commit()

    return {
        "current": current,
        "alternative": alternative,
        "delta_energy_kwh": round(delta_energy, 1),
        "delta_energy_pct": round(pct, 2),
        "delta_time_min": round(delta_time, 1),
        "evidence": evidence,
        "limits": limits,
        "safety_notes": SAFETY_NOTES,
        "recommendations": recommendations,
    }


def reference_profile(db: Session, metal_grade: str) -> dict[str, Any] | None:
    """Best-performing historical heat of a grade, used as a profile baseline."""
    heats = list(
        db.scalars(
            select(HeatRecord).where(
                HeatRecord.metal_grade == metal_grade, HeatRecord.heat_status == "completed"
            )
        )
    )
    if not heats:
        return None
    best = min(heats, key=energy.energy_per_kg)
    return {
        "heat_id": best.heat_id,
        "power_kw": best.power_kw,
        "melting_time_min": best.melting_time_min,
        "energy_kwh": best.energy_kwh,
        "energy_per_kg": round(energy.energy_per_kg(best), 4),
        "charge_weight_kg": best.charge_weight_kg,
        "grade_mean_power_kw": round(mean(h.power_kw for h in heats), 1),
    }

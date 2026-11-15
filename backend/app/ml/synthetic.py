"""Physically-plausible synthetic induction furnace dataset generation.

DOCUMENTED ASSUMPTIONS (all values are engineering estimates for demonstration,
not measurements from a real plant):

1. Specific melting energy per metal grade (kWh per tonne, includes superheat to
   the grade's typical tap temperature and typical induction losses):
      MS 580, SS304 640, SS316 665, Alloy Steel 620, Cast Iron 520,
      Al Alloy 560, Cu Alloy 430.
   Source range: medium-frequency coreless induction furnaces typically require
   500-700 kWh/t for steel melting.

2. Useful power is a fraction of the electrical input:
      usable_power_kw = power_kw * efficiency,  efficiency ~ N(0.72, 0.035)
   so  power_kw ~ specific_energy * tonnes / (efficiency * hours).

3. Energy is the integral of power over the heat:
      energy_kwh = sum(power_kw_i * dt_hours_i)
   The generator builds the 1-minute power trace first and derives energy from
   it, so energy and the trace can never contradict each other.

4. Current is derived from power and voltage with a power factor:
      current_a = power_kw * 1000 / (sqrt(3) * voltage_v * power_factor)
   Voltage drifts slightly with tap changes and power level.

5. Temperature follows delivered energy, not wall-clock time: the melt fraction
   is the fraction of the grade's required energy already delivered, and the
   temperature curve is initial -> target with a plateau through the latent-heat
   region (0.35-0.85 melt fraction). A small superheat overshoot is added.

6. Ambient temperature varies by season/shift and slightly affects losses.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

RNG_SEED = 20251115

# grade -> (specific energy kWh/t, default target temp C, melting temp C)
GRADE_SPECS: dict[str, dict[str, float]] = {
    "MS": {"specific_energy_kwh_per_t": 580.0, "target_temp_c": 1550.0, "melting_temp_c": 1500.0},
    "SS304": {"specific_energy_kwh_per_t": 640.0, "target_temp_c": 1520.0, "melting_temp_c": 1450.0},
    "SS316": {"specific_energy_kwh_per_t": 665.0, "target_temp_c": 1500.0, "melting_temp_c": 1400.0},
    "Alloy Steel": {"specific_energy_kwh_per_t": 620.0, "target_temp_c": 1580.0, "melting_temp_c": 1480.0},
    "Cast Iron": {"specific_energy_kwh_per_t": 520.0, "target_temp_c": 1420.0, "melting_temp_c": 1200.0},
    "Al Alloy": {"specific_energy_kwh_per_t": 560.0, "target_temp_c": 760.0, "melting_temp_c": 660.0},
    "Cu Alloy": {"specific_energy_kwh_per_t": 430.0, "target_temp_c": 1150.0, "melting_temp_c": 1080.0},
}

GRADE_LIST = list(GRADE_SPECS.keys())
GRADE_WEIGHTS = [0.34, 0.16, 0.09, 0.14, 0.11, 0.09, 0.07]

FURNACE_CAPACITY_KG = 5000.0
RATED_POWER_KW = 3500.0
MIN_POWER_KW = 350.0
MAX_POWER_KW = 3200.0
NOMINAL_VOLTAGE_V = 760.0
POWER_FACTOR = 0.92


@dataclass
class HeatSpec:
    heat_id: str
    metal_grade: str
    charge_weight_kg: float
    initial_temp_c: float
    target_temp_c: float
    power_kw: float
    ambient_temp_c: float
    efficiency: float
    started_at: datetime
    is_synthetic: bool = True


def nominal_current(power_kw: float, voltage_v: float, power_factor: float = POWER_FACTOR) -> float:
    """Three-phase current implied by power, line voltage and power factor."""
    return power_kw * 1000.0 / (math.sqrt(3) * max(voltage_v, 1.0) * max(power_factor, 0.5))


def required_energy_kwh(grade: str, charge_kg: float, initial_c: float, target_c: float) -> float:
    """Documented target energy for a heat (kWh).

    Base specific energy is scaled by the fraction of the (initial -> target)
    temperature span relative to the grade's typical span, with a floor so that
    cold scrap always needs at least 45% of the nominal energy.
    """
    spec = GRADE_SPECS[grade]
    nominal_span = max(spec["target_temp_c"] - 35.0, 1.0)
    actual_span = max(target_c - initial_c, 1.0)
    span_factor = min(max(actual_span / nominal_span, 0.45), 1.35)
    return (charge_kg / 1000.0) * spec["specific_energy_kwh_per_t"] * span_factor


def _power_trace(rng: np.random.Generator, base_power: float, duration_min: int) -> np.ndarray:
    """Power profile: short ramp-up, steady melt plateau, short superheat taper."""
    t = np.arange(duration_min, dtype=float)
    frac = t / max(duration_min - 1, 1)

    ramp = np.clip(frac / 0.08, 0.0, 1.0)                    # 0-8% ramp
    plateau = 1.0 - 0.06 * np.clip((frac - 0.8) / 0.2, 0, 1)  # small taper at the end
    noise = rng.normal(0.0, 0.018, size=duration_min)
    drift = 0.02 * np.sin(frac * math.pi)                     # thermal drift

    power = base_power * (0.55 + 0.45 * ramp) * plateau * (1.0 + noise + drift)
    power[0] = base_power * 0.35
    return np.clip(power, MIN_POWER_KW * 0.6, RATED_POWER_KW)


def build_heat(rng: np.random.Generator, index: int, started_at: datetime) -> tuple[dict, pd.DataFrame]:
    grade = str(rng.choice(GRADE_LIST, p=GRADE_WEIGHTS))
    spec = GRADE_SPECS[grade]

    charge = float(np.clip(rng.normal(3000, 900), 600, FURNACE_CAPACITY_KG))
    charge = round(charge / 50.0) * 50.0

    initial = float(np.clip(rng.normal(60, 35), 20, 320))
    target = float(round(np.clip(spec["target_temp_c"] + rng.normal(0, 35), 620, 1750), 0))
    if target <= initial + 150:
        target = initial + 300

    ambient = float(np.clip(rng.normal(31, 6), 18, 46))
    efficiency = float(np.clip(rng.normal(0.72 - (ambient - 31) * 0.001, 0.035), 0.55, 0.86))

    base_power = float(np.clip(charge * rng.uniform(0.42, 0.72), 450, MAX_POWER_KW))

    target_energy = required_energy_kwh(grade, charge, initial, target)
    # Operator variance: 3-12% heat losses above the ideal target.
    loss_factor = 1.0 + rng.uniform(0.03, 0.12)
    duration_min = int(np.clip(round(target_energy * loss_factor / base_power * 60.0), 18, 300))

    power_trace = _power_trace(rng, base_power, duration_min)
    dt_h = 1.0 / 60.0
    energy_trace = np.cumsum(power_trace * dt_h)
    total_energy = float(energy_trace[-1])

    voltage_base = NOMINAL_VOLTAGE_V * rng.uniform(0.94, 1.04)
    power_factor = float(np.clip(rng.normal(POWER_FACTOR, 0.012), 0.86, 0.97))

    rows = []
    delivered = np.maximum(energy_trace, 1e-6)
    for minute in range(duration_min):
        p = float(power_trace[minute])
        # melt fraction from delivered energy, not time
        melt_frac = float(min(delivered[minute] / max(total_energy, 1e-6), 1.0))
        if melt_frac < 0.35:
            temp = initial + (target - initial) * 0.55 * (melt_frac / 0.35)
        elif melt_frac < 0.85:
            # latent heat plateau: ~35% of the temperature span
            temp = initial + (target - initial) * (0.55 + 0.30 * (melt_frac - 0.35) / 0.50)
        else:
            temp = initial + (target - initial) * (0.85 + 0.15 * (melt_frac - 0.85) / 0.15)
        temp += rng.normal(0, 6)

        v = float(voltage_base * (1 + rng.normal(0, 0.008)))
        i = p * 1000.0 / (math.sqrt(3) * v * power_factor)
        quality = "ok"
        roll = rng.random()
        if roll < 0.004:
            i *= 1.22
            quality = "suspect_current"
        elif roll < 0.006:
            v *= 0.88
            quality = "suspect_voltage"

        rows.append(
            {
                "minute": minute,
                "power_kw": round(p, 1),
                "current_a": round(i, 1),
                "voltage_v": round(v, 1),
                "temperature_c": round(temp, 1),
                "energy_kwh": round(float(energy_trace[minute]), 2),
                "melt_progress": round(melt_frac * 100.0, 2),
                "charge_weight_kg": charge,
                "quality_flag": quality,
            }
        )

    trace = pd.DataFrame(rows)
    mean_power = float(trace["power_kw"].mean())
    mean_current = float(trace["current_a"].mean())
    mean_voltage = float(trace["voltage_v"].mean())

    # 2% of heats are aborted part-way through (data quality reality)
    aborted = rng.random() < 0.02
    if aborted:
        cut = int(len(trace) * rng.uniform(0.3, 0.75))
        trace = trace.iloc[:cut].reset_index(drop=True)
        total_energy = float(trace["energy_kwh"].iloc[-1])
        duration_min = int(trace["minute"].iloc[-1]) + 1
        final_temp = float(trace["temperature_c"].iloc[-1])
        mean_power = float(trace["power_kw"].mean())
        mean_current = float(trace["current_a"].mean())
        mean_voltage = float(trace["voltage_v"].mean())
    else:
        final_temp = float(trace["temperature_c"].iloc[-1])

    record = {
        "heat_id": f"H-{started_at:%Y%m%d}-{index:04d}",
        "metal_grade": grade,
        "charge_weight_kg": charge,
        "initial_temp_c": round(initial, 1),
        "target_temp_c": target,
        "power_kw": round(mean_power, 1),
        "current_a": round(mean_current, 1),
        "voltage_v": round(mean_voltage, 1),
        "melting_time_min": round(float(duration_min), 1),
        "energy_kwh": round(total_energy, 2),
        "ambient_temp_c": round(ambient, 1),
        "power_factor": round(power_factor, 3),
        "final_temperature_c": round(final_temp, 1),
        "efficiency": round(efficiency, 3),
        "heat_status": "aborted" if aborted else "completed",
        "heat_started_at": started_at.isoformat(),
        "heat_completed_at": (started_at + timedelta(minutes=duration_min)).isoformat(),
        "source": "synthetic",
        "is_synthetic": True,
    }
    return record, trace


def generate_dataset(n_heats: int = 1200, seed: int = RNG_SEED, start: datetime | None = None):
    """Return (heats_df, readings_df) with internally consistent values."""
    rng = np.random.default_rng(seed)
    end = start or datetime(2026, 11, 14, 18, 0, 0)
    heat_rows: list[dict] = []
    reading_rows: list[dict] = []

    # Spread heats across ~10 months, 2-4 heats per operating day.
    day_offsets = np.sort(rng.integers(0, 300, size=n_heats))
    for idx in range(n_heats):
        day = end - timedelta(days=int(day_offsets[idx]))
        hour = int(rng.integers(6, 22))
        started = day.replace(hour=hour, minute=int(rng.integers(0, 60)), second=0, microsecond=0)
        record, trace = build_heat(rng, idx + 1, started)
        heat_rows.append(record)
        for _, row in trace.iterrows():
            reading_rows.append(
                {
                    "heat_id": record["heat_id"],
                    "ts": (started + timedelta(minutes=int(row["minute"]))).isoformat(),
                    "elapsed_min": float(row["minute"]),
                    "power_kw": row["power_kw"],
                    "current_a": row["current_a"],
                    "voltage_v": row["voltage_v"],
                    "temperature_c": row["temperature_c"],
                    "energy_kwh": row["energy_kwh"],
                    "melt_progress": row["melt_progress"],
                    "charge_weight_kg": row["charge_weight_kg"],
                    "is_synthetic": True,
                    "quality_flag": row["quality_flag"],
                }
            )

    heats_df = pd.DataFrame(heat_rows).sort_values("heat_started_at").reset_index(drop=True)
    readings_df = pd.DataFrame(reading_rows)
    return heats_df, readings_df


if __name__ == "__main__":  # pragma: no cover
    h, r = generate_dataset(1200)
    print(h.shape, r.shape)

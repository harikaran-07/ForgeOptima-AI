"""Feature engineering shared by training and inference."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .synthetic import GRADE_LIST, GRADE_SPECS

GRADE_CODES = {g: i for i, g in enumerate(GRADE_LIST)}

MELTING_FEATURES = [
    "charge_weight_kg",
    "initial_temp_c",
    "target_temp_c",
    "temp_span_c",
    "power_kw",
    "ambient_temp_c",
    "grade_code",
    "energy_per_kg_nominal",
]

ENERGY_FEATURES = [
    "charge_weight_kg",
    "grade_code",
    "power_kw",
    "current_a",
    "voltage_v",
    "initial_temp_c",
    "target_temp_c",
    "temp_span_c",
    "melting_time_min",
    "ambient_temp_c",
    "energy_per_kg_nominal",
]

TARGET_FEATURES = [
    "charge_weight_kg",
    "initial_temp_c",
    "target_temp_c",
    "temp_span_c",
    "power_kw",
    "ambient_temp_c",
    "grade_code",
    "elapsed_min",
    "current_temperature_c",
    "energy_to_date_kwh",
]

FEATURE_LABELS = {
    "charge_weight_kg": "Charge weight (kg)",
    "initial_temp_c": "Initial temperature (°C)",
    "target_temp_c": "Target temperature (°C)",
    "temp_span_c": "Temperature span (°C)",
    "power_kw": "Power (kW)",
    "ambient_temp_c": "Ambient temperature (°C)",
    "grade_code": "Metal grade",
    "energy_per_kg_nominal": "Nominal specific energy (kWh/kg)",
    "current_a": "Current (A)",
    "voltage_v": "Voltage (V)",
    "melting_time_min": "Melting duration (min)",
    "elapsed_min": "Elapsed time (min)",
    "current_temperature_c": "Current temperature (°C)",
    "energy_to_date_kwh": "Energy delivered so far (kWh)",
}


def encode_grade(grade: str) -> int:
    if grade in GRADE_CODES:
        return GRADE_CODES[grade]
    # tolerate unknown grades by falling back to mild steel
    return GRADE_CODES["MS"]


def nominal_energy_per_kg(grade: str, initial_c: float, target_c: float) -> float:
    spec = GRADE_SPECS.get(grade, GRADE_SPECS["MS"])
    span = max(spec["target_temp_c"] - 35.0, 1.0)
    factor = min(max((target_c - initial_c) / span, 0.45), 1.35)
    return spec["specific_energy_kwh_per_t"] / 1000.0 * factor


def melting_frame(payload: dict[str, Any]) -> pd.DataFrame:
    grade = payload["metal_grade"]
    return pd.DataFrame(
        [
            {
                "charge_weight_kg": payload["charge_weight_kg"],
                "initial_temp_c": payload["initial_temp_c"],
                "target_temp_c": payload["target_temp_c"],
                "temp_span_c": payload["target_temp_c"] - payload["initial_temp_c"],
                "power_kw": payload["power_kw"],
                "ambient_temp_c": payload.get("ambient_temp_c", 32.0),
                "grade_code": encode_grade(grade),
                "energy_per_kg_nominal": nominal_energy_per_kg(
                    grade, payload["initial_temp_c"], payload["target_temp_c"]
                ),
            }
        ]
    )[MELTING_FEATURES]


def energy_frame(payload: dict[str, Any]) -> pd.DataFrame:
    grade = payload["metal_grade"]
    voltage = payload.get("voltage_v") or 760.0
    current = payload.get("current_a") or (payload["power_kw"] * 1000.0 / (1.732 * voltage * 0.92))
    melting_time = payload.get("melting_time_min")
    if not melting_time:
        melting_time = payload.get("elapsed_min") or (
            payload["charge_weight_kg"]
            * nominal_energy_per_kg(grade, payload["initial_temp_c"], payload["target_temp_c"])
            / max(payload["power_kw"], 1)
            * 60.0
        )
    return pd.DataFrame(
        [
            {
                "charge_weight_kg": payload["charge_weight_kg"],
                "grade_code": encode_grade(grade),
                "power_kw": payload["power_kw"],
                "current_a": current,
                "voltage_v": voltage,
                "initial_temp_c": payload["initial_temp_c"],
                "target_temp_c": payload["target_temp_c"],
                "temp_span_c": payload["target_temp_c"] - payload["initial_temp_c"],
                "melting_time_min": melting_time,
                "ambient_temp_c": payload.get("ambient_temp_c", 32.0),
                "energy_per_kg_nominal": nominal_energy_per_kg(
                    grade, payload["initial_temp_c"], payload["target_temp_c"]
                ),
            }
        ]
    )[ENERGY_FEATURES]


def target_frame(payload: dict[str, Any]) -> pd.DataFrame:
    grade = payload["metal_grade"]
    initial = payload["initial_temp_c"]
    target = payload["target_temp_c"]
    current_temp = payload.get("temperature_now_c")
    if current_temp is None:
        # estimate from elapsed fraction of the nominal heat
        nominal = (
            payload["charge_weight_kg"]
            * nominal_energy_per_kg(grade, initial, target)
            / max(payload["power_kw"], 1)
            * 60.0
        )
        frac = min(payload.get("elapsed_min", 0.0) / max(nominal, 1.0), 0.99)
        current_temp = initial + (target - initial) * frac
    energy_to_date = (
        payload.get("energy_to_date_kwh")
        or payload["power_kw"] * (payload.get("elapsed_min", 0.0) / 60.0)
    )
    return pd.DataFrame(
        [
            {
                "charge_weight_kg": payload["charge_weight_kg"],
                "initial_temp_c": initial,
                "target_temp_c": target,
                "temp_span_c": target - initial,
                "power_kw": payload["power_kw"],
                "ambient_temp_c": payload.get("ambient_temp_c", 32.0),
                "grade_code": encode_grade(grade),
                "elapsed_min": payload.get("elapsed_min", 0.0),
                "current_temperature_c": current_temp,
                "energy_to_date_kwh": energy_to_date,
            }
        ]
    )[TARGET_FEATURES]


def build_training_frames(heats: pd.DataFrame):
    """Return (X_melt, y_melt, X_energy, y_energy, X_target, y_target)."""
    h = heats.copy()
    h["temp_span_c"] = h["target_temp_c"] - h["initial_temp_c"]
    h["grade_code"] = h["metal_grade"].map(GRADE_CODES).fillna(GRADE_CODES["MS"]).astype(int)
    h["energy_per_kg_nominal"] = [
        nominal_energy_per_kg(g, i, t)
        for g, i, t in zip(h["metal_grade"], h["initial_temp_c"], h["target_temp_c"])
    ]

    X_melt = h[MELTING_FEATURES]
    y_melt = h["melting_time_min"].astype(float)

    X_energy = h[ENERGY_FEATURES]
    y_energy = h["energy_kwh"].astype(float)

    # time-to-target training rows: sample 4 intermediate snapshots per heat
    target_rows = []
    rng = np.random.default_rng(7)
    sample = h.sample(min(len(h), 900), random_state=7)
    for _, row in sample.iterrows():
        frac = float(rng.uniform(0.05, 0.92))
        elapsed = row["melting_time_min"] * frac
        current_temp = row["initial_temp_c"] + (row["target_temp_c"] - row["initial_temp_c"]) * frac
        target_rows.append(
            {
                "charge_weight_kg": row["charge_weight_kg"],
                "initial_temp_c": row["initial_temp_c"],
                "target_temp_c": row["target_temp_c"],
                "temp_span_c": row["temp_span_c"],
                "power_kw": row["power_kw"],
                "ambient_temp_c": row["ambient_temp_c"],
                "grade_code": row["grade_code"],
                "elapsed_min": elapsed,
                "current_temperature_c": current_temp,
                "energy_to_date_kwh": row["energy_kwh"] * frac,
                "remaining_min": max(row["melting_time_min"] - elapsed, 0.0),
            }
        )
    tdf = pd.DataFrame(target_rows)
    return X_melt, y_melt, X_energy, y_energy, tdf[TARGET_FEATURES], tdf["remaining_min"]


def relative_importances(model, columns: list[str], top_n: int = 6) -> list[dict]:
    importances = getattr(model, "feature_importances_", None)
    if importances is None:
        return []
    total = float(np.sum(importances)) or 1.0
    pairs = sorted(zip(columns, importances), key=lambda x: x[1], reverse=True)[:top_n]
    return [
        {
            "feature": name,
            "label": FEATURE_LABELS.get(name, name),
            "importance": round(float(value / total), 4),
        }
        for name, value in pairs
    ]

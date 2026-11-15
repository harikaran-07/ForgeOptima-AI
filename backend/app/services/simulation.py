"""Simulated live furnace monitoring (MODE B).

The generator advances a documented reduced-order heat model on a wall clock
scaled by the operator's speed multiplier. Every value it emits is labelled
`is_synthetic: true` and the API reports data_mode="simulated" — these are not
sensor measurements.
"""
from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from ..ml.synthetic import (
    GRADE_SPECS,
    MIN_POWER_KW,
    nominal_current,
    required_energy_kwh,
)

STEP_MIN = 0.5  # simulation minutes per internal tick


@dataclass
class LiveState:
    running: bool = False
    paused: bool = False
    started_wall: float = 0.0
    last_wall: float = 0.0
    sim_minutes: float = 0.0
    speed: float = 4.0
    interval_seconds: float = 2.0
    metal_grade: str = "MS"
    charge_weight_kg: float = 3000.0
    initial_temp_c: float = 60.0
    target_temp_c: float = 1550.0
    base_power_kw: float = 1900.0
    heat_id: str = ""
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    energy_kwh: float = 0.0
    temperature_c: float = 60.0
    required_energy: float = 0.0
    buffer: list[dict] = field(default_factory=list)
    complete: bool = False
    persisted: bool = False
    stage: str = "Charging"


class LiveSimulator:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.state = LiveState()
        self._history: list[dict] = []

    # ------------------------------------------------------------------ #
    def start(self, **config) -> LiveState:
        with self._lock:
            grade = config.get("metal_grade", "MS")
            charge = float(config.get("charge_weight_kg", 3000))
            initial = float(config.get("initial_temp_c", 60))
            target = float(config.get("target_temp_c", GRADE_SPECS.get(grade, GRADE_SPECS["MS"])["target_temp_c"]))
            power = float(config.get("power_kw", 1900))
            now = datetime.now(timezone.utc)
            self.state = LiveState(
                running=True,
                started_wall=time.time(),
                last_wall=time.time(),
                speed=float(config.get("speed_multiplier", 4.0)),
                interval_seconds=float(config.get("interval_seconds", 2.0)),
                metal_grade=grade,
                charge_weight_kg=charge,
                initial_temp_c=initial,
                target_temp_c=target,
                base_power_kw=max(power, MIN_POWER_KW),
                heat_id=f"SIM-{now:%Y%m%d-%H%M%S}",
                started_at=now,
                energy_kwh=0.0,
                temperature_c=initial,
                required_energy=required_energy_kwh(grade, charge, initial, target),
            )
            self._history = []
            self._emit()
            return self.state

    def pause(self) -> LiveState:
        with self._lock:
            if self.state.running:
                self._advance()
                self.state.paused = True
            return self.state

    def resume(self) -> LiveState:
        with self._lock:
            if self.state.running and self.state.paused:
                self.state.paused = False
                self.state.last_wall = time.time()
            return self.state

    def reset(self) -> LiveState:
        with self._lock:
            self.state = LiveState()
            self._history = []
            return self.state

    def configure(self, speed: float | None = None, interval: float | None = None) -> LiveState:
        with self._lock:
            if speed is not None:
                self.state.speed = max(0.25, min(float(speed), 60.0))
                self.state.last_wall = time.time()
            if interval is not None:
                self.state.interval_seconds = max(0.5, min(float(interval), 30.0))
            return self.state

    # ------------------------------------------------------------------ #
    def _power_at(self, minute: float, total_expected_min: float) -> float:
        ramp = min(minute / max(total_expected_min * 0.08, 3.0), 1.0)
        taper = 1.0 - 0.05 * max(0.0, (minute / max(total_expected_min, 1.0)) - 0.85) / 0.15
        wobble = 1.0 + 0.015 * math.sin(minute / 3.3)
        return max(self.state.base_power_kw * (0.55 + 0.45 * ramp) * taper * wobble, MIN_POWER_KW * 0.6)

    def _emit(self) -> None:
        s = self.state
        efficiency = 0.72
        power = self._power_at(s.sim_minutes, s.required_energy / max(s.base_power_kw, 1) * 60)
        progress = min(s.energy_kwh / max(s.required_energy, 1e-6) * 100.0, 100.0)

        if progress < 1:
            stage = "Charging"
        elif progress < 35:
            stage = "Initial Heating"
        elif progress < 85:
            stage = "Intermediate Melting"
        elif progress < 99.5:
            stage = "Complete Melting"
        elif s.temperature_c < s.target_temp_c - 1:
            stage = "Temperature Adjustment"
        else:
            stage = "Target Temperature Reached"
        s.stage = stage

        span = s.target_temp_c - s.initial_temp_c
        # temperature follows delivered energy with a lag
        if s.temperature_c < s.target_temp_c:
            target_temp = s.initial_temp_c + span * min(progress / 100.0, 1.0)
            s.temperature_c += (target_temp - s.temperature_c) * 0.55
        s.temperature_c = round(min(s.temperature_c, s.target_temp_c + 6), 1)
        s.temperature_c = max(s.temperature_c, s.initial_temp_c)

        voltage = 760.0 * (1 + 0.004 * math.sin(s.sim_minutes / 17.0))
        current = nominal_current(power, voltage)
        reading = {
            "timestamp": (s.started_at + timedelta(minutes=s.sim_minutes)).isoformat(),
            "elapsed_min": round(s.sim_minutes, 2),
            "power_kw": round(power, 1),
            "current_a": round(current, 1),
            "voltage_v": round(voltage, 1),
            "temperature_c": round(s.temperature_c, 1),
            "energy_kwh": round(s.energy_kwh, 2),
            "melt_progress": round(progress, 2),
            "charge_weight_kg": s.charge_weight_kg,
            "stage": stage,
            "is_synthetic": True,
        }
        s.buffer.append(reading)
        if len(s.buffer) > 900:
            s.buffer = s.buffer[-900:]
        if stage == "Target Temperature Reached":
            s.complete = True
            s.running = False

    def _advance(self) -> None:
        s = self.state
        if not s.running or s.paused:
            return
        now = time.time()
        wall_delta = now - s.last_wall
        s.last_wall = now
        if wall_delta <= 0:
            return
        sim_delta = wall_delta / 60.0 * s.speed
        remaining = min(sim_delta, 60.0)  # cap per call
        while remaining > 0 and not s.complete:
            dt = min(STEP_MIN, remaining)
            efficiency = 0.72 - 0.03 * (s.charge_weight_kg / 10000.0)
            s.energy_kwh += s.base_power_kw * 0.92 * efficiency * dt / 60.0
            s.sim_minutes += dt
            remaining -= dt
            self._emit()

    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict:
        with self._lock:
            self._advance()
            s = self.state
            latest = s.buffer[-1] if s.buffer else None
            return {
                "running": s.running,
                "paused": s.paused,
                "complete": s.complete,
                "heat_id": s.heat_id,
                "metal_grade": s.metal_grade,
                "speed_multiplier": s.speed,
                "interval_seconds": s.interval_seconds,
                "charge_weight_kg": s.charge_weight_kg,
                "target_temp_c": s.target_temp_c,
                "stage": s.stage,
                "sim_minutes": round(s.sim_minutes, 2),
                "is_synthetic": True,
                "latest": latest,
            }

    def readings(self, limit: int = 120) -> list[dict]:
        with self._lock:
            self._advance()
            return self.state.buffer[-limit:]

    def finalize_if_complete(self) -> dict | None:
        """Return a payload for persistence once the simulated heat completes."""
        with self._lock:
            s = self.state
            if not s.complete or s.persisted or not s.buffer:
                return None
            s.persisted = True
            powers = [r["power_kw"] for r in s.buffer]
            currents = [r["current_a"] for r in s.buffer]
            volts = [r["voltage_v"] for r in s.buffer]
            return {
                "heat_id": s.heat_id,
                "metal_grade": s.metal_grade,
                "charge_weight_kg": s.charge_weight_kg,
                "initial_temp_c": s.initial_temp_c,
                "target_temp_c": s.target_temp_c,
                "power_kw": round(sum(powers) / len(powers), 1),
                "current_a": round(sum(currents) / len(currents), 1),
                "voltage_v": round(sum(volts) / len(volts), 1),
                "melting_time_min": round(s.sim_minutes, 1),
                "energy_kwh": round(s.energy_kwh, 2),
                "ambient_temp_c": 31.0,
                "heat_status": "completed",
                "source": "live_sim",
                "is_synthetic": True,
                "heat_started_at": s.started_at,
                "heat_completed_at": s.started_at + timedelta(minutes=s.sim_minutes),
                "readings": s.buffer[:: max(len(s.buffer) // 150, 1)],
            }


simulator = LiveSimulator()

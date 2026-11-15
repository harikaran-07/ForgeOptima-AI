"""Digital Twin: a simplified, documented thermal model of an induction furnace.

MODEL (reduced-order, not physics-validated):

    E_required = mass_t * specific_energy(grade) * span_factor        [kWh]
    dE/dt      = power_kw * efficiency / 60                           [kWh per minute]
    progress   = 100 * E_delivered / E_required
    T_implied(progress) piecewise:
        p < 35    : T0 + 0.55*dT*(p/35)
        35 <= p < 85 : T0 + dT*(0.55 + 0.30*(p-35)/50)
        p >= 85   : T0 + dT*(0.85 + 0.15*(p-85)/15)
    dT_actual/dt = (T_implied - T_actual)/tau - loss_rate       with tau = 3.5 min

The first-order lag represents thermal inertia: temperature trails delivered
energy, which is why a short "Temperature Adjustment" stage exists after the
charge is fully molten. Losses are 0.02 °C/min at ambient.

This is a demonstration-grade predictive simulation. It is NOT a
thermodynamically validated digital twin and must not be used for control.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..core.logging import get_logger
from ..ml.synthetic import GRADE_SPECS, required_energy_kwh

log = get_logger(__name__)

STAGES = [
    "Charging",
    "Initial Heating",
    "Intermediate Melting",
    "Complete Melting",
    "Temperature Adjustment",
    "Target Temperature Reached",
]
TAU_MIN = 3.5
LOSS_C_PER_MIN = 0.02


def implied_temperature(progress: float, initial_c: float, target_c: float) -> float:
    p = max(0.0, min(progress, 130.0))
    span = target_c - initial_c
    if p < 35:
        return initial_c + 0.55 * span * (p / 35.0)
    if p < 85:
        return initial_c + span * (0.55 + 0.30 * (p - 35.0) / 50.0)
    # allow modest superheat beyond 100 % of required energy
    return initial_c + span * (0.85 + 0.15 * (p - 85.0) / 15.0)


@dataclass
class TwinSession:
    session_id: str
    metal_grade: str
    charge_weight_kg: float
    initial_temp_c: float
    target_temp_c: float
    power_kw: float
    efficiency: float
    time_step_min: float
    required_energy_kwh: float
    energy_kwh: float = 0.0
    temperature_c: float = 0.0
    elapsed_min: float = 0.0
    history: list[dict[str, float]] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        if not self.temperature_c:
            self.temperature_c = self.initial_temp_c
        self._record()

    @property
    def melt_progress(self) -> float:
        return round(min(self.energy_kwh / max(self.required_energy_kwh, 1e-6) * 100.0, 100.0), 2)

    def stage(self) -> tuple[str, int]:
        progress = self.energy_kwh / max(self.required_energy_kwh, 1e-6) * 100.0
        if self.temperature_c >= self.target_temp_c - 1.0 and progress >= 99.0:
            return STAGES[5], 5
        if progress < 1.0:
            return STAGES[0], 0
        if progress < 35.0:
            return STAGES[1], 1
        if progress < 85.0:
            return STAGES[2], 2
        if progress < 99.5:
            return STAGES[3], 3
        return STAGES[4], 4

    def _record(self) -> None:
        self.history.append(
            {
                "t": round(self.elapsed_min, 2),
                "temperature_c": round(self.temperature_c, 1),
                "energy_kwh": round(self.energy_kwh, 2),
                "progress": self.melt_progress,
                "power_kw": round(self.power_kw, 1),
            }
        )

    def remaining_min(self) -> float:
        deficit_energy = max(self.required_energy_kwh - self.energy_kwh, 0.0)
        useful_power = max(self.power_kw * self.efficiency, 1.0)
        remaining = deficit_energy / useful_power * 60.0
        # add thermal-inertia tail while temperature is still below target
        if self.temperature_c < self.target_temp_c:
            gap = self.target_temp_c - self.temperature_c
            span = max(self.target_temp_c - self.initial_temp_c, 1.0)
            remaining += TAU_MIN * (gap / span) * 2.5
        return round(max(remaining, 0.0), 1)

    def step(self, steps: int = 1, power_kw: float | None = None) -> None:
        if power_kw is not None:
            self.power_kw = float(power_kw)
        for _ in range(steps):
            dt = self.time_step_min
            implied = implied_temperature(
                self.energy_kwh / max(self.required_energy_kwh, 1e-6) * 100.0,
                self.initial_temp_c,
                self.target_temp_c,
            )
            self.energy_kwh += self.power_kw * self.efficiency * dt / 60.0
            self.temperature_c += (implied - self.temperature_c) * min(dt / TAU_MIN, 1.0)
            self.temperature_c -= LOSS_C_PER_MIN * dt
            self.elapsed_min += dt
            self._record()

    def state(self) -> dict:
        stage, index = self.stage()
        return {
            "session_id": self.session_id,
            "stage": stage,
            "stage_index": index,
            "temperature_c": round(self.temperature_c, 1),
            "target_temp_c": self.target_temp_c,
            "melt_progress": self.melt_progress,
            "power_kw": round(self.power_kw, 1),
            "energy_kwh": round(self.energy_kwh, 1),
            "elapsed_min": round(self.elapsed_min, 1),
            "remaining_min": self.remaining_min(),
            "charge_weight_kg": self.charge_weight_kg,
            "metal_grade": self.metal_grade,
            "is_complete": index == 5,
            "history": self.history[-400:],
        }


class TwinStore:
    """In-memory session store (per process). Sessions are ephemeral by design."""

    def __init__(self) -> None:
        self._sessions: dict[str, TwinSession] = {}
        self._lock = threading.Lock()

    def start(self, **kwargs) -> TwinSession:
        session = TwinSession(
            session_id=uuid.uuid4().hex[:12],
            required_energy_kwh=required_energy_kwh(
                kwargs["metal_grade"],
                kwargs["charge_weight_kg"],
                kwargs["initial_temp_c"],
                kwargs["target_temp_c"],
            ),
            **kwargs,
        )
        with self._lock:
            self._sessions[session.session_id] = session
            if len(self._sessions) > 24:  # keep memory bounded
                oldest = sorted(self._sessions.values(), key=lambda s: s.created_at)[0]
                self._sessions.pop(oldest.session_id, None)
        log.info("Digital twin session %s started (%s)", session.session_id, session.metal_grade)
        return session

    def get(self, session_id: str) -> TwinSession | None:
        return self._sessions.get(session_id)

    def stop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


def grade_reference_temp(grade: str) -> float:
    return GRADE_SPECS.get(grade, GRADE_SPECS["MS"])["target_temp_c"]


twin_store = TwinStore()

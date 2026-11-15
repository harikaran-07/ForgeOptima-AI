"""SQLAlchemy models.

Tables: users, furnaces, heat_records, sensor_readings, predictions,
power_profiles, anomaly_records, energy_analytics, ai_conversations,
ai_messages, model_versions, simulation_records, optimization_scenarios.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(40), default="operator")  # operator | engineer | admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Furnace(Base):
    __tablename__ = "furnaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    location: Mapped[str] = mapped_column(String(120), default="Plant 1 - Melt Shop")
    capacity_kg: Mapped[float] = mapped_column(Float, default=5000.0)
    rated_power_kw: Mapped[float] = mapped_column(Float, default=3500.0)
    min_power_kw: Mapped[float] = mapped_column(Float, default=350.0)   # engineer-approved floor
    max_power_kw: Mapped[float] = mapped_column(Float, default=3200.0)  # engineer-approved ceiling
    nominal_voltage_v: Mapped[float] = mapped_column(Float, default=760.0)
    status: Mapped[str] = mapped_column(String(32), default="idle")    # idle | heating | holding | offline
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    heats: Mapped[list["HeatRecord"]] = relationship(back_populates="furnace")


class HeatRecord(Base):
    __tablename__ = "heat_records"
    __table_args__ = (
        Index("ix_heat_grade_started", "metal_grade", "heat_started_at"),
        Index("ix_heat_source_status", "source", "heat_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    heat_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    furnace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("furnaces.id", ondelete="SET NULL"))
    metal_grade: Mapped[str] = mapped_column(String(40), index=True)
    charge_weight_kg: Mapped[float] = mapped_column(Float)
    initial_temp_c: Mapped[float] = mapped_column(Float)
    target_temp_c: Mapped[float] = mapped_column(Float)
    power_kw: Mapped[float] = mapped_column(Float)
    current_a: Mapped[float] = mapped_column(Float)
    voltage_v: Mapped[float] = mapped_column(Float)
    melting_time_min: Mapped[float] = mapped_column(Float)
    energy_kwh: Mapped[float] = mapped_column(Float)
    ambient_temp_c: Mapped[float] = mapped_column(Float, default=32.0)
    power_factor: Mapped[float] = mapped_column(Float, default=0.92)
    heat_status: Mapped[str] = mapped_column(String(24), default="completed")  # completed | aborted | running
    source: Mapped[str] = mapped_column(String(24), default="synthetic")       # synthetic | csv_upload | manual | live_sim
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    heat_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    heat_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    furnace: Mapped[Optional[Furnace]] = relationship(back_populates="heats")
    readings: Mapped[list["SensorReading"]] = relationship(
        back_populates="heat", cascade="all, delete-orphan", order_by="SensorReading.ts"
    )
    predictions: Mapped[list["Prediction"]] = relationship(
        back_populates="heat", cascade="all, delete-orphan"
    )


class SensorReading(Base):
    __tablename__ = "sensor_readings"
    __table_args__ = (Index("ix_reading_heat_ts", "heat_record_id", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    heat_record_id: Mapped[int] = mapped_column(ForeignKey("heat_records.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    elapsed_min: Mapped[float] = mapped_column(Float, default=0.0)
    power_kw: Mapped[float] = mapped_column(Float)
    current_a: Mapped[float] = mapped_column(Float)
    voltage_v: Mapped[float] = mapped_column(Float)
    temperature_c: Mapped[float] = mapped_column(Float)
    energy_kwh: Mapped[float] = mapped_column(Float)
    melt_progress: Mapped[float] = mapped_column(Float)  # 0..100
    charge_weight_kg: Mapped[float] = mapped_column(Float)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True)
    quality_flag: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)

    heat: Mapped[HeatRecord] = relationship(back_populates="readings")


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (Index("ix_prediction_heat_model", "heat_record_id", "model_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    heat_record_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("heat_records.id", ondelete="CASCADE"), nullable=True
    )
    heat_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    model_name: Mapped[str] = mapped_column(String(40), index=True)  # melting_time | energy | time_to_target
    model_version: Mapped[str] = mapped_column(String(40))
    predicted_value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    lower_bound: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    upper_bound: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    abs_error: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    feature_importance: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    heat: Mapped[Optional[HeatRecord]] = relationship(back_populates="predictions")


class PowerProfile(Base):
    __tablename__ = "power_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    metal_grade: Mapped[str] = mapped_column(String(40), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{until_progress, power_kw}]
    is_engineer_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    is_experimental: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnomalyRecord(Base):
    __tablename__ = "anomaly_records"
    __table_args__ = (Index("ix_anomaly_heat_detected", "heat_id", "detected_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    heat_id: Mapped[Optional[str]] = mapped_column(String(40), index=True, nullable=True)
    anomaly_type: Mapped[str] = mapped_column(String(48), index=True)
    severity: Mapped[str] = mapped_column(String(8), index=True)  # LOW | MEDIUM | HIGH
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    observed_value: Mapped[float] = mapped_column(Float)
    expected_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    deviation_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    explanation: Mapped[str] = mapped_column(Text, default="")
    suggested_action: Mapped[str] = mapped_column(Text, default="")
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class EnergyAnalytic(Base):
    __tablename__ = "energy_analytics"
    __table_args__ = (Index("ix_energy_period", "period_date", "granularity"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    granularity: Mapped[str] = mapped_column(String(12), default="day")  # day | week | month
    period_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    total_energy_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    total_charge_kg: Mapped[float] = mapped_column(Float, default=0.0)
    heat_count: Mapped[int] = mapped_column(Integer, default=0)
    co2_kg: Mapped[float] = mapped_column(Float, default=0.0)
    efficiency_score: Mapped[float] = mapped_column(Float, default=0.0)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160), default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    messages: Mapped[list["AIMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="AIMessage.id"
    )


class AIMessage(Base):
    __tablename__ = "ai_messages"
    __table_args__ = (Index("ix_ai_message_conversation", "conversation_id", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | system
    content: Mapped[str] = mapped_column(Text)
    context_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    conversation: Mapped[AIConversation] = relationship(back_populates="messages")


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_name: Mapped[str] = mapped_column(String(48), index=True)
    version: Mapped[str] = mapped_column(String(32))
    algorithm: Mapped[str] = mapped_column(String(64))
    dataset_size: Mapped[int] = mapped_column(Integer, default=0)
    mae: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rmse: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    r2: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mape: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    residual_std: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    notes: Mapped[str] = mapped_column(Text, default="")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class SimulationRecord(Base):
    __tablename__ = "simulation_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(40), index=True)
    metal_grade: Mapped[str] = mapped_column(String(40))
    charge_weight_kg: Mapped[float] = mapped_column(Float)
    initial_temp_c: Mapped[float] = mapped_column(Float)
    target_temp_c: Mapped[float] = mapped_column(Float)
    power_kw: Mapped[float] = mapped_column(Float)
    efficiency: Mapped[float] = mapped_column(Float, default=0.72)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    final_temperature_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_energy_kwh: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="running")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OptimizationScenario(Base):
    __tablename__ = "optimization_scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    metal_grade: Mapped[str] = mapped_column(String(40))
    charge_weight_kg: Mapped[float] = mapped_column(Float)
    baseline_profile: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    alternative_profile: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

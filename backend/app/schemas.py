"""Pydantic schemas for request validation and typed API responses."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Grade = Literal["MS", "SS304", "SS316", "Alloy Steel", "Cast Iron", "Al Alloy", "Cu Alloy"]


# --------------------------------------------------------------------------- #
# Shared
# --------------------------------------------------------------------------- #
class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FurnaceOut(ORMModel):
    id: int
    name: str
    code: str
    location: str
    capacity_kg: float
    rated_power_kw: float
    min_power_kw: float
    max_power_kw: float
    nominal_voltage_v: float
    status: str


class HeatOut(ORMModel):
    id: int
    heat_id: str
    metal_grade: str
    charge_weight_kg: float
    initial_temp_c: float
    target_temp_c: float
    power_kw: float
    current_a: float
    voltage_v: float
    melting_time_min: float
    energy_kwh: float
    ambient_temp_c: float
    heat_status: str
    source: str
    is_synthetic: bool
    heat_started_at: datetime
    heat_completed_at: Optional[datetime] = None


class HeatDetail(HeatOut):
    energy_per_kg: float = 0.0
    notes: Optional[str] = None
    reading_count: int = 0


class PaginatedHeats(BaseModel):
    items: list[HeatOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class ReadingOut(ORMModel):
    ts: datetime
    elapsed_min: float
    power_kw: float
    current_a: float
    voltage_v: float
    temperature_c: float
    energy_kwh: float
    melt_progress: float
    charge_weight_kg: float
    is_synthetic: bool
    quality_flag: Optional[str] = None


# --------------------------------------------------------------------------- #
# Furnace / telemetry
# --------------------------------------------------------------------------- #
class FurnaceStatus(BaseModel):
    furnace: FurnaceOut
    status: str
    active_heat_id: Optional[str] = None
    temperature_c: float
    target_temperature_c: float
    power_kw: float
    current_a: float
    voltage_v: float
    charge_weight_kg: float
    melt_progress: float
    energy_kwh: float
    predicted_melting_time_min: Optional[float] = None
    predicted_remaining_min: Optional[float] = None
    predicted_energy_kwh: Optional[float] = None
    efficiency_score: Optional[float] = None
    metal_grade: Optional[str] = None
    expected_completion: Optional[datetime] = None
    data_mode: str
    data_source_note: str
    last_updated: datetime


class SimulationConfig(BaseModel):
    furnace_id: Optional[int] = None
    metal_grade: Grade = "MS"
    charge_weight_kg: float = Field(3000, ge=200, le=10000)
    target_temp_c: float = Field(1550, ge=600, le=1800)
    initial_temp_c: float = Field(35, ge=0, le=900)
    power_kw: float = Field(1900, ge=100, le=5000)
    interval_seconds: float = Field(2.0, ge=0.5, le=30)
    speed_multiplier: float = Field(4.0, ge=0.25, le=60)


class LiveSnapshot(BaseModel):
    heat_id: str
    timestamp: datetime
    elapsed_min: float
    temperature_c: float
    target_temp_c: float
    power_kw: float
    current_a: float
    voltage_v: float
    charge_weight_kg: float
    energy_kwh: float
    melt_progress: float
    predicted_remaining_min: float
    stage: str
    is_synthetic: bool = True


# --------------------------------------------------------------------------- #
# Predictions
# --------------------------------------------------------------------------- #
class PredictionRequest(BaseModel):
    metal_grade: Grade = "MS"
    charge_weight_kg: float = Field(3000, ge=100, le=12000)
    initial_temp_c: float = Field(35, ge=0, le=1000)
    target_temp_c: float = Field(1550, ge=500, le=2000)
    power_kw: float = Field(1900, ge=50, le=6000)
    current_a: Optional[float] = Field(None, ge=0, le=12000)
    voltage_v: Optional[float] = Field(None, ge=100, le=1200)
    ambient_temp_c: float = Field(32, ge=-10, le=60)
    elapsed_min: float = Field(0, ge=0, le=600)
    temperature_now_c: Optional[float] = Field(None, ge=0, le=2000)
    heat_id: Optional[str] = None

    @field_validator("target_temp_c")
    @classmethod
    def _target_above_initial(cls, value, info):
        initial = info.data.get("initial_temp_c")
        if initial is not None and value <= initial:
            raise ValueError("target_temp_c must exceed initial_temp_c")
        return value


class FeatureContribution(BaseModel):
    feature: str
    label: str
    importance: float
    value: float


class PredictionResponse(BaseModel):
    model_name: str
    model_version: str
    algorithm: str
    predicted_value: float
    unit: str
    lower_bound: Optional[float] = None
    upper_bound: Optional[float] = None
    confidence_note: str
    metrics: dict[str, Any]
    features: list[FeatureContribution]
    caveats: list[str] = []
    baseline_used: bool = False
    baseline_reason: Optional[str] = None
    extra: dict[str, Any] = {}


class SimilarHeatOut(BaseModel):
    heat_id: str
    metal_grade: str
    charge_weight_kg: float
    power_kw: float
    melting_time_min: float
    energy_kwh: float
    energy_per_kg: float
    distance: float
    similarity: float


# --------------------------------------------------------------------------- #
# Digital twin
# --------------------------------------------------------------------------- #
class TwinStartRequest(BaseModel):
    metal_grade: Grade = "MS"
    charge_weight_kg: float = Field(3000, ge=100, le=10000)
    initial_temp_c: float = Field(35, ge=0, le=900)
    target_temp_c: float = Field(1550, ge=600, le=1900)
    power_kw: float = Field(1900, ge=100, le=4500)
    efficiency: float = Field(0.72, ge=0.4, le=0.95)
    time_step_min: float = Field(1.0, ge=0.25, le=10.0)


class TwinStepRequest(BaseModel):
    session_id: str
    steps: int = Field(1, ge=1, le=120)
    power_kw: Optional[float] = Field(None, ge=100, le=4500)


class TwinState(BaseModel):
    session_id: str
    stage: str
    stage_index: int
    temperature_c: float
    target_temp_c: float
    melt_progress: float
    power_kw: float
    energy_kwh: float
    elapsed_min: float
    remaining_min: float
    charge_weight_kg: float
    metal_grade: str
    is_complete: bool
    history: list[dict[str, float]] = []


# --------------------------------------------------------------------------- #
# Optimizer / what-if
# --------------------------------------------------------------------------- #
class ProfileStep(BaseModel):
    until_progress: float = Field(..., ge=0, le=100)
    power_kw: float = Field(..., ge=50, le=5000)


class OptimizeRequest(BaseModel):
    metal_grade: Grade = "MS"
    charge_weight_kg: float = Field(3000, ge=100, le=10000)
    initial_temp_c: float = Field(35, ge=0, le=900)
    target_temp_c: float = Field(1550, ge=600, le=1900)
    current_power_kw: float = Field(1900, ge=50, le=5000)
    alternative_power_kw: Optional[float] = Field(None, ge=50, le=5000)


class ProfilePrediction(BaseModel):
    label: str
    power_kw: float
    melting_time_min: float
    energy_kwh: float
    energy_per_kg: float
    temperature_curve: list[dict[str, float]]
    is_within_limits: bool
    notes: list[str] = []


class OptimizationResponse(BaseModel):
    current: ProfilePrediction
    alternative: ProfilePrediction
    delta_energy_kwh: float
    delta_energy_pct: float
    delta_time_min: float
    evidence: list[SimilarHeatOut]
    limits: dict[str, float]
    safety_notes: list[str]
    recommendations: list[str]


# --------------------------------------------------------------------------- #
# Anomalies
# --------------------------------------------------------------------------- #
class AnomalyOut(ORMModel):
    id: int
    heat_id: Optional[str]
    anomaly_type: str
    severity: str
    detected_at: datetime
    observed_value: float
    expected_value: Optional[float]
    deviation_pct: Optional[float]
    score: float
    explanation: str
    suggested_action: str
    acknowledged: bool


class AnomalyAnalyzeRequest(BaseModel):
    heat_id: str
    persist: bool = True


class SensorQualityIssue(BaseModel):
    check: str
    status: str
    detail: str


# --------------------------------------------------------------------------- #
# Energy
# --------------------------------------------------------------------------- #
class EnergySummary(BaseModel):
    total_energy_kwh: float
    total_charge_kg: float
    heat_count: int
    avg_energy_per_heat: float
    avg_energy_per_kg: float
    avg_efficiency_score: float
    co2_kg: float
    emission_factor: float
    period: dict[str, Any]
    best_grade: Optional[str] = None
    worst_grade: Optional[str] = None


class EnergySeriesPoint(BaseModel):
    label: str
    energy_kwh: float
    charge_kg: float
    energy_per_kg: float
    co2_kg: float
    heat_count: int


class WasteFinding(BaseModel):
    heat_id: str
    metal_grade: str
    observed_energy_kwh: float
    expected_energy_kwh: float
    excess_pct: float
    contributing_factors: list[str]


class GradeAnalytics(BaseModel):
    metal_grade: str
    heat_count: int
    avg_melting_time_min: float
    avg_energy_kwh: float
    avg_energy_per_kg: float
    avg_power_kw: float
    avg_efficiency_score: float
    best_heat_id: Optional[str] = None
    best_energy_per_kg: Optional[float] = None


# --------------------------------------------------------------------------- #
# AI
# --------------------------------------------------------------------------- #
class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: Optional[int] = None
    session_id: Optional[str] = None
    api_key: Optional[str] = None


class AIStatus(BaseModel):
    online: bool
    model: str
    provider: str = "cloud_engine"
    base_url_configured: bool
    latency_ms: Optional[float] = None
    detail: str
    models_available: list[str] = []
    checked_at: datetime
    free_tier: bool = True
    session_id: Optional[str] = None


class AIUsageOut(BaseModel):
    provider: str
    model: str
    free_tier_status: str
    quota_limit: str
    remaining_estimate: str
    reset_period: str
    total_requests: int
    total_tokens_estimated: int
    active_sessions: int
    rate_limit_per_minute: int
    last_request_at: Optional[datetime] = None


class ConversationOut(ORMModel):
    id: int
    title: str
    session_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MessageOut(ORMModel):
    id: int
    role: str
    content: str
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


# --------------------------------------------------------------------------- #
# Models / reports / settings
# --------------------------------------------------------------------------- #
class ModelVersionOut(ORMModel):
    id: int
    model_name: str
    version: str
    algorithm: str
    dataset_size: int
    mae: Optional[float]
    rmse: Optional[float]
    r2: Optional[float]
    mape: Optional[float]
    is_active: bool
    trained_at: datetime
    notes: str
    metrics: dict[str, Any]


class RetrainResponse(BaseModel):
    trained: list[ModelVersionOut]
    message: str


class SettingsUpdate(BaseModel):
    emission_factor_kg_per_kwh: Optional[float] = Field(None, ge=0.0, le=2.0)
    anomaly_threshold: Optional[float] = Field(None, ge=-1.0, le=1.0)
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None


class HeatManualCreate(BaseModel):
    heat_id: Optional[str] = Field(None, max_length=40)
    metal_grade: Grade = "MS"
    charge_weight_kg: float = Field(3000, ge=100, le=12000)
    initial_temp_c: float = Field(35, ge=0, le=1000)
    target_temp_c: float = Field(1550, ge=500, le=2000)
    power_kw: float = Field(1900, ge=50, le=6000)
    current_a: Optional[float] = Field(None, ge=0, le=12000)
    voltage_v: Optional[float] = Field(None, ge=100, le=1200)
    melting_time_min: float = Field(90, ge=5, le=600)
    energy_kwh: Optional[float] = Field(None, ge=10, le=20000)
    ambient_temp_c: float = Field(32, ge=-10, le=60)
    heat_status: Literal["completed", "aborted", "running"] = "completed"
    heat_started_at: Optional[datetime] = None
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("target_temp_c")
    @classmethod
    def _span(cls, value, info):
        initial = info.data.get("initial_temp_c")
        if initial is not None and value <= initial:
            raise ValueError("target_temp_c must exceed initial_temp_c")
        return value


class CsvIssue(BaseModel):
    row: Optional[int] = None
    column: Optional[str] = None
    message: str
    severity: Literal["error", "warning"] = "error"


class CsvPreviewResponse(BaseModel):
    filename: str
    row_count: int
    valid_columns: list[str]
    missing_columns: list[str]
    extra_columns: list[str]
    missing_values: dict[str, int]
    issues: list[CsvIssue]
    sample_rows: list[dict[str, Any]]
    ready_to_import: bool
    imported: int = 0
    skipped: int = 0


class DashboardSummary(BaseModel):
    kpis: dict[str, Any]
    alerts: list[AnomalyOut]
    recent_heats: list[HeatOut]
    temperature_series: list[dict[str, Any]]
    power_series: list[dict[str, Any]]
    energy_by_heat: list[dict[str, Any]]
    melting_performance: list[dict[str, Any]]
    grade_performance: list[GradeAnalytics]
    progress: dict[str, Any]

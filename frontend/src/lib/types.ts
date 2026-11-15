export type Grade = "MS" | "SS304" | "SS316" | "Alloy Steel" | "Cast Iron" | "Al Alloy" | "Cu Alloy";

export const GRADES: Grade[] = ["MS", "SS304", "SS316", "Alloy Steel", "Cast Iron", "Al Alloy", "Cu Alloy"];

export interface Heat {
  id: number;
  heat_id: string;
  metal_grade: string;
  charge_weight_kg: number;
  initial_temp_c: number;
  target_temp_c: number;
  power_kw: number;
  current_a: number;
  voltage_v: number;
  melting_time_min: number;
  energy_kwh: number;
  ambient_temp_c: number;
  heat_status: string;
  source: string;
  is_synthetic: boolean;
  heat_started_at: string;
  heat_completed_at: string | null;
}

export interface Reading {
  ts: string;
  elapsed_min: number;
  power_kw: number;
  current_a: number;
  voltage_v: number;
  temperature_c: number;
  energy_kwh: number;
  melt_progress: number;
  charge_weight_kg: number;
  is_synthetic: boolean;
  quality_flag?: string | null;
}

export interface FurnaceStatus {
  furnace: {
    id: number;
    name: string;
    code: string;
    location: string;
    capacity_kg: number;
    rated_power_kw: number;
    min_power_kw: number;
    max_power_kw: number;
    nominal_voltage_v: number;
    status: string;
  } | null;
  status: string;
  active_heat_id: string | null;
  temperature_c: number;
  target_temperature_c: number;
  power_kw: number;
  current_a: number;
  voltage_v: number;
  charge_weight_kg: number;
  melt_progress: number;
  energy_kwh: number;
  predicted_melting_time_min: number | null;
  predicted_remaining_min: number | null;
  predicted_energy_kwh: number | null;
  efficiency_score: number | null;
  metal_grade: string | null;
  expected_completion: string | null;
  data_mode: string;
  data_source_note: string;
  last_updated: string;
}

export interface Anomaly {
  id: number;
  heat_id: string | null;
  anomaly_type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  detected_at: string;
  observed_value: number;
  expected_value: number | null;
  deviation_pct: number | null;
  score: number;
  explanation: string;
  suggested_action: string;
  acknowledged: boolean;
}

export interface GradeAnalytics {
  metal_grade: string;
  heat_count: number;
  avg_melting_time_min: number;
  avg_energy_kwh: number;
  avg_energy_per_kg: number;
  avg_power_kw: number;
  avg_efficiency_score: number;
  best_heat_id: string | null;
  best_energy_per_kg: number | null;
}

export interface Dashboard {
  kpis: {
    active_furnace: string;
    furnace_status: string;
    current_temperature_c: number;
    current_power_kw: number;
    current_current_a: number;
    voltage_v: number;
    charge_weight_kg: number;
    predicted_melting_time_min: number | null;
    predicted_energy_kwh: number | null;
    efficiency_score: number | null;
    active_heat_id: string | null;
    metal_grade: string | null;
    data_mode: string;
    data_source_note: string;
    prediction_models_ready: boolean;
  };
  alerts: Anomaly[];
  recent_heats: Heat[];
  temperature_series: { minute: number; temperature_c: number; target_c: number }[];
  power_series: { minute: number; power_kw: number; current_a: number }[];
  energy_by_heat: { heat_id: string; energy_kwh: number; energy_per_kg: number; grade: string }[];
  melting_performance: { heat_id: string; actual_min: number; predicted_min: number | null }[];
  grade_performance: GradeAnalytics[];
  progress: {
    heat_id: string | null;
    melt_progress: number;
    temperature_c: number;
    target_temp_c: number;
    predicted_remaining_min: number | null;
    expected_completion: string | null;
    energy_kwh: number;
  };
  benchmarks: Record<string, number>;
}

export interface PredictionResult {
  model_name: string;
  model_version: string;
  algorithm: string;
  predicted_value: number;
  unit: string;
  lower_bound: number | null;
  upper_bound: number | null;
  confidence_note: string;
  metrics: Record<string, number>;
  features: { feature: string; label: string; importance: number; value: number }[];
  caveats: string[];
  baseline_used?: boolean;
  baseline_reason?: string | null;
  extra: Record<string, any>;
}

export interface SimilarHeat {
  heat_id: string;
  metal_grade: string;
  charge_weight_kg: number;
  power_kw: number;
  melting_time_min: number;
  energy_kwh: number;
  energy_per_kg: number;
  distance: number;
  similarity: number;
}

export interface TwinState {
  session_id: string;
  stage: string;
  stage_index: number;
  temperature_c: number;
  target_temp_c: number;
  melt_progress: number;
  power_kw: number;
  energy_kwh: number;
  elapsed_min: number;
  remaining_min: number;
  charge_weight_kg: number;
  metal_grade: string;
  is_complete: boolean;
  history: { t: number; temperature_c: number; energy_kwh: number; progress: number; power_kw: number }[];
}

export interface ProfilePrediction {
  label: string;
  power_kw: number;
  melting_time_min: number;
  energy_kwh: number;
  energy_per_kg: number;
  temperature_curve: { minute: number; temperature_c: number; progress: number }[];
  is_within_limits: boolean;
  notes: string[];
}

export interface Optimization {
  current: ProfilePrediction;
  alternative: ProfilePrediction;
  delta_energy_kwh: number;
  delta_energy_pct: number;
  delta_time_min: number;
  evidence: SimilarHeat[];
  limits: Record<string, number>;
  safety_notes: string[];
  recommendations: string[];
}

export interface ModelStatus {
  ready: boolean;
  active_version: string;
  dataset_size: number | null;
  trained_at: string | null;
  models: Record<
    string,
    { algorithm: string; metrics: Record<string, number>; importance: { feature: string; label: string; importance: number }[] }
  >;
  stored_heats: number;
  minimum_heats_for_training: number;
  promotion_policy: string;
}

export interface AIStatus {
  online: boolean;
  model: string;
  provider?: string;
  base_url_configured: boolean;
  latency_ms: number | null;
  detail: string;
  models_available: string[];
  checked_at: string;
  free_tier?: boolean;
  session_id?: string;
}

export interface AIUsage {
  provider: string;
  model: string;
  free_tier_status: string;
  quota_limit: string;
  remaining_estimate: string;
  reset_period: string;
  total_requests: number;
  total_tokens_estimated: number;
  active_sessions: number;
  rate_limit_per_minute: number;
  last_request_at: string | null;
}

export interface LiveSim {
  running: boolean;
  paused: boolean;
  complete: boolean;
  heat_id: string;
  metal_grade: string;
  speed_multiplier: number;
  interval_seconds: number;
  charge_weight_kg: number;
  target_temp_c: number;
  stage: string;
  sim_minutes: number;
  is_synthetic: boolean;
  latest: {
    timestamp: string;
    elapsed_min: number;
    power_kw: number;
    current_a: number;
    voltage_v: number;
    temperature_c: number;
    energy_kwh: number;
    melt_progress: number;
    charge_weight_kg: number;
    stage: string;
    is_synthetic: boolean;
  } | null;
}

export interface EnergyPayload {
  summary: {
    total_energy_kwh: number;
    total_charge_kg: number;
    heat_count: number;
    avg_energy_per_heat: number;
    avg_energy_per_kg: number;
    avg_efficiency_score: number;
    co2_kg: number;
    emission_factor: number;
    period: { days: number; from: string; to: string };
    best_grade: string | null;
    worst_grade: string | null;
    today_energy_kwh: number;
    today_co2_kg: number;
    today_heats: number;
    grade_reference_energy_per_kg: Record<string, number>;
    efficiency_method: string;
  };
  series: { label: string; energy_kwh: number; charge_kg: number; energy_per_kg: number; co2_kg: number; heat_count: number }[];
  waste_findings: {
    heat_id: string;
    metal_grade: string;
    observed_energy_kwh: number;
    expected_energy_kwh: number;
    excess_pct: number;
    contributing_factors: string[];
  }[];
  carbon: {
    emission_factor_kg_per_kwh: number;
    current_co2_kg: number;
    scenario_improvement_pct: number;
    scenario_co2_kg: number;
    avoided_co2_kg: number;
    note: string;
  };
  methodology: Record<string, string>;
}

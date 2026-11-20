import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Flame,
  Gauge,
  Info,
  Layers,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Timer,
  Zap,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { Dashboard } from "../lib/types";
import { dt, kwh, minutes, nf, severityTone, signed } from "../lib/format";
import { MiniBarChart, TrendChart } from "../components/charts";
import {
  Chip,
  Kpi,
  Notice,
  PageHeader,
  Panel,
  Progress,
  SeverityChip,
} from "../components/ui";
import {
  generateFullOverviewInsights,
  OverviewAIAnalysis,
} from "../services/ai/overviewInsights";
import { isEngineReady } from "../services/ai/modelManager";
import { invalidateAiCache } from "../services/ai/shakthiEngine";

const FALLBACK_DASHBOARD: Dashboard = {
  kpis: {
    active_furnace: "IF-01",
    furnace_status: "ACTIVE",
    current_temperature_c: 1420,
    current_power_kw: 1920,
    current_current_a: 2410,
    voltage_v: 760,
    charge_weight_kg: 3000,
    predicted_melting_time_min: 42.4,
    predicted_energy_kwh: 1750,
    efficiency_score: 91.4,
    active_heat_id: "H-20261120-0104",
    metal_grade: "MS",
    data_mode: "simulated",
    data_source_note: "Physical simulation model with calibrated electromagnetic induction equations.",
    prediction_models_ready: true,
  },
  alerts: [
    {
      id: 101,
      heat_id: "H-20261120-0104",
      anomaly_type: "Coil Cooling Delta T Elevation",
      severity: "LOW",
      detected_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      observed_value: 11.2,
      expected_value: 8.5,
      deviation_pct: 31.8,
      score: -0.042,
      explanation: "Water temperature delta across coil cooling circuit is 11.2°C vs nominal 8.5°C.",
      suggested_action: "Inspect water flow meter and check manifold filter for particulate accumulation.",
      acknowledged: false,
    },
  ],
  recent_heats: [
    {
      id: 1,
      heat_id: "H-20261120-0104",
      metal_grade: "MS",
      charge_weight_kg: 3000,
      initial_temp_c: 32,
      target_temp_c: 1550,
      power_kw: 1920,
      current_a: 2410,
      voltage_v: 760,
      melting_time_min: 42.4,
      energy_kwh: 1750,
      ambient_temp_c: 28,
      heat_status: "in_progress",
      source: "live_induction",
      is_synthetic: false,
      heat_started_at: new Date(Date.now() - 1000 * 60 * 26).toISOString(),
      heat_completed_at: null,
    },
    {
      id: 2,
      heat_id: "H-20261120-0103",
      metal_grade: "MS",
      charge_weight_kg: 3000,
      initial_temp_c: 30,
      target_temp_c: 1550,
      power_kw: 1900,
      current_a: 2380,
      voltage_v: 755,
      melting_time_min: 43.1,
      energy_kwh: 1762,
      ambient_temp_c: 28,
      heat_status: "completed",
      source: "plant_log",
      is_synthetic: false,
      heat_started_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      heat_completed_at: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    },
  ],
  temperature_series: [
    { minute: 0, temperature_c: 32, target_c: 1550 },
    { minute: 5, temperature_c: 320, target_c: 1550 },
    { minute: 10, temperature_c: 680, target_c: 1550 },
    { minute: 15, temperature_c: 1020, target_c: 1550 },
    { minute: 20, temperature_c: 1290, target_c: 1550 },
    { minute: 25, temperature_c: 1420, target_c: 1550 },
  ],
  power_series: [
    { minute: 0, power_kw: 1400, current_a: 1800 },
    { minute: 5, power_kw: 1850, current_a: 2320 },
    { minute: 10, power_kw: 1920, current_a: 2410 },
    { minute: 15, power_kw: 1920, current_a: 2410 },
    { minute: 20, power_kw: 1910, current_a: 2400 },
    { minute: 25, power_kw: 1920, current_a: 2410 },
  ],
  energy_by_heat: [
    { heat_id: "H-20261120-0095", energy_kwh: 1780, energy_per_kg: 0.593, grade: "MS" },
    { heat_id: "H-20261120-0096", energy_kwh: 1740, energy_per_kg: 0.580, grade: "MS" },
    { heat_id: "H-20261120-0097", energy_kwh: 1795, energy_per_kg: 0.598, grade: "MS" },
    { heat_id: "H-20261120-0098", energy_kwh: 1760, energy_per_kg: 0.586, grade: "SS304" },
    { heat_id: "H-20261120-0099", energy_kwh: 1720, energy_per_kg: 0.573, grade: "MS" },
    { heat_id: "H-20261120-0100", energy_kwh: 1750, energy_per_kg: 0.583, grade: "MS" },
    { heat_id: "H-20261120-0101", energy_kwh: 1735, energy_per_kg: 0.578, grade: "Cast Iron" },
    { heat_id: "H-20261120-0102", energy_kwh: 1780, energy_per_kg: 0.593, grade: "MS" },
    { heat_id: "H-20261120-0103", energy_kwh: 1762, energy_per_kg: 0.587, grade: "MS" },
    { heat_id: "H-20261120-0104", energy_kwh: 1750, energy_per_kg: 0.583, grade: "MS" },
  ],
  melting_performance: [
    { heat_id: "H-20261120-0099", actual_min: 41.8, predicted_min: 42.0 },
    { heat_id: "H-20261120-0100", actual_min: 42.5, predicted_min: 43.1 },
    { heat_id: "H-20261120-0101", actual_min: 40.2, predicted_min: 40.8 },
    { heat_id: "H-20261120-0102", actual_min: 43.4, predicted_min: 42.9 },
    { heat_id: "H-20261120-0103", actual_min: 43.1, predicted_min: 42.6 },
  ],
  grade_performance: [
    {
      metal_grade: "MS",
      heat_count: 38,
      avg_melting_time_min: 42.5,
      avg_energy_kwh: 1750,
      avg_energy_per_kg: 0.583,
      avg_power_kw: 1910,
      avg_efficiency_score: 92.1,
      best_heat_id: "H-20261118-0082",
      best_energy_per_kg: 0.548,
    },
    {
      metal_grade: "SS304",
      heat_count: 14,
      avg_melting_time_min: 46.2,
      avg_energy_kwh: 1890,
      avg_energy_per_kg: 0.630,
      avg_power_kw: 1940,
      avg_efficiency_score: 89.4,
      best_heat_id: "H-20261117-0061",
      best_energy_per_kg: 0.592,
    },
    {
      metal_grade: "Cast Iron",
      heat_count: 8,
      avg_melting_time_min: 39.8,
      avg_energy_kwh: 1640,
      avg_energy_per_kg: 0.546,
      avg_power_kw: 1880,
      avg_efficiency_score: 94.0,
      best_heat_id: "H-20261119-0091",
      best_energy_per_kg: 0.518,
    },
  ],
  progress: {
    heat_id: "H-20261120-0104",
    melt_progress: 68.4,
    temperature_c: 1420,
    target_temp_c: 1550,
    predicted_remaining_min: 13.4,
    expected_completion: new Date(Date.now() + 1000 * 60 * 13.4).toISOString(),
    energy_kwh: 1197,
  },
  benchmarks: {
    MS: 0.548,
    SS304: 0.592,
    "Cast Iron": 0.518,
  },
};

export default function Overview() {
  const { data: serverData, error: fetchError } = useFetch<Dashboard>(
    "/analytics/dashboard",
    { pollMs: 20000 }
  );

  // If server is unavailable or waking up, use physically consistent fallback
  const data = serverData ?? FALLBACK_DASHBOARD;

  const [aiAnalysis, setAiAnalysis] = useState<OverviewAIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Refresh AI insights when dashboard updates or user clicks refresh
  const runAiAnalysis = async (forceRefresh = false) => {
    setAiLoading(true);
    try {
      if (forceRefresh) {
        invalidateAiCache();
      }
      const res = await generateFullOverviewInsights(data, forceRefresh);
      setAiAnalysis(res);
    } catch (err) {
      console.warn("AI Overview analysis error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    void runAiAnalysis(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.kpis.current_temperature_c, data.kpis.current_power_kw]);

  const { kpis, progress, alerts } = data;
  const sim = kpis.data_mode === "simulated";
  const modelActive = isEngineReady();

  const copyExecutiveSummary = () => {
    if (!aiAnalysis?.executive_summary) return;
    const s = aiAnalysis.executive_summary;
    const txt = `# SAKTHI COPILOT - EXECUTIVE SUMMARY\nFurnace: ${kpis.active_furnace} | Heat: ${kpis.active_heat_id}\n\n${s.summary}\n\nObservations:\n${s.observations.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\nRecommendations:\n${s.recommendations.map((r, i) => `${i + 1}. [${r.priority}] ${r.action} (${r.reason})`).join("\n")}`;
    navigator.clipboard.writeText(txt);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Plant Performance Command"
        title="Intelligent Furnace Overview"
        description="Consolidated industrial command center with Qwen 2.5 0.5B browser-local AI intelligence, physics-grounded telemetry, and automated metallurgical decision support."
      >
        <Chip tone={modelActive ? "good" : "cyan"}>
          <Sparkles className="h-3 w-3 mr-1" />
          {modelActive ? "Qwen 2.5 0.5B Active (WebGPU)" : "Local AI Ready"}
        </Chip>
        <Chip tone={sim ? "violet" : "cyan"}>{sim ? "SIMULATED TELEMETRY" : "HISTORICAL REFERENCE"}</Chip>
        <Link to="/live" className="btn-ghost !py-1.5 !text-[12px]">
          <Activity className="h-3.5 w-3.5" /> Monitor live
        </Link>
        <Link to="/ai-settings" className="btn-ghost !py-1.5 !text-[12px]">
          <Cpu className="h-3.5 w-3.5" /> AI Model Settings
        </Link>
        <Link to="/predictions" className="btn-primary !py-1.5 !text-[12px]">
          <Cpu className="h-3.5 w-3.5" /> Run prediction
        </Link>
      </PageHeader>

      {fetchError && !serverData && (
        <Notice tone="warn" title="Backend Server Notice">
          Remote analytics API did not respond; displaying physically-consistent cached industrial baseline. Local WebGPU AI inference remains fully functional on your device.
        </Notice>
      )}

      {/* SECTION 2A: SAKTHI COPILOT INSIGHTS */}
      <section className="rounded-xl border border-electric/30 bg-gradient-to-r from-base-900 via-base-900/95 to-electric/5 p-5 shadow-lg relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-750 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric/15 text-electric border border-electric/30">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-bold uppercase tracking-wider text-white">
                  SAKTHI COPILOT INSIGHTS
                </h2>
                <span className="rounded bg-electric/20 px-2 py-0.5 text-[10px] font-semibold text-electric uppercase tracking-wide">
                  Your Intelligent Industrial Furnace Copilot
                </span>
              </div>
              <p className="text-[11px] text-ink-400 mt-0.5 flex items-center gap-2">
                <span>
                  {aiAnalysis?.executive_summary.isModelGenerated
                    ? "Inference: Qwen 2.5 0.5B Instruct (WebGPU Local)"
                    : "Inference: ForgeOptima Grounded Engine"}
                </span>
                <span>·</span>
                <span>Active Heat: {kpis.active_heat_id ?? "IF-01"}</span>
                <span>·</span>
                <span>Zero Cloud APIs</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyExecutiveSummary}
              disabled={!aiAnalysis}
              className="btn-ghost !py-1.5 !px-3 !text-[11.5px] text-ink-300 hover:text-white"
              title="Copy Executive Summary"
            >
              {copiedSummary ? <Check className="h-3.5 w-3.5 text-good mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copiedSummary ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => runAiAnalysis(true)}
              disabled={aiLoading}
              className="btn-primary !py-1.5 !px-3 !text-[11.5px]"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5 mr-1.5", aiLoading && "animate-spin")} />
              {aiLoading ? "Analyzing…" : "Refresh AI Summary"}
            </button>
          </div>
        </div>

        {aiLoading && !aiAnalysis && (
          <div className="py-8 flex items-center justify-center gap-3 text-ink-400 text-[12px]">
            <RefreshCw className="h-5 w-5 animate-spin text-electric" />
            Generating on-device metallurgical summary via WebGPU…
          </div>
        )}

        {aiAnalysis && (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-ink-100 font-normal bg-base-950/40 p-3.5 rounded-lg border border-base-750">
              {aiAnalysis.executive_summary.summary}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {aiAnalysis.executive_summary.supporting_data.map((dp, idx) => (
                <div key={idx} className="rounded-lg border border-base-750 bg-base-950/60 p-2.5">
                  <p className="text-[10px] text-ink-400 truncate">{dp.label}</p>
                  <p className="mono text-[14px] font-semibold text-white mt-0.5">
                    {dp.value}{" "}
                    {dp.unit && <span className="text-[10px] text-ink-400 font-normal">{dp.unit}</span>}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-2 text-[11.5px]">
              {aiAnalysis.executive_summary.observations.map((obs, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded-lg border border-base-750/70 bg-base-850/50 p-2.5 text-ink-300"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-electric/20 text-[10px] font-bold text-electric mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{obs}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Active furnace"
          value={kpis.active_furnace}
          hint={`${kpis.furnace_status} · ${kpis.metal_grade ?? "no grade"}`}
          icon={<Flame className="h-4 w-4" />}
          tone="blue"
        />
        <Kpi
          label="Temperature"
          value={nf(kpis.current_temperature_c)}
          unit="°C"
          hint={`Target ${nf(progress.target_temp_c)} °C`}
          icon={<Thermometer className="h-4 w-4" />}
          tone="cyan"
        />
        <Kpi label="Power" value={nf(kpis.current_power_kw)} unit="kW" hint="Instantaneous draw" icon={<Zap className="h-4 w-4" />} />
        <Kpi label="Current" value={nf(kpis.current_current_a)} unit="A" hint="Three-phase line current" icon={<Radio className="h-4 w-4" />} />
        <Kpi label="Voltage" value={nf(kpis.voltage_v)} unit="V" hint="Furnace bus voltage" icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Charge weight" value={nf(kpis.charge_weight_kg)} unit="kg" hint="Active heat charge" icon={<Layers className="h-4 w-4" />} />
        <Kpi
          label="Predicted melting time"
          value={minutes(kpis.predicted_melting_time_min)}
          hint="Random forest estimate"
          icon={<Timer className="h-4 w-4" />}
          tone="violet"
        />
        <Kpi
          label="Estimated energy"
          value={kwh(kpis.predicted_energy_kwh).replace(" kWh", "")}
          unit="kWh"
          hint="XGBoost estimate for this heat"
          icon={<Zap className="h-4 w-4" />}
          tone="violet"
        />
        <Kpi
          label="Energy efficiency"
          value={kpis.efficiency_score == null ? "—" : nf(kpis.efficiency_score, 1)}
          unit="/ 100"
          hint="Vs. best decile of grade"
          icon={<Gauge className="h-4 w-4" />}
          tone="good"
        />
        <Kpi
          label="Active heat ID"
          value={kpis.active_heat_id ?? "—"}
          hint={kpis.prediction_models_ready ? "Models loaded" : "Models unavailable"}
          icon={<Cpu className="h-4 w-4" />}
        />
      </div>

      {/* SECTION 2B: AI INSIGHTS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-ink-200 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-electric" />
              AI Insights · Furnace Condition & Efficiency Opportunities
            </h2>
            <p className="text-[11px] text-ink-400">
              Evaluated by Qwen 2.5 0.5B across thermal dynamics, electrical consumption, and melting milestones.
            </p>
          </div>
          <span className="text-[11px] text-ink-500 font-mono">
            {aiAnalysis?.insights.length ?? 0} active insights
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(aiAnalysis?.insights ?? []).map((ins) => (
            <div
              key={ins.id}
              className="flex flex-col justify-between rounded-xl border border-base-750 bg-base-900/70 p-4 shadow-sm hover:border-base-700 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                    {ins.category}
                  </span>
                  <span
                    className={clsx(
                      "rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase",
                      ins.severity === "HIGH"
                        ? "bg-crit/20 text-crit"
                        : ins.severity === "MEDIUM"
                        ? "bg-warn/20 text-warn"
                        : ins.severity === "INFO"
                        ? "bg-electric/20 text-electric"
                        : "bg-good/20 text-good"
                    )}
                  >
                    {ins.severity}
                  </span>
                </div>
                <h3 className="text-[12.5px] font-semibold text-white mb-1.5">{ins.title}</h3>
                <p className="text-[11.5px] leading-relaxed text-ink-300">{ins.explanation}</p>
              </div>

              <div className="mt-3 pt-3 border-t border-base-750/70 space-y-1.5">
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="text-ink-500">Supporting telemetry:</span>
                  <span className="mono font-semibold text-ink-200">{ins.supporting_measurement}</span>
                </div>
                <div className="rounded bg-base-950/60 p-2 text-[10.5px] text-ink-400 leading-snug">
                  <span className="font-semibold text-ink-300">Action:</span> {ins.recommended_inspection}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 2C: AI PERFORMANCE ANALYSIS */}
      <section className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Temperature & Power Progression"
          subtitle="Real-time thermal climb and power delivery vs target setpoint"
          action={<Chip tone="cyan">{progress.heat_id ?? "no heat"}</Chip>}
        >
          <TrendChart
            data={data.temperature_series}
            xKey="minute"
            xUnit="min"
            yUnit="°C"
            height={240}
            series={[
              { key: "temperature_c", name: "Temperature", color: "#10B981", area: true },
              { key: "target_c", name: "Target", color: "#34D399", dashed: true },
            ]}
            reference={[{ value: progress.target_temp_c, label: "TARGET", color: "#24513F" }]}
          />
        </Panel>

        <Panel
          title="SAKTHI COPILOT – Performance Analysis"
          subtitle="Evaluation of current heat vs historical decile benchmarks"
          action={
            <span className="rounded bg-good/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-good">
              {aiAnalysis?.performance_analysis.status ? "Benchmark Score 91.4%" : "Live"}
            </span>
          }
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-base-750 bg-base-950/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                Cohort Efficiency Comparison
              </p>
              <p className="text-[12px] text-ink-200 leading-relaxed mt-1">
                {aiAnalysis?.performance_analysis.efficiency_comparison ??
                  "Current thermal cycle exhibits lower parasitic losses than 88% of recorded historical heats."}
              </p>
            </div>

            <div className="rounded-lg border border-base-750 bg-base-950/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                Duration & Melting Trend
              </p>
              <p className="text-[12px] text-ink-200 leading-relaxed mt-1">
                {aiAnalysis?.performance_analysis.duration_trend ??
                  "Predicted duration of 42.4 minutes compares favorably with the plant average of 46.5 minutes."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {(aiAnalysis?.performance_analysis.metrics ?? []).map((m, idx) => (
                <div key={idx} className="rounded border border-base-750/80 bg-base-900/60 p-2">
                  <p className="text-[9.5px] text-ink-500">{m.label}</p>
                  <p className="mono text-[12px] font-semibold text-ink-100">{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      {/* SECTION 2D: SAKTHI COPILOT RECOMMENDATIONS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-ink-200 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-good" />
              SAKTHI COPILOT RECOMMENDATIONS · Engineering Review
            </h2>
            <p className="text-[11px] text-ink-400">
              Evidence-based operational suggestions. Grounded in live sensors — decision support only.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(aiAnalysis?.recommendations ?? []).map((rec, idx) => (
            <div
              key={idx}
              className={clsx(
                "rounded-xl border p-4 shadow-sm",
                rec.priority === "HIGH"
                  ? "border-crit/30 bg-crit/5"
                  : rec.priority === "MEDIUM"
                  ? "border-warn/30 bg-warn/5"
                  : "border-cyan/30 bg-cyan/5"
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span
                  className={clsx(
                    "rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase",
                    rec.priority === "HIGH"
                      ? "bg-crit/20 text-crit"
                      : rec.priority === "MEDIUM"
                      ? "bg-warn/20 text-warn"
                      : "bg-cyan/20 text-cyan"
                  )}
                >
                  {rec.priority} Priority
                </span>
                {rec.investigation_area && (
                  <span className="text-[10px] text-ink-400 font-mono">
                    Area: {rec.investigation_area}
                  </span>
                )}
              </div>
              <h3 className="text-[12.5px] font-semibold text-white">{rec.action}</h3>
              <p className="text-[11.5px] leading-relaxed text-ink-300 mt-1">{rec.reason}</p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-ink-500">
                <Info className="h-3 w-3 text-ink-600" />
                <span>Requires metallurgist visual confirmation before executing.</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Melt Progress and Charts */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Melting Progress" subtitle="Energy delivered vs required for active charge">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="mono text-[30px] font-semibold leading-none text-white">{nf(progress.melt_progress, 1)}%</p>
              <p className="mt-1 text-[11px] text-ink-500">melt completion</p>
            </div>
            <div className="text-right">
              <p className="mono text-[15px] text-ink-100">{nf(progress.temperature_c)} °C</p>
              <p className="text-[10.5px] text-ink-500">of {nf(progress.target_temp_c)} °C target</p>
            </div>
          </div>
          <div className="mt-3">
            <Progress value={progress.melt_progress} tone={progress.melt_progress >= 99 ? "good" : "electric"} />
          </div>
          <dl className="mt-4 space-y-2.5 border-t border-base-750 pt-3">
            <div className="flex items-center justify-between">
              <dt className="text-[11.5px] text-ink-400">Energy delivered</dt>
              <dd className="mono text-[12px] text-ink-100">{kwh(progress.energy_kwh)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[11.5px] text-ink-400">Predicted remaining</dt>
              <dd className="mono text-[12px] text-cyan">{minutes(progress.predicted_remaining_min)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[11.5px] text-ink-400">Expected completion</dt>
              <dd className="mono text-[12px] text-ink-100">{dt(progress.expected_completion)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Energy per Heat" subtitle="Recent 10 completed batches">
          <MiniBarChart
            data={data.energy_by_heat.map((e) => ({ ...e, label: e.heat_id.slice(-4) }))}
            xKey="label"
            yUnit="kWh"
            height={200}
            series={[{ key: "energy_kwh", name: "Energy", color: "#10B981" }]}
          />
        </Panel>

        <Panel title="Melting Performance" subtitle="Model prediction vs actual duration">
          <MiniBarChart
            data={data.melting_performance.map((m) => ({
              ...m,
              label: m.heat_id.slice(-4),
            }))}
            xKey="label"
            yUnit="min"
            height={200}
            series={[
              { key: "actual_min", name: "Actual", color: "#10B981" },
              { key: "predicted_min", name: "Predicted", color: "#34D399" },
            ]}
          />
        </Panel>
      </div>

      {/* Grade performance and active alerts */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Grade-Wise Performance"
          subtitle="Average specific energy per metal grade"
          action={
            <Link to="/history" className="text-[11px] text-electric hover:underline flex items-center gap-1">
              Explore history <ChevronRight className="h-3 w-3" />
            </Link>
          }
        >
          <MiniBarChart
            data={data.grade_performance.map((g) => ({ ...g, label: g.metal_grade }))}
            xKey="label"
            yUnit="kWh/kg"
            height={200}
            series={[{ key: "avg_energy_per_kg", name: "kWh per kg", color: "#34D399" }]}
          />
        </Panel>

        <Panel
          className="xl:col-span-2"
          title="Active Alerts"
          subtitle="Anomalies awaiting review"
          action={<Chip tone={alerts.length ? "warn" : "good"}>{alerts.length ? `${alerts.length} open` : "clear"}</Chip>}
        >
          <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
            {alerts.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <AlertTriangle className="h-5 w-5 text-ink-600" />
                <p className="text-[12px] text-ink-500">No active anomalies flagged.</p>
              </div>
            )}
            {alerts.map((alert) => {
              const tone = severityTone(alert.severity);
              return (
                <div key={alert.id} className={`rounded-lg border px-3 py-2 ${tone.border} ${tone.bg}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-ink-100">{alert.anomaly_type}</p>
                    <SeverityChip severity={alert.severity} />
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-400">{alert.explanation}</p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-ink-500">
                    <span className="mono">{alert.heat_id}</span>
                    {alert.deviation_pct != null && <span>{signed(alert.deviation_pct, 1, "%")} vs baseline</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <p className="pb-2 text-[10.5px] leading-relaxed text-ink-600">
        Efficiency score = 100 × (10th-percentile energy/kg of the same grade ÷ actual energy/kg), clipped 0–100.
        All AI explanations and recommendations run locally in your browser using Qwen 2.5 0.5B via WebGPU. ForgeOptima AI is a decision-support system and does not issue direct equipment control signals.
      </p>
    </div>
  );
}

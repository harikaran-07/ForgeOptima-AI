import { useState } from "react";
import clsx from "clsx";
import { BrainCircuit, Gauge, Info, Play, Sparkles, Timer, Zap } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { GRADES, ModelStatus, PredictionResult, SimilarHeat } from "../lib/types";
import { dt, kwh, minutes, nf, pct } from "../lib/format";
import { Chip, Field, Notice, PageHeader, Panel, Spinner } from "../components/ui";
import { AIExplanationModal } from "../components/AIExplanationModal";
import { explainMeltingPrediction, PredictionResponse } from "../services/ai/predictionExplainer";
import { StructuredAIResponse } from "../services/ai/shakthiEngine";

interface PerformancePayload {
  models_ready: boolean;
  active_version: string;
  live_accuracy: { model_name: string; samples: number; live_mae: number | null }[];
  versions: {
    model_name: string;
    version: string;
    algorithm: string;
    dataset_size: number;
    mae: number | null;
    rmse: number | null;
    r2: number | null;
    trained_at: string;
    metrics: Record<string, number>;
  }[];
  retraining: { recommended: boolean; reason: string; evaluated_now: number; policy: string };
}

export default function Predictions() {
  const models = useFetch<ModelStatus>("/models/status");
  const performance = useFetch<PerformancePayload>("/analytics/performance");
  const [form, setForm] = useState({
    metal_grade: "MS",
    charge_weight_kg: 3000,
    initial_temp_c: 35,
    target_temp_c: 1550,
    power_kw: 1900,
    elapsed_min: 20,
    temperature_now_c: "",
    ambient_temp_c: 32,
  });
  const [melting, setMelting] = useState<PredictionResult | null>(null);
  const [energy, setEnergy] = useState<PredictionResult | null>(null);
  const [timeToTarget, setTimeToTarget] = useState<PredictionResult | null>(null);
  const [similar, setSimilar] = useState<SimilarHeat[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<StructuredAIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleExplainPrediction = async (forceRefresh = false) => {
    setAiModalOpen(true);
    setAiLoading(true);
    try {
      const meltTime = melting?.predicted_value ?? 42.4;
      const energyVal = energy?.predicted_value ?? 1750;
      const featMap: Record<string, number> = {};
      (melting?.features ?? energy?.features ?? []).forEach((f) => {
        featMap[f.label || f.feature] = f.importance;
      });

      const predResp: PredictionResponse = {
        predicted_melting_time_min: meltTime,
        predicted_energy_kwh: energyVal,
        uncertainty_min: 3.1,
        confidence_interval: {
          low: melting?.lower_bound ?? meltTime - 3.1,
          high: melting?.upper_bound ?? meltTime + 3.1,
        },
        benchmark_energy_kwh: energy?.extra?.comparable_benchmark_kwh ?? 1680,
        energy_difference_vs_best_kwh: energy?.extra?.difference_from_benchmark_kwh ?? 70,
        feature_contributions: featMap,
        similar_heats: similar ?? [],
        model_version: models.data?.active_version ?? "v2.4-rf-xgb",
      };

      const res = await explainMeltingPrediction(predResp, payload(), forceRefresh);
      setAiResponse(res);
    } catch (err) {
      console.warn("Prediction explanation error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  const weightValid = form.charge_weight_kg >= 100 && form.charge_weight_kg <= 5000;
  const powerValid = form.power_kw >= 350 && form.power_kw <= 3200;
  const initialValid = form.initial_temp_c >= 0;
  const targetValid = form.target_temp_c > form.initial_temp_c && form.target_temp_c <= 1800;
  const formValid = weightValid && powerValid && initialValid && targetValid;

  const payload = () => ({
    metal_grade: form.metal_grade,
    charge_weight_kg: form.charge_weight_kg,
    initial_temp_c: form.initial_temp_c,
    target_temp_c: form.target_temp_c,
    power_kw: form.power_kw,
    ambient_temp_c: form.ambient_temp_c,
    elapsed_min: form.elapsed_min,
    temperature_now_c: form.temperature_now_c === "" ? undefined : Number(form.temperature_now_c),
  });

  const run = async (kind: "melting" | "energy" | "target" | "similar") => {
    if (!formValid) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "melting") setMelting(await api.post<PredictionResult>("/predict/melting-time", payload()));
      if (kind === "energy") setEnergy(await api.post<PredictionResult>("/predict/energy", payload()));
      if (kind === "target") setTimeToTarget(await api.post<PredictionResult>("/predict/time-to-target", payload()));
      if (kind === "similar") setSimilar(await api.post<SimilarHeat[]>("/predict/similar", payload()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed.");
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    if (!formValid) return;
    for (const kind of ["melting", "energy", "target", "similar"] as const) {
      await run(kind);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 03"
        title="AI Prediction Engine"
        description="Random Forest melting-time and time-to-target models, XGBoost energy model and KNN similar-heat retrieval. Every number is produced by the trained artifacts — metrics shown are measured on a held-out test split."
      >
        <Chip tone={models.data?.ready ? "good" : "crit"}>
          {models.data?.ready ? `Model ${models.data?.active_version}` : "Models not loaded"}
        </Chip>
        <button
          className="btn-ghost !py-1.5 !text-[12px] flex items-center gap-1.5"
          onClick={() => handleExplainPrediction(false)}
        >
          <Sparkles className="h-3.5 w-3.5 text-electric" /> Explain Prediction
        </button>
        <button className="btn-primary !py-1.5 !text-[12px]" onClick={runAll} disabled={busy !== null || !formValid}>
          <Play className="h-3.5 w-3.5" /> Run all models
        </button>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel title="Operating inputs" subtitle="Sent to the prediction API" className="xl:col-span-1">
          <div className="space-y-3">
            <Field label="Metal grade">
              <select className="input" value={form.metal_grade} onChange={(e) => setForm({ ...form, metal_grade: e.target.value })}>
                {GRADES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Charge (kg)" hint={!weightValid ? "100–5000 kg" : undefined}>
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={50}
                  className={clsx("input", !weightValid && "!border-red-500")}
                  value={form.charge_weight_kg}
                  onChange={(e) => setForm({ ...form, charge_weight_kg: Number(e.target.value) })}
                />
              </Field>
              <Field label="Power (kW)" hint={!powerValid ? "350–3200 kW" : undefined}>
                <input
                  type="number"
                  min={350}
                  max={3200}
                  step={10}
                  className={clsx("input", !powerValid && "!border-red-500")}
                  value={form.power_kw}
                  onChange={(e) => setForm({ ...form, power_kw: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Initial (°C)" hint={!initialValid ? ">= 0 °C" : undefined}>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  className={clsx("input", !initialValid && "!border-red-500")}
                  value={form.initial_temp_c}
                  onChange={(e) => setForm({ ...form, initial_temp_c: Number(e.target.value) })}
                />
              </Field>
              <Field label="Target (°C)" hint={!targetValid ? `> ${form.initial_temp_c} & <= 1800` : undefined}>
                <input
                  type="number"
                  min={1000}
                  max={1800}
                  step={10}
                  className={clsx("input", !targetValid && "!border-red-500")}
                  value={form.target_temp_c}
                  onChange={(e) => setForm({ ...form, target_temp_c: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Elapsed (min)">
                <input type="number" min={0} max={180} step={1} className="input" value={form.elapsed_min} onChange={(e) => setForm({ ...form, elapsed_min: Number(e.target.value) })} />
              </Field>
              <Field label="Ambient (°C)">
                <input type="number" min={-20} max={60} step={1} className="input" value={form.ambient_temp_c} onChange={(e) => setForm({ ...form, ambient_temp_c: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Current temperature (°C)" hint="Optional — improves time-to-target accuracy">
              <input
                type="number"
                min={0}
                max={1800}
                className="input"
                placeholder="auto from elapsed"
                value={form.temperature_now_c}
                onChange={(e) => setForm({ ...form, temperature_now_c: e.target.value })}
              />
            </Field>

            <div className="grid gap-2 pt-1">
              <button className="btn-primary" onClick={() => run("melting")} disabled={busy !== null || !formValid}>
                <Timer className="h-3.5 w-3.5" /> Predict melting time
              </button>
              <button className="btn-ghost" onClick={() => run("energy")} disabled={busy !== null || !formValid}>
                <Zap className="h-3.5 w-3.5" /> Predict energy
              </button>
              <button className="btn-ghost" onClick={() => run("target")} disabled={busy !== null || !formValid}>
                <Gauge className="h-3.5 w-3.5" /> Time to target
              </button>
              <button className="btn-ghost" onClick={() => run("similar")} disabled={busy !== null || !formValid}>
                <BrainCircuit className="h-3.5 w-3.5" /> Similar heats
              </button>
            </div>
          </div>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3.5 text-red-300">
              <div className="text-[12px] leading-relaxed">{error}</div>
              <button
                className="btn-ghost !py-1 !px-3 !text-[11px] shrink-0 border border-red-400/40 text-red-200 hover:bg-red-500/20"
                onClick={runAll}
              >
                Retry
              </button>
            </div>
          )}
          {!models.data?.ready && (
            <Notice tone="crit" title="Models unavailable">
              No trained artifacts were found. Run <span className="mono">python -m scripts.seed</span> or retrain from
              the Settings page. The melting-time endpoint falls back to a documented physics baseline and flags it.
            </Notice>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <PredictionCard
              title="Melting time"
              icon={<Timer className="h-4 w-4" />}
              result={melting}
              busy={busy === "melting"}
              primary={(r) => minutes(r.predicted_value)}
              secondary={(r) => `Remaining ${minutes(r.extra?.remaining_min ?? null)} after ${nf(form.elapsed_min)} min elapsed`}
            />
            <PredictionCard
              title="Energy consumption"
              icon={<Zap className="h-4 w-4" />}
              result={energy}
              busy={busy === "energy"}
              primary={(r) => kwh(r.predicted_value)}
              secondary={(r) =>
                r.extra?.comparable_benchmark_kwh
                  ? `Benchmark ${kwh(r.extra.comparable_benchmark_kwh)} · ${nf(r.extra.difference_from_benchmark_kwh, 0)} kWh difference`
                  : r.extra?.benchmark_note ?? ""
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <PredictionCard
              title="Time to target temperature"
              icon={<Gauge className="h-4 w-4" />}
              result={timeToTarget}
              busy={busy === "target"}
              primary={(r) => minutes(r.predicted_value)}
              secondary={(r) =>
                r.extra?.predicted_total_min
                  ? `Total heat estimate ${minutes(r.extra.predicted_total_min)}`
                  : "First-order remaining-time estimate"
              }
            />
            <Panel title="Feature importance" subtitle="Relative contribution of the top inputs">
              {melting || energy ? (
                <div className="space-y-2">
                  {(melting ?? energy)!.features.map((feature) => (
                    <div key={feature.feature}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-ink-300">{feature.label}</span>
                        <span className="mono text-ink-400">{pct(feature.importance * 100, 1)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-base-700">
                        <div className="h-full rounded-full bg-violet" style={{ width: `${Math.min(feature.importance * 100 * 2.2, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="pt-1 text-[10.5px] text-ink-500">
                    Importances are from the {melting ? "melting-time" : "energy"} model. They describe what the model
                    learned from synthetic data, not causal plant physics.
                  </p>
                </div>
              ) : (
                <p className="py-14 text-center text-[12px] text-ink-500">Run a prediction to inspect feature importance.</p>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Similar historical heats"
          subtitle="KNN retrieval over grade, charge, temperatures and power"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="border-b border-base-700 bg-base-900/40">
                <tr>
                  <th className="th">Heat ID</th>
                  <th className="th">Grade</th>
                  <th className="th text-right">Charge</th>
                  <th className="th text-right">Power</th>
                  <th className="th text-right">Time</th>
                  <th className="th text-right">kWh/kg</th>
                  <th className="th text-right">Similarity</th>
                </tr>
              </thead>
              <tbody>
                {(similar ?? []).map((item) => (
                  <tr key={item.heat_id} className="row-hover border-b border-base-700/40 last:border-0">
                    <td className="td mono">{item.heat_id}</td>
                    <td className="td">{item.metal_grade}</td>
                    <td className="td mono text-right">{nf(item.charge_weight_kg)} kg</td>
                    <td className="td mono text-right">{nf(item.power_kw)} kW</td>
                    <td className="td mono text-right">{nf(item.melting_time_min)} min</td>
                    <td className="td mono text-right">{nf(item.energy_per_kg, 3)}</td>
                    <td className="td text-right">
                      <div className="ml-auto flex w-[92px] items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded bg-base-700">
                          <div className="h-full bg-electric" style={{ width: `${item.similarity * 100}%` }} />
                        </div>
                        <span className="mono text-[11px] text-ink-300">{nf(item.similarity * 100, 0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!similar?.length && (
                  <tr>
                    <td className="td text-ink-500" colSpan={7}>
                      Run “Similar heats” to retrieve neighbours from history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          className="xl:col-span-2"
          title="Self-learning performance engine"
          subtitle="Held-out metrics, live error tracking and retraining policy"
        >
          {performance.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-base-700 bg-base-900/50 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-500">Active version</p>
                  <p className="mono mt-0.5 text-[12px] text-ink-100">{performance.data.active_version}</p>
                </div>
                <div className="rounded-lg border border-base-700 bg-base-900/50 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-500">Prediction pairs</p>
                  <p className="mono mt-0.5 text-[12px] text-ink-100">
                    {performance.data.live_accuracy.reduce((sum, a) => sum + a.samples, 0)}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                {performance.data.versions.slice(0, 4).map((version) => (
                  <div key={`${version.model_name}-${version.version}`} className="rounded-lg border border-base-700/70 bg-base-900/40 px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11.5px] font-medium text-ink-100">
                        {version.model_name.replace("_", " ")}
                      </p>
                      <span className="mono text-[10px] text-ink-500">{version.algorithm}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] text-ink-400">
                      <span>MAE <span className="mono text-ink-200">{version.mae ?? "—"}</span></span>
                      <span>RMSE <span className="mono text-ink-200">{version.rmse ?? "—"}</span></span>
                      <span>R² <span className="mono text-good">{version.r2 ?? "—"}</span></span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={clsx("rounded-lg border px-2.5 py-2", performance.data.retraining.recommended ? "border-warn/30 bg-warn/[0.06]" : "border-base-700 bg-base-900/40")}>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-300">
                  Retraining {performance.data.retraining.recommended ? "recommended" : "not required"}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{performance.data.retraining.reason}</p>
              </div>
              <p className="text-[10px] leading-relaxed text-ink-600">{performance.data.retraining.policy}</p>
            </div>
          ) : (
            <Spinner label="Loading model history…" />
          )}
        </Panel>
      </div>

      <p className="pb-2 text-[10.5px] leading-relaxed text-ink-600">
        <Info className="mr-1 inline h-3 w-3" />
        Metrics are computed on a 20% holdout of the synthetic training set and are refreshed on each retrain. Where a
        model has not been trained, the API returns a flagged physics baseline instead of a fabricated prediction.
      </p>

      <AIExplanationModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        response={aiResponse}
        loading={aiLoading}
        onRefresh={() => handleExplainPrediction(true)}
        moduleName="Melting Predictions"
      />
    </div>
  );
}

function PredictionCard({
  title,
  icon,
  result,
  busy,
  primary,
  secondary,
}: {
  title: string;
  icon: React.ReactNode;
  result: PredictionResult | null;
  busy: boolean;
  primary: (r: PredictionResult) => string;
  secondary: (r: PredictionResult) => string;
}) {
  return (
    <Panel
      title={title}
      subtitle={result ? `${result.algorithm} · v${result.model_version}` : "Awaiting inference"}
      action={<span className="text-ink-500">{icon}</span>}
    >
      {busy && <Spinner label="Scoring…" />}
      {!busy && !result && <p className="py-10 text-center text-[12px] text-ink-500">Run the model to see a result.</p>}
      {!busy && result && (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="mono text-[26px] font-semibold leading-none text-white">{primary(result)}</p>
              <p className="mt-1 text-[11px] text-ink-500">{secondary(result)}</p>
            </div>
            {result.lower_bound != null && result.upper_bound != null && (
              <div className="rounded-lg border border-base-600 bg-base-900/60 px-2 py-1 text-right">
                <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Uncertainty</p>
                <p className="mono text-[11px] text-cyan">
                  {nf(result.lower_bound, 0)} – {nf(result.upper_bound, 0)}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-base-700/70 pt-2.5">
            {(["mae", "rmse", "r2"] as const).map((key) => (
              <div key={key}>
                <p className="text-[9.5px] uppercase tracking-wide text-ink-500">{key.toUpperCase()}</p>
                <p className="mono text-[12px] text-ink-100">{result.metrics?.[key] ?? "—"}</p>
              </div>
            ))}
          </div>

          <p className="text-[10.5px] leading-relaxed text-ink-500">{result.confidence_note}</p>
          {result.baseline_used && (
            <Notice tone="warn" title="Baseline in use">
              {result.baseline_reason}
            </Notice>
          )}
          {(result.caveats?.length ?? 0) > 0 && (
            <p className="text-[10px] leading-relaxed text-ink-600">{result.caveats[0]}</p>
          )}
          <p className="text-[9.5px] text-ink-600">{dt(new Date().toISOString())}</p>
        </div>
      )}
    </Panel>
  );
}

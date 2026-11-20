import { useEffect, useState } from "react";
import { AlertTriangle, Check, Database, Flame, Server, Sparkles } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { AIStatus } from "../lib/types";
import { dt, nf } from "../lib/format";
import { Chip, ErrorBox, Field, Notice, PageHeader, Panel, Spinner } from "../components/ui";
import { ModelManager } from "../components/ModelManager";
import { isEngineReady, isQwenModelCached } from "../lib/webllmEngine";

interface SettingsPayload {
  runtime: {
    emission_factor_kg_per_kwh: number;
    anomaly_threshold: number;
    last_retrain_at: string | null;
  };
  environment: {
    app_version: string;
    environment: string;
    database: string;
    cors_origins: string[];
    max_upload_mb: number;
    rate_limit_per_minute: number;
    api_prefix: string;
  };
  furnace: {
    name: string | null;
    capacity_kg: number | null;
    min_power_kw: number | null;
    max_power_kw: number | null;
    rated_power_kw: number | null;
  };
  user: { name: string; role: string; email: string | null };
  models: { ready: boolean; version: string };
  ai: { provider: string; model: string; note: string };
  disclaimer: string;
}

interface RetrainResult {
  message: string;
  trained: { model_name: string; mae: number | null; rmse: number | null; r2: number | null }[];
}

export default function Settings() {
  const settings = useFetch<SettingsPayload>("/settings");
  const ai = useFetch<AIStatus>("/ai/status");
  const [form, setForm] = useState({ emission_factor_kg_per_kwh: 0.71, anomaly_threshold: 0 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrain, setRetrain] = useState<RetrainResult | null>(null);
  const [retraining, setRetraining] = useState(false);
  const [isLocalLoaded, setIsLocalLoaded] = useState(false);
  const [isLocalCached, setIsLocalCached] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setForm({
        emission_factor_kg_per_kwh: settings.data.runtime.emission_factor_kg_per_kwh,
        anomaly_threshold: settings.data.runtime.anomaly_threshold,
      });
    }
    setIsLocalLoaded(isEngineReady());
    void isQwenModelCached().then(setIsLocalCached);
  }, [settings.data]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.put("/settings", form);
      setMessage("Settings saved. Emission factor and thresholds are updated.");
      await settings.reload();
      await ai.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const runRetrain = async () => {
    setRetraining(true);
    setError(null);
    setRetrain(null);
    try {
      const result = await api.post<RetrainResult>("/models/retrain");
      setRetrain(result);
      await settings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retraining failed.");
    } finally {
      setRetraining(false);
    }
  };

  if (settings.loading && !settings.data) return <Spinner label="Loading settings…" />;
  if (settings.error && !settings.data) return <ErrorBox message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return null;

  const s = settings.data;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="On-Device Intelligence"
        title="AI Model Settings"
        description="Shakthi AI runs entirely on your device using WebGPU. No cloud AI, no API key and no external AI server."
      >
        <Chip tone={isLocalLoaded ? "good" : isLocalCached ? "cyan" : "warn"}>
          Qwen 2.5 0.5B {isLocalLoaded ? "Ready in GPU" : isLocalCached ? "Installed" : "Available"}
        </Chip>
        <Chip tone="cyan">WebGPU Acceleration</Chip>
        <Chip tone="good" className="hidden sm:inline-flex">
          100% Private & Local
        </Chip>
      </PageHeader>

      {message && <Notice tone="good">{message}</Notice>}
      {error && <ErrorBox message={error} />}

      {/* CyberShield AI Style: Hero Model Card & WebGPU Diagnostics */}
      <ModelManager
        onModelReady={() => {
          setIsLocalLoaded(true);
          setIsLocalCached(true);
        }}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Analytics parameters" subtitle="Applied across energy and anomaly modules">
          <div className="space-y-3">
            <Field
              label="Grid emission factor (kg CO₂ / kWh)"
              hint="Used for all carbon estimates. Regional grid factors vary; update to match your contract."
            >
              <input
                type="number"
                step={0.01}
                min={0}
                max={2}
                className="input mono"
                value={form.emission_factor_kg_per_kwh}
                onChange={(e) => setForm({ ...form, emission_factor_kg_per_kwh: Number(e.target.value) })}
              />
            </Field>
            <Field label="Anomaly threshold (IsolationForest score)" hint="Lower values flag more records. Default 0.">
              <input
                type="number"
                step={0.01}
                min={-1}
                max={1}
                className="input mono"
                value={form.anomaly_threshold}
                onChange={(e) => setForm({ ...form, anomaly_threshold: Number(e.target.value) })}
              />
            </Field>
            <button className="btn-primary w-full" onClick={save} disabled={saving}>
              <Check className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </Panel>

        <Panel title="Inference Architecture" subtitle="Browser Local AI vs Cloud APIs">
          <div className="space-y-3 text-[11.5px]">
            <div className="flex items-center justify-between border-b border-base-750/70 pb-2">
              <span className="text-ink-400">Primary Runtime</span>
              <span className="mono text-white font-medium">@mlc-ai/web-llm (WebGPU)</span>
            </div>
            <div className="flex items-center justify-between border-b border-base-750/70 pb-2">
              <span className="text-ink-400">Model Name</span>
              <span className="mono text-electric font-medium">Qwen2.5-0.5B-Instruct</span>
            </div>
            <div className="flex items-center justify-between border-b border-base-750/70 pb-2">
              <span className="text-ink-400">External API Key</span>
              <span className="mono text-good font-medium">None (Zero Cost)</span>
            </div>
            <div className="flex items-center justify-between border-b border-base-750/70 pb-2">
              <span className="text-ink-400">Ollama Dependency</span>
              <span className="mono text-good font-medium">None (Browser native)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-400">Privacy Status</span>
              <span className="mono text-good font-medium">100% On-Device</span>
            </div>
            <p className="rounded-lg border border-base-700 bg-base-900/50 p-2.5 text-[10.5px] leading-relaxed text-ink-400">
              User prompts never leave your browser. Inference runs on your device's GPU through WebGPU compute shaders.
            </p>
          </div>
        </Panel>

        <Panel title="Model registry" subtitle="Retraining gate and metrics">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-ink-400">Active version</span>
              <span className="mono text-ink-100">{s.models.version}</span>
            </div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-ink-400">Last retrain</span>
              <span className="mono text-[11px] text-ink-300">
                {s.runtime.last_retrain_at ? dt(s.runtime.last_retrain_at) : "seed run"}
              </span>
            </div>
            <button className="btn-ghost mt-1 w-full !py-1.5 !text-[11.5px]" onClick={runRetrain} disabled={retraining}>
              <Sparkles className="h-3 w-3" /> {retraining ? "Training…" : "Validate data & retrain"}
            </button>
            <p className="text-[10px] leading-relaxed text-ink-500">
              Retraining validates completed heats (energy ≈ power × duration), retrains all models and recomputes
              MAE/RMSE/R² on a holdout split before promoting a new version.
            </p>
            {retraining && <Spinner label="Fitting models…" />}
            {retrain && (
              <div className="space-y-1.5 rounded-lg border border-good/30 bg-good/[0.06] px-2.5 py-2">
                <p className="text-[11px] text-good">{retrain.message}</p>
                {retrain.trained.map((model) => (
                  <p key={model.model_name} className="mono text-[10px] text-ink-400">
                    {model.model_name}: MAE {model.mae ?? "—"} · R² {model.r2 ?? "—"}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Furnace configuration" subtitle="Engineer-approved envelope">
          <div className="space-y-2">
            {[
              { label: "Furnace", value: s.furnace.name ?? "—" },
              { label: "Capacity", value: s.furnace.capacity_kg ? `${nf(s.furnace.capacity_kg)} kg` : "—" },
              { label: "Rated power", value: s.furnace.rated_power_kw ? `${nf(s.furnace.rated_power_kw)} kW` : "—" },
              {
                label: "Operating limits",
                value:
                  s.furnace.min_power_kw && s.furnace.max_power_kw
                    ? `${nf(s.furnace.min_power_kw)} – ${nf(s.furnace.max_power_kw)} kW`
                    : "—",
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-base-700/60 py-1.5 last:border-0">
                <span className="text-[11.5px] text-ink-400">{row.label}</span>
                <span className="mono text-[11.5px] text-ink-100">{row.value}</span>
              </div>
            ))}
            <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/[0.05] px-2.5 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              <p className="text-[10.5px] leading-relaxed text-ink-300">
                Limits are enforced by the API for simulations and optimisation. Change them in the backend
                configuration after engineering review.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Environment" subtitle="Runtime configuration">
          <div className="space-y-1.5">
            {[
              { label: "Version", value: s.environment.app_version, icon: Server },
              { label: "Environment", value: s.environment.environment, icon: Server },
              { label: "Database", value: s.environment.database, icon: Database },
              { label: "Upload limit", value: `${s.environment.max_upload_mb} MB`, icon: Database },
              { label: "Rate limit", value: `${s.environment.rate_limit_per_minute} req/min`, icon: Server },
              { label: "API prefix", value: s.environment.api_prefix, icon: Server },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-base-700/60 py-1.5 last:border-0">
                <span className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
                  <row.icon className="h-3 w-3 text-ink-500" /> {row.label}
                </span>
                <span className="mono text-[11px] text-ink-200">{row.value}</span>
              </div>
            ))}
            <div className="pt-1">
              <p className="text-[10px] uppercase tracking-wide text-ink-500">CORS origins</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.environment.cors_origins.map((origin) => (
                  <span key={origin} className="mono rounded border border-base-600 bg-base-900 px-1.5 py-0.5 text-[9.5px] text-ink-400">
                    {origin}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Profile & compliance" subtitle="Account and platform scope">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-ink-400">User</span>
              <span className="text-[11.5px] text-ink-100">{s.user.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-ink-400">Role</span>
              <Chip tone="blue">{s.user.role}</Chip>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-ink-400">Email</span>
              <span className="mono text-[10.5px] text-ink-300">{s.user.email ?? "—"}</span>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-electric" />
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-300">Safety statement</p>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{s.disclaimer}</p>
          </div>
          <div className="mt-3 rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-ink-500">Data provenance</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-400">
              Historical records are synthetic and internally consistent (energy = ∫power dt). Live monitoring values
              are simulated. Uploaded and manual rows are flagged by source.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

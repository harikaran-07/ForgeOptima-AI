import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Gauge, Scale, ShieldCheck } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { GRADES, Optimization } from "../lib/types";
import { kwh, minutes, nf, signed } from "../lib/format";
import { TrendChart } from "../components/charts";
import { Chip, ErrorBox, Field, Notice, PageHeader, Panel, Spinner } from "../components/ui";

interface OptimizerContext {
  limits: { min_power_kw: number; max_power_kw: number; rated_power_kw: number; capacity_kg: number };
  grades: string[];
  reference_profiles: { metal_grade: string; reference: { heat_id: string; power_kw: number; energy_per_kg: number; melting_time_min: number } }[];
  safety_notes: string[];
  models_ready: boolean;
}

export default function PowerOptimizer() {
  const context = useFetch<OptimizerContext>("/optimize/context");
  const [form, setForm] = useState({
    metal_grade: "MS",
    charge_weight_kg: 3000,
    initial_temp_c: 35,
    target_temp_c: 1550,
    current_power_kw: 1500,
    alternative_power_kw: 1900,
  });
  const [result, setResult] = useState<Optimization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const limits = context.data?.limits;
  const minPower = limits?.min_power_kw ?? 350;
  const maxPower = limits?.max_power_kw ?? 3200;

  useEffect(() => {
    const reference = context.data?.reference_profiles.find((p) => p.metal_grade === form.metal_grade);
    if (reference) {
      setForm((prev) => ({
        ...prev,
        current_power_kw: Math.round(reference.reference.power_kw),
        alternative_power_kw: Math.round(reference.reference.power_kw * 1.12),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.data, form.metal_grade]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<Optimization>("/optimize/analyze", form));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimisation failed.");
    } finally {
      setBusy(false);
    }
  };

  const chartData = useMemo(() => {
    if (!result) return [];
    const current = result.current.temperature_curve;
    const alternative = result.alternative.temperature_curve;
    const length = Math.max(current.length, alternative.length);
    const rows = [];
    for (let i = 0; i < length; i += 1) {
      const c = current[i];
      const a = alternative[i];
      rows.push({
        progress: c?.progress ?? i * (100 / (length - 1)),
        current_temp: c?.temperature_c ?? null,
        alternative_temp: a?.temperature_c ?? null,
      });
    }
    return rows;
  }, [result]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 05"
        title="Intelligent Power Optimizer"
        description="Compare the current operating profile with an alternative power level using the trained models and historical evidence. Profiles are constrained to the engineer-approved furnace envelope."
      >
        <Chip tone="warn">EXPERIMENTAL SCENARIOS</Chip>
        <Chip tone="neutral">
          Limits {nf(minPower)}–{nf(maxPower)} kW
        </Chip>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel title="Scenario inputs" subtitle="What-if analysis parameters" className="xl:col-span-1">
          <div className="space-y-3">
            <Field label="Metal grade">
              <select className="input" value={form.metal_grade} onChange={(e) => setForm({ ...form, metal_grade: e.target.value })}>
                {GRADES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
            <Field label="Charge (kg)">
              <input type="number" className="input" value={form.charge_weight_kg} onChange={(e) => setForm({ ...form, charge_weight_kg: Number(e.target.value) })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Initial (°C)">
                <input type="number" className="input" value={form.initial_temp_c} onChange={(e) => setForm({ ...form, initial_temp_c: Number(e.target.value) })} />
              </Field>
              <Field label="Target (°C)">
                <input type="number" className="input" value={form.target_temp_c} onChange={(e) => setForm({ ...form, target_temp_c: Number(e.target.value) })} />
              </Field>
            </div>

            <div className="rounded-lg border border-base-700 bg-base-900/50 p-2.5">
              <div className="flex justify-between text-[10.5px] text-ink-400">
                <span>Current profile</span>
                <span className="mono text-ink-100">{nf(form.current_power_kw)} kW</span>
              </div>
              <input
                type="range"
                min={minPower}
                max={maxPower}
                step={25}
                value={form.current_power_kw}
                onChange={(e) => setForm({ ...form, current_power_kw: Number(e.target.value) })}
                className="mt-1.5 w-full accent-[#3B7DFF]"
              />
              <div className="mt-2 flex justify-between text-[10.5px] text-ink-400">
                <span>Alternative profile</span>
                <span className="mono text-violet">{nf(form.alternative_power_kw)} kW</span>
              </div>
              <input
                type="range"
                min={minPower}
                max={maxPower}
                step={25}
                value={form.alternative_power_kw}
                onChange={(e) => setForm({ ...form, alternative_power_kw: Number(e.target.value) })}
                className="mt-1.5 w-full accent-[#8B7CF6]"
              />
              <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
                Sliders are bounded by the furnace envelope. Requests outside these limits are clipped by the API.
              </p>
            </div>

            <button className="btn-primary w-full" onClick={analyze} disabled={busy || !context.data?.models_ready}>
              <Scale className="h-3.5 w-3.5" /> Run what-if analysis
            </button>
            {!context.data?.models_ready && (
              <p className="text-[10.5px] text-warn">Prediction models are required for optimisation.</p>
            )}
            {context.data?.reference_profiles.find((p) => p.metal_grade === form.metal_grade) && (
              <p className="text-[10.5px] leading-relaxed text-ink-500">
                Reference heat{" "}
                <span className="mono text-ink-300">
                  {context.data.reference_profiles.find((p) => p.metal_grade === form.metal_grade)?.reference.heat_id}
                </span>{" "}
                is the most energy-efficient recorded heat of this grade.
              </p>
            )}
          </div>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          {busy && <Spinner label="Simulating alternative profile…" />}
          {error && <ErrorBox message={error} />}

          {!result && !busy && (
            <Panel title="Current vs alternative" subtitle="Awaiting scenario">
              <p className="py-24 text-center text-[12px] text-ink-500">
                Configure the two power profiles and run the analysis to compare predicted melting time, energy and
                temperature trajectory.
              </p>
            </Panel>
          )}

          {result && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {[result.current, result.alternative].map((profile, index) => (
                  <div key={profile.label} className={`panel px-4 py-3.5 ${index === 1 ? "border-violet/40" : ""}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{profile.label}</p>
                      <Chip tone={index === 0 ? "blue" : "violet"}>{nf(profile.power_kw)} kW</Chip>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Melting</p>
                        <p className="mono text-[14px] text-ink-100">{minutes(profile.melting_time_min)}</p>
                      </div>
                      <div>
                        <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Energy</p>
                        <p className="mono text-[14px] text-ink-100">{nf(profile.energy_kwh)} kWh</p>
                      </div>
                      <div>
                        <p className="text-[9.5px] uppercase tracking-wide text-ink-500">kWh/kg</p>
                        <p className="mono text-[14px] text-ink-100">{nf(profile.energy_per_kg, 3)}</p>
                      </div>
                    </div>
                    {profile.notes.map((note) => (
                      <p key={note} className="mt-2 text-[10px] leading-relaxed text-warn">{note}</p>
                    ))}
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Panel className="lg:col-span-2" title="Expected temperature progression" subtitle="Model-implied temperature against melt progress">
                  <TrendChart
                    data={chartData}
                    xKey="progress"
                    xUnit="%"
                    yUnit="°C"
                    height={250}
                    series={[
                      { key: "current_temp", name: `Current ${nf(result.current.power_kw)} kW`, color: "#3B7DFF", area: true },
                      { key: "alternative_temp", name: `Alternative ${nf(result.alternative.power_kw)} kW`, color: "#8B7CF6", dashed: true },
                    ]}
                  />
                </Panel>

                <Panel title="Impact summary" subtitle="Alternative relative to current">
                  <div className="space-y-2.5">
                    <div className="rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-ink-500">Energy difference</p>
                      <p className={`mono mt-0.5 flex items-center gap-1 text-[17px] ${result.delta_energy_kwh <= 0 ? "text-good" : "text-warn"}`}>
                        {result.delta_energy_kwh <= 0 ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        {signed(result.delta_energy_kwh, 1, "kWh")}
                      </p>
                      <p className="text-[10px] text-ink-500">{signed(result.delta_energy_pct, 2, "%")} vs current profile</p>
                    </div>
                    <div className="rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-ink-500">Melting time difference</p>
                      <p className={`mono mt-0.5 text-[17px] ${result.delta_time_min <= 0 ? "text-cyan" : "text-ink-100"}`}>
                        {signed(result.delta_time_min, 0, "min")}
                      </p>
                      <p className="text-[10px] text-ink-500">
                        {result.delta_time_min <= 0 ? "shorter heat cycle" : "longer heat cycle"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-ink-500">Furnace envelope</p>
                      <p className="mono mt-0.5 text-[12px] text-ink-100">
                        {nf(result.limits.min_power_kw)} – {nf(result.limits.max_power_kw)} kW
                      </p>
                      <p className="text-[10px] text-ink-500">engineer-approved operating window</p>
                    </div>
                  </div>
                </Panel>
              </div>

              <div className="grid gap-4 xl:grid-cols-5">
                <Panel className="xl:col-span-3" title="Recommendations" subtitle="Explanations generated from the model comparison">
                  <ul className="space-y-2">
                    {result.recommendations.map((rec) => (
                      <li key={rec} className="flex gap-2 rounded-lg border border-base-700/70 bg-base-900/40 px-3 py-2 text-[12px] leading-relaxed text-ink-300">
                        <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <Notice tone="crit" title="Safety — read before acting">
                      <ul className="mt-1 space-y-1">
                        {result.safety_notes.map((note) => (
                          <li key={note} className="flex gap-1.5">
                            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                            {note}
                          </li>
                        ))}
                      </ul>
                    </Notice>
                  </div>
                </Panel>

                <Panel className="xl:col-span-2" title="Supporting historical evidence" subtitle="Nearest comparable heats" bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[380px]">
                      <thead className="border-b border-base-700 bg-base-900/40">
                        <tr>
                          <th className="th">Heat</th>
                          <th className="th text-right">kW</th>
                          <th className="th text-right">Time</th>
                          <th className="th text-right">kWh/kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.evidence.map((item) => (
                          <tr key={item.heat_id} className="row-hover border-b border-base-700/40 last:border-0">
                            <td className="td mono text-[11.5px]">{item.heat_id}</td>
                            <td className="td mono text-right">{nf(item.power_kw)}</td>
                            <td className="td mono text-right">{nf(item.melting_time_min)}</td>
                            <td className="td mono text-right">{nf(item.energy_per_kg, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-base-700/70 px-3 py-2.5">
                    <p className="text-[10px] leading-relaxed text-ink-500">
                      Energy per heat: current {kwh(result.current.energy_kwh)} vs alternative {kwh(result.alternative.energy_kwh)}.
                      Historical rows are synthetic, physically consistent records.
                    </p>
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

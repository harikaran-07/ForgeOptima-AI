import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cpu,
  Flame,
  Gauge,
  Layers,
  Radio,
  Thermometer,
  Timer,
  Zap,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { Dashboard } from "../lib/types";
import { dt, gradeColor, kwh, minutes, nf, severityTone, signed } from "../lib/format";
import { MiniBarChart, TrendChart } from "../components/charts";
import {
  Chip,
  ErrorBox,
  Kpi,
  Notice,
  PageHeader,
  Panel,
  Progress,
  SeverityChip,
  Spinner,
} from "../components/ui";

export default function Overview() {
  const { data, error, loading, reload } = useFetch<Dashboard>("/analytics/dashboard", { pollMs: 20000 });

  if (loading && !data) return <Spinner label="Loading plant overview…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const { kpis, progress, alerts } = data;
  const sim = kpis.data_mode === "simulated";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Plant overview"
        title="Furnace Performance Command"
        description="Consolidated view of the active induction furnace, model predictions and energy performance. All values are served by the ForgeOptima analytics API."
      >
        <Chip tone={sim ? "violet" : "cyan"}>{sim ? "SIMULATED TELEMETRY" : "HISTORICAL REFERENCE"}</Chip>
        <Link to="/live" className="btn-ghost !py-1.5 !text-[12px]">
          <Activity className="h-3.5 w-3.5" /> Monitor live
        </Link>
        <Link to="/predictions" className="btn-primary !py-1.5 !text-[12px]">
          <Cpu className="h-3.5 w-3.5" /> Run prediction
        </Link>
      </PageHeader>

      <Notice tone={sim ? "warn" : "info"} title={sim ? "Simulated data active" : "Historical reference data"}>
        {kpis.data_source_note}
      </Notice>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Active furnace"
          value={kpis.active_furnace.replace("IF-", "IF-")}
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

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Temperature + power */}
        <Panel
          className="xl:col-span-2"
          title="Temperature progression"
          subtitle="Recorded melt trace against the target tapping temperature"
          action={<Chip tone="cyan">{progress.heat_id ?? "no heat"}</Chip>}
        >
          <TrendChart
            data={data.temperature_series}
            xKey="minute"
            xUnit="min"
            yUnit="°C"
            height={244}
            series={[
              { key: "temperature_c", name: "Temperature", color: "#22D3EE", area: true },
              { key: "target_c", name: "Target", color: "#8B7CF6", dashed: true },
            ]}
            reference={[{ value: progress.target_temp_c, label: "TARGET", color: "#5A6B85" }]}
          />
        </Panel>

        <Panel title="Melting progress" subtitle="Energy delivered vs. required for this charge">
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
          <dl className="mt-4 space-y-2.5 border-t border-base-700/70 pt-3">
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
          <div className="mt-3 rounded-lg border border-base-700 bg-base-900/60 px-3 py-2">
            <p className="text-[10.5px] leading-relaxed text-ink-500">
              REMAINING TIME is a model estimate. SIMULATED values are labelled and are not sensor measurements.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Power consumption" subtitle="Electrical draw across the melt trace">
          <TrendChart
            data={data.power_series}
            xKey="minute"
            xUnit="min"
            yUnit="kW"
            height={200}
            series={[{ key: "power_kw", name: "Power", color: "#3B7DFF", area: true }]}
          />
        </Panel>

        <Panel title="Energy per heat" subtitle="Last 12 recorded heats">
          <MiniBarChart
            data={data.energy_by_heat.map((e) => ({ ...e, label: e.heat_id.slice(-4) }))}
            xKey="label"
            yUnit="kWh"
            height={200}
            series={[{ key: "energy_kwh", name: "Energy", color: "#8B7CF6" }]}
          />
        </Panel>

        <Panel title="Melting performance" subtitle="Model prediction vs. actual duration">
          {data.melting_performance.some((m) => m.predicted_min != null) ? (
            <MiniBarChart
              data={data.melting_performance.map((m) => ({
                ...m,
                label: m.heat_id.slice(-4),
              }))}
              xKey="label"
              yUnit="min"
              height={200}
              series={[
                { key: "actual_min", name: "Actual", color: "#22D3EE" },
                { key: "predicted_min", name: "Predicted", color: "#8B7CF6" },
              ]}
            />
          ) : (
            <p className="py-16 text-center text-[12px] text-ink-500">
              Train the models to compare predicted and actual melting times.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Grade-wise performance"
          subtitle="Average specific energy per metal grade"
          action={
            <Link to="/history" className="text-[11px] text-electric hover:underline">
              Explore history
            </Link>
          }
        >
          <MiniBarChart
            data={data.grade_performance.map((g) => ({ ...g, label: g.metal_grade }))}
            xKey="label"
            yUnit="kWh/kg"
            height={210}
            series={[{ key: "avg_energy_per_kg", name: "kWh per kg", color: "#34D399" }]}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.grade_performance.slice(0, 6).map((g) => (
              <div key={g.metal_grade} className="rounded-lg border border-base-700 bg-base-900/50 px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-[10.5px] text-ink-400">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: gradeColor(g.metal_grade) }} />
                  {g.metal_grade}
                </p>
                <p className="mono mt-1 text-[12.5px] text-ink-100">{nf(g.avg_melting_time_min, 0)} min</p>
                <p className="text-[10px] text-ink-500">{nf(g.heat_count)} heats · score {nf(g.avg_efficiency_score, 0)}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          className="xl:col-span-2"
          title="Active alerts"
          subtitle="Anomalies awaiting review"
          action={<Chip tone={alerts.length ? "warn" : "good"}>{alerts.length ? `${alerts.length} open` : "clear"}</Chip>}
        >
          <div className="max-h-[335px] space-y-2 overflow-y-auto pr-1">
            {alerts.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-12 text-center">
                <AlertTriangle className="h-5 w-5 text-ink-600" />
                <p className="text-[12px] text-ink-500">No anomaly records stored yet.</p>
                <Link to="/anomalies" className="text-[11px] text-electric hover:underline">
                  Run a scan
                </Link>
              </div>
            )}
            {alerts.map((alert) => {
              const tone = severityTone(alert.severity);
              return (
                <div key={alert.id} className={`rounded-lg border px-3 py-2.5 ${tone.border} ${tone.bg}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-ink-100">{alert.anomaly_type}</p>
                    <SeverityChip severity={alert.severity} />
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-400">{alert.explanation}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-500">
                    <span className="mono">{alert.heat_id}</span>
                    {alert.deviation_pct != null && <span>{signed(alert.deviation_pct, 1, "%")} vs baseline</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel
        title="Recent heat records"
        subtitle="Newest heats stored in the plant database"
        action={
          <Link to="/history" className="flex items-center gap-1 text-[11px] text-electric hover:underline">
            Full history <ArrowRight className="h-3 w-3" />
          </Link>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-base-700 bg-base-900/40">
              <tr>
                <th className="th">Heat ID</th>
                <th className="th">Grade</th>
                <th className="th text-right">Charge (kg)</th>
                <th className="th text-right">Power (kW)</th>
                <th className="th text-right">Melting (min)</th>
                <th className="th text-right">Energy (kWh)</th>
                <th className="th text-right">kWh/kg</th>
                <th className="th">Status</th>
                <th className="th">Source</th>
                <th className="th">Started</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_heats.map((heat) => (
                <tr key={heat.heat_id} className="row-hover border-b border-base-700/50 last:border-0">
                  <td className="td">
                    <Link to={`/history/${heat.heat_id}`} className="mono text-electric hover:underline">
                      {heat.heat_id}
                    </Link>
                  </td>
                  <td className="td">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: gradeColor(heat.metal_grade) }} />
                      {heat.metal_grade}
                    </span>
                  </td>
                  <td className="td mono text-right">{nf(heat.charge_weight_kg)}</td>
                  <td className="td mono text-right">{nf(heat.power_kw)}</td>
                  <td className="td mono text-right">{nf(heat.melting_time_min)}</td>
                  <td className="td mono text-right">{nf(heat.energy_kwh, 1)}</td>
                  <td className="td mono text-right">{nf(heat.energy_kwh / heat.charge_weight_kg, 3)}</td>
                  <td className="td capitalize">{heat.heat_status}</td>
                  <td className="td text-ink-400">{heat.is_synthetic ? "synthetic" : heat.source}</td>
                  <td className="td text-ink-400">{dt(heat.heat_started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="pb-2 text-[10.5px] leading-relaxed text-ink-600">
        Efficiency score = 100 × (10th-percentile energy/kg of the same grade ÷ actual energy/kg), clipped 0–100.
        Historical records are synthetic and physically consistent; live values are simulated. ForgeOptima AI is a
        decision-support system and does not issue furnace control actions.
      </p>
    </div>
  );
}

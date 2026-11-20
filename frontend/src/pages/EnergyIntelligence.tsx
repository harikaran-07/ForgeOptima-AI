import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, Download, Leaf, Sparkles, TrendingUp, Zap } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api, downloadBlob } from "../lib/api";
import { EnergyPayload } from "../lib/types";
import { kwh, nf, pct, signed } from "../lib/format";
import { MiniBarChart, TrendChart } from "../components/charts";
import { Chip, ErrorBox, Kpi, Notice, PageHeader, Panel, Progress, Spinner } from "../components/ui";
import { AIExplanationModal } from "../components/AIExplanationModal";
import { analyzeEnergyIntelligence, EnergyContextData } from "../services/ai/energyAnalyzer";
import { StructuredAIResponse } from "../services/ai/shakthiEngine";

type Granularity = "day" | "week" | "month";

export default function EnergyIntelligence() {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [days, setDays] = useState(30);
  const [improvement, setImprovement] = useState(5);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<StructuredAIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const navigate = useNavigate();

  const handleAiEnergyAnalysis = async (forceRefresh = false) => {
    if (!data) return;
    setAiModalOpen(true);
    setAiLoading(true);
    try {
      const energyCtx: EnergyContextData = {
        total_energy_kwh: data.summary.total_energy_kwh,
        charge_weight_kg: data.summary.total_charge_kg,
        specific_energy_kwh_per_kg: data.summary.avg_energy_per_kg,
        benchmark_kwh_per_kg: 0.548,
        efficiency_score: data.summary.avg_efficiency_score,
        holding_energy_waste_kwh: data.summary.total_energy_kwh * 0.045,
        carbon_footprint_kg: data.summary.co2_kg,
        grid_emission_factor: data.summary.emission_factor,
      };
      const res = await analyzeEnergyIntelligence(energyCtx, forceRefresh);
      setAiResponse(res);
    } catch (err) {
      console.warn("AI Energy Analysis error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  const { data, error, loading, reload } = useFetch<EnergyPayload>(
    `/analytics/energy?days=${days}&granularity=${granularity}`,
    { deps: [days, granularity] }
  );

  const projected = useMemo(() => {
    if (!data) return null;
    const total = data.summary.total_energy_kwh;
    const factor = data.summary.emission_factor;
    const reduced = total * (1 - improvement / 100);
    return {
      co2: reduced * factor,
      avoided: (total - reduced) * factor,
    };
  }, [data, improvement]);

  const exportReport = async (format: "pdf" | "csv") => {
    setDownloadError(null);
    try {
      const blob = await api.blob(`/reports/energy?format=${format}&days=${days}&granularity=${granularity}`);
      downloadBlob(blob, `forgeoptima_energy_report.${format}`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    }
  };

  if (loading && !data) return <Spinner label="Aggregating energy analytics…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const s = data.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 06"
        title="Energy Intelligence"
        description="Energy consumption, specific energy benchmarking, waste detection, a transparent efficiency score and estimated CO₂ emissions."
      >
        <select className="input !w-auto !py-1.5 !text-[12px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
        </select>
        <button
          className="btn-primary !py-1.5 !text-[12px] flex items-center gap-1.5"
          onClick={() => handleAiEnergyAnalysis(false)}
        >
          <Sparkles className="h-3.5 w-3.5 text-electric" /> AI Energy Analysis
        </button>
        <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => exportReport("csv")}>
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => exportReport("pdf")}>
          <Download className="h-3.5 w-3.5" /> PDF report
        </button>
      </PageHeader>

      {downloadError && <ErrorBox message={downloadError} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total energy" value={nf(s.total_energy_kwh)} unit="kWh" hint={`${s.heat_count} heats`} icon={<Zap className="h-4 w-4" />} tone="blue" />
        <Kpi label="Energy per heat" value={nf(s.avg_energy_per_heat)} unit="kWh" hint="average" icon={<TrendingUp className="h-4 w-4" />} />
        <Kpi label="Specific energy" value={nf(s.avg_energy_per_kg, 3)} unit="kWh/kg" hint="per kg melted" tone="cyan" />
        <Kpi label="Efficiency score" value={nf(s.avg_efficiency_score, 1)} unit="/ 100" hint="vs best decile" tone="good" />
        <Kpi label="Estimated CO₂" value={nf(s.co2_kg)} unit="kg" hint={`factor ${s.emission_factor}`} tone="warn" />
        <Kpi label="Today" value={nf(s.today_energy_kwh)} unit="kWh" hint={`${s.today_heats} heats · ${nf(s.today_co2_kg)} kg CO₂`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Consumption analysis"
          subtitle={`Energy, specific energy and emissions by ${granularity}`}
          action={
            <div className="flex gap-1 rounded-lg border border-base-600 bg-base-900 p-0.5">
              {(["day", "week", "month"] as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`rounded px-2.5 py-1 text-[11px] capitalize transition-colors ${
                    granularity === g ? "bg-electric/20 text-white" : "text-ink-400 hover:text-ink-100"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          }
        >
          <TrendChart
            data={data.series}
            xKey="label"
            xUnit=""
            yUnit="kWh"
            height={250}
            series={[
              { key: "energy_kwh", name: "Energy (kWh)", color: "#10B981", area: true },
              { key: "co2_kg", name: "CO₂ (kg, est.)", color: "#FBBF24" },
            ]}
          />
          <div className="mt-3">
            <MiniBarChart
              data={data.series.slice(-14)}
              xKey="label"
              yUnit="kWh/kg"
              height={160}
              series={[{ key: "energy_per_kg", name: "Specific energy", color: "#34D399" }]}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Efficiency score" subtitle="Documented, non-arbitrary calculation">
            <div className="flex items-end justify-between">
              <p className="mono text-[32px] font-semibold leading-none text-good">{nf(s.avg_efficiency_score, 1)}</p>
              <span className="text-[11px] text-ink-500">out of 100</span>
            </div>
            <div className="mt-2">
              <Progress value={s.avg_efficiency_score} tone={s.avg_efficiency_score > 88 ? "good" : "warn"} />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-400">{s.efficiency_method}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-base-700/70 pt-2.5 text-[10.5px]">
              <div>
                <p className="text-ink-500">Best grade</p>
                <p className="mt-0.5 text-good">{s.best_grade ?? "—"}</p>
              </div>
              <div>
                <p className="text-ink-500">Highest specific energy</p>
                <p className="mt-0.5 text-warn">{s.worst_grade ?? "—"}</p>
              </div>
            </div>
          </Panel>

          <Panel title="Carbon footprint intelligence" subtitle="Estimated, not verified measurements">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-good" />
              <p className="mono text-[22px] font-semibold text-white">{nf(s.co2_kg)} kg</p>
              <span className="text-[10.5px] text-ink-500">CO₂e · {days}d</span>
            </div>
            <p className="mt-1 text-[10.5px] text-ink-500">
              Energy × {data.summary.emission_factor} kg CO₂/kWh (configurable in Settings)
            </p>
            <div className="mt-3 rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
              <div className="flex items-center justify-between text-[10.5px] text-ink-400">
                <span>Scenario improvement</span>
                <span className="mono text-good">{pct(improvement, 0)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={improvement}
                onChange={(e) => setImprovement(Number(e.target.value))}
                className="mt-1.5 w-full accent-[#34D399]"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Scenario CO₂</p>
                  <p className="mono text-[12px] text-ink-100">{nf(projected?.co2 ?? 0)} kg</p>
                </div>
                <div>
                  <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Avoided</p>
                  <p className="mono text-[12px] text-good">{nf(projected?.avoided ?? 0)} kg</p>
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-600">{data.carbon.note}</p>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Energy waste detection" subtitle="Heats exceeding the grade benchmark by more than 6%">
          {data.waste_findings.length === 0 ? (
            <p className="py-14 text-center text-[12px] text-ink-500">No heats exceeded the benchmark threshold.</p>
          ) : (
            <div className="space-y-2">
              {data.waste_findings.map((finding) => (
                <div key={finding.heat_id} className="rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        className="mono text-[12px] text-electric hover:underline"
                        onClick={() => navigate(`/history/${finding.heat_id}`)}
                      >
                        {finding.heat_id}
                      </button>
                      <Chip tone="neutral">{finding.metal_grade}</Chip>
                    </div>
                    <span className="mono text-[12px] text-warn">{signed(finding.excess_pct, 1, "%")} excess</span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-400">
                    {nf(finding.observed_energy_kwh)} kWh observed vs {nf(finding.expected_energy_kwh)} kWh benchmark
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {finding.contributing_factors.map((factor) => (
                      <li key={factor} className="flex gap-1.5 text-[10.5px] text-ink-500">
                        <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-warn" />
                        {factor}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="xl:col-span-2" title="Grade benchmarks" subtitle="10th-percentile specific energy per grade">
          <div className="space-y-2">
            {Object.entries(s.grade_reference_energy_per_kg)
              .sort((a, b) => a[1] - b[1])
              .map(([grade, value]) => {
                const max = Math.max(...Object.values(s.grade_reference_energy_per_kg));
                return (
                  <div key={grade}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-ink-300">{grade}</span>
                      <span className="mono text-ink-200">{nf(value, 3)} kWh/kg</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-base-700">
                      <div className="h-full rounded-full bg-cyan" style={{ width: `${(value / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
          <div className="mt-3">
            <Notice tone="info" title="Method">
              Benchmarks come from the plant's own best decile per grade — grades are never compared on a single
              absolute value.
            </Notice>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-base-700 bg-base-900/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-ink-500" />
              <span className="text-[10.5px] text-ink-400">Energy per kg, all heats</span>
            </div>
            <span className="mono text-[12px] text-ink-100">{nf(s.avg_energy_per_kg, 3)}</span>
          </div>
        </Panel>
      </div>

      <Panel title="Interpretation notes" subtitle="What these numbers do and do not mean">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              title: "Measured / recorded",
              body: "Energy, charge weight and duration come from stored heat records. Synthetic rows are labelled in heat history.",
            },
            {
              title: "Derived",
              body: "Specific energy, benchmarks and efficiency scores are computed from stored records using the documented formulas.",
            },
            {
              title: "Estimated",
              body: "CO₂ emissions are estimated from a configurable grid factor and are not verified environmental measurements.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-base-700 bg-base-900/40 px-3 py-2.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-300">{item.title}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-ink-600">
          Reporting window {s.period.from} → {s.period.to} · total charge {nf(s.total_charge_kg)} kg · {kwh(s.total_energy_kwh)}.
        </p>
      </Panel>

      <AIExplanationModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        response={aiResponse}
        loading={aiLoading}
        onRefresh={() => handleAiEnergyAnalysis(true)}
        moduleName="Energy Intelligence"
      />
    </div>
  );
}

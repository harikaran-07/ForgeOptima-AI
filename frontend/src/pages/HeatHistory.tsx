import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { Download, Filter, Search, X } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api, downloadBlob } from "../lib/api";
import { Heat, SimilarHeat } from "../lib/types";
import { dt, gradeColor, kwh, minutes, nf } from "../lib/format";
import { TrendChart } from "../components/charts";
import { Chip, ErrorBox, Field, Notice, PageHeader, Panel, Spinner } from "../components/ui";

interface HeatPage {
  items: Heat[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface Options {
  grades: string[];
  sources: string[];
  bounds: {
    charge_kg: [number, number];
    melting_time_min: [number, number];
    energy_kwh: [number, number];
  };
  total_heats: number;
}

interface Comparison {
  heat: Heat;
  energy_per_kg: number;
  benchmark_energy_per_kg: number | null;
  efficiency_score: number | null;
  similar: SimilarHeat[];
}

interface Timeline {
  heat_id: string;
  series: { minute: number; temperature_c: number; power_kw: number; energy_kwh: number; progress: number }[];
}

export default function HeatHistory() {
  const { heatId } = useParams();
  const navigate = useNavigate();
  const options = useFetch<Options>("/heats/options");
  const [filters, setFilters] = useState({
    search: "",
    metal_grade: "",
    min_charge: "",
    max_charge: "",
    min_duration: "",
    max_duration: "",
    min_energy: "",
    max_energy: "",
    status: "",
    date_from: "",
    date_to: "",
  });
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState(filters);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), page_size: "20" });
    Object.entries(applied).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return `/heats?${params.toString()}`;
  }, [applied, page]);

  const heats = useFetch<HeatPage>(query, { deps: [query] });

  const apply = () => {
    setPage(1);
    setApplied(filters);
  };
  const reset = () => {
    const clean = {
      search: "",
      metal_grade: "",
      min_charge: "",
      max_charge: "",
      min_duration: "",
      max_duration: "",
      min_energy: "",
      max_energy: "",
      status: "",
      date_from: "",
      date_to: "",
    };
    setFilters(clean);
    setApplied(clean);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 08"
        title="Heat History & Grade Intelligence"
        description={`Filter and inspect every stored heat — ${nf(options.data?.total_heats ?? 0)} records. Each heat keeps its full trace, model comparison and report downloads.`}
      >
        <Chip tone="neutral">{options.data?.grades.length ?? 0} grades</Chip>
        <Chip tone="cyan">{options.data?.sources.join(" · ") || "—"}</Chip>
      </PageHeader>

      <Panel
        title="Filters"
        subtitle="Combine grade, charge, duration, energy and date ranges"
        action={
          <button className="btn-ghost !py-1 !text-[11px]" onClick={reset}>
            <X className="h-3 w-3" /> Clear
          </button>
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="Heat ID search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-500" />
              <input
                className="input !pl-8"
                placeholder="H-2026…"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && apply()}
              />
            </div>
          </Field>
          <Field label="Metal grade">
            <select className="input" value={filters.metal_grade} onChange={(e) => setFilters({ ...filters, metal_grade: e.target.value })}>
              <option value="">All grades</option>
              {(options.data?.grades ?? []).map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label="Charge (kg) min / max">
            <div className="flex gap-1.5">
              <input type="number" className="input" placeholder="min" value={filters.min_charge} onChange={(e) => setFilters({ ...filters, min_charge: e.target.value })} />
              <input type="number" className="input" placeholder="max" value={filters.max_charge} onChange={(e) => setFilters({ ...filters, max_charge: e.target.value })} />
            </div>
          </Field>
          <Field label="Duration (min) min / max">
            <div className="flex gap-1.5">
              <input type="number" className="input" placeholder="min" value={filters.min_duration} onChange={(e) => setFilters({ ...filters, min_duration: e.target.value })} />
              <input type="number" className="input" placeholder="max" value={filters.max_duration} onChange={(e) => setFilters({ ...filters, max_duration: e.target.value })} />
            </div>
          </Field>
          <Field label="Energy (kWh) min / max">
            <div className="flex gap-1.5">
              <input type="number" className="input" placeholder="min" value={filters.min_energy} onChange={(e) => setFilters({ ...filters, min_energy: e.target.value })} />
              <input type="number" className="input" placeholder="max" value={filters.max_energy} onChange={(e) => setFilters({ ...filters, max_energy: e.target.value })} />
            </div>
          </Field>
          <Field label="Status">
            <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any status</option>
              <option value="completed">completed</option>
              <option value="aborted">aborted</option>
              <option value="running">running</option>
            </select>
          </Field>
          <Field label="From">
            <input type="date" className="input" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={apply}>
              <Filter className="h-3.5 w-3.5" /> Apply
            </button>
          </div>
        </div>
      </Panel>

      <div className={clsx("grid gap-4", heatId ? "xl:grid-cols-5" : "grid-cols-1")}>
        <Panel
          className={heatId ? "xl:col-span-3" : ""}
          title="Heat records"
          subtitle={heats.data ? `${nf(heats.data.total)} matching heats` : "Loading"}
          bodyClassName="p-0"
        >
          {heats.loading && !heats.data && <Spinner />}
          {heats.error && <div className="p-4"><ErrorBox message={heats.error} /></div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-base-700 bg-base-900/40">
                <tr>
                  <th className="th">Heat ID</th>
                  <th className="th">Grade</th>
                  <th className="th text-right">Charge</th>
                  <th className="th text-right">Power</th>
                  <th className="th text-right">Time</th>
                  <th className="th text-right">Energy</th>
                  <th className="th text-right">kWh/kg</th>
                  <th className="th">Status</th>
                  <th className="th">Started</th>
                </tr>
              </thead>
              <tbody>
                {(heats.data?.items ?? []).map((heat) => (
                  <tr
                    key={heat.heat_id}
                    className={clsx("row-hover cursor-pointer border-b border-base-700/40 last:border-0", heatId === heat.heat_id && "bg-electric/[0.07]")}
                    onClick={() => navigate(`/history/${heat.heat_id}`)}
                  >
                    <td className="td mono text-electric">{heat.heat_id}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: gradeColor(heat.metal_grade) }} />
                        {heat.metal_grade}
                      </span>
                    </td>
                    <td className="td mono text-right">{nf(heat.charge_weight_kg)}</td>
                    <td className="td mono text-right">{nf(heat.power_kw)}</td>
                    <td className="td mono text-right">{nf(heat.melting_time_min)}</td>
                    <td className="td mono text-right">{nf(heat.energy_kwh)}</td>
                    <td className="td mono text-right">{nf(heat.energy_kwh / heat.charge_weight_kg, 3)}</td>
                    <td className="td capitalize">{heat.heat_status}</td>
                    <td className="td text-ink-400">{dt(heat.heat_started_at)}</td>
                  </tr>
                ))}
                {!heats.loading && !(heats.data?.items ?? []).length && (
                  <tr>
                    <td className="td py-10 text-center text-ink-500" colSpan={9}>
                      No heats match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-700/70 px-3 py-2.5">
            <p className="text-[11px] text-ink-500">
              Page {heats.data?.page ?? 1} of {heats.data?.total_pages ?? 1}
            </p>
            <div className="flex gap-1.5">
              <button className="btn-ghost !py-1 !text-[11px]" disabled={(heats.data?.page ?? 1) <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button
                className="btn-ghost !py-1 !text-[11px]"
                disabled={(heats.data?.page ?? 1) >= (heats.data?.total_pages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </Panel>

        {heatId && <HeatDetail heatId={heatId} onClose={() => navigate("/history")} />}
      </div>
    </div>
  );
}

function HeatDetail({ heatId, onClose }: { heatId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const detail = useFetch<Heat & { energy_per_kg: number; reading_count: number; notes: string | null }>(`/heats/${heatId}`);
  const timeline = useFetch<Timeline>(`/analytics/heat/${heatId}/timeline`);
  const comparison = useFetch<Comparison>(`/heats/${heatId}/comparison`);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setDownloadError(null);
  }, [heatId]);

  const download = async (format: "pdf" | "csv") => {
    try {
      const blob = await api.blob(`/reports/heat/${heatId}?format=${format}`);
      downloadBlob(blob, `${heatId}.${format}`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    }
  };

  const heat = detail.data;

  return (
    <div className="space-y-4 xl:col-span-2">
      <Panel
        title={heatId}
        subtitle={heat ? `${heat.metal_grade} · ${nf(heat.charge_weight_kg)} kg · ${heat.source}` : "Loading heat"}
        action={
          <button className="text-ink-400 hover:text-white" onClick={onClose} aria-label="Close detail">
            <X className="h-4 w-4" />
          </button>
        }
      >
        {!heat ? (
          <Spinner label="Loading heat…" />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: "Energy", value: kwh(heat.energy_kwh) },
                { label: "Melting time", value: minutes(heat.melting_time_min) },
                { label: "Power", value: `${nf(heat.power_kw)} kW` },
                { label: "kWh / kg", value: nf(heat.energy_per_kg, 3) },
                { label: "Charge", value: `${nf(heat.charge_weight_kg)} kg` },
                { label: "Status", value: heat.heat_status },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-base-700 bg-base-900/50 px-2.5 py-2">
                  <p className="text-[9.5px] uppercase tracking-wide text-ink-500">{item.label}</p>
                  <p className="mono mt-0.5 text-[12.5px] capitalize text-ink-100">{item.value}</p>
                </div>
              ))}
            </div>

            {comparison.data && (
              <div className="rounded-lg border border-base-700 bg-base-900/50 px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-400">Benchmark (grade best decile)</span>
                  <span className="mono text-ink-100">
                    {comparison.data.benchmark_energy_per_kg ? nf(comparison.data.benchmark_energy_per_kg, 3) : "—"} kWh/kg
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-ink-400">Efficiency score</span>
                  <span className="mono text-good">{nf(comparison.data.efficiency_score, 1)} / 100</span>
                </div>
              </div>
            )}

            {timeline.data && timeline.data.series.length > 1 && (
              <TrendChart
                data={timeline.data.series}
                xKey="minute"
                xUnit="min"
                yUnit="°C"
                height={190}
                series={[
                  { key: "temperature_c", name: "Temperature", color: "#22D3EE", area: true },
                  { key: "power_kw", name: "Power (kW)", color: "#3B7DFF" },
                ]}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost !py-1.5 !text-[11.5px]" onClick={() => download("pdf")}>
                <Download className="h-3 w-3" /> PDF report
              </button>
              <button className="btn-ghost !py-1.5 !text-[11.5px]" onClick={() => download("csv")}>
                <Download className="h-3 w-3" /> CSV
              </button>
            </div>
            {downloadError && <ErrorBox message={downloadError} />}
            {heat.notes && <Notice tone="info" title="Operator notes">{heat.notes}</Notice>}
          </div>
        )}
      </Panel>

      <Panel title="Comparable historical heats" subtitle="KNN neighbours of this heat" bodyClassName="p-0">
        {comparison.loading && <Spinner />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead className="border-b border-base-700 bg-base-900/40">
              <tr>
                <th className="th">Heat</th>
                <th className="th text-right">Charge</th>
                <th className="th text-right">Time</th>
                <th className="th text-right">kWh/kg</th>
                <th className="th text-right">Match</th>
              </tr>
            </thead>
            <tbody>
              {(comparison.data?.similar ?? []).map((item) => (
                <tr
                  key={item.heat_id}
                  className="row-hover cursor-pointer border-b border-base-700/40 last:border-0"
                  onClick={() => navigate(`/history/${item.heat_id}`)}
                >
                  <td className="td mono text-[11.5px]">{item.heat_id}</td>
                  <td className="td mono text-right">{nf(item.charge_weight_kg)}</td>
                  <td className="td mono text-right">{nf(item.melting_time_min)}</td>
                  <td className="td mono text-right">{nf(item.energy_per_kg, 3)}</td>
                  <td className="td mono text-right text-cyan">{nf(item.similarity * 100, 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

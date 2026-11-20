import { useState } from "react";
import clsx from "clsx";
import { Download, FileBarChart, FileSpreadsheet, FileText, Leaf, Sparkles } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api, downloadBlob } from "../lib/api";
import { Heat } from "../lib/types";
import { dt, nf } from "../lib/format";
import { Chip, ErrorBox, Notice, PageHeader, Panel, Spinner } from "../components/ui";
import { AIExplanationModal } from "../components/AIExplanationModal";
import { generateReportSummary, ReportContextData } from "../services/ai/reportGenerator";
import { StructuredAIResponse } from "../services/ai/shakthiEngine";

interface HeatPage {
  items: Heat[];
  total: number;
}

const REPORTS = [
  {
    key: "heat",
    title: "Individual heat report",
    description: "Full heat sheet with predictions, benchmark comparison and comparable heats.",
    icon: FileText,
    needsHeat: true,
  },
  {
    key: "energy",
    title: "Energy consumption report",
    description: "Consumption by period, specific energy benchmark and highest-excess heats.",
    icon: FileBarChart,
  },
  {
    key: "performance",
    title: "Melting performance report",
    description: "Predicted vs actual melting times and model evaluation metrics.",
    icon: FileBarChart,
  },
  {
    key: "grades",
    title: "Grade-wise analysis",
    description: "Per-grade melting time, energy and efficiency comparison.",
    icon: FileSpreadsheet,
  },
  {
    key: "carbon",
    title: "Carbon emissions report",
    description: "Estimated CO₂ from energy consumption with the configured grid factor.",
    icon: Leaf,
  },
  {
    key: "anomalies",
    title: "Anomaly report",
    description: "Stored anomaly findings with severity, explanation and inspection guidance.",
    icon: FileText,
  },
];

export default function Reports() {
  const heats = useFetch<HeatPage>("/heats?page_size=60");
  const [selectedHeat, setSelectedHeat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<StructuredAIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeReportKey, setActiveReportKey] = useState<string>("Plant Analytics");

  const handleGenerateAiSummary = async (reportType = "Comprehensive Plant Analytics", forceRefresh = false) => {
    setActiveReportKey(reportType);
    setAiModalOpen(true);
    setAiLoading(true);
    try {
      const repCtx: ReportContextData = {
        report_type: reportType,
        heat_id: selectedHeat || heats.data?.items[0]?.heat_id,
        total_heats: heats.data?.total ?? 60,
        total_tonnage_tons: ((heats.data?.items ?? []).reduce((acc, h) => acc + h.charge_weight_kg, 0) || 180000) / 1000,
        avg_melting_time_min: 43.8,
        avg_specific_energy_kwh_per_kg: 0.584,
        total_energy_mwh: 105.2,
        total_anomalies_count: 6,
        high_severity_anomalies: 1,
        top_grades: ["MS", "SS304", "Cast Iron"],
        period: "Last 30 Days",
      };
      const res = await generateReportSummary(repCtx, forceRefresh);
      setAiResponse(res);
    } catch (err) {
      console.warn("AI Report Summary error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  const download = async (key: string, format: "pdf" | "csv", heatId?: string) => {
    setBusy(`${key}-${format}`);
    setError(null);
    setDone(null);
    try {
      const path =
        key === "heat"
          ? `/reports/heat/${heatId}?format=${format}`
          : `/reports/${key}?format=${format}`;
      const blob = await api.blob(path);
      downloadBlob(blob, `forgeoptima_${key}_report.${format}`);
      setDone(`${REPORTS.find((r) => r.key === key)?.title} (${format.toUpperCase()}) generated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const heatId = selectedHeat || heats.data?.items[0]?.heat_id || "";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 11"
        title="Reports & Analytics"
        description="Downloadable decision-support documents. Every report states its data source, model metrics and the limits of what the numbers mean."
      >
        <Chip tone="neutral">PDF & CSV</Chip>
        <button
          className="btn-primary !py-1.5 !text-[12px] flex items-center gap-1.5"
          onClick={() => handleGenerateAiSummary("Comprehensive Plant Performance Report", false)}
        >
          <Sparkles className="h-3.5 w-3.5 text-electric" /> Generate AI Executive Summary
        </button>
      </PageHeader>

      {error && <ErrorBox message={error} />}
      {done && <Notice tone="good">{done}</Notice>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <Panel key={report.key} title={report.title} subtitle={report.description}>
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              <report.icon className="h-3.5 w-3.5 text-electric" />
              {report.needsHeat ? "Requires a heat selection" : "Aggregate report"}
            </div>

            {report.needsHeat && (
              <div className="mt-2.5">
                {heats.loading && !heats.data ? (
                  <Spinner label="Loading heats…" />
                ) : (
                  <select className="input !text-[11.5px]" value={selectedHeat} onChange={(e) => setSelectedHeat(e.target.value)}>
                    <option value="">Most recent heat ({heats.data?.items[0]?.heat_id ?? "—"})</option>
                    {(heats.data?.items ?? []).map((heat) => (
                      <option key={heat.heat_id} value={heat.heat_id}>
                        {heat.heat_id} · {heat.metal_grade} · {nf(heat.charge_weight_kg)} kg
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                className="btn-primary flex-1 !py-1.5 !text-[11.5px]"
                disabled={busy !== null || (report.needsHeat && !heatId)}
                onClick={() => download(report.key, "pdf", heatId)}
              >
                <Download className="h-3 w-3" /> {busy === `${report.key}-pdf` ? "Generating…" : "PDF"}
              </button>
              <button
                className="btn-ghost flex-1 !py-1.5 !text-[11.5px]"
                disabled={busy !== null || (report.needsHeat && !heatId)}
                onClick={() => download(report.key, "csv", heatId)}
              >
                <Download className="h-3 w-3" /> {busy === `${report.key}-csv` ? "Generating…" : "CSV"}
              </button>
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Recently recorded heats" subtitle="Available for individual heat reports" bodyClassName="p-0">
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full min-w-[620px]">
              <thead className="sticky top-0 border-b border-base-700 bg-base-900/90">
                <tr>
                  <th className="th">Heat ID</th>
                  <th className="th">Grade</th>
                  <th className="th text-right">Charge</th>
                  <th className="th text-right">Energy</th>
                  <th className="th">Started</th>
                  <th className="th text-right">Report</th>
                </tr>
              </thead>
              <tbody>
                {(heats.data?.items ?? []).slice(0, 20).map((heat) => (
                  <tr key={heat.heat_id} className="row-hover border-b border-base-700/40 last:border-0">
                    <td className="td mono">{heat.heat_id}</td>
                    <td className="td">{heat.metal_grade}</td>
                    <td className="td mono text-right">{nf(heat.charge_weight_kg)}</td>
                    <td className="td mono text-right">{nf(heat.energy_kwh, 1)}</td>
                    <td className="td text-ink-400">{dt(heat.heat_started_at)}</td>
                    <td className="td text-right">
                      <button
                        className={clsx("text-[11px] text-electric hover:underline")}
                        onClick={() => {
                          setSelectedHeat(heat.heat_id);
                          void download("heat", "pdf", heat.heat_id);
                        }}
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Report contents" subtitle="Consistent fields across documents">
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-ink-400">
              {[
                "Heat ID, metal grade, charge weight",
                "Initial and target temperature",
                "Actual vs predicted melting time",
                "Actual vs predicted energy consumption",
                "Model evaluation metrics and version",
                "Historical benchmark comparison",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-electric" />
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
          <Notice tone="warn" title="Document status">
            Reports are generated from synthetic plant history and model outputs. They are decision-support
            documents, not certified industrial records, and do not authorise control actions.
          </Notice>
        </div>
      </div>

      <AIExplanationModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        response={aiResponse}
        loading={aiLoading}
        onRefresh={() => handleGenerateAiSummary(activeReportKey, true)}
        moduleName={activeReportKey}
      />
    </div>
  );
}

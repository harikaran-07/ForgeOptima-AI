import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Check, ChevronDown, Radar, ScanSearch, ShieldAlert, Sparkles } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { Anomaly } from "../lib/types";
import { dt, nf, signed } from "../lib/format";
import { Chip, ErrorBox, Notice, PageHeader, Panel, SeverityChip, Spinner } from "../components/ui";
import { AIExplanationModal } from "../components/AIExplanationModal";
import { explainAnomalyRecord } from "../services/ai/anomalyExplainer";
import { StructuredAIResponse } from "../services/ai/shakthiEngine";

interface Summary {
  counts: { LOW: number; MEDIUM: number; HIGH: number };
  total: number;
  by_type: { type: string; count: number }[];
  acknowledged: number;
  method: string;
  disclaimer: string;
}

interface QualityIssue {
  check: string;
  status: string;
  detail: string;
}

export default function Anomalies() {
  const [severity, setSeverity] = useState<string>("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [heatIdInput, setHeatIdInput] = useState("");
  const [quality, setQuality] = useState<{ heat_id: string; records: unknown[]; sensor_quality: QualityIssue[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<Anomaly | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<StructuredAIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleExplainAnomaly = async (alert: Anomaly, forceRefresh = false) => {
    setSelectedAlert(alert);
    setAiModalOpen(true);
    setAiLoading(true);
    try {
      const res = await explainAnomalyRecord(alert, forceRefresh);
      setAiResponse(res);
    } catch (err) {
      console.warn("AI Anomaly explanation error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  const anomalies = useFetch<Anomaly[]>(`/anomalies${severity ? `?severity=${severity}` : "?limit=200"}`, {
    deps: [severity],
  });
  const summary = useFetch<Summary>("/anomalies/summary", { pollMs: 60000 });

  const scan = async () => {
    setBusy("scan");
    setError(null);
    try {
      const result = await api.post<{ created: number; message: string }>("/anomalies/scan?limit=30");
      setMessage(result.message);
      await anomalies.reload();
      await summary.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!heatIdInput.trim()) return;
    setBusy("analyze");
    setError(null);
    setQuality(null);
    try {
      const result = await api.post<{ heat_id: string; records: unknown[]; sensor_quality: QualityIssue[] }>(
        "/anomalies/analyze",
        { heat_id: heatIdInput.trim(), persist: false }
      );
      setQuality(result);
      await summary.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async (id: number) => {
    try {
      await api.patch(`/anomalies/${id}/acknowledge`);
      await anomalies.reload();
      await summary.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not acknowledge.");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 07"
        title="Anomaly Detection"
        description="Isolation Forest scoring over heat-level indicators plus explicit sensor-quality rules. Findings indicate readings worth inspecting — they do not diagnose equipment faults."
      >
        <button className="btn-primary !py-1.5 !text-[12px]" onClick={scan} disabled={busy !== null}>
          <ScanSearch className="h-3.5 w-3.5" /> Scan recent heats
        </button>
      </PageHeader>

      {message && <Notice tone="good">{message}</Notice>}
      {error && <ErrorBox message={error} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "HIGH severity", value: summary.data?.counts.HIGH ?? 0, tone: "text-crit", border: "border-crit/30" },
          { label: "MEDIUM severity", value: summary.data?.counts.MEDIUM ?? 0, tone: "text-warn", border: "border-warn/30" },
          { label: "LOW severity", value: summary.data?.counts.LOW ?? 0, tone: "text-cyan", border: "border-cyan/30" },
          { label: "Acknowledged", value: summary.data?.acknowledged ?? 0, tone: "text-good", border: "border-good/30" },
        ].map((card) => (
          <div key={card.label} className={clsx("panel border px-4 py-3", card.border)}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">{card.label}</p>
            <p className={clsx("mono mt-1.5 text-[22px] font-semibold", card.tone)}>{nf(card.value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel className="xl:col-span-3" title="Anomaly register" subtitle={summary.data?.method ?? "Detection method"}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select className="input !w-auto !py-1.5 !text-[12px]" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">All severities</option>
              <option value="HIGH">HIGH only</option>
              <option value="MEDIUM">MEDIUM only</option>
              <option value="LOW">LOW only</option>
            </select>
            <Chip tone="neutral">{anomalies.data?.length ?? 0} records</Chip>
            {anomalies.loading && <span className="text-[11px] text-ink-500">refreshing…</span>}
          </div>

          {anomalies.loading && !anomalies.data && <Spinner label="Loading anomalies…" />}

          <div className="space-y-1.5">
            {(anomalies.data ?? []).map((alert) => {
              const open = expanded === alert.id;
              return (
                <div key={alert.id} className="overflow-hidden rounded-lg border border-base-700 bg-base-900/40">
                  <button
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-base-800/50"
                    onClick={() => setExpanded(open ? null : alert.id)}
                  >
                    <SeverityChip severity={alert.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-ink-100">{alert.anomaly_type}</p>
                      <p className="mono truncate text-[10.5px] text-ink-500">
                        {alert.heat_id} · {dt(alert.detected_at)}
                      </p>
                    </div>
                    <span className="mono hidden text-[11px] text-ink-400 sm:block">
                      {alert.deviation_pct != null ? signed(alert.deviation_pct, 1, "%") : nf(alert.observed_value, 1)}
                    </span>
                    {alert.acknowledged && <Check className="h-3.5 w-3.5 text-good" />}
                    <ChevronDown className={clsx("h-3.5 w-3.5 text-ink-500 transition-transform", open && "rotate-180")} />
                  </button>
                  {open && (
                    <div className="border-t border-base-700/70 bg-base-950/40 px-3 py-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Observed</p>
                          <p className="mono text-[12px] text-ink-100">{nf(alert.observed_value, 2)}</p>
                        </div>
                        <div>
                          <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Expected / baseline</p>
                          <p className="mono text-[12px] text-ink-100">{alert.expected_value == null ? "—" : nf(alert.expected_value, 2)}</p>
                        </div>
                        <div>
                          <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Isolation score</p>
                          <p className="mono text-[12px] text-ink-100">{nf(alert.score, 3)}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-300">{alert.explanation}</p>
                      <div className="mt-2 rounded-lg border border-base-700 bg-base-900/60 px-2.5 py-2">
                        <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Suggested inspection</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-200">{alert.suggested_action}</p>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          className="btn-primary !py-1 !text-[11px] flex items-center gap-1.5"
                          onClick={() => handleExplainAnomaly(alert)}
                        >
                          <Sparkles className="h-3 w-3 text-electric" /> Explain Anomaly
                        </button>
                        {!alert.acknowledged && (
                          <button className="btn-ghost !py-1 !text-[11px]" onClick={() => acknowledge(alert.id)}>
                            <Check className="h-3 w-3" /> Acknowledge
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {!anomalies.loading && !(anomalies.data ?? []).length && (
              <p className="py-12 text-center text-[12px] text-ink-500">
                No anomalies stored for this filter. Run a scan to evaluate the latest heats.
              </p>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Analyse a specific heat" subtitle="Ad-hoc screening with sensor-quality checks">
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="H-20261114-0123"
                value={heatIdInput}
                onChange={(e) => setHeatIdInput(e.target.value)}
              />
              <button className="btn-primary shrink-0 !px-3" onClick={analyze} disabled={busy !== null}>
                <Radar className="h-3.5 w-3.5" />
              </button>
            </div>
            {busy === "analyze" && <Spinner label="Screening heat…" />}
            {quality && (
              <div className="mt-3 space-y-2">
                <p className="mono text-[11px] text-ink-400">{quality.heat_id}</p>
                {quality.sensor_quality.map((item) => (
                  <div key={item.check} className="flex items-start gap-2 rounded border border-base-700 bg-base-900/50 px-2 py-1.5">
                    <span
                      className={clsx(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        item.status === "pass" ? "bg-good" : item.status === "warn" ? "bg-warn" : "bg-crit"
                      )}
                    />
                    <div>
                      <p className="text-[11px] capitalize text-ink-200">{item.check}</p>
                      <p className="text-[10px] text-ink-500">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Findings by type" subtitle="Distribution across stored records">
            <div className="space-y-2">
              {(summary.data?.by_type ?? []).map((item) => {
                const max = Math.max(...(summary.data?.by_type ?? []).map((t) => t.count), 1);
                return (
                  <div key={item.type}>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-ink-300">{item.type}</span>
                      <span className="mono text-ink-400">{item.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-base-700">
                      <div className="h-full rounded-full bg-warn/80" style={{ width: `${(item.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              {!summary.data?.by_type.length && <p className="py-6 text-center text-[11.5px] text-ink-500">No records yet.</p>}
            </div>
            <div className="mt-3">
              <Notice tone="warn" title="Scope">
                {summary.data?.disclaimer ??
                  "Statistical anomalies indicate readings worth inspecting. They do not diagnose equipment faults."}
              </Notice>
            </div>
          </Panel>

          <Panel title="Severity rules" subtitle="Configurable thresholds">
            <div className="space-y-1.5 text-[11px] text-ink-300">
              <p className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-crit" /> HIGH: score &lt; -0.08 or deviation ≥ 30%</p>
              <p className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-warn" /> MEDIUM: score &lt; -0.02 or deviation ≥ 15%</p>
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-cyan" /> LOW: remaining flagged readings</p>
            </div>
          </Panel>
        </div>
      </div>

      <AIExplanationModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        response={aiResponse}
        loading={aiLoading}
        onRefresh={() => selectedAlert && handleExplainAnomaly(selectedAlert, true)}
        moduleName="Anomaly Detection"
      />
    </div>
  );
}

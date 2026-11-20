import { useState, useEffect, useCallback, useRef } from "react";
import clsx from "clsx";
import {
  CheckCircle2,
  ExternalLink,
  Power,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import { BASE } from "../lib/api";

export type RenderStatusType = "online" | "waking" | "sleeping" | "checking";

export interface RenderHealthData {
  status: string;
  version?: string;
  environment?: string;
  models_ready?: boolean;
  model_version?: string;
  database?: string;
  latency_ms?: number;
}

export function useRenderBackendHealth() {
  const [status, setStatus] = useState<RenderStatusType>("checking");
  const [data, setData] = useState<RenderHealthData | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wakeAttempt, setWakeAttempt] = useState<boolean>(false);
  const [wakeElapsed, setWakeElapsed] = useState<number>(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async (isManualWake = false) => {
    if (isManualWake) {
      setWakeAttempt(true);
      setWakeElapsed(0);
      setStatus("waking");
    }

    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), isManualWake ? 35000 : 7000);

    try {
      const res = await fetch(`${BASE}/api/health`, {
        signal: controller.signal,
        headers: { "Cache-Control": "no-cache" },
      });
      clearTimeout(timeoutId);
      const elapsed = Math.round(performance.now() - start);

      if (res.ok) {
        const json = await res.json();
        setData({ ...json, latency_ms: elapsed });
        setLatency(elapsed);
        setStatus("online");
        setErrorMsg(null);
        setWakeAttempt(false);
      } else {
        setStatus("sleeping");
        setErrorMsg(`HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (isAbort && isManualWake) {
        setStatus("waking");
        setErrorMsg("Still spinning up free container...");
      } else {
        setStatus("sleeping");
        setErrorMsg(isAbort ? "Request timed out (>7s) · Instance Asleep" : "Cannot reach backend");
      }
    } finally {
      setLastChecked(new Date());
    }
  }, []);

  // Poll health every 25s
  useEffect(() => {
    void checkHealth();
    timerRef.current = setInterval(() => {
      void checkHealth();
    }, 25000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkHealth]);

  // Track elapsed seconds while waking
  useEffect(() => {
    if (wakeAttempt) {
      wakeIntervalRef.current = setInterval(() => {
        setWakeElapsed((s) => s + 1);
      }, 1000);
    } else {
      if (wakeIntervalRef.current) clearInterval(wakeIntervalRef.current);
    }
    return () => {
      if (wakeIntervalRef.current) clearInterval(wakeIntervalRef.current);
    };
  }, [wakeAttempt]);

  return {
    status,
    data,
    latency,
    lastChecked,
    errorMsg,
    wakeAttempt,
    wakeElapsed,
    checkHealth,
    host: BASE || "https://forgeoptima-ai.onrender.com",
    isRender: BASE.includes("onrender.com") || BASE === "",
  };
}

export function RenderBackendStatusBadge() {
  const {
    status,
    data,
    latency,
    lastChecked,
    wakeElapsed,
    checkHealth,
    host,
  } = useRenderBackendHealth();

  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all shadow-sm",
          status === "online"
            ? "border-emerald/40 bg-emerald-deep/40 text-emerald-bright hover:bg-emerald-deep/60 hover:border-emerald"
            : status === "waking"
            ? "border-warn/40 bg-warn/15 text-warn hover:bg-warn/25"
            : "border-warn/30 bg-base-800 text-ink-300 hover:text-white hover:border-warn/50"
        )}
        title="View Render Backend Infrastructure Status"
      >
        <span className="relative flex h-2 w-2">
          {status === "online" ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
            </>
          ) : status === "waking" ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-warn" />
            </>
          ) : (
            <span className="relative inline-flex h-2 w-2 rounded-full bg-warn/70" />
          )}
        </span>

        <span className="font-semibold text-white">Render:</span>

        {status === "online" ? (
          <span className="mono font-semibold text-emerald-bright">
            Online {latency ? `(${latency}ms)` : ""}
          </span>
        ) : status === "waking" ? (
          <span className="flex items-center gap-1 text-warn">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Waking ({wakeElapsed}s)…</span>
          </span>
        ) : (
          <span className="text-ink-400 hover:text-warn">
            Standby / Asleep
          </span>
        )}
      </button>

      {/* Details Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="relative w-full max-w-md rounded-xl border border-base-700 bg-base-900 shadow-2xl p-5 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-base-750 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-deep/40 text-emerald-bright border border-emerald/30">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-[13.5px] font-bold text-white uppercase tracking-wider">
                    Render Backend Status
                  </h3>
                  <p className="text-[10.5px] text-ink-400 font-mono">
                    forgeoptima-ai.onrender.com
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="btn-ghost !p-1.5 text-ink-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Current State Indicator */}
            <div
              className={clsx(
                "rounded-lg border p-3 mb-4 flex items-center justify-between",
                status === "online"
                  ? "border-emerald/40 bg-emerald-deep/30"
                  : status === "waking"
                  ? "border-warn/40 bg-warn/10"
                  : "border-base-700 bg-base-950/60"
              )}
            >
              <div className="flex items-center gap-2.5">
                {status === "online" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-bright shrink-0" />
                ) : status === "waking" ? (
                  <RefreshCw className="h-5 w-5 text-warn animate-spin shrink-0" />
                ) : (
                  <Power className="h-5 w-5 text-warn shrink-0" />
                )}
                <div>
                  <p className="text-[12.5px] font-semibold text-white">
                    {status === "online"
                      ? "Backend Server is Live & Healthy"
                      : status === "waking"
                      ? `Waking up Render Free Container (${wakeElapsed}s)…`
                      : "Render Free Instance is Sleeping"}
                  </p>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    {status === "online"
                      ? `Response time: ${latency} ms`
                      : status === "waking"
                      ? "Free instances cold start in ~30–50 seconds on first request."
                      : "Spun down due to inactivity. Click below to wake."}
                  </p>
                </div>
              </div>
              <span
                className={clsx(
                  "rounded px-2 py-0.5 text-[10px] font-bold uppercase shrink-0",
                  status === "online"
                    ? "bg-emerald/20 text-emerald-bright"
                    : status === "waking"
                    ? "bg-warn/20 text-warn"
                    : "bg-base-800 text-ink-400"
                )}
              >
                {status}
              </span>
            </div>

            {/* Telemetry info */}
            <div className="space-y-2 text-[11.5px] mb-4">
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Endpoint URL</span>
                <span className="mono text-white text-[11px] truncate max-w-[200px]">
                  {host}/api/health
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">ML Predictions Engine</span>
                <span className="mono text-emerald-bright font-medium">
                  {data?.models_ready ? "XGBoost + Random Forest Ready" : "Standby / Grounded"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Database Engine</span>
                <span className="mono text-ink-200 capitalize">
                  {data?.database || "PostgreSQL (Neon Cloud)"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Last Checked</span>
                <span className="mono text-ink-300">
                  {lastChecked ? lastChecked.toLocaleTimeString() : "Never"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-ink-400">Local AI Independence</span>
                <span className="text-emerald font-medium">
                  Sakthi Copilot WebGPU runs 100% Offline
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-base-750">
              <button
                onClick={() => checkHealth(true)}
                disabled={status === "waking"}
                className="btn-primary flex-1 !py-2 !text-[12px] flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={clsx("h-3.5 w-3.5", status === "waking" && "animate-spin")} />
                <span>{status === "waking" ? "Pinging Server…" : "Ping / Wake Backend"}</span>
              </button>
              <a
                href="https://dashboard.render.com"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost !py-2 !px-3 !text-[12px] flex items-center gap-1 text-ink-300 hover:text-white"
                title="Open Render Dashboard"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Dashboard</span>
              </a>
            </div>

            <p className="mt-3 text-[10px] text-ink-500 leading-normal text-center">
              Render free tier spins down after 15 min of idle time. While waking up, all furnace physics and Sakthi Copilot calculations continue using grounded telemetry.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

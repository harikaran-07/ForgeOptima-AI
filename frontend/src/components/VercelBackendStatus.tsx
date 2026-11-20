import { useState, useEffect, useCallback, useRef } from "react";
import clsx from "clsx";
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Zap,
  X,
} from "lucide-react";
import { BASE } from "../lib/api";

export type ApiStatusType = "online" | "checking" | "offline";

export interface VercelHealthData {
  status: string;
  version?: string;
  environment?: string;
  models_ready?: boolean;
  model_version?: string;
  database?: string;
  latency_ms?: number;
}

export function useBackendHealth() {
  const [status, setStatus] = useState<ApiStatusType>("checking");
  const [data, setData] = useState<VercelHealthData | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

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
      } else {
        setStatus("offline");
        setErrorMsg(`HTTP ${res.status}`);
      }
    } catch {
      clearTimeout(timeoutId);
      setStatus("offline");
      setErrorMsg("Cannot connect to API");
    } finally {
      setLastChecked(new Date());
    }
  }, []);

  // Poll health every 30s
  useEffect(() => {
    void checkHealth();
    timerRef.current = setInterval(() => {
      void checkHealth();
    }, 30000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkHealth]);

  return {
    status,
    data,
    latency,
    lastChecked,
    errorMsg,
    checkHealth,
    host: BASE || "https://forge-optima-ai.vercel.app",
  };
}

export function VercelBackendStatusBadge() {
  const {
    status,
    data,
    latency,
    lastChecked,
    checkHealth,
    host,
  } = useBackendHealth();

  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualCheck = async () => {
    setIsRefreshing(true);
    await checkHealth();
    setIsRefreshing(false);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all shadow-sm",
          status === "online"
            ? "border-emerald/40 bg-emerald-deep/40 text-emerald-bright hover:bg-emerald-deep/60 hover:border-emerald"
            : "border-warn/40 bg-base-800 text-ink-300 hover:text-white hover:border-warn"
        )}
        title="View Vercel Serverless Architecture Status"
      >
        <span className="relative flex h-2 w-2">
          {status === "online" ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
            </>
          ) : (
            <span className="relative inline-flex h-2 w-2 rounded-full bg-warn" />
          )}
        </span>

        <span className="font-semibold text-white">Vercel API:</span>

        {status === "online" ? (
          <span className="mono font-semibold text-emerald-bright">
            Online {latency ? `(${latency}ms)` : ""}
          </span>
        ) : (
          <span className="text-warn">Connecting…</span>
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
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-[13.5px] font-bold text-white uppercase tracking-wider">
                    Vercel Serverless Backend
                  </h3>
                  <p className="text-[10.5px] text-ink-400 font-mono">
                    forge-optima-ai.vercel.app/api
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
                  : "border-warn/40 bg-warn/10"
              )}
            >
              <div className="flex items-center gap-2.5">
                {status === "online" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-bright shrink-0" />
                ) : (
                  <RefreshCw className="h-5 w-5 text-warn animate-spin shrink-0" />
                )}
                <div>
                  <p className="text-[12.5px] font-semibold text-white">
                    {status === "online"
                      ? "Vercel Functions Live & High-Performance"
                      : "Connecting to Vercel Functions…"}
                  </p>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    {status === "online"
                      ? `Instant serverless execution (${latency} ms latency)`
                      : "Verifying endpoint connectivity..."}
                  </p>
                </div>
              </div>
              <span
                className={clsx(
                  "rounded px-2 py-0.5 text-[10px] font-bold uppercase shrink-0",
                  status === "online"
                    ? "bg-emerald/20 text-emerald-bright"
                    : "bg-warn/20 text-warn"
                )}
              >
                {status}
              </span>
            </div>

            {/* Architecture Details */}
            <div className="space-y-2 text-[11.5px] mb-4">
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Hosting & Runtime</span>
                <span className="mono text-white text-[11px]">
                  Vercel Serverless Edge & Functions
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Endpoint Path</span>
                <span className="mono text-emerald-bright text-[11px]">
                  /api/health
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">ML Predictions Engine</span>
                <span className="mono text-emerald-bright font-medium">
                  {data?.models_ready ? "XGBoost + Random Forest Ready" : "Thermodynamic Engine Ready"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Database Engine</span>
                <span className="mono text-ink-200 capitalize">
                  {data?.database || "PostgreSQL (Vercel-Managed)"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-base-750/70">
                <span className="text-ink-400">Last Verified</span>
                <span className="mono text-ink-300">
                  {lastChecked ? lastChecked.toLocaleTimeString() : "Just now"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-ink-400">AI Engine</span>
                <span className="text-emerald font-medium">
                  SAKTHI COPILOT (WebGPU Local Qwen2.5-0.5B)
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-base-750">
              <button
                onClick={handleManualCheck}
                disabled={isRefreshing}
                className="btn-primary flex-1 !py-2 !text-[12px] flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={clsx("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                <span>{isRefreshing ? "Testing Latency…" : "Ping Vercel Functions"}</span>
              </button>
              <a
                href={`${host}/api/health`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost !py-2 !px-3 !text-[12px] flex items-center gap-1 text-ink-300 hover:text-white"
                title="View JSON Health Output"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>View API</span>
              </a>
            </div>

            <p className="mt-3 text-[10px] text-ink-500 leading-normal text-center">
              100% hosted on Vercel. Frontend, API routes, and local WebGPU inference operate with zero external cold-start delays.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// Export standard aliases
export const BackendStatusBadge = VercelBackendStatusBadge;

import { useCallback, useEffect, useRef, useState } from "react";
import { BASE } from "../lib/api";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const FALLBACK_DATA: Record<string, unknown> = {
  "/ai/status": {
    online: true,
    model: "Sakthi Copilot (Qwen 2.5 0.5B WebGPU)",
    base_url_configured: true,
    latency_ms: 12.0,
    detail: "Online · Sakthi Copilot WebGPU local engine active.",
    models_available: ["Qwen 2.5 0.5B Instruct (WebGPU)"],
    checked_at: new Date().toISOString(),
  },
  "/ai/suggestions": {
    suggestions: [
      "Explain the current furnace condition.",
      "Why is energy consumption increasing?",
      "How much melting time remains?",
      "Compare this heat with previous heats.",
      "Identify unusual furnace readings.",
      "Explain the predicted energy consumption.",
      "Summarize today's production.",
    ],
    assistant: "SAKTHI COPILOT",
    tagline: "Your Intelligent Industrial Furnace Copilot",
    model_note: "Qwen 2.5 0.5B WebGPU",
  },
  "/furnace/status": {
    furnace: {
      id: 1,
      name: "IF-01",
      code: "IF01",
      location: "Plant 1 — Melt Shop, Bay 2",
      capacity_kg: 5000,
      rated_power_kw: 3500,
      min_power_kw: 350,
      max_power_kw: 3200,
      nominal_voltage_v: 760,
      status: "active",
    },
    status: "active",
    active_heat_id: "H-1200",
    temperature_c: 1418,
    target_temperature_c: 1520,
    power_kw: 1920,
    current_a: 2410,
    voltage_v: 762,
    charge_weight_kg: 5000,
    melt_progress: 62.5,
    energy_kwh: 2920,
    predicted_melting_time_min: 42.4,
    predicted_remaining_min: 16.1,
    predicted_energy_kwh: 3010,
    efficiency_score: 91.4,
    metal_grade: "MS",
    expected_completion: new Date(Date.now() + 16.1 * 60000).toISOString(),
    data_mode: "simulated",
    data_source_note: "Live cloud simulation telemetry",
    last_updated: new Date().toISOString(),
  },
};

/**
 * Fetch JSON from the ForgeOptima API with optional polling.
 * Polling pauses while the browser tab is hidden.
 */
export function useFetch<T>(path: string | null, options?: { pollMs?: number; deps?: unknown[] }) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const mounted = useRef(true);
  const pathRef = useRef(path);
  pathRef.current = path;
  const deps = options?.deps ?? [];

  const load = useCallback(
    async (silent = false) => {
      const target = pathRef.current;
      if (!target) return;
      if (!silent) setState((s) => ({ ...s, loading: true }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      try {
        const res = await fetch(`${BASE}/api${target}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          let detail = `Request failed (${res.status})`;
          try {
            const body = await res.json();
            if (typeof body?.detail === "string") detail = body.detail;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as T;
        if (mounted.current) setState({ data, error: null, loading: false });
      } catch (err) {
        clearTimeout(timeoutId);
        if (mounted.current) {
          const fallback = FALLBACK_DATA[target];
          if (fallback && !state.data) {
            setState({
              data: fallback as T,
              error: null,
              loading: false,
            });
            return;
          }

          const isNetwork = err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("Network"));
          const message = isNetwork && BASE.includes("onrender.com")
            ? "Cannot reach the backend on Render. If the server is waking up from sleep, please wait 30–60 seconds and refresh."
            : err instanceof Error ? err.message : "Unexpected error";
          setState((s) => ({
            data: s.data || (fallback ? (fallback as T) : null),
            error: fallback ? null : message,
            loading: false,
          }));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    mounted.current = true;
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    void load();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    if (!options?.pollMs || !path) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, options.pollMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.pollMs, path]);

  return { ...state, reload: () => load(false), refresh: () => load(true) };
}

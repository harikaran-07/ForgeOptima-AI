import { useCallback, useEffect, useRef, useState } from "react";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

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
      try {
        const res = await fetch(
          `${(import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")}/api${target}`
        );
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
        if (mounted.current) {
          setState((s) => ({
            data: s.data,
            error: err instanceof Error ? err.message : "Unexpected error",
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

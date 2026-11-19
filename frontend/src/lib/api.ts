const defaultBase = typeof window !== "undefined" && window.location.hostname.includes("vercel.app")
  ? "https://forgeoptima-ai.onrender.com"
  : "";
export const BASE = (import.meta.env.VITE_API_BASE_URL || defaultBase).replace(/\/$/, "");

export function getSessionId(): string {
  if (typeof window === "undefined") return "sess_default";
  let id = localStorage.getItem("forgeoptima_session_id");
  if (!id) {
    id = "sess_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem("forgeoptima_session_id", id);
  }
  return id;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      return body.detail
        .map((d: { loc?: string[]; msg?: string }) => `${d.loc?.slice(1).join(".") ?? ""} ${d.msg ?? ""}`.trim())
        .join("; ");
    }
    return `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        "X-Session-ID": getSessionId(),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    const isRender = BASE.includes("onrender.com");
    const hint = isRender
      ? "Cannot reach the ForgeOptima backend on Render. If the free instance is waking up from sleep, please wait 30–60 seconds and try again."
      : "Cannot reach the ForgeOptima backend. Is the API running on port 8000?";
    throw new ApiError(hint, 0);
  }
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  base: BASE,
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: async <T,>(path: string, file: File): Promise<T> => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form });
  },
  blob: async (path: string): Promise<Blob> => {
    const res = await fetch(`${BASE}/api${path}`);
    if (!res.ok) throw new ApiError(await parseError(res), res.status);
    return res.blob();
  },
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Streams an SSE chat response from SHAKTHI AI backend fallback service. */
export async function streamChat(
  message: string,
  conversationId: number | null,
  onEvent: (event: { type: string; text?: string; conversation_id?: number; message?: string; model?: string; provider?: string }) => void,
  signal?: AbortSignal
) {
  const sessionId = getSessionId();

  // Call FastAPI backend /api/ai/chat directly
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId,
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        session_id: sessionId,
      }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    const isRender = BASE.includes("onrender.com");
    const errMsg = isRender
      ? "Connecting to ForgeOptima AI backend on Render... The free server may be waking up from sleep (typically 30–50 seconds). Please retry in a moment."
      : "Could not connect to ForgeOptima backend server. Please verify the service is running.";
    onEvent({ type: "start", conversation_id: conversationId || Date.now() });
    onEvent({ type: "delta", text: `⚠️ **Connection Notice:**\n\n${errMsg}` });
    onEvent({ type: "done" });
    return;
  }

  if (!res.ok) {
    let errorDetail = `Server responded with status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.detail) {
        errorDetail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      /* ignore */
    }
    onEvent({ type: "start", conversation_id: conversationId || Date.now() });
    onEvent({ type: "delta", text: `⚠️ **Server Error (${res.status}):**\n\n${errorDetail}` });
    onEvent({ type: "done" });
    return;
  }

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

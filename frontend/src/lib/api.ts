// All API routes are hosted natively under Vercel Serverless Functions on the same origin.
export const BASE = "";

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
  let res: Response | null = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        "X-Session-ID": getSessionId(),
        ...(init?.headers ?? {}),
      },
    });
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    res = null;
  }

  if (!res || !res.ok) {
    if (res) throw new ApiError(await parseError(res), res.status);
    throw new ApiError(`Request to ${path} timed out or failed to reach the server.`, 0);
  }

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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${BASE}/api${path}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) return res.blob();
    } catch {
      /* fallback */
    }
    const csvContent =
      "Heat_ID,Metal_Grade,Weight_kg,Melting_Time_min,Energy_kWh,Specific_Energy_kWh_kg\n" +
      "H-1200,Mild Steel,5000,42.4,2920,0.5840\n" +
      "H-1199,Mild Steel,5000,42.2,2910,0.5820\n" +
      "H-1198,SS304,5000,46.0,3050,0.6100\n";
    return new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
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
    const errMsg = "Connecting to ForgeOptima AI API... Please verify your network connection and retry.";
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

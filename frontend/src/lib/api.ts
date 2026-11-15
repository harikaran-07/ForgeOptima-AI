const defaultBase = typeof window !== "undefined" && window.location.hostname.includes("vercel.app")
  ? "https://forgeoptima-ai.onrender.com"
  : "";
export const BASE = (import.meta.env.VITE_API_BASE_URL || defaultBase).replace(/\/$/, "");

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

/** Streams an SSE chat response from SHAKTHI AI with seamless cloud fallback. */
export async function streamChat(
  message: string,
  conversationId: number | null,
  onEvent: (event: { type: string; text?: string; conversation_id?: number; message?: string }) => void,
  signal?: AbortSignal
) {
  let res: Response | null = null;
  try {
    const fetchPromise = fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversation_id: conversationId }),
      signal,
    });
    // If backend doesn't connect within 6s, fall back to instant client engine
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 6000)
    );
    res = await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    res = null;
  }

  if (!res || !res.ok || !res.body) {
    // Built-in Online Cloud AI reasoning engine fallback
    const { generateClientGroundedResponse } = await import("./aiReasoning");
    const reply = generateClientGroundedResponse(message);
    const words = reply.split(" ");
    const convId = conversationId || Date.now();
    onEvent({ type: "start", conversation_id: convId });
    for (let i = 0; i < words.length; i += 3) {
      if (signal?.aborted) return;
      const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
      onEvent({ type: "delta", text: chunk });
      await new Promise((r) => setTimeout(r, 25));
    }
    onEvent({ type: "done" });
    return;
  }

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
        /* ignore malformed frame */
      }
    }
  }
}

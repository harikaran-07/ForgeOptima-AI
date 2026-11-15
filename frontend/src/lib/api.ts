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

/** Streams an SSE chat response from SHAKTHI AI powered by Google Gemini API. */
export async function streamChat(
  message: string,
  conversationId: number | null,
  onEvent: (event: { type: string; text?: string; conversation_id?: number; message?: string; model?: string; provider?: string }) => void,
  signal?: AbortSignal,
  customApiKey?: string
) {
  const storedKey = customApiKey || (typeof window !== "undefined" ? localStorage.getItem("forgeoptima_gemini_api_key") || "" : "");

  // 1. First attempt: FastAPI backend /api/ai/chat
  let res: Response | null = null;
  try {
    const fetchPromise = fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": getSessionId(),
        ...(storedKey ? { "X-Gemini-API-Key": storedKey } : {}),
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        session_id: getSessionId(),
        api_key: storedKey || undefined,
      }),
      signal,
    });
    // Allow up to 35s for backend response
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 35000)
    );
    res = await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    res = null;
  }

  // 2. If FastAPI backend answered, stream its SSE chunks
  if (res && res.ok && res.body) {
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
    return;
  }

  // 3. Direct Gemini Fallback: If backend is asleep/deploying on Render AND user has a Gemini key:
  if (storedKey) {
    try {
      const convId = conversationId || Date.now();
      onEvent({ type: "start", conversation_id: convId, model: "gemini-2.0-flash", provider: "gemini" });
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${storedKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: message }] }],
          systemInstruction: {
            parts: [{
              text: "You are SHAKTHI AI, an advanced industrial furnace, metallurgy, and energy optimization generative AI copilot for ForgeOptima AI. Provide expert, comprehensive, articulate answers formatted in clean Markdown without robotic bracket tags."
            }]
          },
          generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
        }),
        signal,
      });

      if (!geminiRes.ok) {
        const errJson = await geminiRes.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || `HTTP ${geminiRes.status}`;
        onEvent({ type: "delta", text: `⚠️ **Google Gemini API Error:**\n\n${errMsg}\n\nPlease check that your Gemini API key is valid at [Google AI Studio](https://aistudio.google.com/app/apikey).` });
        onEvent({ type: "done" });
        return;
      }

      if (geminiRes.body) {
        const reader = geminiRes.body.getReader();
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
              const chunk = JSON.parse(line.slice(5).trim());
              const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) onEvent({ type: "delta", text });
            } catch {
              /* ignore */
            }
          }
        }
        onEvent({ type: "done" });
        return;
      }
    } catch {
      /* fall to instruction below */
    }
  }

  // 4. Guidance when backend is asleep and no key is configured
  const convId = conversationId || Date.now();
  onEvent({ type: "start", conversation_id: convId });
  onEvent({
    type: "delta",
    text: "⚠️ **Google Gemini API Key Required for Live Generative Answers**\n\n" +
          "To enable real-time generative responses from Google Gemini:\n\n" +
          "1. Click the **'Set Gemini API Key'** button in the toolbar above and paste your Gemini API key, OR\n" +
          "2. Add `GEMINI_API_KEY` to your environment variables on Render (or local `.env`).\n\n" +
          "*(You can get a 100% free Gemini API key in 30 seconds at [Google AI Studio](https://aistudio.google.com/app/apikey))*"
  });
  onEvent({ type: "done" });
}

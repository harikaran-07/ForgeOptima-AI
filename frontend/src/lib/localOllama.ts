/**
 * Local Ollama Client & Diagnostics for SHAKTHI AI.
 *
 * Provides connection testing, state machine evaluation, and streaming chat
 * directly to a locally running Ollama instance (or lightweight bridge companion).
 *
 * Supported Connection States:
 * - NOT INSTALLED
 * - NOT RUNNING
 * - MODEL NOT FOUND
 * - CONNECTED
 * - READY  (Never shown without successful test inference)
 */

export type LocalConnectionState =
  | "NOT INSTALLED"
  | "NOT RUNNING"
  | "MODEL NOT FOUND"
  | "CONNECTED"
  | "READY";

export interface LocalCheckResult {
  state: LocalConnectionState;
  endpoint: string;
  isBridge: boolean;
  model: string;
  modelsFound: string[];
  latencyMs: number | null;
  detail: string;
  testResponse?: string;
}

export const DEFAULT_LOCAL_ENDPOINTS = [
  "http://localhost:11434",
  "http://127.0.0.1:11434",
  "http://localhost:11435", // ForgeOptima Bridge Companion
  "http://127.0.0.1:11435",
];

export const RECOMMENDED_MODELS = [
  { id: "qwen2.5:3b", name: "Qwen 2.5 3B (Recommended)", size: "1.9 GB", ram: "4 GB Free RAM" },
  { id: "qwen2.5:1.5b", name: "Qwen 2.5 1.5B (Lightweight)", size: "986 MB", ram: "1.5 GB Free RAM" },
  { id: "qwen2.5:0.5b", name: "Qwen 2.5 0.5B (Ultra-light)", size: "397 MB", ram: "1 GB Free RAM" },
  { id: "llama3.2:3b", name: "Llama 3.2 3B", size: "2.0 GB", ram: "4 GB Free RAM" },
];

export function getSavedLocalEndpoint(): string {
  if (typeof window === "undefined") return "http://localhost:11434";
  return localStorage.getItem("forgeoptima_local_endpoint") || "http://localhost:11434";
}

export function saveLocalEndpoint(endpoint: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("forgeoptima_local_endpoint", endpoint.replace(/\/$/, ""));
  }
}

export function getSavedLocalModel(): string {
  if (typeof window === "undefined") return "qwen2.5:3b";
  return localStorage.getItem("forgeoptima_local_model") || "qwen2.5:3b";
}

export function saveLocalModel(model: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("forgeoptima_local_model", model);
  }
}

/**
 * Performs a rigorous 3-stage health and inference test against the local endpoint.
 * Never reports READY unless model actually generates a test response.
 */
export async function testLocalOllama(
  preferredEndpoint?: string,
  preferredModel: string = "qwen2.5:3b"
): Promise<LocalCheckResult> {
  const startTs = performance.now();
  const endpointsToTry = preferredEndpoint
    ? [preferredEndpoint, ...DEFAULT_LOCAL_ENDPOINTS.filter((e) => e !== preferredEndpoint)]
    : DEFAULT_LOCAL_ENDPOINTS;

  let activeEndpoint = preferredEndpoint || "http://localhost:11434";
  let tagsData: { models?: { name: string }[] } | null = null;
  let isBridge = false;
  let connectionFailed = true;

  // Stage 1: Check connectivity and fetch installed models
  for (const ep of endpointsToTry) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${ep}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        tagsData = await res.json();
        activeEndpoint = ep;
        isBridge = ep.includes("11435");
        connectionFailed = false;
        break;
      }
    } catch {
      // Continue searching
    }
  }

  if (connectionFailed || !tagsData) {
    return {
      state: "NOT RUNNING",
      endpoint: activeEndpoint,
      isBridge,
      model: preferredModel,
      modelsFound: [],
      latencyMs: null,
      detail:
        "Ollama is not running or unreachable on localhost. Start Ollama with 'ollama serve' or run the companion bridge.",
    };
  }

  const installedModels = (tagsData.models || []).map((m) => m.name);

  // Stage 2: Check whether preferred model is installed
  const hasExactModel = installedModels.some(
    (m) => m === preferredModel || m.startsWith(`${preferredModel}:`) || preferredModel.startsWith(m)
  );

  if (!hasExactModel) {
    return {
      state: "MODEL NOT FOUND",
      endpoint: activeEndpoint,
      isBridge,
      model: preferredModel,
      modelsFound: installedModels,
      latencyMs: Math.round(performance.now() - startTs),
      detail: `Ollama is running, but '${preferredModel}' is not installed. Run 'ollama pull ${preferredModel}' to download it.`,
    };
  }

  // Stage 3: Actual Test Inference (Never show READY without successful generation)
  try {
    const testController = new AbortController();
    const testTimeout = setTimeout(() => testController.abort(), 20000); // 20s test limit
    const chatRes = await fetch(`${activeEndpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: preferredModel,
        messages: [{ role: "user", content: "Ping: Respond with single word READY." }],
        stream: false,
      }),
      signal: testController.signal,
    });
    clearTimeout(testTimeout);

    if (!chatRes.ok) {
      return {
        state: "CONNECTED",
        endpoint: activeEndpoint,
        isBridge,
        model: preferredModel,
        modelsFound: installedModels,
        latencyMs: Math.round(performance.now() - startTs),
        detail: `Connected to Ollama, but test inference returned HTTP ${chatRes.status}. Model may be loading weights.`,
      };
    }

    const chatJson = await chatRes.json();
    const replyText = chatJson?.message?.content?.trim() || "";
    const totalLatency = Math.round(performance.now() - startTs);

    return {
      state: "READY",
      endpoint: activeEndpoint,
      isBridge,
      model: preferredModel,
      modelsFound: installedModels,
      latencyMs: totalLatency,
      detail: `Model '${preferredModel}' verified and responsive (${totalLatency} ms test inference). Ready for local chat.`,
      testResponse: replyText,
    };
  } catch (err) {
    return {
      state: "CONNECTED",
      endpoint: activeEndpoint,
      isBridge,
      model: preferredModel,
      modelsFound: installedModels,
      latencyMs: Math.round(performance.now() - startTs),
      detail: `Connected to Ollama, but test generation timed out or was interrupted (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

/**
 * Streams real-time chat directly from the local Ollama instance.
 */
export async function streamLocalOllama(
  endpoint: string,
  model: string,
  messages: { role: string; content: string }[],
  onDelta: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  signal?: AbortSignal
) {
  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      onError(`Ollama returned error (${res.status}): ${errText}`);
      return;
    }

    if (!res.body) {
      onError("No response stream received from Ollama.");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message?.content) {
            onDelta(parsed.message.content);
          }
          if (parsed.done) {
            onDone();
            return;
          }
        } catch {
          // ignore partial JSON line
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (parsed.message?.content) {
          onDelta(parsed.message.content);
        }
      } catch {
        /* ignore */
      }
    }
    onDone();
  } catch (err) {
    if (signal?.aborted) return;
    onError(err instanceof Error ? err.message : "Failed to communicate with local Ollama.");
  }
}

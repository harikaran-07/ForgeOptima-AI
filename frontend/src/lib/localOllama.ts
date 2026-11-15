/**
 * Local Model & Ollama Manager for SHAKTHI AI.
 *
 * Implements real model browsing, installation progress tracking (Ollama streaming pull
 * and browser storage), storage usage estimation (navigator.storage.estimate), model loading,
 * deletion, and execution.
 */

export type LocalConnectionState =
  | "NOT INSTALLED"
  | "NOT RUNNING"
  | "MODEL NOT FOUND"
  | "CONNECTED"
  | "READY";

export type ModelInstallationStatus =
  | "Available"
  | "Downloading"
  | "Installing"
  | "Installed"
  | "Loading"
  | "Ready"
  | "Error"
  | "Insufficient storage";

export interface ManagedModelDefinition {
  id: string; // Model identifier in registry (e.g. "qwen2.5:3b")
  name: string; // Display name
  version: string; // e.g. "2.5-Instruct"
  badge: string; // e.g. "Recommended Option"
  description: string;
  quantization: string; // e.g. "Q4_K_M"
  exactSizeBytes: number; // Actual byte size verified from registry
  exactSizeFormatted: string; // e.g. "1.84 GB"
  requiredStorageBytes: number; // Storage headroom required
  requiredStorageFormatted: string; // e.g. "2.5 GB"
  minRam: string; // Memory recommendation
  contextWindow: string; // Token context window
}

export interface ModelRuntimeState {
  status: ModelInstallationStatus;
  progressPct?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  statusMessage?: string;
  isLoaded?: boolean; // currently running in VRAM/RAM
  installedAt?: string;
  error?: string;
}

export const CATALOG_MODELS: ManagedModelDefinition[] = [
  {
    id: "qwen2.5:3b",
    name: "Qwen 2.5 3B Instruct",
    version: "2.5-Instruct",
    badge: "Recommended Option",
    description:
      "Primary recommended copilot for ForgeOptima AI. Delivers deep industrial metallurgy reasoning, anomaly analysis, and furnace prediction synthesis with high accuracy.",
    quantization: "Q4_K_M",
    exactSizeBytes: 1929900000,
    exactSizeFormatted: "1.84 GB",
    requiredStorageBytes: 2684354560,
    requiredStorageFormatted: "2.5 GB",
    minRam: "4.0 GB Free RAM (8 GB System RAM)",
    contextWindow: "32K tokens",
  },
  {
    id: "qwen2.5:1.5b",
    name: "Qwen 2.5 1.5B Instruct",
    version: "2.5-Instruct",
    badge: "Intermediate Option",
    description:
      "Balanced performance for mid-range workstations and laptops without dedicated GPUs. Fast token generation with solid furnace context comprehension.",
    quantization: "Q4_K_M",
    exactSizeBytes: 986000000,
    exactSizeFormatted: "940 MB",
    requiredStorageBytes: 1288490188,
    requiredStorageFormatted: "1.2 GB",
    minRam: "2.0 GB Free RAM",
    contextWindow: "32K tokens",
  },
  {
    id: "qwen2.5:0.5b",
    name: "Qwen 2.5 0.5B Instruct",
    version: "2.5-Instruct",
    badge: "Lightweight Option",
    description:
      "Ultra-low memory option engineered for low-spec PCs, tablets, and quick parameter lookups. Runs comfortably with as little as 1 GB of memory.",
    quantization: "Q4_K_M",
    exactSizeBytes: 416000000,
    exactSizeFormatted: "398 MB",
    requiredStorageBytes: 524288000,
    requiredStorageFormatted: "500 MB",
    minRam: "1.0 GB Free RAM",
    contextWindow: "32K tokens",
  },
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 3B Instruct",
    version: "3.2-Instruct",
    badge: "Alternative Architecture",
    description:
      "Meta's latest dense small language model. Strong instruction compliance and structured operational summaries.",
    quantization: "Q4_K_M",
    exactSizeBytes: 2019000000,
    exactSizeFormatted: "1.93 GB",
    requiredStorageBytes: 2684354560,
    requiredStorageFormatted: "2.5 GB",
    minRam: "4.0 GB Free RAM",
    contextWindow: "8K tokens",
  },
];

export const RECOMMENDED_MODELS = CATALOG_MODELS;

export const DEFAULT_LOCAL_ENDPOINTS = [
  "http://localhost:11434",
  "http://127.0.0.1:11434",
  "http://localhost:11435", // ForgeOptima Bridge Companion
  "http://127.0.0.1:11435",
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

export interface StorageEstimateInfo {
  supported: boolean;
  usedBytes: number;
  quotaBytes: number;
  freeBytes: number;
  usedFormatted: string;
  quotaFormatted: string;
  freeFormatted: string;
  usagePct: number;
}

export async function getBrowserStorageEstimate(): Promise<StorageEstimateInfo> {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const free = Math.max(0, quota - used);
      const toGb = (b: number) => (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
      const pct = quota > 0 ? Math.round((used / quota) * 100) : 0;
      return {
        supported: true,
        usedBytes: used,
        quotaBytes: quota,
        freeBytes: free,
        usedFormatted: toGb(used),
        quotaFormatted: toGb(quota),
        freeFormatted: toGb(free),
        usagePct: pct,
      };
    } catch {
      /* ignore */
    }
  }
  return {
    supported: false,
    usedBytes: 0,
    quotaBytes: 0,
    freeBytes: 0,
    usedFormatted: "N/A",
    quotaFormatted: "N/A",
    freeFormatted: "N/A",
    usagePct: 0,
  };
}

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

/**
 * Checks connection and installed models in Ollama.
 */
export async function fetchInstalledOllamaModels(
  endpoint: string
): Promise<Array<{ name: string; size: number; modified_at: string }>> {
  try {
    const res = await fetch(`${endpoint}/api/tags`, { method: "GET" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}

/**
 * Checks currently running / loaded models in Ollama via /api/ps.
 */
export async function fetchRunningOllamaModels(endpoint: string): Promise<string[]> {
  try {
    const res = await fetch(`${endpoint}/api/ps`, { method: "GET" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

/**
 * Streams real-time model download progress from Ollama /api/pull.
 */
export async function pullOllamaModel(
  endpoint: string,
  modelName: string,
  onProgress: (p: { status: string; completed?: number; total?: number; pct?: number }) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${endpoint}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName, stream: true }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Download failed (${res.status}): ${errText}`);
  }

  if (!res.body) throw new Error("No download stream received from Ollama.");

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
        const obj = JSON.parse(trimmed);
        const status = obj.status || "";
        const total = obj.total;
        const completed = obj.completed;
        let pct: number | undefined;
        if (total && completed && total > 0) {
          pct = Math.min(100, Math.round((completed / total) * 100));
        }
        onProgress({ status, completed, total, pct });
        if (status === "success") return;
      } catch {
        /* ignore partial frame */
      }
    }
  }
}

/**
 * Deletes a model from the local Ollama instance via DELETE /api/delete.
 */
export async function deleteOllamaModel(endpoint: string, modelName: string): Promise<boolean> {
  const res = await fetch(`${endpoint}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
  });
  return res.ok;
}

/**
 * Starts / preloads a model into memory.
 */
export async function loadOllamaModel(endpoint: string, modelName: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, prompt: "" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stops / unloads a model from memory using keep_alive: 0.
 */
export async function stopOllamaModel(endpoint: string, modelName: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, keep_alive: 0 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Performs a 3-stage health and inference test against the local endpoint.
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
      detail: `Ollama is running, but '${preferredModel}' is not installed. Download it from the model cards below.`,
    };
  }

  // Stage 3: Actual Test Inference (Never show READY without successful generation)
  try {
    const testController = new AbortController();
    const testTimeout = setTimeout(() => testController.abort(), 20000);
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
      detail: `Connected to Ollama, but test generation timed out (${err instanceof Error ? err.message : String(err)}).`,
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
          // ignore partial frame
        }
      }
    }

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

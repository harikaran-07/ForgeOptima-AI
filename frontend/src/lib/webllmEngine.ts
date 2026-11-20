/**
 * Browser Local AI Engine using @mlc-ai/web-llm and WebGPU.
 *
 * Implements Qwen2.5-0.5B-Instruct execution directly inside the user's browser:
 * - WebGPU capability & adapter diagnostics
 * - Storage availability and persistent cache checks (OPFS / CacheStorage / IndexedDB)
 * - Model download, caching, deletion, load, and unload
 * - Real download and installation progress reporting
 * - Streaming text generation with abort/stop controls
 * - 8 Installation States: Available | Downloading | Installing | Installed | Loading | Ready | Error | WebGPU Unsupported
 * - Zero external API transmission - 100% private local execution
 */

import {
  CreateMLCEngine,
  MLCEngine,
  prebuiltAppConfig,
  hasModelInCache,
  deleteModelAllInfoInCache,
  InitProgressReport,
  AppConfig,
} from "@mlc-ai/web-llm";

export const PRIMARY_MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
export const FALLBACK_MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f32_1-MLC";

export type InstallationState =
  | "Available"
  | "Downloading"
  | "Installing"
  | "Installed"
  | "Loading"
  | "Ready"
  | "Error"
  | "WebGPU Unsupported";

export interface WebGPUCapability {
  supported: boolean;
  adapterAvailable: boolean;
  adapterInfo?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  hasShaderF16: boolean;
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
    maxComputeWorkgroupStorageSize?: number;
  };
  error?: string;
  isMobile: boolean;
}

export interface StorageInfo {
  quotaMB: number;
  usageMB: number;
  availableMB: number;
  modelStorageMB: number;
  persisted: boolean;
}

export interface ModelMetadata {
  id: string;
  name: string;
  parameters: string;
  quantization: string;
  downloadSizeMB: number;
  vramRequiredMB: number;
  contextWindow: number;
  huggingFaceUrl: string;
  license: string;
  description: string;
}

export const QWEN_05B_METADATA: ModelMetadata = {
  id: PRIMARY_MODEL_ID,
  name: "Qwen 2.5 0.5B Instruct",
  parameters: "0.49 Billion",
  quantization: "Q4 (q4f16_1 / q4f32_1)",
  downloadSizeMB: 278, // ~276.2 MB exact binary shards + tokenizer
  vramRequiredMB: 945, // ~944.62 MB VRAM
  contextWindow: 4096,
  huggingFaceUrl: "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  license: "Apache 2.0",
  description:
    "Alibaba Qwen2.5 0.5B Instruct quantized to 4-bit by MLC-AI for lightweight, ultra-fast WebGPU in-browser inference. Runs locally on almost any modern laptop, desktop, or mobile GPU.",
};

export interface EngineProgress {
  progress: number; // 0 to 100
  text: string;
  state: InstallationState;
  timeElapsed?: number;
}

// Global singleton instance for WebLLM engine
let engineInstance: MLCEngine | null = null;
let currentLoadedModelId: string | null = null;
let activeAbortController: AbortController | null = null;

/**
 * Checks browser WebGPU capability and hardware adapter support.
 */
export async function detectWebGPU(): Promise<WebGPUCapability> {
  const isMobile =
    typeof navigator !== "undefined" &&
    (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (typeof window !== "undefined" && window.innerWidth <= 768));

  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    return {
      supported: false,
      adapterAvailable: false,
      hasShaderF16: false,
      isMobile,
      error:
        "WebGPU is not supported by your current browser. To run Qwen2.5-0.5B-Instruct locally, please use modern Google Chrome (113+), Microsoft Edge (113+), or Safari (18+) with WebGPU enabled.",
    };
  }

  try {
    const adapter =
      (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })) ||
      (await navigator.gpu.requestAdapter());

    if (!adapter) {
      return {
        supported: true,
        adapterAvailable: false,
        hasShaderF16: false,
        isMobile,
        error:
          "WebGPU is present in your browser, but no compatible GPU adapter was found. Please ensure hardware acceleration is enabled in your browser settings (chrome://settings/system) and your GPU drivers are up to date.",
      };
    }

    const hasShaderF16 = adapter.features.has("shader-f16");
    let adapterInfo: WebGPUCapability["adapterInfo"] = undefined;

    try {
      if ("info" in adapter && adapter.info) {
        const info = adapter.info as {
          vendor?: string;
          architecture?: string;
          device?: string;
          description?: string;
        };
        adapterInfo = {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
        };
      } else if ("requestAdapterInfo" in adapter) {
        const info = await (adapter as { requestAdapterInfo: () => Promise<{ vendor?: string; architecture?: string; device?: string; description?: string }> }).requestAdapterInfo();
        adapterInfo = {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
        };
      }
    } catch {
      /* adapter info optional */
    }

    const limits = {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
    };

    return {
      supported: true,
      adapterAvailable: true,
      hasShaderF16,
      adapterInfo,
      limits,
      isMobile,
    };
  } catch (err) {
    return {
      supported: true,
      adapterAvailable: false,
      hasShaderF16: false,
      isMobile,
      error: err instanceof Error ? err.message : "Failed to initialize WebGPU adapter.",
    };
  }
}

/**
 * Checks browser storage quota and available space using navigator.storage.estimate().
 * Also inspects actual CacheStorage usage for MLC model files.
 */
export async function checkStorageAvailability(): Promise<StorageInfo> {
  let quotaMB = 0;
  let usageMB = 0;
  let availableMB = 0;
  let persisted = false;
  let modelStorageMB = 0;

  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      const usage = estimate.usage || 0;
      quotaMB = Math.round(quota / (1024 * 1024));
      usageMB = Math.round(usage / (1024 * 1024));
      availableMB = Math.max(quotaMB - usageMB, 0);

      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
    } catch {
      // ignore
    }
  }

  // Calculate actual cache bytes for WebLLM model if available
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const keys = await window.caches.keys();
      let totalBytes = 0;
      for (const key of keys) {
        if (key.toLowerCase().includes("webllm") || key.toLowerCase().includes("mlc")) {
          const cache = await window.caches.open(key);
          const reqs = await cache.keys();
          for (const req of reqs) {
            const res = await cache.match(req);
            if (res) {
              const blob = await res.clone().blob();
              totalBytes += blob.size;
            }
          }
        }
      }
      if (totalBytes > 0) {
        modelStorageMB = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
      }
    } catch {
      // ignore
    }
  }

  return {
    quotaMB,
    usageMB,
    availableMB,
    modelStorageMB: modelStorageMB > 0 ? modelStorageMB : (await isQwenModelCached() ? QWEN_05B_METADATA.downloadSizeMB : 0),
    persisted,
  };
}

/**
 * Requests persistent storage from browser so cached model files are not cleared automatically.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Verifies if Qwen2.5 0.5B is already cached in browser Cache API / IndexedDB,
 * and returns the specific cached model ID if found.
 */
export async function getCachedModelId(): Promise<string | null> {
  try {
    const primary = await hasModelInCache(PRIMARY_MODEL_ID, prebuiltAppConfig);
    if (primary) return PRIMARY_MODEL_ID;
    const fallback = await hasModelInCache(FALLBACK_MODEL_ID, prebuiltAppConfig);
    if (fallback) return FALLBACK_MODEL_ID;
    return null;
  } catch {
    return null;
  }
}

export async function isQwenModelCached(): Promise<boolean> {
  const cached = await getCachedModelId();
  return cached !== null;
}

/**
 * Deletes cached model weights, tokenizer, and wasm files from browser cache.
 */
export async function deleteQwenModelCache(): Promise<void> {
  try {
    if (engineInstance) {
      await unloadEngine();
    }
    await deleteModelAllInfoInCache(PRIMARY_MODEL_ID, prebuiltAppConfig);
    await deleteModelAllInfoInCache(FALLBACK_MODEL_ID, prebuiltAppConfig);

    // Also check and clean any leftover cache entries
    if (typeof window !== "undefined" && "caches" in window) {
      const keys = await window.caches.keys();
      for (const key of keys) {
        if (key.toLowerCase().includes("qwen") || key.toLowerCase().includes("webllm")) {
          await window.caches.delete(key);
        }
      }
    }
  } catch (err) {
    console.error("Failed to delete model cache:", err);
    throw err;
  }
}

/**
 * Initializes or retrieves the loaded MLCEngine for Qwen2.5-0.5B-Instruct.
 */
export async function loadQwenModel(
  onProgress?: (report: EngineProgress) => void,
  options?: {
    forceFp32?: boolean;
    contextWindow?: number;
  }
): Promise<MLCEngine> {
  // If engine already loaded with the same model, return it immediately
  if (engineInstance && currentLoadedModelId) {
    onProgress?.({
      progress: 100,
      text: "Qwen 2.5 0.5B Instruct is ready in WebGPU memory.",
      state: "Ready",
    });
    return engineInstance;
  }

  // Detect WebGPU capability
  const gpu = await detectWebGPU();
  if (!gpu.supported || !gpu.adapterAvailable) {
    onProgress?.({
      progress: 0,
      text: gpu.error || "WebGPU is not supported on this device.",
      state: "WebGPU Unsupported",
    });
    throw new Error(gpu.error || "WebGPU is not available on this device.");
  }

  // Check if a model is already cached in browser storage to avoid re-downloading
  const cachedModelId = await getCachedModelId();

  // Select fp16 or fp32 based on cached assets, options, or hardware capability
  let targetModelId = PRIMARY_MODEL_ID;
  if (options?.forceFp32 || !gpu.hasShaderF16) {
    targetModelId = FALLBACK_MODEL_ID;
  } else if (cachedModelId) {
    targetModelId = cachedModelId;
  }

  onProgress?.({
    progress: 5,
    text: cachedModelId
      ? `Loading ${targetModelId} from browser storage into WebGPU...`
      : `Downloading ${targetModelId} from Hugging Face repository...`,
    state: cachedModelId ? "Loading" : "Downloading",
  });

  const customAppConfig: AppConfig = {
    ...prebuiltAppConfig,
  };

  // Allow custom context window (e.g. 2048 for mobile to save VRAM)
  if (options?.contextWindow) {
    const record = customAppConfig.model_list.find((m) => m.model_id === targetModelId);
    if (record) {
      record.overrides = {
        ...(record.overrides || {}),
        context_window_size: options.contextWindow,
      };
    }
  }

  const controller = new AbortController();
  activeAbortController = controller;

  try {
    const engine = await CreateMLCEngine(targetModelId, {
      appConfig: customAppConfig,
      initProgressCallback: (report: InitProgressReport) => {
        const pct = Math.round((report.progress || 0) * 100);
        const text = report.text || "Loading model assets...";
        let state: InstallationState = cachedModelId ? "Loading" : "Downloading";

        if (pct >= 100) {
          state = "Ready";
        } else if (
          text.toLowerCase().includes("install") ||
          text.toLowerCase().includes("cache") ||
          text.toLowerCase().includes("finish") ||
          text.toLowerCase().includes("pack")
        ) {
          state = "Installing";
        } else if (
          text.toLowerCase().includes("load") ||
          text.toLowerCase().includes("compil") ||
          text.toLowerCase().includes("init") ||
          cachedModelId
        ) {
          state = "Loading";
        } else {
          state = "Downloading";
        }

        onProgress?.({
          progress: pct,
          text,
          state,
          timeElapsed: report.timeElapsed,
        });
      },
      logLevel: "WARN",
    });

    engineInstance = engine;
    currentLoadedModelId = targetModelId;

    // Try requesting persistent storage in background
    void requestPersistentStorage();

    onProgress?.({
      progress: 100,
      text: "Qwen 2.5 0.5B Instruct model successfully loaded into WebGPU.",
      state: "Ready",
    });

    return engine;
  } catch (err) {
    engineInstance = null;
    currentLoadedModelId = null;
    const msg = err instanceof Error ? err.message : "Failed to load Qwen 2.5 0.5B model.";
    onProgress?.({
      progress: 0,
      text: msg,
      state: "Error",
    });
    throw err;
  } finally {
    activeAbortController = null;
  }
}

/**
 * Cancels active download/initialization if possible.
 */
export function cancelActiveDownload(): void {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

/**
 * Unloads the engine from GPU memory to free VRAM.
 */
export async function unloadEngine(): Promise<void> {
  if (engineInstance) {
    try {
      await engineInstance.unload();
    } catch (e) {
      console.warn("Engine unload error:", e);
    } finally {
      engineInstance = null;
      currentLoadedModelId = null;
    }
  }
}

/**
 * Returns whether the engine is currently loaded and ready in memory.
 */
export function isEngineReady(): boolean {
  return engineInstance !== null && currentLoadedModelId !== null;
}

/**
 * Returns currently loaded model ID.
 */
export function getActiveModelId(): string | null {
  return currentLoadedModelId;
}

/**
 * Streams chat completion using the loaded Qwen2.5-0.5B-Instruct WebGPU engine.
 */
export async function streamQwenChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onDelta: (delta: string) => void,
  onDone: () => void,
  onError: (errorText: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!engineInstance) {
    onError("WebGPU Local Engine is not initialized. Please load Qwen 2.5 0.5B first.");
    return;
  }

  try {
    const asyncChunkGenerator = await engineInstance.chat.completions.create({
      messages: messages as any,
      stream: true,
      temperature: 0.3,
      top_p: 0.85,
      max_tokens: 1024,
    });

    for await (const chunk of asyncChunkGenerator) {
      if (signal?.aborted) {
        break;
      }
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        onDelta(delta);
      }
    }

    onDone();
  } catch (err) {
    if (signal?.aborted) {
      onDone();
      return;
    }
    const msg = err instanceof Error ? err.message : "Inference failed during local token generation.";
    console.error("Local WebGPU inference error:", err);
    onError(msg);
  }
}

/**
 * Aborts current generation in flight.
 */
export function stopGeneration(): void {
  if (engineInstance) {
    try {
      engineInstance.interruptGenerate();
    } catch {
      // interrupt not available or already completed
    }
  }
}

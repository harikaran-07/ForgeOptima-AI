/**
 * Central Sakthi Copilot Intelligence Engine
 *
 * Implements:
 * - Shared WebGPU inference using Qwen 2.5 0.5B Instruct
 * - Structured JSON parsing with robust extraction & fallback
 * - Streaming token generator with interrupt/stop controls
 * - In-memory hash-based explanation cache (avoids re-inference on unchanged telemetry)
 * - Domain-grounded deterministic metallurgical fallback when model is not yet loaded in VRAM
 * - Zero external API transmission - 100% private on-device execution
 */

import {
  getRawEngineInstance,
  isEngineReady,
  loadQwenModel,
} from "./modelManager";

export interface SupportingDataPoint {
  label: string;
  value: string | number;
  unit?: string;
}

export interface AIRecommendation {
  action: string;
  reason: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  investigation_area?: string;
}

export interface StructuredAIResponse {
  title: string;
  summary: string;
  observations: string[];
  supporting_data: SupportingDataPoint[];
  recommendations: AIRecommendation[];
  limitations: string[];
  isModelGenerated: boolean;
  modelName: string;
  timestamp: string;
}

// In-memory cache for generated explanations
const explanationCache = new Map<string, { response: StructuredAIResponse; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL per telemetry snapshot

/**
 * Creates a stable deterministic hash from an object
 */
function hashObject(obj: unknown): string {
  try {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  } catch {
    return String(Date.now());
  }
}

/**
 * Manually invalidates the AI explanation cache (e.g. when user clicks Refresh)
 */
export function invalidateAiCache(): void {
  explanationCache.clear();
}

/**
 * Builds the base industrial furnace system prompt for Qwen 2.5 0.5B Instruct.
 */
export function buildEngineSystemPrompt(): string {
  return `You are SAKTHI COPILOT, an expert industrial furnace metallurgist and energy optimization AI copilot.
Your role is to analyze industrial induction furnace data, temperatures, electrical power, melting curves, and operational observations.
Always provide thorough, accurate, and constructive technical analysis and structured recommendations using standard engineering units (°C, kW, kWh, min, kg).
Respond strictly in valid JSON format matching the requested schema.`;
}

/**
 * Executes a structured inference task using Qwen 2.5 0.5B WebGPU or grounded physics fallback.
 */
export async function runStructuredTask(
  taskType: string,
  contextData: Record<string, unknown>,
  customPrompt: string,
  deterministicFallback: (data: Record<string, unknown>) => StructuredAIResponse,
  forceRefresh = false
): Promise<StructuredAIResponse> {
  const cacheKey = `${taskType}_${hashObject(contextData)}`;

  if (!forceRefresh) {
    const cached = explanationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.response;
    }
  }

  // If engine is not ready in WebGPU memory, return the physics-grounded fallback immediately
  if (!isEngineReady()) {
    const fallbackResponse = deterministicFallback(contextData);
    fallbackResponse.isModelGenerated = false;
    fallbackResponse.modelName = "ForgeOptima Physics & ML Engine";
    fallbackResponse.timestamp = new Date().toISOString();
    explanationCache.set(cacheKey, {
      response: fallbackResponse,
      expiresAt: Date.now() + 15000,
    });
    return fallbackResponse;
  }

  const engine = getRawEngineInstance();
  if (!engine) {
    return deterministicFallback(contextData);
  }

  const prompt = `${buildEngineSystemPrompt()}

--- LIVE FURNACE DATA ---
${JSON.stringify(contextData, null, 2)}
--- END DATA ---

TASK:
${customPrompt}

REQUIRED JSON SCHEMA:
{
  "title": "Short descriptive title",
  "summary": "1-2 sentence executive summary of the observation",
  "observations": ["Specific observation 1 with numbers", "Specific observation 2"],
  "supporting_data": [{"label": "Measurement name", "value": 1234, "unit": "°C or kW"}],
  "recommendations": [{"action": "Action to take", "reason": "Why it matters", "priority": "HIGH" | "MEDIUM" | "LOW", "investigation_area": "Lining/Electrical/Scrap"}],
  "limitations": ["Operating boundary or uncertainty note"]
}
Output ONLY the raw JSON object, without markdown code fences.`;

  try {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: "system", content: "You are a metallurgical furnace copilot. Always output pure valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const rawText = completion.choices[0]?.message?.content || "";
    const parsed = extractAndValidateJson<StructuredAIResponse>(rawText);

    if (parsed && parsed.title && parsed.summary) {
      const result: StructuredAIResponse = {
        title: parsed.title,
        summary: parsed.summary,
        observations: Array.isArray(parsed.observations) ? parsed.observations : [],
        supporting_data: Array.isArray(parsed.supporting_data) ? parsed.supporting_data : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
        isModelGenerated: true,
        modelName: "Qwen 2.5 0.5B Instruct (WebGPU)",
        timestamp: new Date().toISOString(),
      };
      explanationCache.set(cacheKey, {
        response: result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return result;
    }
  } catch (err) {
    console.warn("Local Qwen inference task failed, falling back to grounded engine:", err);
  }

  // Graceful fallback to grounded formula engine
  const fallback = deterministicFallback(contextData);
  fallback.isModelGenerated = false;
  fallback.modelName = "ForgeOptima Physics & ML Engine";
  fallback.timestamp = new Date().toISOString();
  return fallback;
}

/**
 * Extracts and parses JSON from potentially conversational or fenced model output.
 */
function extractAndValidateJson<T>(rawText: string): T | null {
  try {
    // 1. Direct parse attempt
    return JSON.parse(rawText) as T;
  } catch {
    // 2. Extract between first { and last }
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const cleanJson = rawText.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(cleanJson) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Streams chat completion using the shared Qwen 2.5 0.5B WebGPU engine.
 */
export async function streamEngineChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onDelta: (delta: string) => void,
  onDone: () => void,
  onError: (errorText: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const engine = getRawEngineInstance();
  if (!engine) {
    onError("Qwen 2.5 0.5B model is not loaded in WebGPU memory. Please load the model first.");
    return;
  }

  try {
    const stream = await engine.chat.completions.create({
      messages: messages as any,
      stream: true,
      temperature: 0.3,
      top_p: 0.85,
      max_tokens: 1024,
    });

    for await (const chunk of stream) {
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
    const msg = err instanceof Error ? err.message : "Inference error occurred.";
    onError(msg);
  }
}

/**
 * Halts active token generation.
 */
export function stopEngineGeneration(): void {
  const engine = getRawEngineInstance();
  if (engine) {
    try {
      engine.interruptGenerate();
    } catch {
      // ignore
    }
  }
}

/**
 * Auto-initializes the engine if cached in storage.
 */
export async function autoLoadIfCached(onProgress?: (report: any) => void): Promise<boolean> {
  if (isEngineReady()) return true;
  try {
    await loadQwenModel(onProgress);
    return true;
  } catch {
    return false;
  }
}

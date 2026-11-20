/**
 * Centralized WebLLM Engine Bridge
 * Re-exports the shared singleton model manager from services/ai/modelManager.ts
 * Ensuring ONE unified model instance across the entire application.
 */

export * from "../services/ai/modelManager";

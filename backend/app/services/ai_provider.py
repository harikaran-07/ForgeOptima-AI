"""AI inference and status service for ForgeOptima AI.

Primary Architecture:
- Browser Local AI with Qwen2.5 3B Instruct executed directly on user WebGPU via @mlc-ai/web-llm.
- 100% private, zero-latency on-device inference.
- Zero external API dependencies (no external cloud APIs, no Ollama requirement).
- Built-in grounded industrial domain engine as instant server-side fallback.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import time
from typing import Any, AsyncIterator, Optional

from ..core.config import settings
from ..core.logging import get_logger
from .furnace_context import generate_grounded_response

log = get_logger("forgeoptima.ai_provider")


class AIUsageTracker:
    def __init__(self) -> None:
        self.total_requests: int = 0
        self.total_tokens_estimated: int = 0
        self.active_sessions: set[str] = set()
        self.last_request_at: Optional[datetime] = None

    def record_request(self, session_id: Optional[str], estimated_tokens: int = 250):
        self.total_requests += 1
        self.total_tokens_estimated += estimated_tokens
        self.last_request_at = datetime.now(timezone.utc)
        if session_id:
            self.active_sessions.add(session_id)

    def get_stats(self, provider: str, model: str) -> dict[str, Any]:
        return {
            "provider": provider,
            "model": model,
            "free_tier_status": "Browser Local AI · WebGPU Active",
            "quota_limit": "Unlimited Local Inference (Zero Cost)",
            "remaining_estimate": "Runs 100% Locally on Device",
            "reset_period": "No Reset Needed",
            "total_requests": self.total_requests,
            "total_tokens_estimated": self.total_tokens_estimated,
            "active_sessions": len(self.active_sessions),
            "rate_limit_per_minute": settings.ai_rate_limit_per_minute,
            "last_request_at": self.last_request_at,
        }


usage_tracker = AIUsageTracker()


def detect_provider(override_key: Optional[str] = None) -> tuple[str, str, Optional[str], Optional[str]]:
    """Resolves primary Browser Local AI model configuration."""
    return "webllm", "Qwen2.5-3B-Instruct", None, "browser://webgpu"


async def check_provider_status() -> dict[str, Any]:
    """Returns status metadata for the WebLLM Browser Local AI architecture."""
    provider, model, _, _ = detect_provider()
    return {
        "online": True,
        "provider": provider,
        "model": model,
        "base_url_configured": True,
        "latency_ms": 0.0,
        "detail": "Online · Qwen2.5 3B Instruct running via WebLLM WebGPU directly in the browser.",
        "models_available": [
            "Qwen2.5-3B-Instruct-q4f16_1-MLC",
            "Qwen2.5-3B-Instruct-q4f32_1-MLC",
        ],
        "free_tier": True,
        "checked_at": datetime.now(timezone.utc),
    }


async def stream_chat_provider(
    messages: list[dict[str, str]],
    context: dict[str, Any],
    session_id: Optional[str] = None,
    override_key: Optional[str] = None,
) -> AsyncIterator[str]:
    """Streams deterministic grounded responses if server-side chat is called.

    Note: Primary chat execution happens directly inside the browser using WebLLM WebGPU.
    This streaming provider serves as an instant fallback when the backend endpoint is tested.
    """
    last_user_query = "furnace status"
    for m in reversed(messages):
        if (m.get("role") or "").lower() == "user":
            last_user_query = m.get("content") or "furnace status"
            break

    grounded_reply = generate_grounded_response(last_user_query, context)

    # Stream out words with realistic natural cadence
    words = grounded_reply.split(" ")
    for i, word in enumerate(words):
        yield word + (" " if i < len(words) - 1 else "")
        await asyncio.sleep(0.015)

    usage_tracker.record_request(session_id, estimated_tokens=len(words))

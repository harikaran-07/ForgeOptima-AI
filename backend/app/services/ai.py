"""Backwards-compatibility bridge for app.services.ai.

Forwards to modular services:
- furnace_context.py
- ai_provider.py
- conversation_manager.py
- shakthi_ai.py
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Optional
from sqlalchemy.orm import Session

from .furnace_context import (
    SUGGESTED_QUESTIONS,
    SYSTEM_PROMPT,
    build_furnace_context as build_context,
    format_context_prompt as context_prompt,
    generate_grounded_response,
)
from .ai_provider import check_provider_status as status, detect_provider, stream_chat_provider
from .shakthi_ai import chat_stream, get_status, get_usage


async def stream_chat(
    messages: list[dict[str, str]], context: dict[str, Any] | None = None
) -> AsyncIterator[str]:
    """Compatibility wrapper for stream_chat."""
    ctx = context or {}
    async for token in stream_chat_provider(messages, ctx):
        yield token


def summarize_anomalies_for_prompt(records) -> str:
    if not records:
        return "No anomaly records."
    return "; ".join(f"{r.heat_id}: {r.anomaly_type} ({r.severity})" for r in records[:5])

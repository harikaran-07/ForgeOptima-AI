"""SHAKTHI AI: Core industrial furnace copilot service.

Integrates:
- Domain context assembly (furnace_context.py)
- Provider-independent inference with fallback (ai_provider.py)
- Multi-user session isolation & rate limiting (conversation_manager.py)
"""
from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Optional

from sqlalchemy.orm import Session

from ..core.logging import get_logger
from .ai_provider import check_provider_status, detect_provider, stream_chat_provider, usage_tracker
from .conversation_manager import (
    append_message,
    check_rate_limit,
    get_or_create_conversation,
    load_conversation_messages,
    resolve_session_id,
)
from .furnace_context import (
    SUGGESTED_QUESTIONS,
    SYSTEM_PROMPT,
    build_furnace_context,
    format_context_prompt,
)

log = get_logger("forgeoptima.shakthi_ai")


async def get_status(session_id: Optional[str] = None) -> dict[str, Any]:
    """Returns AI status and active model information."""
    status = await check_provider_status()
    if session_id:
        status["session_id"] = session_id
    return status


def get_usage(session_id: Optional[str] = None) -> dict[str, Any]:
    """Returns usage stats, quota info, and rate limits."""
    provider, model, _, _ = detect_provider()
    return usage_tracker.get_stats(provider, model)


async def chat_stream(
    db: Session,
    session_id: str,
    message: str,
    conversation_id: Optional[int] = None,
    api_key: Optional[str] = None,
) -> AsyncIterator[str]:
    """Executes a multi-user, rate-limited, grounded streaming conversation."""
    clean_session = resolve_session_id(session_id)

    # 1. Rate limiting
    try:
        check_rate_limit(clean_session)
    except Exception as rl_exc:
        yield f"data: {json.dumps({'type': 'delta', 'text': f'⚠️ **Notice:** {rl_exc}'})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # 2. Retrieve or create session-isolated conversation & assemble furnace context
    active_conv_id = conversation_id or int(time.time() * 1000) % 1000000
    messages: list[dict[str, str]] = []
    context: dict[str, Any] = {}

    try:
        conv = get_or_create_conversation(db, clean_session, conversation_id, title_hint=message[:80])
        active_conv_id = conv.id
        append_message(db, active_conv_id, role="user", content=message)
        context = build_furnace_context(db)
        history = load_conversation_messages(db, active_conv_id)
        full_system = f"{SYSTEM_PROMPT}\n\n{format_context_prompt(context)}"
        messages.append({"role": "system", "content": full_system})
        for h in history[:-1]:
            messages.append(h)
    except Exception as db_exc:
        log.warning("Database unavailable in chat_stream (%s), continuing with ephemeral session", db_exc)
        messages.append({"role": "system", "content": SYSTEM_PROMPT})

    messages.append({"role": "user", "content": message})

    # 3. Stream SSE frames
    provider, model, resolved_key, _ = detect_provider(override_key=api_key)
    yield f"data: {json.dumps({'type': 'start', 'conversation_id': active_conv_id, 'model': model, 'provider': provider, 'session_id': clean_session})}\n\n"

    accumulated = ""
    try:
        async for token in stream_chat_provider(messages, context, session_id=clean_session, override_key=api_key):
            accumulated += token
            yield f"data: {json.dumps({'type': 'delta', 'text': token})}\n\n"
    except Exception as exc:
        log.error("Error during streaming: %s", exc)
        yield f"data: {json.dumps({'type': 'delta', 'text': f'\n\n⚠️ **Inference Notice:** {exc}'})}\n\n"

    # 4. Persist completed assistant message
    if accumulated.strip():
        try:
            db.rollback()
            append_message(db, active_conv_id, role="assistant", content=accumulated)
        except Exception as save_exc:
            log.warning("Could not persist assistant reply: %s", save_exc)

    yield f"data: {json.dumps({'type': 'done'})}\n\n"


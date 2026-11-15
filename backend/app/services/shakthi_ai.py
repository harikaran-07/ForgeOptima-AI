"""SHAKTHI AI: Core industrial furnace copilot service.

Integrates:
- Domain context assembly (furnace_context.py)
- Provider-independent inference with fallback (ai_provider.py)
- Multi-user session isolation & rate limiting (conversation_manager.py)
"""
from __future__ import annotations

import json
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
) -> AsyncIterator[str]:
    """Executes a multi-user, rate-limited, grounded streaming conversation."""
    clean_session = resolve_session_id(session_id)

    # 1. Rate limiting
    check_rate_limit(clean_session)

    # 2. Retrieve or create session-isolated conversation
    conv = get_or_create_conversation(db, clean_session, conversation_id, title_hint=message[:80])
    conversation_id = conv.id

    # 3. Store user message in DB
    append_message(db, conversation_id, role="user", content=message)

    # 4. Assemble real furnace context
    context = build_furnace_context(db)
    context_str = format_context_prompt(context)

    # 5. Build conversation message history
    history = load_conversation_messages(db, conversation_id)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": f"{SYSTEM_PROMPT}\n\n{context_str}"}
    ]
    for h in history[:-1]:  # exclude the user message we just appended
        messages.append(h)
    messages.append({"role": "user", "content": message})

    # 6. Stream SSE frames
    provider, model, _, _ = detect_provider()
    yield f"data: {json.dumps({'type': 'start', 'conversation_id': conversation_id, 'model': model, 'provider': provider, 'session_id': clean_session})}\n\n"

    accumulated = ""
    try:
        async for token in stream_chat_provider(messages, context, session_id=clean_session):
            accumulated += token
            yield f"data: {json.dumps({'type': 'delta', 'text': token})}\n\n"
    except Exception as exc:
        log.error("Error during streaming: %s", exc)
        yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    # 7. Persist completed assistant message
    if accumulated.strip():
        try:
            append_message(db, conversation_id, role="assistant", content=accumulated)
        except Exception as save_exc:
            log.warning("Could not persist assistant reply: %s", save_exc)

    yield f"data: {json.dumps({'type': 'done'})}\n\n"

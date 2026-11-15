"""Multi-user session isolation, rate limiting, and conversation management.

Guarantees:
- Strict session isolation: User A can NEVER view or modify User B's conversations.
- Rate limiting: Protects free AI provider quotas and backend resources.
- Safe session generation when client doesn't provide one.
"""
from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.logging import get_logger
from ..models import AIConversation, AIMessage

log = get_logger("forgeoptima.conversation_manager")

# In-memory sliding window rate limiter: session_id -> deque of timestamps
_rate_limit_records: dict[str, deque[float]] = defaultdict(deque)
MAX_HISTORY_MESSAGES = 10


def resolve_session_id(raw_session_id: Optional[str] = None) -> str:
    """Sanitizes or creates a persistent session identifier."""
    if raw_session_id and len(raw_session_id.strip()) >= 8:
        # Sanitize to alphanumeric + dashes
        clean = "".join(c for c in raw_session_id.strip() if c.isalnum() or c in "-_")
        if clean:
            return clean[:64]
    return f"sess_{uuid.uuid4().hex[:16]}"


def check_rate_limit(session_id: str) -> None:
    """Enforces sliding-window rate limit per session (default: 20 req/min)."""
    now = time.time()
    window = 60.0
    limit = settings.ai_rate_limit_per_minute

    q = _rate_limit_records[session_id]
    # Pop events older than window
    while q and q[0] <= now - window:
        q.popleft()

    if len(q) >= limit:
        log.warning("Rate limit hit for session %s (%d requests in 60s)", session_id, len(q))
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({limit} messages/min). Please wait a moment before sending another prompt.",
        )

    q.append(now)


def get_or_create_conversation(
    db: Session,
    session_id: str,
    conversation_id: Optional[int] = None,
    title_hint: str = "New conversation",
) -> AIConversation:
    """Retrieves an existing conversation belonging to session_id, or creates a new one."""
    conv = None
    if conversation_id:
        conv = db.scalar(
            select(AIConversation).where(
                AIConversation.id == conversation_id,
                AIConversation.session_id == session_id,
            )
        )

    if conv is None:
        title = title_hint.strip()[:80] if title_hint else "Furnace copilot conversation"
        conv = AIConversation(
            session_id=session_id,
            title=title,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)

    return conv


def list_conversations(db: Session, session_id: str, limit: int = 30) -> list[AIConversation]:
    """Lists conversations belonging exclusively to the caller's session."""
    return list(
        db.scalars(
            select(AIConversation)
            .where(AIConversation.session_id == session_id)
            .order_by(AIConversation.updated_at.desc())
            .limit(limit)
        )
    )


def get_conversation_detail(db: Session, session_id: str, conversation_id: int) -> AIConversation:
    """Returns conversation detail if and only if it belongs to this session."""
    conv = db.scalar(
        select(AIConversation).where(
            AIConversation.id == conversation_id,
            AIConversation.session_id == session_id,
        )
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied.")
    return conv


def delete_conversation(db: Session, session_id: str, conversation_id: int) -> int:
    """Deletes conversation if owned by session_id."""
    conv = db.scalar(
        select(AIConversation).where(
            AIConversation.id == conversation_id,
            AIConversation.session_id == session_id,
        )
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied.")
    db.delete(conv)
    db.commit()
    return conversation_id


def clear_all_history(db: Session, session_id: str) -> int:
    """Clears all conversations belonging to the caller's session."""
    stmt = delete(AIConversation).where(AIConversation.session_id == session_id)
    res = db.execute(stmt)
    db.commit()
    return res.rowcount or 0


def append_message(
    db: Session,
    conversation_id: int,
    role: str,
    content: str,
    snapshot: Optional[dict] = None,
) -> AIMessage:
    """Appends an AIMessage and updates conversation's updated_at."""
    msg = AIMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        context_snapshot=snapshot,
        created_at=datetime.now(timezone.utc),
    )
    db.add(msg)
    conv = db.get(AIConversation, conversation_id)
    if conv:
        conv.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    return msg


def load_conversation_messages(db: Session, conversation_id: int) -> list[dict[str, str]]:
    """Loads recent messages for prompt history injection."""
    prior = list(
        db.scalars(
            select(AIMessage)
            .where(AIMessage.conversation_id == conversation_id)
            .order_by(AIMessage.id.desc())
            .limit(MAX_HISTORY_MESSAGES)
        )
    )
    prior.reverse()
    result = []
    for m in prior:
        if m.role in ("user", "assistant"):
            result.append({"role": m.role, "content": m.content[:4000]})
    return result

"""SHAKTHI AI endpoints: status, streaming chat, history, usage.

Multi-user session isolation:
- Browser passes an anonymous or authenticated session token via X-Session-ID header or payload.
- All conversation histories and rate limits are partitioned per session.
- The browser communicates only with this FastAPI backend; API keys are never exposed.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.logging import get_logger
from ..schemas import (
    AIStatus,
    AIUsageOut,
    ChatRequest,
    ConversationDetail,
    ConversationOut,
)
from ..services import conversation_manager as conv_mgr
from ..services import shakthi_ai

router = APIRouter(prefix="/ai", tags=["shakthi ai"])
log = get_logger("forgeoptima.api.ai")


def get_current_session_id(
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID"),
    session_id: Optional[str] = Query(None),
) -> str:
    """Extracts session identifier from request header or query param."""
    raw = x_session_id or session_id
    return conv_mgr.resolve_session_id(raw)


@router.get("/status", response_model=AIStatus)
async def ai_status(
    session_id: str = Depends(get_current_session_id),
):
    """Returns AI model provider status, latency and active model info."""
    return await shakthi_ai.get_status(session_id=session_id)


@router.get("/usage", response_model=AIUsageOut)
def ai_usage(
    session_id: str = Depends(get_current_session_id),
):
    """Returns provider quota limits, request statistics and session rate limits."""
    return shakthi_ai.get_usage(session_id=session_id)


@router.get("/suggestions")
def suggestions():
    """Returns prompt suggestions tailored for induction furnace intelligence."""
    provider, model, _, _ = shakthi_ai.detect_provider()
    return {
        "suggestions": shakthi_ai.SUGGESTED_QUESTIONS,
        "assistant": "SHAKTHI AI",
        "tagline": "Your Intelligent Industrial Furnace Copilot",
        "model_note": f"{model} via {provider.capitalize()}",
    }


@router.get("/context")
def ai_context(db: Session = Depends(get_db)):
    """Returns the read-only plant context snapshot sent to Shakthi AI."""
    from ..services.furnace_context import SYSTEM_PROMPT, build_furnace_context
    ctx = build_furnace_context(db)
    return {
        "context": ctx,
        "system_prompt": SYSTEM_PROMPT,
    }


@router.get("/history", response_model=list[ConversationOut])
def history(
    db: Session = Depends(get_db),
    session_id: str = Depends(get_current_session_id),
    limit: int = Query(30, ge=1, le=100),
):
    """Lists conversations belonging exclusively to the requesting user session."""
    return conv_mgr.list_conversations(db, session_id=session_id, limit=limit)


@router.get("/history/{conversation_id}", response_model=ConversationDetail)
def conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    session_id: str = Depends(get_current_session_id),
):
    """Retrieves full conversation history with session isolation."""
    return conv_mgr.get_conversation_detail(db, session_id=session_id, conversation_id=conversation_id)


@router.delete("/history/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    session_id: str = Depends(get_current_session_id),
):
    """Deletes a single conversation owned by the session."""
    deleted_id = conv_mgr.delete_conversation(db, session_id=session_id, conversation_id=conversation_id)
    return {"deleted": deleted_id}


@router.delete("/history")
def clear_all_history(
    db: Session = Depends(get_db),
    session_id: str = Depends(get_current_session_id),
):
    """Clears all conversation history belonging exclusively to the caller's session."""
    count = conv_mgr.clear_all_history(db, session_id=session_id)
    return {"cleared": True, "count": count, "session_id": session_id}


@router.post("/chat")
async def chat(
    payload: ChatRequest,
    response: Response,
    db: Session = Depends(get_db),
    header_session_id: Optional[str] = Header(None, alias="X-Session-ID"),
):
    """Stream a grounded furnace answer.

    Yields Server-Sent Events (SSE):
    - `data: {"type": "start", "conversation_id": 1, "model": "...", "session_id": "..."}`
    - `data: {"type": "delta", "text": "..."}`
    - `data: {"type": "done"}`
    """
    raw_session = payload.session_id or header_session_id
    session_id = conv_mgr.resolve_session_id(raw_session)

    # Attach session id to response header for client persistence
    response.headers["X-Session-ID"] = session_id

    return StreamingResponse(
        shakthi_ai.chat_stream(
            db=db,
            session_id=session_id,
            message=payload.message,
            conversation_id=payload.conversation_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Session-ID": session_id,
        },
    )

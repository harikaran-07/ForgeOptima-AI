"""SHAKTHI AI endpoints: status, streaming chat, history.

The browser receives SSE frames (`data: {...}`) and never sees the Ollama URL.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.database import SessionLocal, get_db
from ..core.logging import get_logger
from ..models import AIConversation, AIMessage
from ..schemas import AIStatus, ChatRequest, ConversationDetail, ConversationOut, MessageOut
from ..services import ai as service

router = APIRouter(prefix="/ai", tags=["shakthi ai"])
log = get_logger(__name__)

MAX_HISTORY_MESSAGES = 10


@router.get("/status", response_model=AIStatus)
async def ai_status():
    return await service.status()


@router.get("/suggestions")
def suggestions():
    return {"suggestions": service.SUGGESTED_QUESTIONS, "assistant": "SHAKTHI AI", "model_note": "Qwen 2.5 3B via Ollama"}


@router.get("/history", response_model=list[ConversationOut])
def history(db: Session = Depends(get_db), limit: int = 30):
    return list(
        db.scalars(select(AIConversation).order_by(AIConversation.updated_at.desc()).limit(limit))
    )


@router.get("/history/{conversation_id}", response_model=ConversationDetail)
def conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.get(AIConversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conv


@router.delete("/history/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.get(AIConversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    db.delete(conv)
    db.commit()
    return {"deleted": conversation_id}


@router.post("/chat")
async def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    """Stream a grounded answer. Persists the exchange as it completes."""
    if db.scalar(select(AIConversation.id).limit(1)) is None:
        pass

    conv = None
    if payload.conversation_id:
        conv = db.get(AIConversation, payload.conversation_id)
    if conv is None:
        conv = AIConversation(title=payload.message[:80])
        db.add(conv)
        db.commit()
        db.refresh(conv)

    db.add(AIMessage(conversation_id=conv.id, role="user", content=payload.message))
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()

    context = service.build_context(db)
    prior = list(
        db.scalars(
            select(AIMessage)
            .where(AIMessage.conversation_id == conv.id)
            .order_by(AIMessage.id.desc())
            .limit(MAX_HISTORY_MESSAGES)
        )
    )
    prior.reverse()
    messages = [{"role": "system", "content": service.SYSTEM_PROMPT + "\n\n" + service.context_prompt(context)}]
    for msg in prior:
        if msg.role in ("user", "assistant"):
            messages.append({"role": msg.role, "content": msg.content[:4000]})
    if messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": payload.message})

    conversation_id = conv.id

    async def event_stream():
        chunks: list[str] = []
        try:
            yield f"data: {json.dumps({'type': 'start', 'conversation_id': conversation_id})}\n\n"
            async for delta in service.stream_chat(messages, context=context):
                chunks.append(delta)
                yield f"data: {json.dumps({'type': 'delta', 'text': delta})}\n\n"
            answer = "".join(chunks).strip()
            if not answer:
                answer = "The model returned an empty response. Please retry."
            yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation_id})}\n\n"
        except Exception as exc:  # Ollama down mid-stream, timeout, etc.
            log.warning("SHAKTHI AI stream failed: %s", exc)
            answer = ""
            yield f"data: {json.dumps({'type': 'error', 'message': 'SHAKTHI AI is offline or the model request failed. Check Ollama connectivity and retry.'})}\n\n"
        finally:
            if answer:
                with SessionLocal() as session:
                    session.add(
                        AIMessage(
                            conversation_id=conversation_id,
                            role="assistant",
                            content=answer,
                            context_snapshot={
                                "latest_heat": (context.get("latest_heat") or {}).get("heat_id"),
                                "models_ready": bool(context.get("predictions")),
                                "generated_at": context.get("generated_at"),
                            },
                        )
                    )
                    record = session.get(AIConversation, conversation_id)
                    if record:
                        record.updated_at = datetime.now(timezone.utc)
                        if record.title.startswith("New conversation"):
                            record.title = payload.message[:80]
                    session.commit()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/context")
def context_preview(db: Session = Depends(get_db)):
    """Transparency endpoint: exactly what SHAKTHI AI is given (read-only)."""
    ctx = service.build_context(db)
    return {"context": ctx, "system_prompt": service.SYSTEM_PROMPT}

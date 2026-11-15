"""End-to-end SHAKTHI AI test: Ollama connectivity + grounded, context-aware answers.

Usage (from backend/, API and Ollama running):
    python -m scripts.test_ai_chat
    python -m scripts.test_ai_chat --question "How much time remains for melting?"
"""
from __future__ import annotations

import argparse
import json
import sys

import httpx


def stream_answer(client: httpx.Client, base: str, question: str) -> tuple[str, int | None]:
    chunks: list[str] = []
    conversation_id: int | None = None
    with client.stream(
        "POST", f"{base}/api/ai/chat", json={"message": question}, timeout=200.0
    ) as response:
        if response.status_code >= 400:
            response.read()
            raise RuntimeError(f"chat HTTP {response.status_code}: {response.text[:300]}")
        for line in response.iter_lines():
            if not line or not line.startswith("data:"):
                continue
            event = json.loads(line[5:].strip())
            if event.get("type") == "start":
                conversation_id = event.get("conversation_id")
            elif event.get("type") == "delta":
                chunks.append(event.get("text", ""))
            elif event.get("type") == "error":
                raise RuntimeError(event.get("message", "stream error"))
    return "".join(chunks).strip(), conversation_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--question", default="How much time remains for melting, and why is energy consumption high?")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    client = httpx.Client(timeout=60.0)

    print("== Ollama status ==")
    status = client.get(f"{base}/api/ai/status").json()
    print(f"  online={status['online']} model={status['model']} latency={status['latency_ms']}ms")
    print(f"  {status['detail']}")
    if not status["online"]:
        print("\nFAIL: SHAKTHI AI is offline; start Ollama and re-run.")
        return 1

    print("\n== Context the model receives ==")
    context = client.get(f"{base}/api/ai/context").json()["context"]
    latest = context.get("latest_heat") or {}
    print(f"  latest heat: {latest.get('heat_id')} · {latest.get('metal_grade')} · {latest.get('energy_per_kg')} kWh/kg")
    print(f"  predictions present: {list((context.get('predictions') or {}).keys())}")
    print(f"  anomalies in context: {len(context.get('recent_anomalies') or [])}")

    print(f"\n== Question ==\n  {args.question}")
    print("\n== SHAKTHI AI (streaming) ==")
    try:
        answer, conversation_id = stream_answer(client, base, args.question)
    except Exception as exc:
        print(f"FAIL: {exc}")
        return 1

    print(answer or "(empty answer)")
    print(f"\n  characters={len(answer)} conversation_id={conversation_id}")

    failures = []
    if len(answer) < 60:
        failures.append("answer too short to be a grounded analysis")
    lowered = answer.lower()
    if not any(token in lowered for token in ("heat", "melt", "energy", "furnace", "kwh", "°c", "c)")):
        failures.append("answer does not reference furnace domain terms")
    if any(phrase in lowered for phrase in ("i have set", "i will set", "i've adjusted", "command sent")):
        failures.append("answer implies it issued a control action")

    print("\n== Persistence ==")
    history = client.get(f"{base}/api/ai/history").json()
    print(f"  conversations stored: {len(history)}")
    if conversation_id:
        detail = client.get(f"{base}/api/ai/history/{conversation_id}").json()
        roles = [m["role"] for m in detail["messages"]]
        print(f"  conversation {conversation_id} messages: {roles}")
        if "assistant" not in roles:
            failures.append("assistant reply was not persisted")

    if failures:
        print("\nFAILED: " + "; ".join(failures))
        return 1
    print("\nPASS: SHAKTHI AI answered from plant context and the exchange was stored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

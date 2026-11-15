import { FormEvent, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Bot, MessageSquarePlus, RefreshCw, Send, Sparkles, Trash2, User2, WifiOff } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api, streamChat } from "../lib/api";
import { AIStatus } from "../lib/types";
import { dt } from "../lib/format";
import { Chip, ErrorBox, Notice, PageHeader, Panel } from "../components/ui";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ConversationDetail extends Conversation {
  messages: { id: number; role: string; content: string; created_at: string }[];
}

export default function ShakthiAI() {
  const status = useFetch<AIStatus>("/ai/status");
  const suggestions = useFetch<{ suggestions: string[] }>("/ai/suggestions");
  const history = useFetch<Conversation[]>("/ai/history", { pollMs: 30000 });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "", streaming: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(
      trimmed,
      conversationId,
      (event) => {
        if (event.type === "start" && event.conversation_id) {
          setConversationId(event.conversation_id);
        }
        if (event.type === "delta" && event.text) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + event.text };
            return next;
          });
        }
        if (event.type === "error") {
          setError(event.message ?? "SHAKTHI AI request failed.");
          setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming && m.content === "")));
        }
        if (event.type === "done") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, streaming: false };
            return next;
          });
        }
      },
      controller.signal
    );

    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && last.streaming) next[next.length - 1] = { ...last, streaming: false };
      return next;
    });
    setBusy(false);
    void history.reload();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const loadConversation = async (id: number) => {
    try {
      const detail = await api.get<ConversationDetail>(`/ai/history/${id}`);
      setConversationId(detail.id);
      setMessages(
        detail.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversation.");
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  const removeConversation = async (id: number) => {
    try {
      await api.del(`/ai/history/${id}`);
      if (conversationId === id) newChat();
      await history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete conversation.");
    }
  };

  const online = status.data?.online ?? false;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 09"
        title="SHAKTHI AI"
        description="Your Intelligent Industrial Furnace Assistant. Context-aware answers grounded in live plant data, model predictions, history and anomalies — powered by online cloud intelligence."
      >
        <Chip tone={online ? "violet" : "crit"}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", online ? "animate-pulseSoft bg-violet" : "bg-crit")} />
          {online ? (status.data?.model?.includes("Cloud") ? "Cloud AI Online" : "SHAKTHI AI Online") : "AI Offline"}
        </Chip>
        <Chip tone="neutral">{status.data?.model ?? "SHAKTHI Cloud Engine"}</Chip>
        <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => status.reload()}>
          <RefreshCw className="h-3.5 w-3.5" /> Recheck
        </button>
      </PageHeader>

      {!online && (
        <div className="rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div>
              <p className="text-[12.5px] font-semibold text-warn">SHAKTHI AI is offline</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-300">
                {status.data?.detail ?? "Checking the inference service…"} Start Ollama and pull the model:
                <span className="mono ml-1 rounded bg-base-900 px-1.5 py-0.5 text-[11px] text-ink-200">ollama pull qwen2.5:3b</span>
              </p>
              <p className="mt-1 text-[10.5px] text-ink-500">
                No substitute answers are generated when the model is unavailable — you will see the connection error
                instead of fabricated analysis.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Panel
            title="Furnace-aware conversation"
            subtitle={conversationId ? `Conversation #${conversationId}` : "New conversation"}
            action={
              <button className="btn-ghost !py-1 !text-[11px]" onClick={newChat}>
                <MessageSquarePlus className="h-3 w-3" /> New chat
              </button>
            }
            bodyClassName="p-0"
          >
            <div ref={scrollRef} className="max-h-[520px] min-h-[360px] space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="mx-auto max-w-lg py-8 text-center">
                  <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-violet/30 bg-violet/10">
                    <Sparkles className="h-5 w-5 text-violet" />
                  </div>
                  <p className="mt-3 text-[14px] font-semibold text-white">SHAKTHI AI</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">
                    Ask about the current heat, energy consumption, model predictions or anomalies. Answers use only the
                    plant context supplied by the backend — nothing is invented.
                  </p>
                  <div className="mt-5 grid gap-1.5 text-left">
                    {(suggestions.data?.suggestions ?? []).slice(0, 5).map((question) => (
                      <button
                        key={question}
                        onClick={() => send(question)}
                        className="rounded-lg border border-base-700 bg-base-900/60 px-3 py-2 text-[11.5px] text-ink-300 transition-colors hover:border-violet/40 hover:text-white"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message, index) => (
                <div key={index} className={clsx("flex gap-2.5", message.role === "user" && "flex-row-reverse")}>
                  <div
                    className={clsx(
                      "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border",
                      message.role === "user" ? "border-base-600 bg-base-750" : "border-violet/40 bg-violet/10"
                    )}
                  >
                    {message.role === "user" ? <User2 className="h-3 w-3 text-ink-300" /> : <Bot className="h-3 w-3 text-violet" />}
                  </div>
                  <div
                    className={clsx(
                      "max-w-[86%] rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap",
                      message.role === "user"
                        ? "bg-electric/15 text-ink-100"
                        : "border border-base-700 bg-base-900/70 text-ink-200"
                    )}
                  >
                    {message.content}
                    {message.streaming && (
                      <span className="ml-1 inline-block h-3 w-1.5 animate-pulseSoft bg-violet align-middle" />
                    )}
                  </div>
                </div>
              ))}

              {error && (
                <ErrorBox message={error} onRetry={() => (input ? send(input) : status.reload())} />
              )}
            </div>

            <form onSubmit={onSubmit} className="border-t border-base-700/70 px-3 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  className="input max-h-28 min-h-[42px] resize-y"
                  placeholder={online ? "Ask SHAKTHI AI about this heat…" : "Ollama is offline — start it to chat"}
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  disabled={busy}
                />
                <button type="submit" className="btn-primary shrink-0" disabled={busy || !input.trim()}>
                  <Send className="h-3.5 w-3.5" /> {busy ? "Thinking" : "Send"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(suggestions.data?.suggestions ?? []).slice(5).map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => send(question)}
                    disabled={busy}
                    className="rounded-full border border-base-600 bg-base-800/60 px-2.5 py-0.5 text-[10.5px] text-ink-400 transition-colors hover:border-violet/40 hover:text-ink-100"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </form>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Model status" subtitle="Backend-mediated inference">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Service</span>
                <Chip tone={online ? "good" : "crit"}>{online ? "online" : "offline"}</Chip>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Model</span>
                <span className="mono text-[11.5px] text-ink-100">{status.data?.model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Latency</span>
                <span className="mono text-[11.5px] text-ink-100">
                  {status.data?.latency_ms != null ? `${status.data.latency_ms} ms` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Last checked</span>
                <span className="mono text-[10.5px] text-ink-500">{status.data ? dt(status.data.checked_at) : "—"}</span>
              </div>
              {status.data && status.data.models_available.length > 0 && (
                <div className="border-t border-base-700/70 pt-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-500">Installed models</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {status.data.models_available.slice(0, 6).map((model) => (
                      <span key={model} className="mono rounded border border-base-600 bg-base-900 px-1.5 py-0.5 text-[10px] text-ink-300">
                        {model}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn-ghost w-full !py-1.5 !text-[11px]" onClick={() => setContextOpen((v) => !v)}>
                {contextOpen ? "Hide" : "Inspect"} AI context
              </button>
            </div>
          </Panel>

          {contextOpen && <ContextPreview />}

          <Panel title="Conversations" subtitle="Stored on the backend" bodyClassName="p-0">
            <div className="max-h-[300px] overflow-y-auto">
              {(history.data ?? []).map((conversation) => (
                <div
                  key={conversation.id}
                  className={clsx(
                    "group flex items-center gap-2 border-b border-base-700/50 px-3 py-2 last:border-0",
                    conversationId === conversation.id && "bg-electric/[0.07]"
                  )}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => loadConversation(conversation.id)}>
                    <p className="truncate text-[11.5px] text-ink-200">{conversation.title}</p>
                    <p className="text-[9.5px] text-ink-500">{dt(conversation.updated_at)}</p>
                  </button>
                  <button
                    className="text-ink-600 opacity-0 transition-opacity hover:text-crit group-hover:opacity-100"
                    onClick={() => removeConversation(conversation.id)}
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {!(history.data ?? []).length && (
                <p className="px-3 py-6 text-center text-[11px] text-ink-500">No conversations yet.</p>
              )}
            </div>
          </Panel>

          <Notice tone="info" title="Guardrails">
            SHAKTHI AI is read-only. It cannot query arbitrary SQL, execute tools or issue furnace commands. Every
            answer must distinguish measured, predicted and simulated values.
          </Notice>
        </div>
      </div>
    </div>
  );
}

function ContextPreview() {
  const context = useFetch<{ context: Record<string, unknown>; system_prompt: string }>("/ai/context");
  return (
    <Panel title="Context sent to the model" subtitle="Read-only plant snapshot">
      {context.data ? (
        <pre className="max-h-[260px] overflow-auto rounded-lg border border-base-700 bg-base-950/80 p-2.5 text-[9.5px] leading-relaxed text-ink-400">
          {JSON.stringify(context.data.context, null, 1)}
        </pre>
      ) : (
        <p className="py-4 text-center text-[11px] text-ink-500">Loading context…</p>
      )}
    </Panel>
  );
}

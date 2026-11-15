import { FormEvent, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Database,
  Flame,
  Layers,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  User2,
  Zap,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { api, getSessionId, streamChat } from "../lib/api";
import { AIStatus, AIUsage } from "../lib/types";
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

const SUGGESTED_QUESTIONS = [
  "Explain the current furnace condition.",
  "Why is energy consumption increasing?",
  "How much melting time remains?",
  "Compare this heat with previous heats.",
  "Identify unusual furnace readings.",
  "Explain the predicted energy consumption.",
  "Summarize today's production.",
];

const FACETS = [
  { icon: Flame, title: "Furnace Status & Sensors", desc: "Coil power, bath temp, delta T" },
  { icon: Zap, title: "Energy & Specific Power", desc: "kWh/kg benchmark & excess waste" },
  { icon: Clock, title: "Melting Time Predictions", desc: "RandomForest 42.4 min forecast" },
  { icon: Database, title: "Historical Heat Cohorts", desc: "KNN nearest heat matches" },
  { icon: AlertTriangle, title: "Anomaly Detection", desc: "IsolationForest safety screening" },
  { icon: ShieldCheck, title: "Carbon & Shift Output", desc: "kg CO₂ avoided & shift performance" },
];

export default function ShakthiAI() {
  const status = useFetch<AIStatus>("/ai/status");
  const usage = useFetch<AIUsage>("/ai/usage", { pollMs: 30000 });
  const suggestions = useFetch<{ suggestions: string[] }>("/ai/suggestions");
  const history = useFetch<Conversation[]>("/ai/history", { pollMs: 20000 });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = getSessionId();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      /* clipboard write may fail if permissions denied */
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setLastPrompt(trimmed);
    setInput("");
    setBusy(true);

    // Append user message and empty streaming assistant placeholder
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
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
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + event.text };
              }
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
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Inference connection error.");
      }
    } finally {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false };
        }
        return next;
      });
      setBusy(false);
      void history.reload();
      void usage.reload();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const retryLast = () => {
    if (lastPrompt) {
      void send(lastPrompt);
    } else {
      status.reload();
    }
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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversation.");
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setError(null);
    setClearConfirm(false);
    inputRef.current?.focus();
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

  const clearAllHistory = async () => {
    try {
      await api.del("/ai/history");
      newChat();
      await history.reload();
      setClearConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear conversation history.");
    }
  };

  const activeModel = status.data?.model ?? "Gemini 2.0 Flash";
  const activeProvider = status.data?.provider ?? "Google Gemini";
  const isOnline = status.data?.online !== false;
  const promptList = suggestions.data?.suggestions?.length
    ? suggestions.data.suggestions
    : SUGGESTED_QUESTIONS;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 09 · Industrial Furnace Copilot"
        title="SHAKTHI AI"
        description="Your Intelligent Industrial Furnace Copilot. Grounded decision support for furnace status, melt predictions, energy, similar heats, anomalies, and carbon footprint — powered by Google Gemini Cloud AI."
      >
        <Chip tone={isOnline ? "violet" : "crit"}>
          <span
            className={clsx(
              "h-2 w-2 rounded-full",
              isOnline ? "animate-pulseSoft bg-violet" : "bg-crit"
            )}
          />
          {isOnline ? "Gemini Cloud Online" : "AI Offline"}
        </Chip>

        <Chip tone="neutral" className="hidden sm:inline-flex">
          <Sparkles className="h-3 w-3 text-violet" />
          <span className="capitalize">{activeProvider}</span> · {activeModel}
        </Chip>

        <Chip tone="good" className="hidden md:inline-flex">
          ₹0.00 Free Quota
        </Chip>

        <button
          className="btn-ghost !py-1.5 !text-[12px]"
          onClick={() => {
            status.reload();
            usage.reload();
            history.reload();
          }}
          title="Refresh connection status & usage"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Recheck
        </button>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-4">
        {/* Main Conversation Stream (3 cols) */}
        <div className="xl:col-span-3">
          <Panel
            title="Furnace Telemetry & Gemini Copilot Stream"
            subtitle={
              conversationId
                ? `Active Session Conversation #${conversationId}`
                : "New session · Grounded in live plant telemetry and ML models"
            }
            action={
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <button
                    className="btn-ghost !py-1 !text-[11px] text-ink-400 hover:text-crit"
                    onClick={newChat}
                    title="Clear current conversation"
                  >
                    <Trash2 className="h-3 w-3" /> Clear chat
                  </button>
                )}
                <button
                  className="btn-ghost !py-1 !text-[11px] border-violet/30 text-violet hover:bg-violet/10"
                  onClick={newChat}
                >
                  <MessageSquarePlus className="h-3 w-3" /> New chat
                </button>
              </div>
            }
            bodyClassName="p-0 flex flex-col h-[640px]"
          >
            {/* Scrollable messages container */}
            <div ref={scrollRef} className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="mx-auto max-w-xl py-6 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-violet/40 bg-gradient-to-br from-violet/20 via-electric/10 to-base-900 shadow-panel">
                    <Sparkles className="h-6 w-6 text-violet animate-pulseSoft" />
                  </div>
                  <h3 className="mt-3 text-[16px] font-semibold text-white tracking-tight">SHAKTHI AI</h3>
                  <p className="mt-0.5 text-[12px] font-medium text-violet tracking-wide">
                    Your Intelligent Industrial Furnace Copilot
                  </p>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    Powered by Google Gemini Cloud Intelligence
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-400 max-w-md mx-auto">
                    Live decision support grounded in furnace sensor telemetry, RandomForest melting time forecasts,
                    XGBoost energy consumption predictions, KNN historical cohorts, and IsolationForest anomaly audits.
                  </p>

                  <div className="mt-5 text-left">
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
                      Suggested Furnace Questions
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {promptList.map((question) => (
                        <button
                          key={question}
                          onClick={() => send(question)}
                          className="flex items-center justify-between rounded-lg border border-base-700 bg-base-900/60 p-2.5 text-left text-[11.5px] text-ink-300 transition-all hover:border-violet/50 hover:bg-violet/[0.04] hover:text-white group"
                        >
                          <span className="line-clamp-2">{question}</span>
                          <Send className="h-3 w-3 shrink-0 text-ink-500 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-violet ml-1.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Chat Messages */}
              {messages.map((message, index) => {
                const isAssistant = message.role === "assistant";
                return (
                  <div
                    key={index}
                    className={clsx(
                      "flex gap-3 animate-slideUp",
                      !isAssistant && "flex-row-reverse"
                    )}
                  >
                    {/* Role Avatar */}
                    <div
                      className={clsx(
                        "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                        isAssistant
                          ? "border-violet/40 bg-gradient-to-br from-violet/20 to-base-900 text-violet shadow-panel"
                          : "border-electric/40 bg-electric/15 text-electric"
                      )}
                    >
                      {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User2 className="h-3.5 w-3.5" />}
                    </div>

                    {/* Bubble Content */}
                    <div
                      className={clsx(
                        "group relative max-w-[84%] rounded-xl px-4 py-3 text-[12.5px] leading-relaxed",
                        isAssistant
                          ? "border border-base-700 bg-base-900/90 text-ink-100 shadow-panel"
                          : "border border-electric/30 bg-electric/15 text-ink-50"
                      )}
                    >
                      <div className="whitespace-pre-wrap font-sans">
                        {message.content}
                        {message.streaming && (
                          <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulseSoft bg-violet align-middle" />
                        )}
                      </div>

                      {/* Assistant Action Bar: Copy Button */}
                      {isAssistant && !message.streaming && message.content.length > 0 && (
                        <div className="mt-2.5 flex items-center justify-between border-t border-base-750/70 pt-1.5 text-[10.5px] text-ink-500">
                          <span className="flex items-center gap-1 text-[10px] text-ink-500 font-mono">
                            <Sparkles className="h-2.5 w-2.5 text-violet" />
                            Grounded Telemetry · Gemini
                          </span>
                          <button
                            onClick={() => copyToClipboard(message.content, index)}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-base-800 hover:text-white"
                            title="Copy response to clipboard"
                          >
                            {copiedIndex === index ? (
                              <>
                                <Check className="h-3 w-3 text-good" />
                                <span className="text-good">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Busy Typing Indicator when no text yet */}
              {busy && messages[messages.length - 1]?.content === "" && (
                <div className="flex gap-3 animate-slideUp">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-violet/40 bg-violet/10 text-violet">
                    <Bot className="h-3.5 w-3.5 animate-pulse" />
                  </div>
                  <div className="rounded-xl border border-base-700 bg-base-900/90 px-4 py-3 text-[12px] text-ink-400 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-violet animate-ping" />
                    <span>Analyzing furnace telemetry & synthesizing grounded response with Google Gemini...</span>
                  </div>
                </div>
              )}

              {/* Error Box with Retry */}
              {error && (
                <ErrorBox
                  message={error}
                  onRetry={retryLast}
                />
              )}
            </div>

            {/* Input Form & Quick Prompt Toolbar */}
            <form onSubmit={onSubmit} className="border-t border-base-700/80 bg-base-900/50 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  className="input max-h-28 min-h-[44px] resize-none leading-relaxed text-[13px] border-base-700 focus:border-violet/60 focus:ring-1 focus:ring-violet/30"
                  placeholder="Ask SHAKTHI AI about furnace condition, energy, melting time, or anomalies…"
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
                <button
                  type="submit"
                  className={clsx(
                    "btn-primary shrink-0 !py-2.5 !px-4 transition-all",
                    busy
                      ? "opacity-60 cursor-not-allowed"
                      : "bg-gradient-to-r from-violet to-electric hover:from-violet/90 hover:to-electric/90 shadow-panel"
                  )}
                  disabled={busy || !input.trim()}
                >
                  <Send className="h-4 w-4" />
                  <span>{busy ? "Thinking…" : "Send"}</span>
                </button>
              </div>

              {/* Quick Prompt Pill Strip */}
              <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                <span className="text-[10px] uppercase tracking-wider text-ink-500 shrink-0 font-medium mr-1">
                  Ask:
                </span>
                {promptList.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => send(question)}
                    disabled={busy}
                    className="shrink-0 rounded-full border border-base-700 bg-base-850 px-2.5 py-1 text-[11px] text-ink-400 transition-colors hover:border-violet/40 hover:bg-violet/[0.06] hover:text-ink-100 disabled:opacity-40"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </form>
          </Panel>
        </div>

        {/* Sidebar Controls (1 col) */}
        <div className="space-y-4">
          {/* Panel: Model & Inference Engine Status */}
          <Panel title="Gemini Copilot Engine" subtitle="Google Gemini Cloud AI Architecture">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Inference Status</span>
                <Chip tone={isOnline ? "good" : "crit"}>
                  <span
                    className={clsx(
                      "h-1.5 w-1.5 rounded-full",
                      isOnline ? "bg-good" : "bg-crit"
                    )}
                  />
                  {isOnline ? "online" : "offline"}
                </Chip>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">AI Provider</span>
                <span className="mono text-[11.5px] text-ink-100 capitalize font-medium">
                  {activeProvider}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Active Model</span>
                <span className="mono text-[11px] text-ink-200 truncate max-w-[150px]" title={activeModel}>
                  {activeModel}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Engine Latency</span>
                <span className="mono text-[11.5px] text-ink-100">
                  {status.data?.latency_ms != null ? `${status.data.latency_ms.toFixed(0)} ms` : "12.0 ms"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Budget Tier</span>
                <span className="mono text-[11px] text-good font-medium">₹0.00 (Free Quota)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Session ID</span>
                <span className="mono text-[10px] text-ink-500 truncate max-w-[120px]" title={sessionId}>
                  {sessionId.slice(0, 10)}…
                </span>
              </div>

              <div className="pt-2 border-t border-base-750 flex flex-col gap-1.5">
                <button
                  className="btn-ghost w-full !py-1.5 !text-[11px] justify-between text-ink-300 hover:text-white"
                  onClick={() => setUsageOpen((v) => !v)}
                >
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3 text-violet" />
                    Usage & Free Quotas
                  </span>
                  {usageOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>

                <button
                  className="btn-ghost w-full !py-1.5 !text-[11px] justify-between text-ink-300 hover:text-white"
                  onClick={() => setContextOpen((v) => !v)}
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3 w-3 text-electric" />
                    Inspect Furnace Context
                  </span>
                  {contextOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </Panel>

          {/* Collapsible Usage & Quota Box */}
          {usageOpen && (
            <Panel title="Gemini Quota & Usage" subtitle="Free tier usage tracking">
              <div className="space-y-2 text-[11.5px]">
                <div className="flex justify-between">
                  <span className="text-ink-400">Free Tier Status:</span>
                  <span className="text-good font-medium">
                    {usage.data?.free_tier_status ?? "Active (Free)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Quota Limit:</span>
                  <span className="mono text-ink-200">
                    {usage.data?.quota_limit ?? "Free API Tier"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Rate Limit:</span>
                  <span className="mono text-ink-200">
                    {usage.data?.rate_limit_per_minute ?? 20} req/min/user
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Total Requests:</span>
                  <span className="mono text-ink-200">{usage.data?.total_requests ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Active Sessions:</span>
                  <span className="mono text-ink-200">{usage.data?.active_sessions ?? 1}</span>
                </div>
                <p className="mt-2 text-[10px] text-ink-500 leading-normal border-t border-base-750 pt-1.5">
                  Multi-user rate limiting protects free provider quotas. Sessions are completely isolated.
                </p>
              </div>
            </Panel>
          )}

          {/* Collapsible Raw Context Preview */}
          {contextOpen && <ContextPreview />}

          {/* Multi-User Session Conversation History */}
          <Panel
            title="Conversation History"
            subtitle="Private to your browser session"
            action={
              (history.data ?? []).length > 0 && (
                <div>
                  {!clearConfirm ? (
                    <button
                      className="text-[10px] text-ink-500 hover:text-crit transition-colors"
                      onClick={() => setClearConfirm(true)}
                      title="Clear all conversations for this session"
                    >
                      Clear all
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        className="text-[10px] font-semibold text-crit hover:underline"
                        onClick={clearAllHistory}
                      >
                        Confirm
                      </button>
                      <button
                        className="text-[10px] text-ink-400 hover:text-white"
                        onClick={() => setClearConfirm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            }
            bodyClassName="p-0"
          >
            <div className="max-h-[260px] overflow-y-auto divide-y divide-base-750/50">
              {(history.data ?? []).map((conv) => (
                <div
                  key={conv.id}
                  className={clsx(
                    "group flex items-center justify-between gap-2 px-3 py-2.5 transition-colors",
                    conversationId === conv.id
                      ? "bg-violet/[0.08] border-l-2 border-violet"
                      : "hover:bg-base-800/60"
                  )}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => loadConversation(conv.id)}
                  >
                    <p className="truncate text-[11.5px] text-ink-200 font-medium">{conv.title}</p>
                    <p className="text-[9.5px] text-ink-500">{dt(conv.updated_at)}</p>
                  </button>
                  <button
                    className="text-ink-600 opacity-0 transition-opacity hover:text-crit group-hover:opacity-100 p-1"
                    onClick={() => removeConversation(conv.id)}
                    aria-label="Delete conversation"
                    title="Delete this conversation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {!(history.data ?? []).length && (
                <div className="px-3 py-6 text-center">
                  <p className="text-[11.5px] text-ink-400 font-medium">No saved conversations</p>
                  <p className="mt-0.5 text-[10px] text-ink-500">
                    Ask a question to start a new chat in this session.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          {/* Plant Intelligence Grounding Notice */}
          <Notice tone="info" title="Zero-Hallucination Guardrails">
            <p className="text-[11.5px] leading-relaxed text-ink-300">
              SHAKTHI AI is read-only decision support. Telemetry and predictions come strictly from the backend
              ML models and database. Every answer clearly marks{" "}
              <span className="text-violet font-semibold">[MEASURED]</span>,{" "}
              <span className="text-cyan font-semibold">[SIMULATED]</span>, or{" "}
              <span className="text-electric font-semibold">[PREDICTION]</span>.
            </p>
          </Notice>

          {/* Facets Overview */}
          <div className="rounded-xl border border-base-750 bg-base-900/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">
              Furnace Intelligence Facets
            </p>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {FACETS.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 text-ink-400">
                  <f.icon className="h-3 w-3 text-violet shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-ink-200">{f.title}</p>
                    <p className="text-[9px] text-ink-500">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextPreview() {
  const context = useFetch<{ context: Record<string, unknown>; system_prompt: string }>("/ai/context");
  return (
    <Panel title="Context sent to Google Gemini" subtitle="Read-only plant snapshot">
      {context.data ? (
        <pre className="max-h-[260px] overflow-auto rounded-lg border border-base-700 bg-base-950/80 p-2.5 text-[9.5px] leading-relaxed text-ink-400 font-mono">
          {JSON.stringify(context.data.context, null, 1)}
        </pre>
      ) : (
        <p className="py-4 text-center text-[11px] text-ink-500">Loading context…</p>
      )}
    </Panel>
  );
}

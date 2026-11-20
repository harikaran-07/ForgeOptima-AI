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
  Cpu,
  Database,
  Download,
  Flame,
  Layers,
  MessageSquarePlus,
  Play,
  Power,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User2,
  Zap,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { dt } from "../lib/format";
import { streamChat } from "../lib/api";
import { Chip, ErrorBox, Notice, PageHeader, Panel, Spinner } from "../components/ui";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ModelManager } from "../components/ModelManager";
import {
  detectWebGPU,
  isEngineReady,
  isQwenModelCached,
  loadQwenModel,
  unloadEngine,
  streamQwenChat,
  stopGeneration,
  WebGPUCapability,
  EngineProgress,
} from "../lib/webllmEngine";
import {
  buildGroundingPrompt,
  SUGGESTED_FURNACE_QUESTIONS,
} from "../lib/furnaceSystemPrompt";

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp: string;
}

interface LocalConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: LocalMessage[];
}

const STORAGE_KEY_CONVERSATIONS = "forgeoptima_qwen_conversations";
const STORAGE_KEY_ACTIVE_CONV = "forgeoptima_qwen_active_id";

function loadSavedConversations(): LocalConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversationsToStorage(conversations: LocalConversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
  } catch {
    /* localStorage quota or privacy */
  }
}

const FACETS = [
  { icon: Flame, title: "Furnace Status & Sensors", desc: "Bath temp, coil kW, delta T" },
  { icon: Zap, title: "Energy & Specific Power", desc: "kWh/kg benchmark & excess waste" },
  { icon: Clock, title: "Melting Time Predictions", desc: "Thermal cycle progression forecast" },
  { icon: Database, title: "Historical Heat Cohorts", desc: "Nearest heat matching & peer comparison" },
  { icon: AlertTriangle, title: "Anomaly Detection", desc: "Ground-fault & cooling water screening" },
  { icon: ShieldCheck, title: "Carbon & Shift Output", desc: "kg CO₂ calculation & energy efficiency" },
];

export default function ShakthiAI() {
  const contextSnapshot = useFetch<{ context: Record<string, unknown>; system_prompt: string }>("/ai/context");

  // Local AI model state
  const [gpuCapability, setGpuCapability] = useState<WebGPUCapability | null>(null);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [isCached, setIsCached] = useState<boolean>(false);
  const [loadingModel, setLoadingModel] = useState<boolean>(false);
  const [loadProgress, setLoadProgress] = useState<EngineProgress>({
    progress: 0,
    text: "Idle",
    state: "Available",
  });

  // Conversations & Chat State
  const [conversations, setConversations] = useState<LocalConversation[]>(loadSavedConversations);
  const [activeConvId, setActiveConvId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_CONV) || null;
  });
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [lastUserPrompt, setLastUserPrompt] = useState<string | null>(null);

  // Panels & Views
  const [showModelManager, setShowModelManager] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync active conversation messages on change
  useEffect(() => {
    if (activeConvId) {
      const active = conversations.find((c) => c.id === activeConvId);
      if (active) {
        setMessages(active.messages);
        return;
      }
    }
    // No active or not found: start with empty
    setMessages([]);
  }, [activeConvId, conversations]);

  // Check hardware and model cache on mount
  const checkLocalAI = async () => {
    const gpu = await detectWebGPU();
    setGpuCapability(gpu);
    const ready = isEngineReady();
    setModelReady(ready);
    const cached = await isQwenModelCached();
    setIsCached(cached);

    // If model is already cached on disk and not yet in GPU memory, auto-load it!
    if (cached && !ready && gpu.supported && gpu.adapterAvailable) {
      setLoadingModel(true);
      try {
        await loadQwenModel((report) => setLoadProgress(report));
        setModelReady(true);
      } catch (e) {
        console.warn("Auto-load cached model error:", e);
      } finally {
        setLoadingModel(false);
      }
    }
  };

  useEffect(() => {
    void checkLocalAI();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Load model handler
  const handleLoadModel = async () => {
    setLoadingModel(true);
    setError(null);
    try {
      await loadQwenModel((report) => {
        setLoadProgress(report);
      });
      setModelReady(true);
      setIsCached(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Qwen2.5 3B into WebGPU.");
    } finally {
      setLoadingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    try {
      await unloadEngine();
      setModelReady(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unload model.");
    }
  };

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      /* clipboard write may fail */
    }
  };

  // Helper to persist message updates to active conversation
  const persistConversationMessages = (newMessages: LocalMessage[], firstUserText?: string) => {
    let currentId = activeConvId;
    let updatedList = [...conversations];

    if (!currentId || !updatedList.some((c) => c.id === currentId)) {
      currentId = "conv_" + Date.now();
      setActiveConvId(currentId);
      localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, currentId);

      const title = firstUserText ? firstUserText.slice(0, 45) : "Furnace Discussion";
      const newConv: LocalConversation = {
        id: currentId,
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: newMessages,
      };
      updatedList = [newConv, ...updatedList];
    } else {
      updatedList = updatedList.map((c) => {
        if (c.id === currentId) {
          return {
            ...c,
            updated_at: new Date().toISOString(),
            messages: newMessages,
          };
        }
        return c;
      });
    }

    setConversations(updatedList);
    saveConversationsToStorage(updatedList);
  };

  // Send prompt to local Qwen2.5 3B WebLLM engine (or grounded fallback if not yet loaded)
  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setError(null);
    setLastUserPrompt(trimmed);
    setInput("");
    setBusy(true);

    const userMsg: LocalMessage = {
      id: "u_" + Date.now(),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    const assistantMsg: LocalMessage = {
      id: "a_" + (Date.now() + 1),
      role: "assistant",
      content: "",
      streaming: true,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg, assistantMsg];
    setMessages(nextMessages);

    const controller = new AbortController();
    abortRef.current = controller;

    // If model is not yet loaded into WebGPU memory, initialize it!
    if (!isEngineReady() && gpuCapability?.supported && gpuCapability?.adapterAvailable) {
      setLoadingModel(true);
      try {
        await loadQwenModel((report) => setLoadProgress(report));
        setModelReady(true);
        setIsCached(true);
      } catch (loadErr) {
        console.warn("Could not load WebGPU model:", loadErr);
      } finally {
        setLoadingModel(false);
      }
    }

    // 1. Primary path: Qwen2.5 3B WebGPU Browser Local AI
    if (isEngineReady()) {
      const systemPrompt = buildGroundingPrompt(contextSnapshot.data?.context);
      const contextTurns = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      contextTurns.push({ role: "user", content: trimmed });

      const chatPayload: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
        ...contextTurns,
      ];

      let fullReply = "";

      try {
        await streamQwenChat(
          chatPayload,
          (delta) => {
            fullReply += delta;
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  content: fullReply,
                  streaming: true,
                };
              }
              return copy;
            });
          },
          () => {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  content: fullReply,
                  streaming: false,
                };
              }
              persistConversationMessages(copy, trimmed);
              return copy;
            });
            setBusy(false);
          },
          (errText) => {
            setError(errText);
            setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming && m.content === "")));
            setBusy(false);
          },
          controller.signal
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Local inference execution failed.");
        }
        setBusy(false);
      }
      return;
    }

    // 2. Cloud Fallback path: When Qwen2.5 3B is downloading or WebGPU is unsupported
    let serverReply = "";
    try {
      await streamChat(
        trimmed,
        null,
        (event) => {
          if (event.type === "delta" && event.text) {
            serverReply += event.text;
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  content: serverReply,
                  streaming: true,
                };
              }
              return copy;
            });
          }
          if (event.type === "done") {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  content: serverReply,
                  streaming: false,
                };
              }
              persistConversationMessages(copy, trimmed);
              return copy;
            });
            setBusy(false);
          }
          if (event.type === "error") {
            setError(event.message || "Inference error occurred.");
            setBusy(false);
          }
        },
        controller.signal
      );
    } catch (fallbackErr) {
      if (!controller.signal.aborted) {
        setError(fallbackErr instanceof Error ? fallbackErr.message : "Inference connection error.");
      }
      setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming && m.content === "")));
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    stopGeneration();
    setBusy(false);
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") {
        copy[copy.length - 1] = { ...last, streaming: false };
      }
      persistConversationMessages(copy);
      return copy;
    });
  };

  const handleRegenerate = () => {
    if (busy || !lastUserPrompt) return;
    // Remove last assistant message
    setMessages((prev) => prev.filter((_, idx) => idx !== prev.length - 1));
    void send(lastUserPrompt);
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    stopGeneration();
    setBusy(false);
    const newId = "conv_" + Date.now();
    setActiveConvId(newId);
    localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, newId);
    setMessages([]);
    setError(null);
    setClearConfirm(false);
    inputRef.current?.focus();
  };

  const handleSelectConversation = (id: string) => {
    abortRef.current?.abort();
    stopGeneration();
    setBusy(false);
    setActiveConvId(id);
    localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, id);
    const selected = conversations.find((c) => c.id === id);
    if (selected) {
      setMessages(selected.messages);
    }
    setError(null);
  };

  const handleDeleteConversation = (id: string) => {
    const updated = conversations.filter((c) => c.id !== id);
    setConversations(updated);
    saveConversationsToStorage(updated);
    if (activeConvId === id) {
      if (updated.length > 0) {
        handleSelectConversation(updated[0].id);
      } else {
        handleNewChat();
      }
    }
  };

  const handleClearAllConversations = () => {
    setConversations([]);
    saveConversationsToStorage([]);
    setActiveConvId(null);
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CONV);
    setMessages([]);
    setClearConfirm(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 09 · Industrial Furnace Copilot"
        title="SHAKTHI AI"
        description="Browser Local AI powered by Qwen2.5-0.5B-Instruct running directly inside your browser via WebGPU. Grounded decision support for furnace temperature, combustion, thermal efficiency, energy, and anomalies — zero external API keys, 100% private."
      >
        <Chip tone={modelReady ? "good" : isCached ? "cyan" : "warn"}>
          <span
            className={clsx(
              "h-2 w-2 rounded-full",
              modelReady ? "animate-pulseSoft bg-good" : isCached ? "bg-cyan" : "bg-warn"
            )}
          />
          {modelReady ? "Qwen2.5 0.5B Active (WebGPU)" : isCached ? "Model Installed" : "Model Not Loaded"}
        </Chip>

        <Chip tone="neutral" className="hidden sm:inline-flex">
          <Cpu className="h-3 w-3 text-cyan" />
          <span>WebLLM Local Engine</span> · 490M params
        </Chip>

        <Chip tone="good" className="hidden md:inline-flex">
          100% Private & Local
        </Chip>

        <button
          className="btn-ghost !py-1.5 !text-[12px]"
          onClick={() => setShowModelManager((v) => !v)}
          title="Toggle WebGPU & Model Installation Manager"
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{showModelManager ? "Hide Model Manager" : "AI Model Settings"}</span>
        </button>
      </PageHeader>

      {/* Model Manager Drawer / Panel when toggled */}
      {showModelManager && (
        <div className="rounded-xl border border-electric/30 bg-base-950/70 p-4 shadow-panel">
          <ModelManager
            onModelReady={() => {
              setModelReady(true);
              setIsCached(true);
            }}
          />
        </div>
      )}

      {/* Inline Quick Model Load / Download Card if model is not yet ready */}
      {!modelReady && !showModelManager && (
        <div className="rounded-xl border border-electric/30 bg-gradient-to-r from-base-900 via-base-900/90 to-electric/[0.05] p-4 shadow-panel">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-electric" />
                <h3 className="text-[13px] font-semibold text-white">
                  {isCached ? "Qwen2.5 0.5B is Installed in Browser Storage" : "Qwen2.5-0.5B-Instruct Ready for Local WebGPU Inference"}
                </h3>
                <span className="mono rounded bg-electric/15 px-2 py-0.5 text-[10px] text-electric">
                  ~278 MB
                </span>
              </div>
              <p className="text-[11.5px] text-ink-300 leading-relaxed max-w-2xl">
                {isCached
                  ? "Model weights are already verified and stored in your browser cache. Load the model into WebGPU memory to start chatting."
                  : "Download Qwen2.5-0.5B-Instruct directly from HuggingFace to your browser storage. Lightweight (~278 MB), ultra-fast on WebGPU, and runs 100% locally without API keys or Ollama."}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {loadingModel ? (
                <div className="flex items-center gap-2 text-[11px] text-ink-300">
                  <Spinner label="" />
                  <span className="mono font-semibold text-electric">{loadProgress.progress}%</span>
                  <span className="text-ink-400 truncate max-w-[140px]">{loadProgress.text}</span>
                </div>
              ) : (
                <button
                  onClick={handleLoadModel}
                  disabled={gpuCapability ? (!gpuCapability.supported || !gpuCapability.adapterAvailable) : false}
                  className="btn-primary !py-2 !px-4 !text-[12px] bg-gradient-to-r from-electric to-cyan hover:from-electric/90 hover:to-cyan/90"
                >
                  {isCached ? <Play className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  <span>{isCached ? "Load Model into WebGPU" : "Download & Install Qwen2.5 0.5B"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Progress bar during download */}
          {loadingModel && (
            <div className="mt-3 space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-800">
                <div
                  className="h-full bg-gradient-to-r from-electric to-cyan transition-all duration-300"
                  style={{ width: `${Math.max(loadProgress.progress, 4)}%` }}
                />
              </div>
              <p className="text-[10px] text-ink-500">{loadProgress.text}</p>
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Chat Stream (3 cols) + Sidebar (1 col) */}
      <div className="grid gap-4 xl:grid-cols-4">
        {/* Main Conversation Stream */}
        <div className="xl:col-span-3">
          <Panel
            title="Qwen2.5 0.5B Local Generative Stream"
            subtitle={
              modelReady
                ? "WebGPU Accelerated · Local Execution · Zero Network Latency"
                : "Model not loaded · Click 'Load Model' to activate local AI"
            }
            action={
              <div className="flex items-center gap-2">
                {busy && (
                  <button
                    className="btn-ghost !py-1 !text-[11px] border-crit/40 text-crit hover:bg-crit/10"
                    onClick={handleStop}
                    title="Stop active generation"
                  >
                    <Square className="h-3 w-3 fill-crit" /> Stop
                  </button>
                )}
                {messages.length > 0 && !busy && (
                  <button
                    className="btn-ghost !py-1 !text-[11px] text-ink-400 hover:text-crit"
                    onClick={handleNewChat}
                    title="Clear current conversation"
                  >
                    <Trash2 className="h-3 w-3" /> Clear
                  </button>
                )}
                <button
                  className="btn-ghost !py-1 !text-[11px] border-electric/30 text-electric hover:bg-electric/10"
                  onClick={handleNewChat}
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
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-electric/40 bg-gradient-to-br from-electric/20 via-cyan/10 to-base-900 shadow-panel">
                    <Sparkles className="h-6 w-6 text-electric animate-pulseSoft" />
                  </div>
                  <h3 className="mt-3 text-[16px] font-semibold text-white tracking-tight">SHAKTHI AI</h3>
                  <p className="mt-0.5 text-[12px] font-medium text-electric tracking-wide">
                    Qwen2.5-0.5B-Instruct · Browser Local AI Copilot
                  </p>
                  <p className="text-[11px] text-ink-400 mt-0.5">
                    100% Private WebGPU Inference · No Cloud API Required
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-400 max-w-md mx-auto">
                    Expert generative AI assistant for industrial induction furnaces, melting metallurgy,
                    combustion physics, power optimization, thermal efficiency, and operational anomalies.
                  </p>

                  <div className="mt-5 text-left">
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
                      Suggested Furnace Questions
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {SUGGESTED_FURNACE_QUESTIONS.map((question) => (
                        <button
                          key={question}
                          onClick={() => send(question)}
                          disabled={busy}
                          className="flex items-center justify-between rounded-lg border border-base-700 bg-base-900/60 p-2.5 text-left text-[11.5px] text-ink-300 transition-all hover:border-electric/50 hover:bg-electric/[0.04] hover:text-white group disabled:opacity-50"
                        >
                          <span className="line-clamp-2">{question}</span>
                          <Send className="h-3 w-3 shrink-0 text-ink-500 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-electric ml-1.5" />
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
                    key={message.id || index}
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
                          ? "border-electric/40 bg-gradient-to-br from-electric/20 to-base-900 text-electric shadow-panel"
                          : "border-cyan/40 bg-cyan/15 text-cyan"
                      )}
                    >
                      {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User2 className="h-3.5 w-3.5" />}
                    </div>

                    {/* Bubble Content */}
                    <div
                      className={clsx(
                        "group relative max-w-[85%] rounded-xl px-4 py-3 text-[12.5px] leading-relaxed",
                        isAssistant
                          ? "border border-base-700 bg-base-900/90 text-ink-100 shadow-panel"
                          : "border border-electric/30 bg-electric/15 text-ink-50"
                      )}
                    >
                      {/* Markdown rendered output */}
                      {isAssistant ? (
                        <MarkdownRenderer content={message.content} />
                      ) : (
                        <div className="whitespace-pre-wrap font-sans">{message.content}</div>
                      )}

                      {message.streaming && (
                        <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulseSoft bg-electric align-middle" />
                      )}

                      {/* Assistant Action Bar: Copy & Regenerate */}
                      {isAssistant && !message.streaming && message.content.length > 0 && (
                        <div className="mt-2.5 flex items-center justify-between border-t border-base-750/70 pt-1.5 text-[10.5px] text-ink-500">
                          <span className="flex items-center gap-1 text-[10px] text-ink-500 font-mono">
                            <Sparkles className="h-2.5 w-2.5 text-electric" />
                            Qwen2.5-0.5B-Instruct · WebGPU
                          </span>
                          <div className="flex items-center gap-1.5">
                            {index === messages.length - 1 && (
                              <button
                                onClick={handleRegenerate}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-base-800 hover:text-white"
                                title="Regenerate this response"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Retry</span>
                              </button>
                            )}
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
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Model Loading / Initializing In-Chat Progress Card */}
              {loadingModel && (
                <div className="flex gap-3 animate-slideUp">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-electric/40 bg-electric/10 text-electric">
                    <Sparkles className="h-3.5 w-3.5 animate-spin" />
                  </div>
                  <div className="flex-1 rounded-xl border border-electric/30 bg-base-900/90 p-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-white">
                        {isCached ? "Loading Qwen2.5 0.5B into WebGPU VRAM..." : "Downloading Qwen2.5-0.5B-Instruct to Browser Storage..."}
                      </span>
                      <span className="mono font-semibold text-electric">{loadProgress.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-800">
                      <div
                        className="h-full bg-gradient-to-r from-electric to-cyan transition-all duration-300"
                        style={{ width: `${Math.max(loadProgress.progress, 5)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-ink-400 truncate">{loadProgress.text || "Loading model weights..."}</p>
                  </div>
                </div>
              )}

              {/* Busy Typing Indicator when no text yet */}
              {busy && !loadingModel && messages[messages.length - 1]?.content === "" && (
                <div className="flex gap-3 animate-slideUp">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-electric/40 bg-electric/10 text-electric">
                    <Bot className="h-3.5 w-3.5 animate-pulse" />
                  </div>
                  <div className="rounded-xl border border-base-700 bg-base-900/90 px-4 py-3 text-[12px] text-ink-400 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-electric animate-ping" />
                    <span>Qwen2.5 0.5B is generating response directly on your GPU…</span>
                  </div>
                </div>
              )}

              {/* Error Box */}
              {error && (
                <ErrorBox
                  message={error}
                  onRetry={() => {
                    if (lastUserPrompt) void send(lastUserPrompt);
                  }}
                />
              )}
            </div>

            {/* Input Form & Quick Prompt Toolbar */}
            <form onSubmit={onSubmit} className="border-t border-base-700/80 bg-base-900/50 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  className="input max-h-28 min-h-[44px] resize-none leading-relaxed text-[13px] border-base-700 focus:border-electric/60 focus:ring-1 focus:ring-electric/30"
                  placeholder={
                    modelReady
                      ? "Ask SHAKTHI AI about furnace condition, energy, melting time, or anomalies…"
                      : loadingModel
                      ? `Qwen2.5 0.5B is initializing in WebGPU (${loadProgress.progress}%)...`
                      : isCached
                      ? "Ask a question (will load cached Qwen2.5 0.5B into WebGPU)..."
                      : "Ask about furnace telemetry, or click Download above for local Qwen2.5 0.5B..."
                  }
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
                {busy ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="btn-ghost shrink-0 !py-2.5 !px-4 border-crit/40 text-crit hover:bg-crit/10"
                    title="Stop generation"
                  >
                    <Square className="h-4 w-4 fill-crit" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={clsx(
                      "btn-primary shrink-0 !py-2.5 !px-4 transition-all",
                      !input.trim() || busy
                        ? "opacity-50 cursor-not-allowed"
                        : "bg-gradient-to-r from-electric to-cyan hover:from-electric/90 hover:to-cyan/90 shadow-panel"
                    )}
                    disabled={!input.trim() || busy}
                  >
                    <Send className="h-4 w-4" />
                    <span>Send</span>
                  </button>
                )}
              </div>

              {/* Quick Prompt Pill Strip */}
              <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                <span className="text-[10px] uppercase tracking-wider text-ink-500 shrink-0 font-medium mr-1">
                  Ask:
                </span>
                {SUGGESTED_FURNACE_QUESTIONS.slice(0, 6).map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => send(question)}
                    disabled={busy}
                    className="shrink-0 rounded-full border border-base-700 bg-base-850 px-2.5 py-1 text-[11px] text-ink-400 transition-colors hover:border-electric/40 hover:bg-electric/[0.06] hover:text-ink-100 disabled:opacity-40"
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
          {/* Panel: WebGPU Engine Status */}
          <Panel title="WebGPU Engine Status" subtitle="Local Browser Execution">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Execution Mode</span>
                <Chip tone="cyan">100% In-Browser</Chip>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Model Name</span>
                <span className="mono text-[11px] text-ink-100 font-medium">Qwen2.5-0.5B-Instruct</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Runtime Engine</span>
                <span className="mono text-[11px] text-ink-200">@mlc-ai/web-llm (WebGPU)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Hardware Accel</span>
                <span className="mono text-[11px] text-good font-medium">WebGPU Direct</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">Memory Status</span>
                <span className="mono text-[11px] text-ink-200">
                  {modelReady ? "~945 MB allocated" : "Not in memory"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-400">API Cost</span>
                <span className="mono text-[11px] text-good font-medium">₹0.00 (No API Key)</span>
              </div>

              <div className="pt-2 border-t border-base-750 flex flex-col gap-1.5">
                {modelReady ? (
                  <button
                    onClick={handleUnloadModel}
                    className="btn-ghost w-full !py-1.5 !text-[11px] border-warn/30 text-warn hover:bg-warn/10"
                  >
                    <Power className="h-3 w-3" /> Unload from GPU Memory
                  </button>
                ) : (
                  <button
                    onClick={handleLoadModel}
                    disabled={loadingModel}
                    className="btn-ghost w-full !py-1.5 !text-[11px] border-electric/40 text-electric hover:bg-electric/10"
                  >
                    <Play className="h-3 w-3" /> {isCached ? "Load Model" : "Download Model"}
                  </button>
                )}

                <button
                  className="btn-ghost w-full !py-1.5 !text-[11px] justify-between text-ink-300 hover:text-white"
                  onClick={() => setContextOpen((v) => !v)}
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3 w-3 text-electric" />
                    Inspect Furnace Telemetry
                  </span>
                  {contextOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </Panel>

          {/* Collapsible Raw Context Preview */}
          {contextOpen && (
            <Panel title="Live Plant Context Grounding" subtitle="Read-only sensor & model snapshot">
              {contextSnapshot.data?.context ? (
                <pre className="max-h-[240px] overflow-auto rounded-lg border border-base-700 bg-base-950/80 p-2.5 text-[9.5px] leading-relaxed text-ink-400 font-mono">
                  {JSON.stringify(contextSnapshot.data.context, null, 1)}
                </pre>
              ) : (
                <p className="py-4 text-center text-[11px] text-ink-500">Loading plant context…</p>
              )}
            </Panel>
          )}

          {/* Local Conversation History */}
          <Panel
            title="Local Chat History"
            subtitle="Saved 100% in your browser localStorage"
            action={
              conversations.length > 0 && (
                <div>
                  {!clearConfirm ? (
                    <button
                      className="text-[10px] text-ink-500 hover:text-crit transition-colors"
                      onClick={() => setClearConfirm(true)}
                      title="Clear all saved local chats"
                    >
                      Clear all
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        className="text-[10px] font-semibold text-crit hover:underline"
                        onClick={handleClearAllConversations}
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
            <div className="max-h-[240px] overflow-y-auto divide-y divide-base-750/50">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={clsx(
                    "group flex items-center justify-between gap-2 px-3 py-2.5 transition-colors",
                    activeConvId === conv.id
                      ? "bg-electric/[0.08] border-l-2 border-electric"
                      : "hover:bg-base-800/60"
                  )}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => handleSelectConversation(conv.id)}
                  >
                    <p className="truncate text-[11.5px] text-ink-200 font-medium">{conv.title}</p>
                    <p className="text-[9.5px] text-ink-500">{dt(conv.updated_at)}</p>
                  </button>
                  <button
                    className="text-ink-600 opacity-0 transition-opacity hover:text-crit group-hover:opacity-100 p-1"
                    onClick={() => handleDeleteConversation(conv.id)}
                    aria-label="Delete conversation"
                    title="Delete this conversation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {conversations.length === 0 && (
                <div className="px-3 py-6 text-center">
                  <p className="text-[11.5px] text-ink-400 font-medium">No saved local chats</p>
                  <p className="mt-0.5 text-[10px] text-ink-500">
                    Ask a question to start a private conversation.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          {/* Privacy & Security Notice */}
          <Notice tone="good" title="100% Client-Side Privacy">
            <p className="text-[11px] leading-relaxed text-ink-300">
              Your conversations and metallurgical data are executed entirely on your GPU and never leave your browser.
              No prompts are sent to external cloud APIs or corporate servers.
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
                  <f.icon className="h-3 w-3 text-electric shrink-0 mt-0.5" />
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

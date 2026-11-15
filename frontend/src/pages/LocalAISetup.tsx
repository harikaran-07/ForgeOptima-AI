import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Info,
  Laptop,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  User2,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { Chip, ErrorBox, Notice, PageHeader, Panel } from "../components/ui";
import {
  LocalCheckResult,
  LocalConnectionState,
  RECOMMENDED_MODELS,
  getSavedLocalEndpoint,
  getSavedLocalModel,
  saveLocalEndpoint,
  saveLocalModel,
  streamLocalOllama,
  testLocalOllama,
} from "../lib/localOllama";

interface LocalMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
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

export default function LocalAISetup() {
  const [endpoint, setEndpoint] = useState(getSavedLocalEndpoint());
  const [selectedModel, setSelectedModel] = useState(getSavedLocalModel());
  const [checkResult, setCheckResult] = useState<LocalCheckResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [activeOsTab, setActiveOsTab] = useState<"windows" | "mac" | "linux">("windows");

  // Local Chat state
  const [messages, setMessages] = useState<LocalMessage[]>(() => {
    try {
      const saved = localStorage.getItem("forgeoptima_local_chat_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedMsgIndex, setCopiedMsgIndex] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch backend furnace context to inject into local model
  const contextFetch = useFetch<{ context: Record<string, unknown>; system_prompt: string }>("/ai/context");

  // Persist local messages in localStorage
  useEffect(() => {
    try {
      localStorage.setItem("forgeoptima_local_chat_history", JSON.stringify(messages));
    } catch {
      /* ignore quota errors */
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Initial connection test on mount
  useEffect(() => {
    void runConnectionTest();
  }, []);

  const runConnectionTest = async (overrideEndpoint?: string, overrideModel?: string) => {
    setTesting(true);
    const ep = overrideEndpoint || endpoint;
    const mdl = overrideModel || selectedModel;
    const res = await testLocalOllama(ep, mdl);
    setCheckResult(res);
    setTesting(false);
    saveLocalEndpoint(ep);
    saveLocalModel(mdl);
  };

  const copyCommand = async (cmd: string, id: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(id);
      setTimeout(() => setCopiedCmd(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const copyMessage = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgIndex(idx);
      setTimeout(() => setCopiedMsgIndex(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const sendLocalMessage = async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    if (checkResult?.state !== "READY") {
      setChatError("Please run connection test to verify your local Qwen model before chatting.");
      return;
    }

    setChatError(null);
    setInput("");
    setBusy(true);

    // Prepare system prompt with furnace context
    const ctxString = contextFetch.data?.context ? JSON.stringify(contextFetch.data.context, null, 1) : "";
    const systemContent = `${contextFetch.data?.system_prompt || "You are SHAKTHI AI, the industrial furnace copilot."}

=== CURRENT PLANT CONTEXT (STRICT FACT BASE) ===
${ctxString}
=== END CONTEXT ===

Distinguish measured, simulated, predicted, and estimated data. Answer clearly and concisely in industrial units.`;

    const chatPayload = [
      { role: "system", content: systemContent },
      ...messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: trimmed },
    ];

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamLocalOllama(
      checkResult.endpoint,
      selectedModel,
      chatPayload,
      (delta) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + delta };
          }
          return next;
        });
      },
      () => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, streaming: false };
          }
          return next;
        });
        setBusy(false);
      },
      (err) => {
        setChatError(err);
        setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming && !m.content)));
        setBusy(false);
      },
      controller.signal
    );
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setChatError(null);
    localStorage.removeItem("forgeoptima_local_chat_history");
  };

  const pullCmd = `ollama pull ${selectedModel}`;
  const runCmd = `ollama run ${selectedModel}`;

  const renderStateBadge = (state?: LocalConnectionState) => {
    switch (state) {
      case "READY":
        return (
          <Chip tone="good" className="!text-[12px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-good animate-pulse" />
            READY · LOCAL INFERENCE VERIFIED
          </Chip>
        );
      case "CONNECTED":
        return (
          <Chip tone="warn" className="!text-[12px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-warn animate-pulse" />
            CONNECTED · TESTING INFERENCE…
          </Chip>
        );
      case "MODEL NOT FOUND":
        return (
          <Chip tone="warn" className="!text-[12px] font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 text-warn" />
            MODEL NOT FOUND ({selectedModel})
          </Chip>
        );
      case "NOT RUNNING":
        return (
          <Chip tone="crit" className="!text-[12px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-crit" />
            NOT RUNNING · SERVICE UNREACHABLE
          </Chip>
        );
      case "NOT INSTALLED":
      default:
        return (
          <Chip tone="neutral" className="!text-[12px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-ink-400" />
            NOT INSTALLED / UNCONFIGURED
          </Chip>
        );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Private & On-Device Intelligence"
        title="RUN SHAKTHI AI LOCALLY"
        description="Download and run your own private industrial AI assistant using local AI technology. Zero cloud inference costs, complete operational privacy, and direct hardware acceleration on your workstation."
      >
        {renderStateBadge(checkResult?.state)}
        <button
          className="btn-ghost !py-1.5 !text-[12px] text-violet hover:bg-violet/10"
          onClick={() => runConnectionTest()}
          disabled={testing}
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", testing && "animate-spin")} />
          {testing ? "Testing…" : "Test Connection"}
        </button>
      </PageHeader>

      {/* Hero Quick Start Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-violet/30 bg-gradient-to-r from-violet/15 via-electric/10 to-base-900 p-6 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet/20 text-violet">
                <Laptop className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-[16px] font-semibold text-white tracking-tight">
                Private Local AI with Qwen 2.5 3B & Ollama
              </h2>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-300">
              Run <strong className="text-white">Qwen 2.5 3B</strong> directly inside Ollama on your Windows, Mac, or
              Linux machine. Your prompt tokens and plant inquiries remain completely private on your local hardware.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="btn-primary !bg-gradient-to-r from-violet to-electric hover:from-violet/90 hover:to-electric/90 shadow-panel"
            >
              <Download className="h-4 w-4" />
              <span>DOWNLOAD OLLAMA</span>
              <ExternalLink className="h-3 w-3 ml-0.5 opacity-70" />
            </a>

            <button
              onClick={() => copyCommand(pullCmd, "hero-pull")}
              className="btn-ghost !border-violet/40 text-ink-100 hover:text-white"
            >
              {copiedCmd === "hero-pull" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-good" />
                  <span className="text-good">Copied!</span>
                </>
              ) : (
                <>
                  <Terminal className="h-3.5 w-3.5 text-violet" />
                  <span>Copy Pull Command</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Step by Step Setup Grid */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Step 1: Install Ollama */}
        <Panel
          title="1. Download Ollama"
          subtitle="Open-source local LLM runner"
          action={<span className="mono text-[11px] font-semibold text-violet">Step 01</span>}
        >
          <div className="space-y-3.5 text-[12px]">
            <p className="text-ink-300">
              Ollama manages local model weights and serves a lightweight REST API on your machine.
            </p>

            {/* OS Tab Selector */}
            <div className="flex rounded-lg border border-base-700 bg-base-900 p-0.5">
              <button
                className={clsx(
                  "flex-1 rounded py-1 text-[11px] font-medium transition-colors",
                  activeOsTab === "windows" ? "bg-base-750 text-white shadow-sm" : "text-ink-400 hover:text-white"
                )}
                onClick={() => setActiveOsTab("windows")}
              >
                Windows
              </button>
              <button
                className={clsx(
                  "flex-1 rounded py-1 text-[11px] font-medium transition-colors",
                  activeOsTab === "mac" ? "bg-base-750 text-white shadow-sm" : "text-ink-400 hover:text-white"
                )}
                onClick={() => setActiveOsTab("mac")}
              >
                macOS
              </button>
              <button
                className={clsx(
                  "flex-1 rounded py-1 text-[11px] font-medium transition-colors",
                  activeOsTab === "linux" ? "bg-base-750 text-white shadow-sm" : "text-ink-400 hover:text-white"
                )}
                onClick={() => setActiveOsTab("linux")}
              >
                Linux
              </button>
            </div>

            {/* OS Specific Guidance */}
            <div className="rounded-lg border border-base-750 bg-base-900/60 p-3 space-y-2 text-[11.5px]">
              {activeOsTab === "windows" && (
                <>
                  <p className="text-ink-200 font-medium">Windows Installation:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-ink-400">
                    <li>Download and run <strong>OllamaSetup.exe</strong> from ollama.com.</li>
                    <li>Ollama starts automatically in the system tray.</li>
                    <li>Open PowerShell to verify with <code className="mono text-violet">ollama --version</code>.</li>
                  </ol>
                </>
              )}
              {activeOsTab === "mac" && (
                <>
                  <p className="text-ink-200 font-medium">macOS Installation:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-ink-400">
                    <li>Download <strong>Ollama-darwin.zip</strong> and extract.</li>
                    <li>Drag <strong>Ollama.app</strong> to Applications folder.</li>
                    <li>Launch Ollama from Applications or Spotlight.</li>
                  </ol>
                </>
              )}
              {activeOsTab === "linux" && (
                <>
                  <p className="text-ink-200 font-medium">Linux Quick Install:</p>
                  <div className="flex items-center justify-between rounded border border-base-700 bg-base-950 p-1.5 mono text-[10.5px]">
                    <span className="truncate text-ink-300">curl -fsSL https://ollama.com/install.sh | sh</span>
                    <button
                      onClick={() => copyCommand("curl -fsSL https://ollama.com/install.sh | sh", "linux-install")}
                      className="ml-2 text-ink-400 hover:text-white"
                    >
                      {copiedCmd === "linux-install" ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </>
              )}
            </div>

            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full justify-center !py-2 !text-[12px]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>DOWNLOAD OLLAMA</span>
              <ExternalLink className="h-3 w-3 ml-1 opacity-70" />
            </a>
            <p className="text-[10px] text-ink-500 text-center">
              Official link: ollama.com/download · No bundled software or telemetry.
            </p>
          </div>
        </Panel>

        {/* Step 2: Download Qwen 2.5 3B */}
        <Panel
          title="2. Download Qwen 2.5 3B"
          subtitle="Model weights for industrial reasoning"
          action={<span className="mono text-[11px] font-semibold text-violet">Step 02</span>}
        >
          <div className="space-y-3 text-[12px]">
            {/* Model Card Metadata */}
            <div className="rounded-lg border border-violet/30 bg-violet/[0.04] p-3 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-ink-400">Model:</span>
                <span className="mono text-[11.5px] font-semibold text-white">Qwen 2.5 3B</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-ink-400">Runtime:</span>
                <span className="mono text-[11.5px] text-ink-200">Ollama</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-ink-400">Purpose:</span>
                <span className="text-[11px] text-violet font-medium">Industrial furnace AI assistant</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-ink-400">Download Size:</span>
                <span className="mono text-[11.5px] text-good">~1.9 GB</span>
              </div>
            </div>

            {/* Model Selector Dropdown */}
            <div>
              <label className="text-[11px] font-medium text-ink-400 block mb-1">Select Model Target:</label>
              <select
                className="input !py-1.5 !text-[12px] bg-base-900 border-base-700"
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  void runConnectionTest(endpoint, e.target.value);
                }}
              >
                {RECOMMENDED_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.size})
                  </option>
                ))}
              </select>
            </div>

            {/* Pull Command Terminal Card */}
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
                Execute in your Terminal:
              </p>
              <div className="flex items-center justify-between rounded-lg border border-base-700 bg-base-950 p-2 font-mono text-[11.5px]">
                <span className="text-violet font-medium">{pullCmd}</span>
                <button
                  onClick={() => copyCommand(pullCmd, "pull-cmd")}
                  className="btn-ghost !p-1 text-ink-400 hover:text-white"
                  title="Copy terminal command"
                >
                  {copiedCmd === "pull-cmd" ? (
                    <span className="flex items-center gap-1 text-good text-[10px]">
                      <Check className="h-3 w-3" /> Copied
                    </span>
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-ink-400 leading-relaxed">
              Ollama downloads the quantized model weights directly from the registry onto your local drive. This
              requires about 1–3 minutes depending on your internet connection.
            </p>
          </div>
        </Panel>

        {/* Step 3: Run Model & Verify */}
        <Panel
          title="3. Run & Connect"
          subtitle="Start Ollama & enable browser access"
          action={<span className="mono text-[11px] font-semibold text-violet">Step 03</span>}
        >
          <div className="space-y-3 text-[12px]">
            <p className="text-ink-300">
              Test that your model runs in terminal, then connect it to ForgeOptima AI:
            </p>

            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
                Verify in Terminal:
              </p>
              <div className="flex items-center justify-between rounded-lg border border-base-700 bg-base-950 p-2 font-mono text-[11.5px]">
                <span className="text-ink-200">{runCmd}</span>
                <button
                  onClick={() => copyCommand(runCmd, "run-cmd")}
                  className="btn-ghost !p-1 text-ink-400 hover:text-white"
                >
                  {copiedCmd === "run-cmd" ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* CORS / Bridge Guidance */}
            <div className="rounded-lg border border-base-750 bg-base-900/60 p-2.5 space-y-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-ink-200 font-medium">
                <ShieldCheck className="h-3.5 w-3.5 text-electric" />
                Browser CORS Setup
              </div>
              <p className="text-ink-400 leading-relaxed">
                To allow the website to talk to your local Ollama port, launch with CORS enabled:
              </p>
              <div className="rounded bg-base-950 p-1.5 font-mono text-[10px] text-ink-300">
                OLLAMA_ORIGINS=&quot;*&quot; ollama serve
              </div>
              <p className="text-ink-500 text-[10px]">
                Or download the lightweight{" "}
                <a
                  href="/forgeoptima-bridge.py"
                  download="forgeoptima-bridge.py"
                  className="text-violet underline hover:text-ink-100"
                >
                  forgeoptima-bridge.py
                </a>{" "}
                companion to bridge automatically.
              </p>
            </div>

            {/* Endpoint Input */}
            <div>
              <label className="text-[11px] font-medium text-ink-400 block mb-1">Local Endpoint:</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  className="input !py-1.5 !text-[12px] font-mono flex-1 bg-base-900 border-base-700"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <button
                  onClick={() => runConnectionTest(endpoint, selectedModel)}
                  disabled={testing}
                  className="btn-primary shrink-0 !py-1.5 !px-3 !text-[12px]"
                >
                  {testing ? "Testing…" : "Test"}
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Connection Diagnostics Card */}
      <Panel
        title="Local AI Connection Status"
        subtitle={`Checking: ${endpoint} · Model: ${selectedModel}`}
        action={renderStateBadge(checkResult?.state)}
      >
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-base-750 bg-base-900/50 p-3 space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">Connection State</span>
            <p className="text-[13px] font-semibold text-white">
              {checkResult ? checkResult.state : "RUN TEST"}
            </p>
            <p className="text-[10.5px] text-ink-400">
              {checkResult?.state === "READY"
                ? "Test generation passed"
                : checkResult?.state === "MODEL NOT FOUND"
                ? "Ollama online, model missing"
                : "Awaiting local handshake"}
            </p>
          </div>

          <div className="rounded-xl border border-base-750 bg-base-900/50 p-3 space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">Local Endpoint</span>
            <p className="mono text-[12px] font-semibold text-ink-100 truncate" title={checkResult?.endpoint ?? endpoint}>
              {checkResult?.endpoint ?? endpoint}
            </p>
            <p className="text-[10.5px] text-ink-400">
              {checkResult?.isBridge ? "Connected via Bridge (11435)" : "Direct Ollama port (11434)"}
            </p>
          </div>

          <div className="rounded-xl border border-base-750 bg-base-900/50 p-3 space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">Latency & Speed</span>
            <p className="mono text-[13px] font-semibold text-good">
              {checkResult?.latencyMs != null ? `${checkResult.latencyMs} ms` : "—"}
            </p>
            <p className="text-[10.5px] text-ink-400">Zero cloud API transmission delay</p>
          </div>

          <div className="rounded-xl border border-base-750 bg-base-900/50 p-3 space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">Installed Models</span>
            <p className="mono text-[12px] font-semibold text-ink-100">
              {checkResult?.modelsFound ? `${checkResult.modelsFound.length} installed` : "—"}
            </p>
            <p className="text-[10.5px] text-ink-400 truncate" title={(checkResult?.modelsFound || []).join(", ")}>
              {(checkResult?.modelsFound || []).slice(0, 3).join(", ") || "None detected"}
            </p>
          </div>
        </div>

        {checkResult && (
          <div className="mt-4 rounded-xl border border-base-700 bg-base-950/80 p-3 text-[12px] space-y-2">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-violet shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-ink-200">{checkResult.detail}</p>
                {checkResult.testResponse && (
                  <div className="mt-2 rounded border border-base-800 bg-base-900 p-2 font-mono text-[11px] text-ink-300">
                    <span className="text-ink-500 mr-2">Test Inference Output:</span>
                    <span className="text-good">{checkResult.testResponse}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Embedded Local AI Chat Interface */}
      <Panel
        title="Local AI Chat Interface"
        subtitle={`Direct browser-to-Ollama inference · Model: ${selectedModel}`}
        action={
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                className="btn-ghost !py-1 !text-[11px] text-ink-400 hover:text-crit"
                onClick={clearChat}
                title="Clear local conversation"
              >
                <Trash2 className="h-3 w-3" /> Clear chat
              </button>
            )}
            <Chip tone={checkResult?.state === "READY" ? "good" : "neutral"}>
              {checkResult?.state === "READY" ? "Local Model Active" : "Local Mode Paused"}
            </Chip>
          </div>
        }
        bodyClassName="p-0 flex flex-col h-[540px]"
      >
        {/* Messages Scroll Area */}
        <div ref={scrollRef} className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-lg py-8 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-violet/30 bg-violet/10 shadow-panel">
                <Cpu className="h-6 w-6 text-violet" />
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-white">Local Qwen 2.5 3B Copilot</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-400 max-w-sm mx-auto">
                Inference runs directly on your CPU/GPU via Ollama. Responses are grounded in ForgeOptima furnace
                telemetry and predictions.
              </p>

              <div className="mt-5 text-left">
                <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
                  Ask Your Local Model:
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      onClick={() => sendLocalMessage(question)}
                      disabled={busy || checkResult?.state !== "READY"}
                      className="flex items-center justify-between rounded-lg border border-base-700 bg-base-900/60 p-2 text-left text-[11px] text-ink-300 transition-all hover:border-violet/40 hover:bg-violet/[0.04] hover:text-white disabled:opacity-50"
                    >
                      <span className="line-clamp-2">{question}</span>
                      <ChevronRight className="h-3 w-3 text-ink-500 shrink-0 ml-1" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Chat Messages */}
          {messages.map((message, idx) => {
            const isAssistant = message.role === "assistant";
            return (
              <div
                key={idx}
                className={clsx("flex gap-2.5 animate-slideUp", !isAssistant && "flex-row-reverse")}
              >
                <div
                  className={clsx(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                    isAssistant
                      ? "border-violet/40 bg-violet/10 text-violet"
                      : "border-electric/40 bg-electric/15 text-electric"
                  )}
                >
                  {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User2 className="h-3.5 w-3.5" />}
                </div>

                <div
                  className={clsx(
                    "max-w-[84%] rounded-xl px-4 py-3 text-[12.5px] leading-relaxed",
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

                  {isAssistant && !message.streaming && message.content.length > 0 && (
                    <div className="mt-2.5 flex items-center justify-between border-t border-base-750/70 pt-1.5 text-[10px] text-ink-500">
                      <span className="flex items-center gap-1 font-mono">
                        <Sparkles className="h-2.5 w-2.5 text-violet" />
                        Local Ollama Inference
                      </span>
                      <button
                        onClick={() => copyMessage(message.content, idx)}
                        className="flex items-center gap-1 text-ink-400 hover:text-white"
                      >
                        {copiedMsgIndex === idx ? (
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

          {busy && messages[messages.length - 1]?.content === "" && (
            <div className="flex gap-2.5 animate-slideUp">
              <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-violet/40 bg-violet/10 text-violet">
                <Bot className="h-3.5 w-3.5 animate-pulse" />
              </div>
              <div className="rounded-xl border border-base-700 bg-base-900/90 px-4 py-3 text-[12px] text-ink-400 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-violet animate-ping" />
                <span>Local Qwen 2.5 3B model is generating response...</span>
              </div>
            </div>
          )}

          {chatError && (
            <ErrorBox message={chatError} onRetry={() => runConnectionTest()} />
          )}
        </div>

        {/* Input Bar */}
        <div className="border-t border-base-700/80 bg-base-900/50 p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="input max-h-24 min-h-[44px] resize-none leading-relaxed text-[13px] border-base-700 focus:border-violet/60"
              placeholder={
                checkResult?.state === "READY"
                  ? "Ask your local Qwen model about furnace telemetry, energy, or melting time…"
                  : "Verify connection above to enable local chat…"
              }
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendLocalMessage(input);
                }
              }}
              disabled={busy || checkResult?.state !== "READY"}
            />
            <button
              onClick={() => sendLocalMessage(input)}
              disabled={busy || !input.trim() || checkResult?.state !== "READY"}
              className="btn-primary shrink-0 !py-2.5 !px-4 !bg-gradient-to-r from-violet to-electric hover:from-violet/90 hover:to-electric/90 shadow-panel"
            >
              <Send className="h-4 w-4" />
              <span>{busy ? "Thinking…" : "Send"}</span>
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-good" />
              100% On-Device · Zero cloud tokens transmitted
            </span>
            <span>Target: {selectedModel} @ {endpoint}</span>
          </div>
        </div>
      </Panel>

      {/* System Requirements & Privacy Guarantees */}
      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="System Requirements" subtitle="Hardware recommendations for local inference">
          <div className="space-y-3 text-[12px]">
            <div className="grid grid-cols-2 gap-2 text-[11.5px]">
              <div className="rounded-lg border border-base-750 bg-base-900/60 p-2.5">
                <span className="text-[10px] text-ink-500 uppercase tracking-wide block mb-1">
                  Memory (RAM)
                </span>
                <p className="font-semibold text-white">4 GB Free RAM</p>
                <p className="text-[10px] text-ink-400">8 GB system RAM recommended</p>
              </div>

              <div className="rounded-lg border border-base-750 bg-base-900/60 p-2.5">
                <span className="text-[10px] text-ink-500 uppercase tracking-wide block mb-1">
                  Disk Space
                </span>
                <p className="font-semibold text-white">2.5 GB Free Disk</p>
                <p className="text-[10px] text-ink-400">For model weights & Ollama</p>
              </div>

              <div className="rounded-lg border border-base-750 bg-base-900/60 p-2.5">
                <span className="text-[10px] text-ink-500 uppercase tracking-wide block mb-1">
                  Processor (CPU/GPU)
                </span>
                <p className="font-semibold text-white">Multi-core CPU</p>
                <p className="text-[10px] text-ink-400">Apple Silicon / AVX2 / GPU</p>
              </div>

              <div className="rounded-lg border border-base-750 bg-base-900/60 p-2.5">
                <span className="text-[10px] text-ink-500 uppercase tracking-wide block mb-1">
                  Low-Spec Alternative
                </span>
                <p className="font-semibold text-violet">Qwen 2.5 1.5B</p>
                <p className="text-[10px] text-ink-400">Needs only 1.5 GB RAM</p>
              </div>
            </div>

            <Notice tone="info">
              Inference throughput depends directly on your computer&apos;s processor. If Qwen 2.5 3B feels sluggish
              on your laptop, switch to <code className="mono text-violet">qwen2.5:1.5b</code> in the dropdown above for
              faster execution with lower RAM usage.
            </Notice>
          </div>
        </Panel>

        <Panel title="Privacy & Data Isolation" subtitle="Local vs. Cloud architecture guarantees">
          <div className="space-y-3 text-[12px] text-ink-300 leading-relaxed">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-good shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-white">100% On-Device Inference</p>
                <p className="text-[11.5px] text-ink-400">
                  When using Local Mode, every token generation occurs inside your local Ollama runtime. Prompts and
                  conversations never leave your workstation.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-electric shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-white">Two Independent Modes</p>
                <p className="text-[11.5px] text-ink-400">
                  <strong className="text-white">Local Mode</strong> runs completely independently of any cloud AI
                  service. <strong className="text-white">Cloud Mode</strong> is always available on the main Shakthi AI
                  page without requiring local installation.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-violet shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-white">Grounded Decision Support</p>
                <p className="text-[11.5px] text-ink-400">
                  Plant telemetry is injected strictly as context data into your local model. The AI distinguishes
                  measured, simulated, predicted, and estimated data, and cannot execute unverified furnace actions.
                </p>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

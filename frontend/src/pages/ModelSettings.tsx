import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  AlertTriangle,
  Check,
  Cpu,
  Database,
  Download,
  HardDrive,
  Laptop,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Chip, ErrorBox, Notice, PageHeader, Progress } from "../components/ui";
import {
  CATALOG_MODELS,
  ManagedModelDefinition,
  ModelInstallationStatus,
  ModelRuntimeState,
  StorageEstimateInfo,
  deleteOllamaModel,
  fetchInstalledOllamaModels,
  fetchRunningOllamaModels,
  getBrowserStorageEstimate,
  getSavedLocalEndpoint,
  getSavedLocalModel,
  loadOllamaModel,
  pullOllamaModel,
  saveLocalEndpoint,
  saveLocalModel,
  stopOllamaModel,
} from "../lib/localOllama";

export default function ModelSettings() {
  const [endpoint, setEndpoint] = useState(getSavedLocalEndpoint());
  const [activeModelId, setActiveModelId] = useState(getSavedLocalModel());
  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);
  const [modelStates, setModelStates] = useState<Record<string, ModelRuntimeState>>({});
  const [installedList, setInstalledList] = useState<string[]>([]);
  const [runningList, setRunningList] = useState<string[]>([]);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState(false);
  const [endpointOnline, setEndpointOnline] = useState<boolean | null>(null);
  const [deleteConfirmModel, setDeleteConfirmModel] = useState<ManagedModelDefinition | null>(null);

  // Download abort controllers keyed by model id
  const pullControllers = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    void refreshAll();
  }, [endpoint]);

  const refreshAll = async () => {
    setTestingEndpoint(true);
    // 1. Fetch storage estimate
    const storage = await getBrowserStorageEstimate();
    setStorageInfo(storage);

    // 2. Fetch installed models from Ollama endpoint
    const installed = await fetchInstalledOllamaModels(endpoint);
    const installedNames = installed.map((m) => m.name);
    setInstalledList(installedNames);
    setEndpointOnline(installed.length > 0 || installedNames !== null);

    // 3. Fetch running models
    const running = await fetchRunningOllamaModels(endpoint);
    setRunningList(running);

    // 4. Update catalog model states
    const states: Record<string, ModelRuntimeState> = {};
    for (const def of CATALOG_MODELS) {
      const isInstalled = installedNames.some(
        (n) => n === def.id || n.startsWith(`${def.id}:`) || def.id.startsWith(n)
      );
      const isRunning = running.some(
        (n) => n === def.id || n.startsWith(`${def.id}:`) || def.id.startsWith(n)
      );

      // Check if user has ongoing download
      const existing = modelStates[def.id];
      if (existing?.status === "Downloading" || existing?.status === "Installing") {
        states[def.id] = existing;
      } else if (isInstalled) {
        states[def.id] = {
          status: def.id === activeModelId ? "Ready" : "Installed",
          isLoaded: isRunning,
          statusMessage: isRunning ? "Loaded in memory" : "Installed on disk",
        };
      } else {
        // Check storage headroom
        const hasStorage = !storageInfo?.supported || (storageInfo?.freeBytes || 0) > def.requiredStorageBytes;
        states[def.id] = {
          status: hasStorage ? "Available" : "Insufficient storage",
          statusMessage: hasStorage ? "Ready to download" : "Insufficient disk space",
        };
      }
    }
    setModelStates(states);
    setTestingEndpoint(false);
  };

  const handleStartDownload = async (model: ManagedModelDefinition) => {
    // Set downloading state
    const controller = new AbortController();
    pullControllers.current[model.id] = controller;

    setModelStates((prev) => ({
      ...prev,
      [model.id]: {
        status: "Downloading",
        progressPct: 0,
        downloadedBytes: 0,
        totalBytes: model.exactSizeBytes,
        statusMessage: "Connecting to model registry…",
      },
    }));

    try {
      await pullOllamaModel(
        endpoint,
        model.id,
        (progress) => {
          setModelStates((prev) => {
            const pct = progress.pct ?? prev[model.id]?.progressPct ?? 0;
            const downloaded = progress.completed ?? prev[model.id]?.downloadedBytes ?? 0;
            const total = progress.total ?? model.exactSizeBytes;
            const statusLabel =
              progress.status === "success"
                ? "Installed"
                : progress.status.includes("verifying")
                ? "Installing"
                : "Downloading";

            return {
              ...prev,
              [model.id]: {
                status: statusLabel,
                progressPct: pct,
                downloadedBytes: downloaded,
                totalBytes: total,
                statusMessage: progress.status,
              },
            };
          });
        },
        controller.signal
      );

      // Successfully finished download
      setModelStates((prev) => ({
        ...prev,
        [model.id]: {
          status: "Installed",
          progressPct: 100,
          statusMessage: "Successfully installed and verified.",
        },
      }));
      await refreshAll();
    } catch (err) {
      if (controller.signal.aborted) {
        setModelStates((prev) => ({
          ...prev,
          [model.id]: {
            status: "Available",
            statusMessage: "Download cancelled by user.",
          },
        }));
      } else {
        setModelStates((prev) => ({
          ...prev,
          [model.id]: {
            status: "Error",
            statusMessage: err instanceof Error ? err.message : "Download failed",
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    } finally {
      delete pullControllers.current[model.id];
    }
  };

  const handleCancelDownload = (modelId: string) => {
    pullControllers.current[modelId]?.abort();
    delete pullControllers.current[modelId];
    setModelStates((prev) => ({
      ...prev,
      [modelId]: {
        status: "Available",
        progressPct: 0,
        statusMessage: "Download cancelled.",
      },
    }));
  };

  const handleDeleteModel = async (model: ManagedModelDefinition) => {
    try {
      await deleteOllamaModel(endpoint, model.id);
      setDeleteConfirmModel(null);
      await refreshAll();
    } catch (err) {
      alert(`Could not delete model: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSelectActive = (modelId: string) => {
    setActiveModelId(modelId);
    saveLocalModel(modelId);
    // Mark this model as Ready
    setModelStates((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (id === modelId) {
          next[id] = { ...next[id], status: "Ready" };
        } else if (next[id].status === "Ready") {
          next[id] = { ...next[id], status: "Installed" };
        }
      }
      return next;
    });
  };

  const handleLoadModel = async (modelId: string) => {
    setModelStates((prev) => ({
      ...prev,
      [modelId]: { ...prev[modelId], status: "Loading", statusMessage: "Preloading weights into RAM/VRAM…" },
    }));
    await loadOllamaModel(endpoint, modelId);
    await refreshAll();
  };

  const handleStopModel = async (modelId: string) => {
    await stopOllamaModel(endpoint, modelId);
    await refreshAll();
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

  // Calculate total disk size of installed catalog models
  const totalInstalledBytes = CATALOG_MODELS.filter((m) =>
    installedList.some((n) => n === m.id || n.startsWith(`${m.id}:`))
  ).reduce((acc, curr) => acc + curr.exactSizeBytes, 0);

  const totalInstalledFormatted =
    totalInstalledBytes > 0
      ? (totalInstalledBytes / (1024 * 1024 * 1024)).toFixed(2) + " GB"
      : "0 GB";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Local AI Architecture · CyberShield System Inspired"
        title="AI MODEL SETTINGS"
        description="Download, install and manage your local AI models. Run Shakthi AI privately on your device with complete storage visibility, quantization options, and zero cloud API dependencies."
      >
        <Chip tone={endpointOnline ? "good" : "crit"}>
          <span
            className={clsx(
              "h-2 w-2 rounded-full",
              endpointOnline ? "bg-good animate-pulse" : "bg-crit"
            )}
          />
          {endpointOnline ? "Local Daemon Online" : "Daemon Offline"}
        </Chip>

        <button
          className="btn-ghost !py-1.5 !text-[12px] text-violet hover:bg-violet/10 flex items-center gap-1.5"
          onClick={() => refreshAll()}
          disabled={testingEndpoint}
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", testingEndpoint && "animate-spin")} />
          <span>Refresh</span>
        </button>

        <Link
          to="/shakthi-ai"
          className="btn-primary !py-1.5 !text-[12px] !bg-gradient-to-r from-violet to-electric hover:from-violet/90 hover:to-electric/90 shadow-panel"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Open Shakthi AI</span>
        </Link>
      </PageHeader>

      {/* Top Storage Management & Quota Dashboard */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* Card 1: Available Storage */}
        <div className="rounded-2xl border border-base-750 bg-gradient-to-b from-base-850 to-base-900 p-4 shadow-panel space-y-2">
          <div className="flex items-center justify-between text-ink-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Device Storage</span>
            <HardDrive className="h-4 w-4 text-violet" />
          </div>
          <div>
            <span className="mono text-[22px] font-bold text-white">
              {storageInfo?.freeFormatted || "Available"}
            </span>
            <p className="text-[11px] text-ink-400 mt-0.5">
              {storageInfo?.supported
                ? `Free space of ${storageInfo.quotaFormatted}`
                : "Standard OS filesystem storage"}
            </p>
          </div>
          {storageInfo?.supported && (
            <div className="pt-1">
              <Progress value={storageInfo.usagePct} tone="violet" />
              <div className="flex justify-between text-[10px] text-ink-500 mt-1 font-mono">
                <span>Used: {storageInfo.usedFormatted}</span>
                <span>{storageInfo.usagePct}% utilized</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Installed Models Data */}
        <div className="rounded-2xl border border-base-750 bg-gradient-to-b from-base-850 to-base-900 p-4 shadow-panel space-y-2">
          <div className="flex items-center justify-between text-ink-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Installed Models</span>
            <Database className="h-4 w-4 text-electric" />
          </div>
          <div>
            <span className="mono text-[22px] font-bold text-electric">{totalInstalledFormatted}</span>
            <p className="text-[11px] text-ink-400 mt-0.5">
              {installedList.length} local model{installedList.length === 1 ? "" : "s"} ready on device
            </p>
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <Chip tone="neutral" className="!text-[10px] !py-0.5">
              Ollama Disk Storage
            </Chip>
            <span className="text-[10px] text-ink-500">Persistent</span>
          </div>
        </div>

        {/* Card 3: Active Model */}
        <div className="rounded-2xl border border-base-750 bg-gradient-to-b from-base-850 to-base-900 p-4 shadow-panel space-y-2">
          <div className="flex items-center justify-between text-ink-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active Copilot</span>
            <Cpu className="h-4 w-4 text-good" />
          </div>
          <div>
            <span className="mono text-[16px] font-bold text-good truncate block" title={activeModelId}>
              {activeModelId}
            </span>
            <p className="text-[11px] text-ink-400 mt-0.5">
              {runningList.includes(activeModelId) ? "Running in Memory (Hot)" : "Standby (Loads on Query)"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                runningList.includes(activeModelId) ? "bg-good animate-ping" : "bg-ink-500"
              )}
            />
            <span className="text-[10.5px] text-ink-300">
              {runningList.includes(activeModelId) ? "Active in VRAM" : "Cached on disk"}
            </span>
          </div>
        </div>

        {/* Card 4: Local Endpoint Configuration */}
        <div className="rounded-2xl border border-base-750 bg-gradient-to-b from-base-850 to-base-900 p-4 shadow-panel space-y-2">
          <div className="flex items-center justify-between text-ink-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Daemon Endpoint</span>
            <Laptop className="h-4 w-4 text-ink-400" />
          </div>
          <input
            type="text"
            className="input !py-1 !text-[11.5px] font-mono border-base-700 bg-base-950"
            value={endpoint}
            onChange={(e) => {
              setEndpoint(e.target.value);
              saveLocalEndpoint(e.target.value);
            }}
            placeholder="http://localhost:11434"
          />
          <div className="flex items-center justify-between text-[10px] text-ink-500">
            <span>Bridge: port 11435</span>
            <button
              onClick={() => refreshAll()}
              className="text-violet hover:underline"
            >
              Check port
            </button>
          </div>
        </div>
      </div>

      {/* Storage Architecture Explanation Card */}
      <Notice tone="info" title="Persistent Model Storage Architecture">
        <p className="text-[11.5px] leading-relaxed text-ink-300">
          Models installed through Ollama persist in your operating system&apos;s local model directory (
          <code className="mono text-violet">~/.ollama/models</code> or{" "}
          <code className="mono text-violet">%USERPROFILE%\.ollama\models</code>) and are{" "}
          <strong className="text-white">never deleted by clearing browser cache or cookies</strong>. In-browser
          WebGPU cache shards are tied to your browser origin storage and can be managed or cleared below.
        </p>
      </Notice>

      {/* Available Models Catalog Grid */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[18px] font-semibold text-white tracking-tight">Available AI Models</h2>
            <p className="text-[12px] text-ink-400">
              Select, install, or run industrial furnace models on your workstation with real-time download progress.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Chip tone="neutral">Quantization: Q4_K_M (4-bit Balanced)</Chip>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {CATALOG_MODELS.map((model) => {
            const state = modelStates[model.id] || { status: "Available" };
            const isDownloading = state.status === "Downloading" || state.status === "Installing";
            const isInstalled =
              state.status === "Installed" || state.status === "Ready" || state.status === "Loading";
            const isActive = activeModelId === model.id;
            const isLoaded = state.isLoaded || runningList.includes(model.id);

            return (
              <div
                key={model.id}
                className={clsx(
                  "relative rounded-2xl border p-5 transition-all shadow-panel flex flex-col justify-between",
                  isActive
                    ? "border-violet/60 bg-gradient-to-b from-violet/[0.08] to-base-900 ring-1 ring-violet/30"
                    : "border-base-750 bg-gradient-to-b from-base-850/90 to-base-900/90 hover:border-base-650"
                )}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={clsx(
                          "grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
                          isActive
                            ? "border-violet/50 bg-violet/20 text-violet"
                            : "border-base-700 bg-base-800/80 text-ink-300"
                        )}
                      >
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-semibold text-white">{model.name}</h3>
                          {isActive && (
                            <span className="rounded bg-violet/20 px-1.5 py-0.5 text-[10px] font-medium text-violet border border-violet/40">
                              Active Model
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-ink-400">
                          {model.version} · {model.badge}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Chip tone="neutral" className="!font-mono !text-[10px]">
                        {model.quantization}
                      </Chip>
                      {/* Status Badge */}
                      <StatusBadge status={state.status} />
                    </div>
                  </div>

                  {/* Description */}
                  <p className="mt-3 text-[12px] leading-relaxed text-ink-300">
                    {model.description}
                  </p>

                  {/* Hardware & Storage Specs Grid */}
                  <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl border border-base-750/80 bg-base-950/60 p-2.5 text-[11px]">
                    <div>
                      <span className="text-[9.5px] uppercase tracking-wider text-ink-500 block">Model Size</span>
                      <span className="mono font-semibold text-white">{model.exactSizeFormatted}</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase tracking-wider text-ink-500 block">Req. Storage</span>
                      <span className="mono text-ink-200">{model.requiredStorageFormatted}</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase tracking-wider text-ink-500 block">Min. RAM</span>
                      <span className="text-ink-200 truncate block" title={model.minRam}>
                        {model.minRam.split(" ")[0]} {model.minRam.split(" ")[1]}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] uppercase tracking-wider text-ink-500 block">Context</span>
                      <span className="mono text-ink-200">{model.contextWindow}</span>
                    </div>
                  </div>

                  {/* Real-time Download Progress Bar */}
                  {isDownloading && (
                    <div className="mt-4 rounded-xl border border-violet/30 bg-violet/[0.04] p-3 space-y-2 animate-slideUp">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="text-ink-200 font-medium flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-violet animate-ping" />
                          {state.status === "Installing" ? "Verifying digest & installing…" : "Downloading model weights…"}
                        </span>
                        <span className="mono font-semibold text-violet">
                          {state.progressPct || 0}%
                        </span>
                      </div>

                      <Progress value={state.progressPct || 0} tone="violet" />

                      <div className="flex items-center justify-between text-[10.5px] text-ink-400 font-mono">
                        <span className="truncate max-w-[200px]">{state.statusMessage || "Pulling manifest…"}</span>
                        <span>
                          {state.downloadedBytes
                            ? `${(state.downloadedBytes / (1024 * 1024)).toFixed(1)} MB`
                            : "0 MB"}{" "}
                          / {model.exactSizeFormatted}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Error Box if failed */}
                  {state.status === "Error" && (
                    <div className="mt-3">
                      <ErrorBox
                        message={state.error || "Installation failed."}
                        onRetry={() => handleStartDownload(model)}
                      />
                    </div>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="mt-5 border-t border-base-750/70 pt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Copy pull command button */}
                    <button
                      onClick={() => copyCommand(`ollama pull ${model.id}`, model.id)}
                      className="btn-ghost !py-1 !px-2 !text-[11px] text-ink-400 hover:text-white"
                      title={`Copy command: ollama pull ${model.id}`}
                    >
                      {copiedCmd === model.id ? (
                        <>
                          <Check className="h-3 w-3 text-good" />
                          <span className="text-good">Copied</span>
                        </>
                      ) : (
                        <>
                          <Terminal className="h-3 w-3 text-violet" />
                          <span>CLI Command</span>
                        </>
                      )}
                    </button>

                    {/* Delete button when installed */}
                    {isInstalled && (
                      <button
                        onClick={() => setDeleteConfirmModel(model)}
                        className="btn-ghost !py-1 !px-2 !text-[11px] text-ink-400 hover:text-crit"
                        title="Delete installed model from disk"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Download button if available */}
                    {!isInstalled && !isDownloading && (
                      <button
                        onClick={() => handleStartDownload(model)}
                        className="btn-primary !py-1.5 !px-3.5 !text-[12px] !bg-gradient-to-r from-violet to-electric hover:from-violet/90 hover:to-electric/90 shadow-panel"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download & Install</span>
                      </button>
                    )}

                    {/* Cancel button if downloading */}
                    {isDownloading && (
                      <button
                        onClick={() => handleCancelDownload(model.id)}
                        className="btn-ghost !py-1.5 !px-3 !text-[12px] text-crit hover:bg-crit/10 border-crit/30"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}

                    {/* Preload / Start / Stop Model when installed */}
                    {isInstalled && (
                      <>
                        {isLoaded ? (
                          <button
                            onClick={() => handleStopModel(model.id)}
                            className="btn-ghost !py-1.5 !px-2.5 !text-[11px] text-ink-300 hover:text-white"
                            title="Unload model from RAM/VRAM"
                          >
                            <Square className="h-3 w-3 text-crit" />
                            <span>Stop</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLoadModel(model.id)}
                            className="btn-ghost !py-1.5 !px-2.5 !text-[11px] text-ink-300 hover:text-white"
                            title="Preload model weights into memory"
                          >
                            <Play className="h-3 w-3 text-good" />
                            <span>Start</span>
                          </button>
                        )}

                        {/* Select as active model */}
                        <button
                          onClick={() => handleSelectActive(model.id)}
                          disabled={isActive}
                          className={clsx(
                            "btn-primary !py-1.5 !px-3.5 !text-[12px]",
                            isActive
                              ? "opacity-50 cursor-default bg-base-750 text-ink-300 border border-base-650"
                              : "!bg-violet hover:bg-violet/90 text-white shadow-panel"
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{isActive ? "Active Model" : "Select Model"}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Model Deletion Confirmation Dialog */}
      {deleteConfirmModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-crit/40 bg-base-900 p-5 shadow-2xl space-y-4 animate-slideUp">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-crit/15 text-crit border border-crit/30">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-white">Delete Local Model?</h3>
                <p className="text-[12px] text-ink-400">
                  {deleteConfirmModel.name} ({deleteConfirmModel.exactSizeFormatted})
                </p>
              </div>
            </div>

            <p className="text-[12px] leading-relaxed text-ink-300">
              This will remove the downloaded quantized weights from your local disk (
              <code className="mono text-crit">{deleteConfirmModel.id}</code>). You will need to download the model
              again if you wish to use it in the future.
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                className="btn-ghost !py-1.5 !text-[12px]"
                onClick={() => setDeleteConfirmModel(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary !bg-crit hover:!bg-crit/90 text-white !py-1.5 !text-[12px]"
                onClick={() => handleDeleteModel(deleteConfirmModel)}
              >
                Yes, Delete Model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ModelInstallationStatus }) {
  switch (status) {
    case "Ready":
      return (
        <span className="chip border-good/40 bg-good/10 text-good font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-good animate-ping" />
          Ready
        </span>
      );
    case "Installed":
      return (
        <span className="chip border-electric/40 bg-electric/10 text-electric">
          <Check className="h-3 w-3" />
          Installed
        </span>
      );
    case "Downloading":
      return (
        <span className="chip border-violet/40 bg-violet/10 text-violet">
          <span className="h-1.5 w-1.5 rounded-full bg-violet animate-pulse" />
          Downloading
        </span>
      );
    case "Installing":
      return (
        <span className="chip border-violet/40 bg-violet/10 text-violet">
          <span className="h-1.5 w-1.5 rounded-full bg-violet animate-pulse" />
          Installing
        </span>
      );
    case "Loading":
      return (
        <span className="chip border-warn/40 bg-warn/10 text-warn">
          <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />
          Loading
        </span>
      );
    case "Insufficient storage":
      return (
        <span className="chip border-crit/40 bg-crit/10 text-crit">
          <AlertTriangle className="h-3 w-3" />
          Low Storage
        </span>
      );
    case "Error":
      return (
        <span className="chip border-crit/40 bg-crit/10 text-crit">
          <AlertTriangle className="h-3 w-3" />
          Error
        </span>
      );
    case "Available":
    default:
      return (
        <span className="chip border-base-600 bg-base-800 text-ink-400">
          Available
        </span>
      );
  }
}

import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  BatteryCharging,
  Check,
  Cpu,
  Download,
  HardDrive,
  Play,
  Power,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import {
  PRIMARY_MODEL_ID,
  FALLBACK_MODEL_ID,
  QWEN_3B_METADATA,
  detectWebGPU,
  checkStorageAvailability,
  isQwenModelCached,
  loadQwenModel,
  unloadEngine,
  deleteQwenModelCache,
  cancelActiveDownload,
  isEngineReady,
  getActiveModelId,
  WebGPUCapability,
  StorageInfo,
  EngineProgress,
} from "../lib/webllmEngine";
import { Chip, ErrorBox, Notice, Panel, Spinner } from "./ui";

interface ModelManagerProps {
  onModelReady?: () => void;
  className?: string;
}

export function ModelManager({ onModelReady, className = "" }: ModelManagerProps) {
  const [gpuInfo, setGpuInfo] = useState<WebGPUCapability | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<EngineProgress>({
    progress: 0,
    text: "Idle",
    state: "uninitialized",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(4096);
  const [forceFp32, setForceFp32] = useState<boolean>(false);
  const [activeTabNotice, setActiveTabNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Tab visibility listener to warn during download/inference if user leaves the tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && loading) {
        setActiveTabNotice(
          "⚠️ Browser tab is in background. Downloading and WebGPU compilation might be throttled or paused by your OS. Please keep this tab active for fastest installation."
        );
      } else if (!document.hidden && activeTabNotice) {
        setActiveTabNotice(null);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [loading, activeTabNotice]);

  const refreshDiagnostics = async () => {
    setErrorMessage(null);
    try {
      const gpu = await detectWebGPU();
      setGpuInfo(gpu);
      if (gpu.isMobile) {
        // Automatically default mobile devices to 2048 context window for memory safety
        setContextWindow(2048);
      }
      if (!gpu.hasShaderF16) {
        setForceFp32(true);
      }

      const storage = await checkStorageAvailability();
      setStorageInfo(storage);

      const cached = await isQwenModelCached();
      setIsCached(cached);

      const ready = isEngineReady();
      setIsLoaded(ready);
      setActiveModel(getActiveModelId());
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to run hardware checks.");
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  const handleDownloadAndLoad = async () => {
    setLoading(true);
    setErrorMessage(null);
    setProgress({ progress: 1, text: "Starting WebGPU model acquisition...", state: "checking" });

    try {
      await loadQwenModel(
        (report) => {
          setProgress(report);
        },
        {
          forceFp32,
          contextWindow,
        }
      );

      setIsLoaded(true);
      setIsCached(true);
      setActiveModel(getActiveModelId());
      await refreshDiagnostics();
      if (onModelReady) {
        onModelReady();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Model installation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDownload = () => {
    cancelActiveDownload();
    setLoading(false);
    setProgress({ progress: 0, text: "Download canceled by operator.", state: "unloaded" });
  };

  const handleUnload = async () => {
    try {
      await unloadEngine();
      setIsLoaded(false);
      setActiveModel(null);
      setProgress({ progress: 0, text: "Model unloaded from GPU memory.", state: "unloaded" });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to unload model.");
    }
  };

  const handleDeleteCache = async () => {
    if (!window.confirm("Are you sure you want to delete the cached Qwen2.5 3B model (~1.62 GB) from your browser storage? You will need to download it again to use Browser Local AI.")) {
      return;
    }

    setDeleting(true);
    setErrorMessage(null);
    try {
      await deleteQwenModelCache();
      setIsCached(false);
      setIsLoaded(false);
      setActiveModel(null);
      await refreshDiagnostics();
      setProgress({ progress: 0, text: "Model cache purged from browser storage.", state: "uninitialized" });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete model cache.");
    } finally {
      setDeleting(false);
    }
  };

  const targetModelId = forceFp32 || !(gpuInfo?.hasShaderF16 ?? true) ? FALLBACK_MODEL_ID : PRIMARY_MODEL_ID;

  return (
    <div className={clsx("space-y-4", className)}>
      {/* Hardware / WebGPU Detection Banner */}
      {gpuInfo && !gpuInfo.supported && (
        <Notice tone="crit" title="WebGPU Not Supported in This Browser">
          <p className="text-[11.5px] leading-relaxed text-ink-200">
            {gpuInfo.error ||
              "Your current browser does not have WebGPU support enabled. WebLLM requires WebGPU to execute Qwen2.5 3B directly inside your browser."}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-300">
            <span className="font-semibold text-white">Recommended:</span>
            <span className="rounded bg-base-800 px-2 py-0.5 border border-base-700">Google Chrome 113+</span>
            <span className="rounded bg-base-800 px-2 py-0.5 border border-base-700">Microsoft Edge 113+</span>
            <span className="rounded bg-base-800 px-2 py-0.5 border border-base-700">Safari 18+ (macOS/iOS)</span>
          </div>
        </Notice>
      )}

      {gpuInfo && gpuInfo.supported && !gpuInfo.adapterAvailable && (
        <Notice tone="warn" title="WebGPU Present But No GPU Adapter Found">
          <p className="text-[11.5px] leading-relaxed text-ink-200">
            {gpuInfo.error ||
              "WebGPU is supported by your browser, but no graphics adapter could be initialized. Please ensure hardware acceleration is toggled on in your browser settings (Settings → System → Use graphics acceleration when available) and restart the browser."}
          </p>
        </Notice>
      )}

      {/* Mobile Device Optimization & Safety Notice */}
      {gpuInfo?.isMobile && (
        <div className="rounded-xl border border-warn/30 bg-warn/[0.06] p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-warn shrink-0" />
            <h4 className="text-[12px] font-semibold text-warn">
              Mobile Device Detected · Memory & Battery Advisory
            </h4>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-300">
            Running <strong>Qwen2.5 3B</strong> requires approximately <strong>2.5 GB of shared VRAM/RAM</strong>.
            On mobile devices (Android / iOS), browsers enforce strict memory limits per tab.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 text-[10.5px] text-ink-400 pt-1">
            <div className="flex items-start gap-1.5">
              <BatteryCharging className="h-3.5 w-3.5 text-warn shrink-0 mt-0.5" />
              <span>Higher battery drain during GPU neural network inference.</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Zap className="h-3.5 w-3.5 text-cyan shrink-0 mt-0.5" />
              <span>Context length automatically adjusted to 2048 tokens to conserve memory.</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Tab Notice */}
      {activeTabNotice && (
        <Notice tone="warn" title="Tab Suspended">
          <p className="text-[11px] text-ink-200">{activeTabNotice}</p>
        </Notice>
      )}

      {errorMessage && <ErrorBox message={errorMessage} onRetry={refreshDiagnostics} />}

      {/* Main Model Card */}
      <Panel
        title="Qwen2.5 3B Instruct · Browser Local AI Model"
        subtitle={activeModel ? `Loaded in WebGPU memory: ${activeModel}` : "Zero external API calls · 100% private in-browser WebGPU execution"}
        action={
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost !py-1 !text-[11px] text-ink-400 hover:text-white"
              onClick={refreshDiagnostics}
              title="Refresh hardware status"
            >
              <RefreshCw className="h-3 w-3" /> Check WebGPU
            </button>
            <Chip tone={isLoaded ? "good" : isCached ? "cyan" : "neutral"}>
              {isLoaded ? "Loaded in GPU" : isCached ? "Cached on Disk" : "Not Downloaded"}
            </Chip>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Model Specification Grid */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-base-700/80 bg-base-900/60 p-2.5">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">
                Model Parameters
              </span>
              <p className="mt-1 font-mono text-[13px] font-bold text-white">
                {QWEN_3B_METADATA.parameters}
              </p>
              <span className="text-[10px] text-ink-400">Dense Architecture</span>
            </div>

            <div className="rounded-lg border border-base-700/80 bg-base-900/60 p-2.5">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">
                Estimated Download
              </span>
              <p className="mt-1 font-mono text-[13px] font-bold text-white">
                ~{(QWEN_3B_METADATA.downloadSizeMB / 1024).toFixed(2)} GB
              </p>
              <span className="text-[10px] text-ink-400">1,655 MB (62 shards)</span>
            </div>

            <div className="rounded-lg border border-base-700/80 bg-base-900/60 p-2.5">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">
                VRAM Required
              </span>
              <p className="mt-1 font-mono text-[13px] font-bold text-white">
                ~{(QWEN_3B_METADATA.vramRequiredMB / 1024).toFixed(2)} GB
              </p>
              <span className="text-[10px] text-ink-400">WebGPU buffer alloc</span>
            </div>

            <div className="rounded-lg border border-base-700/80 bg-base-900/60 p-2.5">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">
                Quantization
              </span>
              <p className="mt-1 font-mono text-[13px] font-bold text-electric">
                {forceFp32 ? "q4f32_1 (32-bit shader)" : "q4f16_1 (fp16)"}
              </p>
              <span className="text-[10px] text-ink-400">MLC WebGPU format</span>
            </div>
          </div>

          {/* Model Card Description & Hosting Disclosure */}
          <div className="rounded-lg border border-base-700/60 bg-base-900/40 p-3 space-y-1.5 text-[11px] leading-relaxed text-ink-300">
            <div className="flex items-center gap-1.5 font-semibold text-white">
              <ShieldCheck className="h-3.5 w-3.5 text-good" />
              <span>Verified Compatibility & Official MLC Hosting</span>
            </div>
            <p>
              Weights are fetched securely from the official MLC repository at{" "}
              <a
                href={QWEN_3B_METADATA.huggingFaceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-cyan underline hover:text-white"
              >
                huggingface.co/mlc-ai/{targetModelId}
              </a>
              . Once downloaded, all model assets are cached locally inside your browser storage (IndexedDB / Cache Storage). Subsequent visits initialize instantaneously without re-downloading.
            </p>
            <p className="text-[10px] text-ink-500">
              License: {QWEN_3B_METADATA.license} · No Ollama server required · No OpenAI API required · Zero token billing.
            </p>
          </div>

          {/* Storage & WebGPU Diagnostic Details */}
          <div className="grid gap-3 sm:grid-cols-2 text-[11px]">
            {/* Storage Quota */}
            <div className="rounded-lg border border-base-700/70 bg-base-900/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-ink-300">
                  <HardDrive className="h-3.5 w-3.5 text-cyan" /> Browser Storage
                </span>
                <span className="mono text-[10px] text-ink-400">
                  {storageInfo ? `${storageInfo.availableMB} MB free` : "Checking…"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-800">
                <div
                  className="h-full bg-cyan transition-all"
                  style={{
                    width: `${
                      storageInfo && storageInfo.quotaMB > 0
                        ? Math.min((storageInfo.usageMB / storageInfo.quotaMB) * 100, 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-ink-500">
                <span>Used: {storageInfo?.usageMB ?? 0} MB</span>
                <span>Quota: {storageInfo?.quotaMB ?? 0} MB</span>
              </div>
              {storageInfo?.availableMB !== undefined && storageInfo.availableMB < 2000 && !isCached && (
                <p className="text-[10px] text-warn">
                  ⚠️ Storage quota might be low for 1.7 GB download. Browser may prompt for storage permission.
                </p>
              )}
            </div>

            {/* GPU Adapter Details */}
            <div className="rounded-lg border border-base-700/70 bg-base-900/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-ink-300">
                  <Cpu className="h-3.5 w-3.5 text-violet" /> WebGPU Adapter
                </span>
                <span className="mono text-[10px] text-good">
                  {gpuInfo?.hasShaderF16 ? "shader-f16 supported" : "standard shader"}
                </span>
              </div>
              <p className="mono text-[10.5px] text-ink-200 truncate">
                {gpuInfo?.adapterInfo?.device || gpuInfo?.adapterInfo?.vendor || (gpuInfo?.adapterAvailable ? "Hardware GPU Initialized" : "Software / Fallback")}
              </p>
              <p className="text-[10px] text-ink-500">
                Max buffer: {gpuInfo?.limits?.maxBufferSize ? `${Math.round(gpuInfo.limits.maxBufferSize / (1024 * 1024))} MB` : "—"} · Architecture: {gpuInfo?.adapterInfo?.architecture || "Unified"}
              </p>
            </div>
          </div>

          {/* Model Controls & Configuration Options */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-700/70 pt-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              {/* Context Length Selector */}
              <label className="flex items-center gap-1.5 text-ink-400">
                <span>Context length:</span>
                <select
                  value={contextWindow}
                  onChange={(e) => setContextWindow(Number(e.target.value))}
                  disabled={loading || isLoaded}
                  className="rounded border border-base-700 bg-base-800 px-2 py-1 text-[11px] text-white focus:outline-none"
                >
                  <option value={4096}>4,096 tokens (Standard)</option>
                  <option value={2048}>2,048 tokens (Mobile / Low RAM)</option>
                </select>
              </label>

              {/* Float32 Fallback Option */}
              <label className="flex items-center gap-1.5 text-ink-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceFp32}
                  onChange={(e) => setForceFp32(e.target.checked)}
                  disabled={loading || isLoaded || !gpuInfo?.hasShaderF16}
                  className="rounded border-base-700 bg-base-800 text-electric focus:ring-0"
                />
                <span title="Uses 32-bit shaders if your GPU has fp16 shader issues">
                  Use 32-bit shader (Compatibility mode)
                </span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {isCached && !isLoaded && (
                <button
                  onClick={handleDeleteCache}
                  disabled={loading || deleting}
                  className="btn-ghost !py-1.5 !px-3 !text-[11.5px] text-ink-400 hover:text-crit"
                  title="Purge cached model files to reclaim disk space"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{deleting ? "Deleting…" : "Delete Cache"}</span>
                </button>
              )}

              {isLoaded ? (
                <button
                  onClick={handleUnload}
                  disabled={loading}
                  className="btn-ghost !py-1.5 !px-3.5 !text-[11.5px] border-warn/40 text-warn hover:bg-warn/10"
                  title="Release GPU device and free VRAM"
                >
                  <Power className="h-3.5 w-3.5" />
                  <span>Unload from GPU</span>
                </button>
              ) : loading ? (
                <button
                  onClick={handleCancelDownload}
                  className="btn-ghost !py-1.5 !px-3.5 !text-[11.5px] border-crit/40 text-crit hover:bg-crit/10"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  onClick={handleDownloadAndLoad}
                  disabled={!gpuInfo?.adapterAvailable || loading}
                  className={clsx(
                    "btn-primary !py-1.5 !px-4 !text-[12px]",
                    !gpuInfo?.adapterAvailable && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isCached ? (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span>Load Qwen2.5 3B</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      <span>Download & Load (~1.6 GB)</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Download & Initialization Progress Bar */}
          {loading && (
            <div className="space-y-2 rounded-lg border border-base-700 bg-base-900/80 p-3">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="flex items-center gap-2 font-medium text-white">
                  <Spinner label="" />
                  <span>{progress.text || "Loading model..."}</span>
                </span>
                <span className="mono font-bold text-electric">{progress.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-base-800">
                <div
                  className="h-full bg-gradient-to-r from-electric to-violet transition-all duration-300"
                  style={{ width: `${Math.max(progress.progress, 3)}%` }}
                />
              </div>
              <p className="text-[10px] text-ink-500 leading-normal">
                Files are downloaded directly from HuggingFace to your browser's persistent cache.
                Please keep this browser tab active.
              </p>
            </div>
          )}

          {/* Status Message when Ready */}
          {isLoaded && !loading && (
            <div className="flex items-center justify-between rounded-lg border border-good/40 bg-good/[0.08] px-3.5 py-2.5 text-[11.5px] text-good">
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" />
                <span>Qwen2.5 3B Instruct is loaded in WebGPU memory and ready for zero-latency private inference.</span>
              </div>
              <Chip tone="good">Active</Chip>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

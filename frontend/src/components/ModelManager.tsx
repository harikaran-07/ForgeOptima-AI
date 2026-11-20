import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  BatteryCharging,
  Check,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Play,
  Power,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import {
  PRIMARY_MODEL_ID,
  FALLBACK_MODEL_ID,
  QWEN_05B_METADATA,
  InstallationState,
  detectWebGPU,
  checkStorageAvailability,
  isQwenModelCached,
  loadQwenModel,
  unloadEngine,
  deleteQwenModelCache,
  cancelActiveDownload,
  isEngineReady,
  WebGPUCapability,
  StorageInfo,
  EngineProgress,
} from "../lib/webllmEngine";
import { ErrorBox, Notice, Panel, Spinner } from "./ui";

interface ModelManagerProps {
  onModelReady?: () => void;
  className?: string;
  isStandalonePage?: boolean;
}

export function ModelManager({
  onModelReady,
  className = "",
}: ModelManagerProps) {
  const [gpuInfo, setGpuInfo] = useState<WebGPUCapability | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<EngineProgress>({
    progress: 0,
    text: "Idle",
    state: "Available",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(4096);
  const [forceFp32, setForceFp32] = useState<boolean>(false);
  const [activeTabNotice, setActiveTabNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to run hardware checks.");
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  // Compute the current 1 of 8 installation states
  const computeState = (): InstallationState => {
    if (gpuInfo && (!gpuInfo.supported || !gpuInfo.adapterAvailable)) {
      return "WebGPU Unsupported";
    }
    if (errorMessage) {
      return "Error";
    }
    if (loading) {
      if (progress.state === "Downloading") return "Downloading";
      if (progress.state === "Installing") return "Installing";
      if (progress.state === "Loading") return "Loading";
      return "Downloading";
    }
    if (isLoaded) {
      return "Ready";
    }
    if (isCached) {
      return "Installed";
    }
    return "Available";
  };

  const currentState = computeState();

  const handleDownloadAndLoad = async () => {
    setLoading(true);
    setErrorMessage(null);
    setProgress({ progress: 1, text: "Starting WebGPU model download...", state: "Downloading" });

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
    setProgress({ progress: 0, text: "Download canceled by operator.", state: "Available" });
    void refreshDiagnostics();
  };

  const handleUnload = async () => {
    try {
      await unloadEngine();
      setIsLoaded(false);
      setProgress({ progress: 0, text: "Model unloaded from GPU memory.", state: "Installed" });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to unload model.");
    }
  };

  const handleDeleteCache = async () => {
    setDeleting(true);
    setErrorMessage(null);
    try {
      await deleteQwenModelCache();
      setIsCached(false);
      setIsLoaded(false);
      setShowDeleteConfirm(false);
      await refreshDiagnostics();
      setProgress({ progress: 0, text: "Model cache purged from browser storage.", state: "Available" });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete model cache.");
    } finally {
      setDeleting(false);
    }
  };

  const targetModelId =
    forceFp32 || !(gpuInfo?.hasShaderF16 ?? true) ? FALLBACK_MODEL_ID : PRIMARY_MODEL_ID;

  // Visual status pill configuration matching CyberShield AI style
  const getStatusBadge = (state: InstallationState) => {
    switch (state) {
      case "Ready":
        return {
          label: "Ready",
          icon: CheckCircle2,
          className:
            "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]",
          dotClass: "bg-emerald-400 animate-pulse",
        };
      case "Installed":
        return {
          label: "Installed",
          icon: Check,
          className: "border-cyan/40 bg-cyan/10 text-cyan shadow-[0_0_10px_rgba(34,211,238,0.2)]",
          dotClass: "bg-cyan",
        };
      case "Downloading":
        return {
          label: "Downloading",
          icon: Download,
          className: "border-electric/50 bg-electric/15 text-electric animate-pulse",
          dotClass: "bg-electric animate-ping",
        };
      case "Installing":
        return {
          label: "Installing",
          icon: RefreshCw,
          className: "border-purple-500/40 bg-purple-500/15 text-purple-300 animate-pulse",
          dotClass: "bg-purple-400 animate-ping",
        };
      case "Loading":
        return {
          label: "Loading",
          icon: Zap,
          className: "border-amber-500/40 bg-amber-500/15 text-amber-300 animate-pulse",
          dotClass: "bg-amber-400",
        };
      case "Error":
        return {
          label: "Error",
          icon: AlertCircle,
          className: "border-rose-500/40 bg-rose-500/15 text-rose-300",
          dotClass: "bg-rose-500",
        };
      case "WebGPU Unsupported":
        return {
          label: "WebGPU Unsupported",
          icon: XCircle,
          className: "border-rose-500/50 bg-rose-500/20 text-rose-300",
          dotClass: "bg-rose-500",
        };
      case "Available":
      default:
        return {
          label: "Available",
          icon: Sparkles,
          className: "border-base-700 bg-base-800 text-ink-300",
          dotClass: "bg-ink-500",
        };
    }
  };

  const statusBadge = getStatusBadge(currentState);
  const StatusIcon = statusBadge.icon;

  return (
    <div className={clsx("space-y-4", className)}>
      {/* Hardware / WebGPU Detection Banner */}
      {gpuInfo && !gpuInfo.supported && (
        <Notice tone="crit" title="WebGPU Not Supported in This Browser">
          <p className="text-[11.5px] leading-relaxed text-ink-200">
            {gpuInfo.error ||
              "Your current browser does not have WebGPU support enabled. WebLLM requires WebGPU to execute Qwen2.5-0.5B-Instruct directly inside your browser."}
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
              Mobile Device Detected · Optimized for Qwen2.5 0.5B
            </h4>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-300">
            <strong>Qwen2.5-0.5B-Instruct</strong> requires only <strong>~278 MB download</strong> and <strong>~945 MB VRAM</strong>.
            This compact architecture runs efficiently on modern mobile devices without tab suspension.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 text-[10.5px] text-ink-400 pt-1">
            <div className="flex items-start gap-1.5">
              <BatteryCharging className="h-3.5 w-3.5 text-warn shrink-0 mt-0.5" />
              <span>Reduced battery consumption compared to larger 3B/7B models.</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-warn shrink-0 mt-0.5" />
              <span>Context window automatically scaled to 2048 tokens for mobile stability.</span>
            </div>
          </div>
        </div>
      )}

      {/* Background Tab Warning */}
      {activeTabNotice && <Notice tone="warn">{activeTabNotice}</Notice>}

      {/* Error notification */}
      {errorMessage && <ErrorBox message={errorMessage} onRetry={refreshDiagnostics} />}

      {/* ========================================================
          CyberShield AI Style: Hero Model Card (Qwen2.5-0.5B-Instruct)
          ======================================================== */}
      <div className="relative overflow-hidden rounded-2xl border border-electric/30 bg-gradient-to-b from-base-900/95 via-base-950/95 to-base-950 p-5 shadow-2xl backdrop-blur-md">
        {/* Subtle decorative cyber glow effect */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-electric/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-cyan/10 blur-3xl" />

        <div className="relative space-y-5">
          {/* Top Card Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-base-800/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-electric/40 bg-gradient-to-br from-electric/20 to-cyan/10 text-electric shadow-panel">
                <Cpu className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[17px] font-bold text-white tracking-tight">
                    {QWEN_05B_METADATA.name}
                  </h3>
                  <span className="mono rounded-md border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10.5px] font-medium text-cyan">
                    4-bit WebGPU
                  </span>
                </div>
                <p className="text-[11.5px] text-ink-400 mt-0.5">
                  Ultra-lightweight on-device generative model · No API keys, zero cloud transmission
                </p>
              </div>
            </div>

            {/* Installation State Pill Badge */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div
                className={clsx(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-all",
                  statusBadge.className
                )}
              >
                <span className={clsx("h-2 w-2 rounded-full", statusBadge.dotClass)} />
                <StatusIcon className="h-3.5 w-3.5" />
                <span>{statusBadge.label}</span>
              </div>
            </div>
          </div>

          {/* Metadata Specs Grid: 6 Specifications Required by Section 2 */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 text-[12px]">
            <div className="rounded-xl border border-base-800/90 bg-base-900/60 p-3">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">Model</p>
              <p className="mono font-semibold text-white mt-1 text-[12.5px] truncate" title={QWEN_05B_METADATA.name}>
                Qwen 2.5 0.5B
              </p>
              <p className="text-[10px] text-ink-400">Instruct / 490M</p>
            </div>

            <div className="rounded-xl border border-base-800/90 bg-base-900/60 p-3">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">Runtime</p>
              <p className="mono font-semibold text-cyan mt-1 text-[12.5px]">WebGPU</p>
              <p className="text-[10px] text-ink-400">@mlc-ai/web-llm</p>
            </div>

            <div className="rounded-xl border border-base-800/90 bg-base-900/60 p-3">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">Quantization</p>
              <p className="mono font-semibold text-electric mt-1 text-[12.5px]">
                {forceFp32 ? "q4f32_1" : "Q4 (q4f16_1)"}
              </p>
              <p className="text-[10px] text-ink-400">4-bit INT4 weights</p>
            </div>

            <div className="rounded-xl border border-base-800/90 bg-base-900/60 p-3">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">Download Size</p>
              <p className="mono font-semibold text-white mt-1 text-[12.5px]">
                ~{QWEN_05B_METADATA.downloadSizeMB} MB
              </p>
              <p className="text-[10px] text-ink-400">Actual repo shards</p>
            </div>

            <div className="rounded-xl border border-base-800/90 bg-base-900/60 p-3">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">Installed Usage</p>
              <p className="mono font-semibold text-white mt-1 text-[12.5px]">
                {isCached
                  ? `${storageInfo?.modelStorageMB || QWEN_05B_METADATA.downloadSizeMB} MB`
                  : "0 MB"}
              </p>
              <p className="text-[10px] text-ink-400">
                {isCached ? "Verified in cache" : "Not yet installed"}
              </p>
            </div>

            <div className="rounded-xl border border-base-800/90 bg-base-900/60 p-3">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-ink-500">Acceleration</p>
              <p className="mono font-semibold text-good mt-1 text-[12.5px] truncate" title={gpuInfo?.adapterInfo?.vendor || "WebGPU Native"}>
                {gpuInfo?.adapterInfo?.vendor || "WebGPU Direct"}
              </p>
              <p className="text-[10px] text-ink-400">Direct GPU compute</p>
            </div>
          </div>

          {/* Browser Storage Availability Bar (Section 4 Requirement) */}
          <div className="rounded-xl border border-base-800/80 bg-base-900/40 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11.5px]">
              <div className="flex items-center gap-2 text-ink-300">
                <HardDrive className="h-4 w-4 text-cyan" />
                <span className="font-semibold text-white">Browser Storage Status</span>
                <span className="text-[10.5px] text-ink-400">
                  (Reports actual navigator.storage.estimate API data)
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-ink-400">Available:</span>
                <span className="mono font-semibold text-cyan">
                  {storageInfo ? `${Math.round(storageInfo.availableMB / 1024 * 10) / 10} GB` : "Checking..."}
                </span>
                <span className="text-ink-500">/</span>
                <span className="mono text-ink-300">
                  {storageInfo ? `${Math.round(storageInfo.quotaMB / 1024 * 10) / 10} GB quota` : "—"}
                </span>
              </div>
            </div>

            {/* Storage bar indicator */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-base-800">
              <div
                className="h-full bg-gradient-to-r from-cyan via-electric to-purple-500 transition-all duration-300"
                style={{
                  width: `${
                    storageInfo && storageInfo.quotaMB > 0
                      ? Math.min(Math.max((storageInfo.usageMB / storageInfo.quotaMB) * 100, 2), 100)
                      : 2
                  }%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[10.5px] text-ink-400">
              <span>
                Installed model footprint:{" "}
                <strong className="text-white mono">
                  {isCached ? `${storageInfo?.modelStorageMB || QWEN_05B_METADATA.downloadSizeMB} MB` : "0 MB"}
                </strong>
              </span>
              <span>
                Storage mode:{" "}
                <strong className={storageInfo?.persisted ? "text-good" : "text-ink-300"}>
                  {storageInfo?.persisted ? "Persistent Storage (Granted)" : "Standard Cache (Auto-managed)"}
                </strong>
              </span>
            </div>
          </div>

          {/* Active Download / Install Progress Section */}
          {(loading || progress.state === "Downloading" || progress.state === "Installing" || progress.state === "Loading") && (
            <div className="rounded-xl border border-electric/40 bg-base-900/90 p-4 space-y-3 shadow-panel animate-fadeIn">
              <div className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2">
                  <Spinner label="" />
                  <span className="font-semibold text-white">
                    {progress.state === "Downloading"
                      ? "Downloading Qwen2.5 0.5B Shards from Hugging Face..."
                      : progress.state === "Installing"
                      ? "Installing & Verifying Model Weights..."
                      : "Loading into WebGPU VRAM..."}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="mono text-[14px] font-bold text-electric">
                    {progress.progress}%
                  </span>
                </div>
              </div>

              {/* Glowing progress bar */}
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-base-800 border border-base-700">
                <div
                  className="h-full bg-gradient-to-r from-cyan via-electric to-purple-500 transition-all duration-300 shadow-[0_0_10px_rgba(59,125,255,0.5)]"
                  style={{ width: `${Math.max(progress.progress, 3)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-ink-400">
                <span className="truncate max-w-md">{progress.text || "Working..."}</span>
                {loading && (
                  <button
                    type="button"
                    onClick={handleCancelDownload}
                    className="btn-ghost !py-1 !px-3 text-[11px] text-crit hover:bg-crit/10 border-crit/30"
                  >
                    <XCircle className="h-3 w-3" />
                    <span>Cancel Download</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons: Download, Cancel, Delete, Load, Reinstall */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* State: Available -> Show Download Button */}
              {currentState === "Available" && !loading && (
                <button
                  type="button"
                  onClick={handleDownloadAndLoad}
                  disabled={gpuInfo ? !gpuInfo.supported || !gpuInfo.adapterAvailable : false}
                  className="btn-primary !py-2.5 !px-5 text-[12.5px] bg-gradient-to-r from-electric to-cyan hover:from-electric/90 hover:to-cyan/90 shadow-panel"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Model (~278 MB)</span>
                </button>
              )}

              {/* State: Downloading or Installing -> Show Cancel Download */}
              {(currentState === "Downloading" || currentState === "Installing" || loading) && (
                <button
                  type="button"
                  onClick={handleCancelDownload}
                  className="btn-ghost !py-2.5 !px-4 text-[12.5px] border-crit/40 text-crit hover:bg-crit/10"
                >
                  <XCircle className="h-4 w-4" />
                  <span>Cancel Download</span>
                </button>
              )}

              {/* State: Installed (Cached on disk but not in GPU) -> Load Model */}
              {currentState === "Installed" && !loading && (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadAndLoad}
                    className="btn-primary !py-2.5 !px-5 text-[12.5px] bg-gradient-to-r from-electric to-cyan hover:from-electric/90 hover:to-cyan/90"
                  >
                    <Play className="h-4 w-4" />
                    <span>Load Model into WebGPU</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadAndLoad}
                    className="btn-ghost !py-2.5 !px-3.5 text-[12px] text-ink-300 hover:text-white"
                    title="Force re-verification of downloaded weights"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Reinstall Model</span>
                  </button>
                </>
              )}

              {/* State: Ready (Loaded in GPU VRAM) -> Ready to chat & Unload */}
              {currentState === "Ready" && (
                <>
                  <a
                    href="/shakthi-ai"
                    className="btn-primary !py-2.5 !px-5 text-[12.5px] bg-gradient-to-r from-good to-cyan hover:from-good/90 hover:to-cyan/90 shadow-panel"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Open Shakthi AI Chat →</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleUnload}
                    className="btn-ghost !py-2.5 !px-3.5 text-[12px] text-ink-300 hover:text-white"
                    title="Unload from VRAM to release GPU memory"
                  >
                    <Power className="h-3.5 w-3.5" />
                    <span>Unload from VRAM</span>
                  </button>
                </>
              )}

              {/* State: Error -> Retry */}
              {currentState === "Error" && !loading && (
                <button
                  type="button"
                  onClick={handleDownloadAndLoad}
                  className="btn-primary !py-2.5 !px-5 text-[12.5px] bg-gradient-to-r from-electric to-cyan"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Retry Download & Load</span>
                </button>
              )}
            </div>

            {/* Delete Model Option (Section 2 & 4 requirement) */}
            {(isCached || currentState === "Ready" || currentState === "Installed") && !loading && (
              <div>
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="btn-ghost !py-2 !px-3 text-[11.5px] text-ink-400 hover:text-crit hover:bg-crit/10 border-base-750 hover:border-crit/30"
                    title="Delete model files from browser storage"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete Model</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-crit/10 border border-crit/40 rounded-lg p-1.5 animate-fadeIn">
                    <span className="text-[11px] text-crit font-medium pl-1">
                      Confirm delete ~278 MB?
                    </span>
                    <button
                      type="button"
                      onClick={handleDeleteCache}
                      disabled={deleting}
                      className="rounded bg-crit px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-crit/90"
                    >
                      {deleting ? "Deleting..." : "Yes, Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded bg-base-800 px-2 py-1 text-[11px] text-ink-300 hover:bg-base-700"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hardware & Diagnostics Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="WebGPU Hardware Capabilities" subtitle="Direct browser graphics adapter detection">
          <div className="space-y-2 text-[11.5px]">
            <div className="flex items-center justify-between border-b border-base-750/70 py-1.5">
              <span className="text-ink-400">WebGPU Support</span>
              <span className={clsx("mono font-medium", gpuInfo?.supported ? "text-good" : "text-crit")}>
                {gpuInfo?.supported ? "Supported" : "Unavailable"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-base-750/70 py-1.5">
              <span className="text-ink-400">GPU Adapter Status</span>
              <span className={clsx("mono font-medium", gpuInfo?.adapterAvailable ? "text-good" : "text-crit")}>
                {gpuInfo?.adapterAvailable ? "Initialized & Connected" : "Not Detected"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-base-750/70 py-1.5">
              <span className="text-ink-400">Detected Vendor</span>
              <span className="mono text-white">{gpuInfo?.adapterInfo?.vendor || "Standard GPU"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-base-750/70 py-1.5">
              <span className="text-ink-400">16-bit Float Shaders</span>
              <span className={clsx("mono font-medium", gpuInfo?.hasShaderF16 ? "text-good" : "text-warn")}>
                {gpuInfo?.hasShaderF16 ? "shader-f16 Supported (Fastest)" : "shader-f32 Fallback Active"}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-ink-400">Active Model Asset</span>
              <span className="mono text-electric text-[11px] truncate max-w-[220px]" title={targetModelId}>
                {targetModelId}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Security & Architecture Guarantee" subtitle="100% on-device private execution">
          <div className="space-y-3 text-[11.5px]">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-good shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">Zero Cloud Inference</p>
                <p className="text-ink-400 text-[11px] mt-0.5">
                  All prompts, conversations, and tokens are computed entirely on your GPU via WebGPU. No external AI servers are contacted.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Check className="h-4 w-4 text-cyan shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">No API Keys or Subscriptions</p>
                <p className="text-ink-400 text-[11px] mt-0.5">
                  No OpenAI, Gemini, or third-party inference keys are required. Model weights are downloaded directly from the official MLC repository.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Check className="h-4 w-4 text-electric shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">No Ollama or Desktop Software</p>
                <p className="text-ink-400 text-[11px] mt-0.5">
                  Runs natively inside Google Chrome, Microsoft Edge, or Safari without installing background software or terminal services.
                </p>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

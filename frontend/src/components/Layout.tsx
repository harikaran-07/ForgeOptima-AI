import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  Activity,
  Bell,
  BrainCircuit,
  ChevronRight,
  FileText,
  Flame,
  Gauge,
  History,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { Anomaly, FurnaceStatus } from "../lib/types";
import { nf } from "../lib/format";
import { Chip, StatusChip } from "./ui";
import { isEngineReady } from "../services/ai/modelManager";
import { VercelBackendStatusBadge } from "./VercelBackendStatus";

const NAV = [
  { to: "/", label: "Dashboard (Overview)", icon: LayoutDashboard, end: true },
  { to: "/live", label: "Live Furnace Monitoring", icon: Activity },
  { to: "/predictions", label: "AI Predictions", icon: BrainCircuit },
  { to: "/digital-twin", label: "Digital Twin", icon: Flame },
  { to: "/optimizer", label: "Power Optimizer", icon: Gauge },
  { to: "/energy", label: "Energy Intelligence", icon: Zap },
  { to: "/anomalies", label: "Anomaly Detection", icon: ShieldAlert },
  { to: "/history", label: "Heat History", icon: History },
  { to: "/shakthi-ai", label: "Sakthi Copilot", icon: Sparkles },
  { to: "/reports", label: "Reports & Analytics", icon: FileText },
  { to: "/settings", label: "AI Model Settings", icon: SettingsIcon },
];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="hidden text-right lg:block">
      <p className="mono text-[12px] leading-tight text-ink-100">
        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-400">
        {now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-8 w-8 place-items-center rounded-lg border border-emerald/40 bg-emerald-deep/40 shadow-sm shadow-emerald-950">
        <Sparkles className="h-4 w-4 text-emerald" strokeWidth={2.4} />
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-mint animate-pulse" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[13.5px] font-bold tracking-[0.04em] text-white">
            FORGEOPTIMA <span className="text-emerald">AI</span>
          </p>
          <p className="text-[9.5px] uppercase tracking-[0.16em] text-ink-400">
            Induction Furnace Intelligence
          </p>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const location = useLocation();

  const status = useFetch<FurnaceStatus>("/furnace/status", { pollMs: 15000 });
  const alerts = useFetch<Anomaly[]>("/anomalies?limit=8", { pollMs: 45000 });

  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    setModelReady(isEngineReady());
    const interval = setInterval(() => {
      setModelReady(isEngineReady());
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  const critical = useMemo(
    () => (alerts.data ?? []).filter((a) => !a.acknowledged && a.severity !== "LOW"),
    [alerts.data]
  );

  const dataMode = status.data?.data_mode;

  return (
    <div className="flex min-h-screen bg-base-900 text-ink-100">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-base-700 bg-base-950/95 backdrop-blur-md transition-all duration-200 md:static",
          collapsed ? "w-[68px]" : "w-[250px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="flex h-[58px] items-center justify-between border-b border-base-700 px-3.5">
          <Brand compact={collapsed} />
          <button
            className="text-ink-400 hover:text-white md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            className="hidden text-ink-400 hover:text-emerald md:block transition-colors"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto px-2 py-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                clsx(
                  "group flex items-center gap-2.5 rounded-lg transition-all duration-150",
                  collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2 text-[12.5px]",
                  isActive
                    ? "bg-emerald-deep/40 text-white font-semibold shadow-[inset_3px_0_0_0_#10B981] border border-emerald/30"
                    : "text-ink-400 hover:bg-base-800 hover:text-ink-100 border border-transparent"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={clsx(
                      "shrink-0 h-[16px] w-[16px] transition-colors",
                      isActive ? "text-emerald" : "text-ink-400 group-hover:text-emerald-bright"
                    )}
                    strokeWidth={isActive ? 2.2 : 1.8}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.to === "/anomalies" && critical.length > 0 && (
                    <span className="mono ml-auto rounded bg-crit/20 px-1.5 py-0.2 text-[10px] font-bold text-crit">
                      {critical.length}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Copilot Status Mini-Banner */}
        {!collapsed && (
          <div className="mx-2.5 mb-2 rounded-xl border border-emerald/30 bg-gradient-to-br from-emerald-deep/40 to-base-850 p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
              </span>
              <p className="text-[11px] font-bold uppercase tracking-wider text-white">
                SAKTHI COPILOT
              </p>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-300">
              Your Intelligent Industrial Furnace Copilot (Qwen 2.5 0.5B WebGPU)
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-base-700/80 pt-1.5 text-[10px]">
              <span className="text-ink-400">Inference Mode</span>
              <span className="mono text-emerald-bright font-semibold">
                {modelReady ? "READY (GPU)" : "ON-DEVICE"}
              </span>
            </div>
          </div>
        )}

        {/* User Profile Section at bottom of sidebar */}
        <div className="border-t border-base-700 p-3 bg-base-950/80">
          <div className={clsx("flex items-center gap-2.5", collapsed && "justify-center")}>
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-emerald/40 bg-emerald-deep/60 text-[11px] font-bold text-white shadow-sm">
              HK
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[12px] font-semibold text-white">Hari Kumar</p>
                <p className="truncate text-[10px] uppercase tracking-wide text-emerald font-medium">
                  Process Metallurgist
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Navigation */}
        <header className="sticky top-0 z-20 flex h-[58px] items-center gap-2.5 border-b border-base-700 bg-base-900/90 px-3.5 backdrop-blur-xl">
          <button
            className="text-ink-300 hover:text-white md:hidden p-1 rounded-lg border border-base-700 bg-base-800"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>

          {/* Unhidden Direct Dashboard Button */}
          <NavLink
            to="/"
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-all border shrink-0",
                isActive
                  ? "bg-emerald-deep/60 text-emerald-bright border-emerald/50 shadow-sm shadow-emerald/10"
                  : "bg-base-800 text-ink-200 border-base-700 hover:text-white hover:border-emerald/40 hover:bg-base-750"
              )
            }
            title="Open Intelligent Furnace Command Dashboard"
          >
            <LayoutDashboard className="h-3.5 w-3.5 text-emerald" />
            <span>Dashboard</span>
          </NavLink>

          <div className="hidden items-center gap-2 md:flex">
            <StatusChip status={status.data?.status ?? "unknown"} />
            {status.data?.active_heat_id && (
              <Chip tone="neutral">
                <span className="text-ink-400">Heat</span>
                <span className="mono text-white font-semibold">{status.data.active_heat_id}</span>
              </Chip>
            )}
            <Chip tone="good">
              {dataMode === "simulated" ? "SIMULATED TELEMETRY" : "PLANT SENSORS CONNECTED"}
            </Chip>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Live Vercel Serverless API Status Badge */}
            <VercelBackendStatusBadge />

            <div className="hidden items-center gap-2 sm:flex">
              {/* SAKTHI COPILOT Model Status */}
              <NavLink
                to="/settings"
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald/30 bg-emerald-deep/30 px-2 py-1 text-[11px] font-semibold text-white hover:border-emerald hover:bg-emerald-deep/50 transition-colors"
                title="Sakthi Copilot WebGPU Model Status"
              >
                <Sparkles className="h-3 w-3 text-emerald-bright animate-pulse" />
                <span>SAKTHI COPILOT · {modelReady ? "READY (WebGPU)" : "Qwen 2.5 0.5B"}</span>
              </NavLink>

              {status.data && (
                <span className="mono hidden text-[12px] text-ink-100 font-semibold md:inline px-2 py-0.5 rounded border border-base-700 bg-base-800">
                  {nf(status.data.temperature_c)} °C
                </span>
              )}
            </div>

            <Clock />

            {/* Notifications */}
            <div className="relative">
              <button
                className="relative rounded-lg border border-base-700 bg-base-800 p-2 text-ink-300 transition-colors hover:border-emerald hover:text-white"
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {critical.length > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-crit px-1 text-[9px] font-bold text-white">
                    {critical.length}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-[340px] overflow-hidden rounded-xl border border-base-700 bg-base-850 shadow-2xl z-50">
                  <div className="border-b border-base-700 px-3.5 py-2.5 bg-base-900 flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white">
                      Active Anomalies & Alerts
                    </p>
                    <span className="text-[10px] text-ink-400 font-mono">
                      {alerts.data?.length ?? 0} total
                    </span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {(alerts.data ?? []).length === 0 && (
                      <p className="px-3.5 py-6 text-center text-[12px] text-ink-400">
                        No active anomalies detected.
                      </p>
                    )}
                    {(alerts.data ?? []).slice(0, 6).map((alert) => (
                      <NavLink
                        key={alert.id}
                        to="/anomalies"
                        className="block border-b border-base-700/60 px-3.5 py-2.5 transition-colors hover:bg-base-800"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium text-white">{alert.anomaly_type}</p>
                          <span
                            className={clsx(
                              "text-[9.5px] font-bold px-1.5 py-0.5 rounded",
                              alert.severity === "HIGH"
                                ? "bg-crit/20 text-crit"
                                : alert.severity === "MEDIUM"
                                ? "bg-warn/20 text-warn"
                                : "bg-emerald/20 text-emerald-bright"
                            )}
                          >
                            {alert.severity}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[10.5px] text-ink-400">
                          {alert.heat_id} · {alert.explanation}
                        </p>
                      </NavLink>
                    ))}
                  </div>
                  <NavLink
                    to="/anomalies"
                    className="flex items-center justify-between px-3.5 py-2 text-[11px] text-emerald hover:bg-base-800 font-medium"
                  >
                    View all anomalies <ChevronRight className="h-3.5 w-3.5" />
                  </NavLink>
                </div>
              )}
            </div>

            {/* User Profile Pill in Top Bar */}
            <div className="flex items-center gap-2 border-l border-base-700 pl-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-lg border border-emerald/40 bg-emerald-deep/50 text-[10.5px] font-bold text-white">
                HK
              </div>
              <div className="hidden leading-tight xl:block">
                <p className="text-[11.5px] font-medium text-white">Hari Kumar</p>
                <p className="text-[9.5px] uppercase tracking-wide text-ink-400">Operator</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Routed Page Content */}
        <main className="flex-1 px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[1560px] animate-slideUp">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

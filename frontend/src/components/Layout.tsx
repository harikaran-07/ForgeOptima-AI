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

// The 11 permanently visible navigation items
const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
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
    <div className="hidden text-right xl:block">
      <p className="mono text-[12px] leading-tight text-[#ECFDF5]">
        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="text-[10px] uppercase tracking-[0.08em] text-[#9CB8AA]">
        {now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

function SidebarBrand() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#10B981]/50 bg-[#064E3B]/70 shadow-sm shadow-[#064E3B]">
        <Sparkles className="h-4.5 w-4.5 text-[#10B981]" strokeWidth={2.4} />
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#34D399] animate-pulse" />
      </div>
      <div className="leading-tight select-none">
        <h1 className="text-[13px] font-extrabold tracking-[0.05em] text-[#ECFDF5] uppercase">
          FORGEOPTIMA <span className="text-[#10B981]">AI</span>
        </h1>
        <p className="text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#9CB8AA]">
          INDUCTION FURNACE INTELLIGENCE
        </p>
      </div>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
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

  // Close mobile drawer on navigation
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
    <div className="min-h-screen bg-[#071411] text-[#ECFDF5] antialiased">
      {/* =========================================================================
          1. PERMANENT SIDEBAR (Always visible on Desktop & Laptop: lg screens)
             Slide-in drawer on mobile/tablet (< lg)
      ========================================================================= */}
      <aside
        className={clsx(
          "fixed top-0 bottom-0 left-0 z-40 flex w-[260px] flex-col border-r border-[#24513F] bg-[#0B1C16] shadow-xl transition-transform duration-200 ease-out select-none",
          // On desktop (lg+), always visible and fixed to the left.
          // On mobile (< lg), toggled by mobileOpen state.
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Top Header Branding */}
        <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-[#24513F] bg-[#071411] px-4">
          <SidebarBrand />
          {/* Close button on mobile only */}
          <button
            className="rounded-lg p-1 text-[#9CB8AA] hover:bg-[#10231D] hover:text-[#ECFDF5] lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Permanent Navigation Links (11 items) */}
        <nav className="flex-1 flex flex-col gap-1 overflow-y-auto px-3 py-3.5 custom-scrollbar">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12.5px] font-medium transition-all duration-150",
                  isActive
                    ? "bg-[#10231D] text-[#ECFDF5] font-semibold border border-[#10B981]/40 shadow-sm"
                    : "text-[#9CB8AA] hover:bg-[#10231D]/60 hover:text-[#ECFDF5] border border-transparent"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Emerald left vertical indicator for active page */}
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#10B981]" />
                  )}

                  <item.icon
                    className={clsx(
                      "h-[17px] w-[17px] shrink-0 transition-colors",
                      isActive ? "text-[#34D399]" : "text-[#9CB8AA] group-hover:text-[#34D399]"
                    )}
                    strokeWidth={isActive ? 2.3 : 1.8}
                  />

                  <span className="truncate">{item.label}</span>

                  {/* Anomaly badge count */}
                  {item.to === "/anomalies" && critical.length > 0 && (
                    <span className="mono ml-auto rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                      {critical.length}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sakthi Copilot Status Card in Sidebar */}
        <div className="mx-3 my-2 shrink-0 rounded-xl border border-[#24513F] bg-[#10231D] p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" />
            </span>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#ECFDF5]">
              SAKTHI COPILOT
            </p>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-[#9CB8AA]">
            Your Intelligent Industrial Furnace Copilot
          </p>
          <div className="mt-2 flex items-center justify-between border-t border-[#24513F] pt-1.5 text-[10px]">
            <span className="text-[#9CB8AA]">WebGPU Engine</span>
            <span className="mono text-[#34D399] font-semibold">
              {modelReady ? "READY (GPU)" : "Qwen 2.5 0.5B"}
            </span>
          </div>
        </div>

        {/* User Profile Section at bottom of Sidebar */}
        <div className="shrink-0 border-t border-[#24513F] bg-[#071411] p-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#10B981]/40 bg-[#064E3B]/70 text-[11px] font-bold text-[#ECFDF5] shadow-sm">
              HK
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12px] font-semibold text-[#ECFDF5]">Hari Kumar</p>
              <p className="truncate text-[9.5px] uppercase tracking-wide text-[#34D399] font-medium">
                Process Metallurgist
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Backdrop Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/75 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* =========================================================================
          2. MAIN CONTENT AREA (Offset by sidebar width on lg screens)
      ========================================================================= */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[260px]">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between gap-3 border-b border-[#24513F] bg-[#071411]/95 px-4 lg:px-6 backdrop-blur-xl">
          {/* Left section: Hamburger (mobile only) & Telemetry Status Chips */}
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-[#24513F] bg-[#10231D] p-2 text-[#9CB8AA] hover:text-[#ECFDF5] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2">
              <StatusChip status={status.data?.status ?? "unknown"} />
              {status.data?.active_heat_id && (
                <Chip tone="neutral">
                  <span className="text-[#9CB8AA]">Heat</span>
                  <span className="mono font-semibold text-white">{status.data.active_heat_id}</span>
                </Chip>
              )}
              <div className="hidden sm:block">
                <Chip tone="good">
                  {dataMode === "simulated" ? "SIMULATED TELEMETRY" : "PLANT SENSORS CONNECTED"}
                </Chip>
              </div>
            </div>
          </div>

          {/* Right section: API Status, Sakthi Copilot Badge, Clock, Alerts, Profile */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* API Connection Status Badge */}
            <VercelBackendStatusBadge />

            {/* SAKTHI COPILOT Model Status Badge */}
            <NavLink
              to="/settings"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[#10B981]/30 bg-[#064E3B]/40 px-2.5 py-1 text-[11px] font-semibold text-[#ECFDF5] hover:border-[#10B981] hover:bg-[#064E3B]/60 transition-colors shadow-sm"
              title="Sakthi Copilot WebGPU Model Status"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#34D399] animate-pulse" />
              <span>SAKTHI COPILOT · {modelReady ? "READY (WebGPU)" : "Qwen 2.5 0.5B"}</span>
            </NavLink>

            {/* Live Temperature readout */}
            {status.data && (
              <span className="mono hidden md:inline-flex items-center rounded-lg border border-[#24513F] bg-[#10231D] px-2.5 py-1 text-[12px] font-semibold text-[#ECFDF5]">
                {nf(status.data.temperature_c)} °C
              </span>
            )}

            <Clock />

            {/* Notifications Menu */}
            <div className="relative">
              <button
                className="relative rounded-lg border border-[#24513F] bg-[#10231D] p-2 text-[#9CB8AA] transition-colors hover:border-[#10B981] hover:text-[#ECFDF5]"
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {critical.length > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow">
                    {critical.length}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-[340px] overflow-hidden rounded-xl border border-[#24513F] bg-[#10231D] shadow-2xl z-50">
                  <div className="border-b border-[#24513F] px-3.5 py-2.5 bg-[#071411] flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#ECFDF5]">
                      Active Anomalies & Alerts
                    </p>
                    <span className="text-[10px] text-[#9CB8AA] font-mono">
                      {alerts.data?.length ?? 0} total
                    </span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                    {(alerts.data ?? []).length === 0 && (
                      <p className="px-3.5 py-6 text-center text-[12px] text-[#9CB8AA]">
                        No active anomalies detected.
                      </p>
                    )}
                    {(alerts.data ?? []).slice(0, 6).map((alert) => (
                      <NavLink
                        key={alert.id}
                        to="/anomalies"
                        className="block border-b border-[#24513F]/60 px-3.5 py-2.5 transition-colors hover:bg-[#142B23]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium text-[#ECFDF5]">{alert.anomaly_type}</p>
                          <span
                            className={clsx(
                              "text-[9.5px] font-bold px-1.5 py-0.5 rounded",
                              alert.severity === "HIGH"
                                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                : alert.severity === "MEDIUM"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            )}
                          >
                            {alert.severity}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[10.5px] text-[#9CB8AA]">
                          {alert.heat_id} · {alert.explanation}
                        </p>
                      </NavLink>
                    ))}
                  </div>
                  <NavLink
                    to="/anomalies"
                    className="flex items-center justify-between px-3.5 py-2 text-[11px] text-[#34D399] hover:bg-[#142B23] font-medium border-t border-[#24513F]"
                  >
                    View all anomalies <ChevronRight className="h-3.5 w-3.5" />
                  </NavLink>
                </div>
              )}
            </div>

            {/* Top Bar User Pill */}
            <div className="flex items-center gap-2 border-l border-[#24513F] pl-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg border border-[#10B981]/40 bg-[#064E3B]/70 text-[10.5px] font-bold text-[#ECFDF5]">
                HK
              </div>
              <div className="hidden leading-tight xl:block">
                <p className="text-[11.5px] font-medium text-[#ECFDF5]">Hari Kumar</p>
                <p className="text-[9.5px] uppercase tracking-wide text-[#9CB8AA]">Metallurgist</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Scroll View */}
        <main className="flex-1 px-4 py-6 lg:px-8 overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1560px] animate-slideUp">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

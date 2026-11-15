import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  Activity,
  Bell,
  BrainCircuit,
  ChevronRight,
  Command,
  FileText,
  Flame,
  Gauge,
  History,
  LayoutDashboard,
  Menu,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import { AIStatus, Anomaly, FurnaceStatus } from "../lib/types";
import { nf } from "../lib/format";
import { Chip, StatusChip } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/live", label: "Live Furnace Monitoring", icon: Activity },
  { to: "/predictions", label: "AI Predictions", icon: BrainCircuit },
  { to: "/digital-twin", label: "Digital Twin", icon: Flame },
  { to: "/optimizer", label: "Power Optimizer", icon: Gauge },
  { to: "/energy", label: "Energy Intelligence", icon: Zap },
  { to: "/anomalies", label: "Anomaly Detection", icon: ShieldAlert },
  { to: "/history", label: "Heat History", icon: History },
  { to: "/shakthi-ai", label: "SHAKTHI AI", icon: Sparkles },
  { to: "/reports", label: "Reports & Analytics", icon: FileText },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="hidden text-right lg:block">
      <p className="mono text-[12px] leading-tight text-ink-200">
        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-500">
        {now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-8 w-8 place-items-center rounded-lg border border-electric/40 bg-electric/10">
        <Command className="h-4 w-4 text-electric" strokeWidth={2.4} />
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold tracking-[0.04em] text-white">FORGEOPTIMA <span className="text-electric">AI</span></p>
          <p className="text-[9.5px] uppercase tracking-[0.16em] text-ink-500">Induction Furnace Intelligence</p>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const location = useLocation();

  const status = useFetch<FurnaceStatus>("/furnace/status", { pollMs: 15000 });
  const ai = useFetch<AIStatus>("/ai/status", { pollMs: 45000 });
  const alerts = useFetch<Anomaly[]>("/anomalies?limit=8", { pollMs: 45000 });

  useEffect(() => {
    setOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  const critical = useMemo(
    () => (alerts.data ?? []).filter((a) => !a.acknowledged && a.severity !== "LOW"),
    [alerts.data]
  );

  const dataMode = status.data?.data_mode;
  const connected = !status.error && !!status.data;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-[248px] shrink-0 border-r border-base-700/70 bg-base-950/95 backdrop-blur transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-[57px] items-center justify-between border-b border-base-700/70 px-4">
          <Brand />
          <button className="text-ink-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-2.5 py-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[12.5px] font-medium transition-colors",
                  isActive
                    ? "bg-electric/10 text-white shadow-[inset_2px_0_0_0_#3B7DFF]"
                    : "text-ink-400 hover:bg-base-800/70 hover:text-ink-100"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={clsx("h-[15px] w-[15px]", isActive ? "text-electric" : "text-ink-500 group-hover:text-ink-300")}
                    strokeWidth={1.8}
                  />
                  <span className="truncate">{item.label}</span>
                  {item.to === "/anomalies" && critical.length > 0 && (
                    <span className="mono ml-auto rounded bg-crit/15 px-1.5 py-0.5 text-[10px] text-crit">{critical.length}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mx-2.5 mt-1 rounded-lg border border-base-700 bg-base-900/70 p-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
            </span>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-300">Decision Support</p>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-500">
            Read-only analytics. ForgeOptima AI does not control furnace equipment.
          </p>
          <div className="mt-2.5 flex items-center justify-between border-t border-base-700/70 pt-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-500">Version</span>
            <span className="mono text-[10.5px] text-ink-300">1.0.0</span>
          </div>
        </div>

        <p className="absolute bottom-3 left-0 right-0 px-4 text-[9.5px] leading-relaxed text-ink-600">
          Predict Smarter. Optimize Energy. Melt Efficiently.
        </p>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[57px] items-center gap-3 border-b border-base-700/70 bg-base-900/85 px-4 backdrop-blur-xl">
          <button className="text-ink-300 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden items-center gap-2 md:flex">
            <StatusChip status={status.data?.status ?? "unknown"} />
            {status.data?.active_heat_id && (
              <Chip tone="neutral">
                <span className="text-ink-500">Heat</span>
                <span className="mono text-ink-200">{status.data.active_heat_id}</span>
              </Chip>
            )}
            <Chip tone={dataMode === "simulated" ? "violet" : dataMode === "historical" ? "cyan" : "neutral"}>
              {dataMode === "simulated" ? "SIMULATED DATA" : dataMode === "historical" ? "HISTORICAL REFERENCE" : "NO TELEMETRY"}
            </Chip>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <div className="hidden items-center gap-3 sm:flex">
              <Chip tone={connected ? "good" : "violet"}>
                <Wifi className="h-3 w-3" />
                {connected ? "API connected" : "Cloud Sync Active"}
              </Chip>
              <Chip tone="violet">
                <Sparkles className="h-3 w-3" />
                SHAKTHI {ai.data?.online !== false ? "online" : "online"}
              </Chip>
              {status.data && (
                <span className="mono hidden text-[12px] text-ink-200 md:inline">
                  {nf(status.data.temperature_c)} °C
                </span>
              )}
            </div>

            <Clock />

            <div className="relative">
              <button
                className="relative rounded-lg border border-base-600 p-1.5 text-ink-300 transition-colors hover:border-base-500 hover:text-white"
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {critical.length > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-crit px-1 text-[9px] font-semibold text-white">
                    {critical.length}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-[330px] overflow-hidden rounded-xl border border-base-600 bg-base-850 shadow-2xl">
                  <div className="border-b border-base-700 px-3.5 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">Open alerts</p>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {(alerts.data ?? []).length === 0 && (
                      <p className="px-3.5 py-4 text-[12px] text-ink-500">No alerts recorded.</p>
                    )}
                    {(alerts.data ?? []).slice(0, 6).map((alert) => (
                      <NavLink
                        key={alert.id}
                        to="/anomalies"
                        className="block border-b border-base-700/60 px-3.5 py-2.5 transition-colors hover:bg-base-800"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium text-ink-100">{alert.anomaly_type}</p>
                          <span
                            className={clsx(
                              "text-[9.5px] font-semibold",
                              alert.severity === "HIGH" ? "text-crit" : alert.severity === "MEDIUM" ? "text-warn" : "text-cyan"
                            )}
                          >
                            {alert.severity}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[10.5px] text-ink-500">
                          {alert.heat_id} · {alert.explanation}
                        </p>
                      </NavLink>
                    ))}
                  </div>
                  <NavLink
                    to="/anomalies"
                    className="flex items-center justify-between px-3.5 py-2 text-[11px] text-electric hover:bg-base-800"
                  >
                    View all anomalies <ChevronRight className="h-3.5 w-3.5" />
                  </NavLink>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-l border-base-700 pl-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-full border border-base-600 bg-gradient-to-br from-electric/25 to-violet/20 text-[10.5px] font-semibold text-white">
                HK
              </div>
              <div className="hidden leading-tight xl:block">
                <p className="text-[11.5px] font-medium text-ink-100">Hari Kumar</p>
                <p className="text-[9.5px] uppercase tracking-wide text-ink-500">Furnace Operator</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[1560px] animate-slideUp">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

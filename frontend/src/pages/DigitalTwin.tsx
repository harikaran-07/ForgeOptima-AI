import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { CircleStop, Flame, Play, StepForward, Thermometer } from "lucide-react";
import { api } from "../lib/api";
import { GRADES, TwinState } from "../lib/types";
import { kwh, minutes, nf } from "../lib/format";
import { TrendChart } from "../components/charts";
import { Chip, ErrorBox, Field, Notice, PageHeader, Panel, Progress, Spinner } from "../components/ui";

const STAGES = [
  { name: "Charging", note: "Scrap charged, power ramping" },
  { name: "Initial Heating", note: "Solid metal heating to melting point" },
  { name: "Intermediate Melting", note: "Latent heat absorbed, pool forming" },
  { name: "Complete Melting", note: "Full liquid pool, superheat begins" },
  { name: "Temperature Adjustment", note: "Thermal lag closing on target" },
  { name: "Target Temperature Reached", note: "Ready for tapping / holding" },
];

const tempColor = (t: number, target: number) => {
  const ratio = Math.max(0, Math.min(1, t / Math.max(target, 1)));
  if (ratio > 0.82) return "#FFF4D6";
  if (ratio > 0.65) return "#FFC46B";
  if (ratio > 0.42) return "#FF8A3D";
  if (ratio > 0.2) return "#E2553B";
  return "#8C3A2E";
};

export default function DigitalTwin() {
  const [config, setConfig] = useState({
    metal_grade: "MS",
    charge_weight_kg: 3000,
    initial_temp_c: 35,
    target_temp_c: 1550,
    power_kw: 1900,
    efficiency: 0.72,
    time_step_min: 1,
  });
  const [state, setState] = useState<TwinState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<TwinState>("/digital-twin/start", config);
      setState(next);
      sessionRef.current = next.session_id;
      setPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the digital twin.");
    } finally {
      setBusy(false);
    }
  };

  const step = async (steps = 1) => {
    const id = sessionRef.current;
    if (!id) return;
    try {
      const next = await api.post<TwinState>("/digital-twin/step", { session_id: id, steps });
      setState(next);
      if (next.is_complete) setPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation step failed.");
      setPlaying(false);
    }
  };

  const stop = async () => {
    const id = sessionRef.current;
    setPlaying(false);
    if (!id) return;
    try {
      await api.post("/digital-twin/stop", { session_id: id, steps: 1 });
    } catch {
      /* session may already be complete */
    }
  };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      void step(6);
    }, 500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const progress = state?.melt_progress ?? 0;
  const target = state?.target_temp_c ?? config.target_temp_c;
  const temperature = state?.temperature_c ?? config.initial_temp_c;
  const stageIndex = state?.stage_index ?? 0;
  const fill = Math.max(12, Math.min(88, 18 + progress * 0.62));
  const moltenColor = tempColor(temperature, target);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 04"
        title="Digital Twin — Virtual Furnace"
        description="A reduced-order thermal simulation of the induction furnace: energy balance, first-order thermal lag and stage progression. Documented assumptions are shown below the twin; this is not a physics-validated plant model."
      >
        <Chip tone="violet">SIMULATION MODEL</Chip>
        <Chip tone="neutral">No hardware control</Chip>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Virtual induction furnace"
          subtitle={state ? `Session ${state.session_id}` : "Start a virtual heat to activate"}
          action={
            state ? (
              <Chip tone={state.is_complete ? "good" : "violet"}>{state.stage}</Chip>
            ) : (
              <Chip tone="neutral">Idle</Chip>
            )
          }
        >
          <div className="relative overflow-hidden rounded-xl border border-base-700 bg-gradient-to-b from-base-950 to-base-900 px-2 py-4">
            <svg viewBox="0 0 420 300" className="mx-auto h-[300px] w-full max-w-[520px]">
              <defs>
                <radialGradient id="molten" cx="50%" cy="35%" r="70%">
                  <stop offset="0%" stopColor="#FFF7E0" stopOpacity={0.95} />
                  <stop offset="45%" stopColor={moltenColor} stopOpacity={0.92} />
                  <stop offset="100%" stopColor="#B23A1F" stopOpacity={0.85} />
                </radialGradient>
                <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#243149" />
                  <stop offset="100%" stopColor="#111A2C" />
                </linearGradient>
                <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="9" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* heat glow under the furnace */}
              <ellipse
                cx="210"
                cy="268"
                rx={92 + progress * 0.45}
                ry="13"
                fill={moltenColor}
                opacity={0.12 + (progress / 100) * 0.4}
                filter="url(#glow)"
              />

              {/* shell */}
              <rect x="118" y="34" width="184" height="228" rx="26" fill="url(#shell)" stroke="#2B3A52" strokeWidth="1.4" />
              <rect x="118" y="34" width="184" height="18" rx="9" fill="#1B2639" />

              {/* induction coils */}
              {[74, 96, 118, 140, 162, 184, 206, 228].map((y, i) => (
                <path
                  key={y}
                  d={`M126 ${y} h168`}
                  stroke={i % 2 === 0 ? "#3B7DFF" : "#22D3EE"}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  opacity={state && (state.power_kw ?? 0) > 0 ? 0.32 + 0.18 * Math.sin((state.elapsed_min + i) / 3) : 0.16}
                />
              ))}

              {/* crucible interior */}
              <rect x="136" y="58" width="148" height="188" rx="16" fill="#0A0F1A" stroke="#1F2B3F" strokeWidth="1" />

              {/* molten bath */}
              <g clipPath="none">
                <rect
                  x="140"
                  y={246 - (fill / 100) * 186}
                  width="140"
                  height={(fill / 100) * 186}
                  rx="10"
                  fill="url(#molten)"
                  opacity={0.25 + Math.min(progress / 100, 1) * 0.75}
                  filter="url(#glow)"
                />
                <ellipse
                  cx="210"
                  cy={246 - (fill / 100) * 186}
                  rx="70"
                  ry="7"
                  fill={moltenColor}
                  opacity={0.35 + Math.min(progress / 100, 1) * 0.5}
                />
              </g>

              {/* level readout line */}
              <line x1="136" y1={246 - (fill / 100) * 186} x2="284" y2={246 - (fill / 100) * 186} stroke="#22D3EE" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.55" />

              {/* tap spout */}
              <path d="M302 118 h22 l6 10 -6 10 h-22" fill="#1B2639" stroke="#2B3A52" strokeWidth="1.2" />
              <text x="330" y="146" fill="#5A6B85" fontSize="8" fontFamily="monospace">TAP</text>

              {/* thermometer scale */}
              <rect x="352" y="60" width="7" height="170" rx="3.5" fill="#162134" />
              <rect
                x="352"
                y={230 - Math.min(1, temperature / Math.max(target, 1)) * 168}
                width="7"
                height={Math.min(1, temperature / Math.max(target, 1)) * 168}
                rx="3.5"
                fill={moltenColor}
              />
              <text x="344" y="52" fill="#7688A3" fontSize="8" fontFamily="monospace">{nf(target)}</text>
              <text x="348" y="243" fill="#5A6B85" fontSize="8" fontFamily="monospace">0</text>

              {/* labels */}
              <text x="210" y="22" textAnchor="middle" fill="#9DACC3" fontSize="9" letterSpacing="2.4" fontFamily="monospace">
                {state?.metal_grade ?? config.metal_grade} · {nf(state?.charge_weight_kg ?? config.charge_weight_kg)} kg
              </text>
              <text x="210" y="286" textAnchor="middle" fill={moltenColor} fontSize="17" fontFamily="monospace" fontWeight="600">
                {nf(temperature)} °C
              </text>
              <text x="210" y="298" textAnchor="middle" fill="#5A6B85" fontSize="8" letterSpacing="1.6" fontFamily="monospace">
                SIMULATED CRUCIBLE · {nf(progress, 0)}% MOLTEN
              </text>
            </svg>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Melt progress", value: `${nf(progress, 1)}%` },
              { label: "Energy", value: kwh(state?.energy_kwh) },
              { label: "Elapsed", value: minutes(state?.elapsed_min) },
              { label: "Remaining", value: minutes(state?.remaining_min) },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-base-700 bg-base-900/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-ink-500">{item.label}</p>
                <p className="mono mt-0.5 text-[14px] text-ink-100">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[10.5px] text-ink-500">
              <span>Energy delivered vs required</span>
              <span className="mono">{nf(progress, 1)}%</span>
            </div>
            <Progress value={progress} tone={progress >= 99 ? "good" : "warn"} />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Heat configuration" subtitle="Values stay within engineer-approved power limits">
            <div className="space-y-3">
              <Field label="Metal grade">
                <select className="input" value={config.metal_grade} onChange={(e) => setConfig({ ...config, metal_grade: e.target.value })}>
                  {GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Charge (kg)">
                  <input type="number" className="input" value={config.charge_weight_kg} onChange={(e) => setConfig({ ...config, charge_weight_kg: Number(e.target.value) })} />
                </Field>
                <Field label="Power (kW)">
                  <input type="number" className="input" value={config.power_kw} onChange={(e) => setConfig({ ...config, power_kw: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Initial (°C)">
                  <input type="number" className="input" value={config.initial_temp_c} onChange={(e) => setConfig({ ...config, initial_temp_c: Number(e.target.value) })} />
                </Field>
                <Field label="Target (°C)">
                  <input type="number" className="input" value={config.target_temp_c} onChange={(e) => setConfig({ ...config, target_temp_c: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Efficiency ${(config.efficiency * 100).toFixed(0)}%`}>
                  <input type="range" min={0.5} max={0.9} step={0.01} value={config.efficiency} onChange={(e) => setConfig({ ...config, efficiency: Number(e.target.value) })} className="w-full accent-[#8B7CF6]" />
                </Field>
                <Field label={`Step ${config.time_step_min} min`}>
                  <input type="range" min={0.5} max={5} step={0.5} value={config.time_step_min} onChange={(e) => setConfig({ ...config, time_step_min: Number(e.target.value) })} className="w-full accent-[#8B7CF6]" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button className="btn-primary" onClick={start} disabled={busy}>
                  <Play className="h-3.5 w-3.5" /> {state ? "Restart" : "Start heat"}
                </button>
                <button
                  className="btn-ghost"
                  disabled={!state || state.is_complete}
                  onClick={() => setPlaying((v) => !v)}
                >
                  {playing ? <CircleStop className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playing ? "Pause run" : "Auto run"}
                </button>
                <button className="btn-ghost" disabled={!state || state.is_complete || busy} onClick={() => step(10)}>
                  <StepForward className="h-3.5 w-3.5" /> +10 min
                </button>
                <button className="btn-danger" disabled={!state} onClick={stop}>
                  Stop session
                </button>
              </div>
              {busy && <Spinner label="Initialising session…" />}
              {error && <ErrorBox message={error} />}
            </div>
          </Panel>

          <Panel title="Melting stages" subtitle="Progression for the active virtual heat">
            <ol className="space-y-1.5">
              {STAGES.map((stage, index) => {
                const active = index === stageIndex && !!state;
                const done = !!state && index < stageIndex;
                return (
                  <li
                    key={stage.name}
                    className={clsx(
                      "rounded-lg border px-2.5 py-1.5 transition-colors",
                      active
                        ? "border-electric/50 bg-electric/10"
                        : done
                          ? "border-good/30 bg-good/[0.06]"
                          : "border-base-700/70 bg-base-900/40"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "grid h-4 w-4 place-items-center rounded-full text-[9px] font-semibold",
                          active ? "bg-electric text-white" : done ? "bg-good/20 text-good" : "bg-base-700 text-ink-500"
                        )}
                      >
                        {index + 1}
                      </span>
                      <p className={clsx("text-[11.5px] font-medium", active ? "text-white" : done ? "text-ink-200" : "text-ink-400")}>
                        {stage.name}
                      </p>
                      {active && <span className="ml-auto h-1.5 w-1.5 animate-pulseSoft rounded-full bg-electric" />}
                    </div>
                    <p className="ml-6 text-[10px] text-ink-500">{stage.note}</p>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Simulated temperature & energy" subtitle="Step-by-step model output">
          {state && state.history.length > 1 ? (
            <TrendChart
              data={state.history.map((h) => ({ t: h.t, temperature_c: h.temperature_c, energy_kwh: h.energy_kwh }))}
              xKey="t"
              xUnit="min"
              yUnit="°C"
              height={250}
              series={[
                { key: "temperature_c", name: "Temperature", color: "#FF8A3D", area: true },
                { key: "energy_kwh", name: "Energy (kWh)", color: "#8B7CF6" },
              ]}
              reference={[{ value: target, label: "TARGET", color: "#5A6B85" }]}
            />
          ) : (
            <p className="py-24 text-center text-[12px] text-ink-500">
              Start a virtual heat and step the model to plot temperature and energy.
            </p>
          )}
        </Panel>

        <Panel title="Model assumptions" subtitle="Documented, reduced-order physics">
          <div className="space-y-2.5 text-[11.5px] leading-relaxed text-ink-300">
            <p className="flex gap-2"><Thermometer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" /> Temperature trails the energy-implied value with a 3.5 minute first-order lag.</p>
            <p className="flex gap-2"><Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> Required energy = mass × specific energy for the grade × temperature-span factor.</p>
            <p className="flex gap-2"><Play className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric" /> Delivered energy = power × efficiency × time; losses 0.02 °C/min ambient.</p>
          </div>
          <div className="mt-3">
            <Notice tone="warn" title="Scope">
              A simplified predictive simulation, not a physics-validated industrial digital twin. Use for training and
              what-if exploration only.
            </Notice>
          </div>
        </Panel>
      </div>
    </div>
  );
}

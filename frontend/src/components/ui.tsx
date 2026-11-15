import { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { severityTone, statusTone } from "../lib/format";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("panel", className)}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="mt-1 text-[11.5px] text-ink-400">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  unit,
  hint,
  tone = "default",
  icon,
  footer,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "default" | "blue" | "cyan" | "violet" | "good" | "warn";
  icon?: ReactNode;
  footer?: ReactNode;
}) {
  const accents: Record<string, string> = {
    default: "text-ink-100",
    blue: "text-electric",
    cyan: "text-cyan",
    violet: "text-violet",
    good: "text-good",
    warn: "text-warn",
  };
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{label}</p>
        {icon && <span className="text-ink-500">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={clsx("mono text-[21px] font-semibold leading-none", accents[tone])}>{value}</span>
        {unit && <span className="text-[11px] font-medium text-ink-400">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-ink-500">{hint}</p>}
      {footer}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "cyan" | "violet" | "good" | "warn" | "crit";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-base-600 bg-base-750/70 text-ink-300",
    blue: "border-electric/40 bg-electric/10 text-electric",
    cyan: "border-cyan/40 bg-cyan/10 text-cyan",
    violet: "border-violet/40 bg-violet/10 text-violet",
    good: "border-good/40 bg-good/10 text-good",
    warn: "border-warn/40 bg-warn/10 text-warn",
    crit: "border-crit/40 bg-crit/10 text-crit",
  };
  return <span className={clsx("chip", tones[tone], className)}>{children}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span className={clsx("chip capitalize", tone.text, tone.bg, tone.border)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace("_", " ")}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: string }) {
  const tone = severityTone(severity);
  return <span className={clsx("chip", tone.text, tone.bg, tone.border)}>{severity}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-ink-400">
      <Loader2 className="h-4 w-4 animate-spin text-electric" />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-crit/30 bg-crit/[0.07] px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crit" />
        <p className="text-[12.5px] leading-relaxed text-ink-200">{message}</p>
      </div>
      {onRetry && (
        <button className="btn-ghost !py-1.5 !text-[12px]" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
  title,
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "crit" | "good";
  title?: string;
}) {
  const tones = {
    info: "border-base-600 bg-base-800/60 text-ink-300",
    warn: "border-warn/30 bg-warn/[0.07] text-warn",
    crit: "border-crit/30 bg-crit/[0.07] text-crit",
    good: "border-good/30 bg-good/[0.07] text-good",
  } as const;
  return (
    <div className={clsx("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[12px] leading-relaxed", tones[tone])}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Progress({
  value,
  tone = "electric",
}: {
  value: number;
  tone?: "electric" | "cyan" | "good" | "warn" | "violet";
}) {
  const colors: Record<string, string> = {
    electric: "bg-electric",
    cyan: "bg-cyan",
    good: "bg-good",
    warn: "bg-warn",
    violet: "bg-violet",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-700">
      <div
        className={clsx("h-full rounded-full transition-[width] duration-500", colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-ink-500">{hint}</span>}
    </label>
  );
}

export function PageHeader({
  title,
  description,
  children,
  eyebrow,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-electric">{eyebrow}</p>
        )}
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-white">{title}</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-400">{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <p className="text-[13px] font-medium text-ink-200">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-ink-500">{body}</p>
      {action}
    </div>
  );
}

export function MetricRow({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-base-700/60 py-2 last:border-0">
      <span className="text-[12px] text-ink-400">{label}</span>
      <span className={clsx("mono text-[12.5px] font-medium text-ink-100", tone)}>{value}</span>
    </div>
  );
}

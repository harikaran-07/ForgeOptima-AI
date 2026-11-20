export const nf = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const temp = (value: number | null | undefined): string => (value == null ? "—" : `${nf(value, 0)} °C`);
export const kwh = (value: number | null | undefined): string => (value == null ? "—" : `${nf(value, 1)} kWh`);
export const pct = (value: number | null | undefined, digits = 1): string =>
  value == null ? "—" : `${nf(value, digits)}%`;
export const signed = (value: number | null | undefined, digits = 0, unit = ""): string =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${nf(value, digits)}${unit ? ` ${unit}` : ""}`;

export const dt = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const dateOnly = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const minutes = (value: number | null | undefined): string => {
  if (value == null) return "—";
  const total = Math.max(0, Math.round(value));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m} min`;
};

export const severityTone = (severity: string) =>
  severity === "HIGH"
    ? { text: "text-crit", border: "border-crit/40", bg: "bg-crit/10" }
    : severity === "MEDIUM"
      ? { text: "text-warn", border: "border-warn/40", bg: "bg-warn/10" }
      : { text: "text-cyan", border: "border-cyan/40", bg: "bg-cyan/10" };

export const gradeColor = (grade: string): string => {
  const map: Record<string, string> = {
    MS: "#10B981",          // Emerald Green
    SS304: "#34D399",       // Bright Mint
    SS316: "#14B8A6",       // Muted Teal
    "Alloy Steel": "#059669",// Deep Emerald
    "Cast Iron": "#FBBF24", // Amber
    "Al Alloy": "#6EE7B7",  // Light Mint
    "Cu Alloy": "#F59E0B",  // Warm Copper
  };
  return map[grade] ?? "#9CB8AA";
};

export const statusTone = (status: string) => {
  const s = status.toLowerCase();
  if (["heating", "running"].includes(s)) return { text: "text-electric", bg: "bg-electric/10", border: "border-electric/40" };
  if (["holding", "completed"].includes(s)) return { text: "text-good", bg: "bg-good/10", border: "border-good/40" };
  if (["aborted", "offline", "no_data"].includes(s)) return { text: "text-crit", bg: "bg-crit/10", border: "border-crit/40" };
  return { text: "text-ink-300", bg: "bg-base-700/50", border: "border-base-600" };
};

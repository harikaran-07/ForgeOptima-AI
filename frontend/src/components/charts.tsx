import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS_STYLE = {
  stroke: "#28374F",
  tick: { fill: "#7688A3", fontSize: 10 },
  tickLine: false,
  axisLine: { stroke: "#1D2A40" },
} as const;

export const CHART_COLORS = {
  blue: "#3B7DFF",
  cyan: "#22D3EE",
  violet: "#8B7CF6",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
  slate: "#5A6B85",
};

interface TipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
}

export function ChartTip(props: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  labelPrefix?: string;
  suffix?: string;
}) {
  const { active, payload, label, labelPrefix, suffix } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-base-600 bg-base-900/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wide text-ink-400">
        {labelPrefix ?? ""}
        {label}
      </p>
      {payload.map((item, index) => (
        <p key={index} className="flex items-center gap-2 text-[11.5px] text-ink-200">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
          <span className="text-ink-400">{item.name}</span>
          <span className="mono ml-auto font-medium text-white">
            {typeof item.value === "number" ? item.value.toLocaleString("en-US") : item.value}
            {suffix ? ` ${suffix}` : ""}
          </span>
        </p>
      ))}
    </div>
  );
}

export function TrendChart({
  data,
  xKey,
  series,
  height = 220,
  yUnit,
  xUnit = "min",
  reference,
  domain,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color: string; area?: boolean; dashed?: boolean; type?: "line" | "bar" }[];
  height?: number;
  yUnit?: string;
  xUnit?: string;
  reference?: { value: number; label: string; color?: string }[];
  domain?: [number | "auto", number | "auto"];
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <defs>
            {series
              .filter((s) => s.area)
              .map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
          </defs>
          <CartesianGrid stroke="#162134" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={xKey} {...AXIS_STYLE} unit={xUnit ? ` ${xUnit}` : undefined} />
          <YAxis {...AXIS_STYLE} width={48} unit={yUnit ? ` ${yUnit}` : undefined} domain={domain} />
          <Tooltip content={<ChartTip suffix={yUnit} labelPrefix={`t = `} />} cursor={{ stroke: "#28374F" }} />
          {reference?.map((ref) => (
            <ReferenceLine
              key={ref.label}
              y={ref.value}
              stroke={ref.color ?? "#5A6B85"}
              strokeDasharray="4 4"
              label={{ value: ref.label, position: "insideTopRight", fill: "#7688A3", fontSize: 10 }}
            />
          ))}
          {series.map((s) =>
            s.type === "bar" ? (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[2, 2, 0, 0]} barSize={16} />
            ) : s.area ? (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={1.9}
                fill={`url(#grad-${s.key})`}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={1.9}
                strokeDasharray={s.dashed ? "4 4" : undefined}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            )
          )}
          <Legend
            verticalAlign="top"
            height={26}
            iconType="plainline"
            iconSize={10}
            formatter={(value) => <span className="text-[10.5px] text-ink-400">{value}</span>}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniBarChart({
  data,
  xKey,
  series,
  height = 200,
  yUnit,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color: string }[];
  height?: number;
  yUnit?: string;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#162134" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={xKey} {...AXIS_STYLE} interval={0} angle={0} height={30} />
          <YAxis {...AXIS_STYLE} width={46} unit={yUnit ? ` ${yUnit}` : undefined} />
          <Tooltip content={<ChartTip suffix={yUnit} />} cursor={{ fill: "rgba(59,125,255,0.06)" }} />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="square"
            iconSize={9}
            formatter={(value) => <span className="text-[10.5px] text-ink-400">{value}</span>}
          />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[2, 2, 0, 0]} barSize={14} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaOnly({
  data,
  xKey,
  yKey,
  name,
  color,
  height = 180,
  yUnit,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  name: string;
  color: string;
  height?: number;
  yUnit?: string;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id={`mini-${yKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#162134" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={xKey} {...AXIS_STYLE} />
          <YAxis {...AXIS_STYLE} width={46} unit={yUnit ? ` ${yUnit}` : undefined} />
          <Tooltip content={<ChartTip suffix={yUnit} />} />
          <Area
            type="monotone"
            dataKey={yKey}
            name={name}
            stroke={color}
            strokeWidth={1.8}
            fill={`url(#mini-${yKey})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

import { formatMetricValue, type MetricDefinition, type MetricPoint } from "@ams/shared";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { FLAG_TEXT } from "@/lib/flags";
import { niceDomain, thresholdBands } from "@/lib/chart";

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

const FLAG_FILL: Record<"amber" | "red", string> = { amber: "var(--flag-amber)", red: "var(--flag-red)" };

export function MetricChart({
  metric,
  points,
  height = 160,
  color = "var(--chart-1)",
  showAxis = true,
}: {
  metric: MetricDefinition;
  points: readonly MetricPoint[];
  height?: number;
  color?: string;
  showAxis?: boolean;
}) {
  const data = useMemo(() => points.map((p) => ({ ...p, label: shortDate(p.date) })), [points]);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null && isFinite(v));
  const [lo, hi] = niceDomain(values, metric);
  const bands = thresholdBands(metric, lo, hi);

  if (values.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground" style={{ height }}>
        No values in this period
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`${metric.name} trend, ${values.length} values`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: showAxis ? -8 : 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {bands.map((b, i) => (
            <ReferenceArea
              key={i}
              y1={b.y1}
              y2={b.y2}
              ifOverflow="hidden"
              fill={FLAG_FILL[b.flag]}
              fillOpacity={b.flag === "red" ? 0.1 : 0.08}
              stroke="none"
            />
          ))}
          <XAxis
            dataKey="label"
            hide={!showAxis}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            minTickGap={24}
          />
          <YAxis
            domain={[lo, hi]}
            hide={!showAxis}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickFormatter={(v: number) => formatMetricValue(v, { decimals: Math.min(metric.decimals, 2), unit: null })}
          />
          <Tooltip content={(props) => <ChartTooltip {...props} metric={metric} />} cursor={{ stroke: "var(--border)" }} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: MetricPoint; index?: number }) => {
              const { cx, cy, payload, index } = props;
              if (cx === undefined || cy === undefined || !payload || payload.value === null) return <g key={index} />;
              const fill = payload.flag === "red" ? "var(--flag-red)" : payload.flag === "amber" ? "var(--flag-amber)" : color;
              return <circle key={index} cx={cx} cy={cy} r={payload.flag && payload.flag !== "green" ? 3.2 : 2} fill={fill} stroke="var(--background)" strokeWidth={1} />;
            }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload, metric }: Pick<TooltipContentProps<ValueType, NameType>, "active" | "payload"> & { metric: MetricDefinition }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload as MetricPoint & { label: string };
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground">{p.date}</div>
      <div className="font-medium tabular">{formatMetricValue(p.value, metric)}</div>
      {p.flag && p.flag !== "green" && <div className={p.flag === "red" ? "text-flag-red" : "text-flag-amber"}>{FLAG_TEXT[p.flag]} flag</div>}
      {p.source && <div className="text-muted-foreground">{p.source}</div>}
    </div>
  );
}

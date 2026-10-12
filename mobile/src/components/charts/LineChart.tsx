import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Polygon, Text as SvgText } from "react-native-svg";
import { flagColor, type Thresholds } from "@ams/shared";
import { useTheme } from "../../theme";
import { AppText } from "../ui";
import { linePath, thresholdLines, yDomain, type ChartPoint } from "./scale";

export interface LineChartProps {
  points: ChartPoint[];
  thresholds?: Thresholds;
  height?: number;
  /** Formats axis labels. */
  formatValue?: (v: number) => string;
  /** Spoken summary of the chart. */
  accessibilityLabel: string;
  testID?: string;
}

const PAD = { top: 10, right: 10, bottom: 8, left: 40 };

/**
 * Compact line chart over evenly spaced days. Gaps are left where data is missing; flagged
 * points get a shape as well as a colour (amber ▲, red ■).
 */
export function LineChart({
  points,
  thresholds,
  height = 120,
  formatValue = (v) => String(Math.round(v * 10) / 10),
  accessibilityLabel,
  testID,
}: LineChartProps) {
  const p = useTheme();
  const [width, setWidth] = useState(0);
  const values = points.map((pt) => pt.value).filter((v): v is number => v !== null && isFinite(v));
  const lines = thresholdLines(thresholds);
  const domain = yDomain(
    values,
    lines.map((l) => l.value),
  );

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - domain.min) / (domain.max - domain.min)) * plotH;

  return (
    <View
      testID={testID}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.wrap, { height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {values.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="caption" tone="muted">
            No data in this period
          </AppText>
        </View>
      ) : width > 0 ? (
        <Svg width={width} height={height}>
          {[domain.max, domain.min].map((v, i) => (
            <Line
              key={`grid-${i}`}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={p.chartGrid}
              strokeWidth={1}
            />
          ))}
          <SvgText x={PAD.left - 6} y={y(domain.max) + 4} fontSize={10} fill={p.textMuted} textAnchor="end">
            {formatValue(domain.max)}
          </SvgText>
          <SvgText x={PAD.left - 6} y={y(domain.min)} fontSize={10} fill={p.textMuted} textAnchor="end">
            {formatValue(domain.min)}
          </SvgText>
          {lines
            .filter((l) => l.value >= domain.min && l.value <= domain.max)
            .map((l, i) => (
              <Line
                key={`thr-${i}`}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(l.value)}
                y2={y(l.value)}
                stroke={p.flag[l.level]}
                strokeWidth={1}
                strokeDasharray={l.level === "red" ? "2,3" : "6,4"}
                opacity={0.8}
              />
            ))}
          <Path d={linePath(points, x, y)} stroke={p.chartLine} strokeWidth={2} fill="none" />
          {points.map((pt, i) => {
            if (pt.value === null || !isFinite(pt.value)) return null;
            const cx = x(i);
            const cy = y(pt.value);
            const color = flagColor(pt.flag);
            const fill = p.flag[color];
            if (color === "red") {
              return <Rect key={pt.date} x={cx - 4} y={cy - 4} width={8} height={8} fill={fill} />;
            }
            if (color === "amber") {
              return <Polygon key={pt.date} points={`${cx},${cy - 5} ${cx + 5},${cy + 4} ${cx - 5},${cy + 4}`} fill={fill} />;
            }
            const isLast = i === points.length - 1 || points.slice(i + 1).every((q) => q.value === null);
            return (
              <Circle
                key={pt.date}
                cx={cx}
                cy={cy}
                r={isLast ? 4.5 : 2.5}
                fill={color === "none" ? p.chartLine : fill}
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});

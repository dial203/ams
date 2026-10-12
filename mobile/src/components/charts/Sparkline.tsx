import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { flagColor } from "@ams/shared";
import { useTheme } from "../../theme";
import { lastValue, linePath, yDomain, type ChartPoint } from "./scale";

/** Tiny trend line without axes; the last value is marked with its flag colour. */
export function Sparkline({ points, height = 28, width: fixedWidth }: { points: ChartPoint[]; height?: number; width?: number }) {
  const p = useTheme();
  const [measured, setMeasured] = useState(0);
  const width = fixedWidth ?? measured;
  const values = points.map((pt) => pt.value).filter((v): v is number => v !== null && isFinite(v));
  const domain = yDomain(values);
  const pad = 3;
  const x = (i: number) => pad + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (width - pad * 2));
  const y = (v: number) => pad + (1 - (v - domain.min) / (domain.max - domain.min)) * (height - pad * 2);
  const last = lastValue(points);
  const lastIndex = last ? points.lastIndexOf(last) : -1;

  return (
    <View
      style={{ width: fixedWidth ?? "100%", height }}
      onLayout={fixedWidth ? undefined : (e) => setMeasured(e.nativeEvent.layout.width)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {width > 0 && values.length > 0 ? (
        <Svg width={width} height={height}>
          <Path d={linePath(points, x, y)} stroke={p.chartLine} strokeWidth={1.5} fill="none" />
          {last && last.value !== null ? (
            <Circle cx={x(lastIndex)} cy={y(last.value)} r={3} fill={p.flag[flagColor(last.flag)]} />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

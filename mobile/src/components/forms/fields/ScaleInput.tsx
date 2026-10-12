import { StyleSheet, View } from "react-native";
import Slider from "@react-native-community/slider";
import { roundHalfAwayFromZero, scaleDisplay, scaleStep, scaleValues, type ScaleField } from "@ams/shared";
import { haptics } from "../../../lib/haptics";
import { spacing, useTheme } from "../../../theme";
import { AppText, Button } from "../../ui";
import { formatNumber } from "../display";
import { ChoiceButton } from "./ChoiceButton";

export interface ScaleInputProps {
  field: ScaleField;
  value: unknown;
  onChange: (value: number | null) => void;
}

function anchorFor(field: ScaleField, v: number, points: number[]): string | undefined {
  const a = field.anchors;
  if (!a) return undefined;
  if (v === points[0] && a.min) return a.min;
  if (v === points[points.length - 1] && a.max) return a.max;
  if (a.mid && points.length % 2 === 1 && v === points[(points.length - 1) / 2]) return a.mid;
  return undefined;
}

function Anchors({ field, points }: { field: ScaleField; points: number[] }) {
  const a = field.anchors;
  if (!a || (!a.min && !a.max && !a.mid)) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <View style={styles.anchors} accessible={false} importantForAccessibility="no-hide-descendants">
      <AppText variant="caption" tone="muted" style={styles.anchorLeft}>
        {a.min && first !== undefined ? `${formatNumber(first)} = ${a.min}` : ""}
      </AppText>
      {a.mid ? (
        <AppText variant="caption" tone="muted" style={styles.anchorMid}>
          {a.mid}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted" style={styles.anchorRight}>
        {a.max && last !== undefined ? `${formatNumber(last)} = ${a.max}` : ""}
      </AppText>
    </View>
  );
}

/** Number row for scales up to 11 points (`display: "buttons"`), a slider otherwise. */
export function ScaleInput({ field, value, onChange }: ScaleInputProps) {
  const points = scaleValues(field);
  if (points.length === 0) return null;
  return scaleDisplay(field) === "slider" ? (
    <ScaleSlider field={field} value={value} onChange={onChange} points={points} />
  ) : (
    <ScaleButtons field={field} value={value} onChange={onChange} points={points} />
  );
}

function ScaleButtons({ field, value, onChange, points }: ScaleInputProps & { points: number[] }) {
  // Up to 7 points fit one row; longer scales (e.g. 0-10) wrap into two even rows.
  const columns = points.length <= 7 ? points.length : Math.ceil(points.length / 2);
  const width = `${100 / columns}%` as const;
  return (
    <View>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={field.label}>
        {points.map((v) => {
          const selected = value === v;
          const anchor = anchorFor(field, v, points);
          return (
            <View key={v} style={[styles.cell, { width }]}>
              <ChoiceButton
                label={formatNumber(v)}
                emphasis
                selected={selected}
                accessibilityLabel={anchor ? `${formatNumber(v)}, ${anchor}` : formatNumber(v)}
                onPress={() => {
                  haptics.selection();
                  onChange(selected && field.required !== true ? null : v);
                }}
              />
            </View>
          );
        })}
      </View>
      <Anchors field={field} points={points} />
    </View>
  );
}

function ScaleSlider({ field, value, onChange, points }: ScaleInputProps & { points: number[] }) {
  const p = useTheme();
  const min = points[0]!;
  const max = points[points.length - 1]!;
  const step = scaleStep(field);
  const current = typeof value === "number" && isFinite(value) ? value : null;
  const snap = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    return roundHalfAwayFromZero(min + Math.round((clamped - min) / step) * step, 10);
  };
  const bump = (direction: 1 | -1) => {
    haptics.selection();
    if (current === null) onChange(direction === 1 ? min : max);
    else onChange(snap(current + direction * step));
  };
  return (
    <View style={styles.sliderWrap}>
      <AppText variant="display" style={styles.sliderValue} accessibilityLiveRegion="polite">
        {current === null ? "–" : formatNumber(current)}
        {current !== null && field.unit ? (
          <AppText variant="heading" tone="muted">{` ${field.unit}`}</AppText>
        ) : null}
      </AppText>
      {current === null ? (
        <AppText variant="caption" tone="muted" style={styles.sliderValue}>
          Drag the slider or use − / + to answer
        </AppText>
      ) : null}
      <View style={styles.sliderRow}>
        <Button
          label="−"
          variant="secondary"
          accessibilityLabel={`Decrease ${field.label}`}
          onPress={() => bump(-1)}
          style={styles.stepButton}
        />
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={step}
          value={current ?? (min + max) / 2}
          minimumTrackTintColor={current === null ? p.border : p.primary}
          maximumTrackTintColor={p.border}
          thumbTintColor={current === null ? p.textMuted : p.primary}
          accessibilityLabel={field.label}
          onValueChange={(v: number) => onChange(snap(v))}
          onSlidingComplete={() => haptics.selection()}
          testID={`slider-${field.key}`}
        />
        <Button
          label="+"
          variant="secondary"
          accessibilityLabel={`Increase ${field.label}`}
          onPress={() => bump(1)}
          style={styles.stepButton}
        />
      </View>
      <Anchors field={field} points={points} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs },
  cell: { padding: spacing.xs },
  anchors: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.xs },
  anchorLeft: { flex: 1, textAlign: "left" },
  anchorMid: { flex: 1, textAlign: "center" },
  anchorRight: { flex: 1, textAlign: "right" },
  sliderWrap: { gap: spacing.sm },
  sliderValue: { textAlign: "center" },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  slider: { flex: 1, height: 48 },
  stepButton: { minWidth: 52 },
});

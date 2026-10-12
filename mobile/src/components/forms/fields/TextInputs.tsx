import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { maxLengthOf, type DurationField, type NumberField, type TextareaField, type TextField } from "@ams/shared";
import { formatDuration } from "../../../lib/format";
import { MIN_TOUCH, radius, spacing, useTheme } from "../../../theme";
import { AppText } from "../../ui";
import { formatNumber } from "../display";

/**
 * Parses what the athlete typed. Empty -> null; a number (comma or dot decimal) -> number;
 * anything else is kept as text so validation reports "Enter a number." instead of
 * silently dropping it.
 */
export function parseNumberText(text: string): number | string | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  return text;
}

function textFromValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function useSyncedText(value: unknown, toText: (v: unknown) => string, matches: (text: string, v: unknown) => boolean) {
  const [text, setText] = useState(() => toText(value));
  const [lastValue, setLastValue] = useState<unknown>(value);
  if (!Object.is(lastValue, value)) {
    // The value changed from outside this input (e.g. a reset): show it.
    setLastValue(value);
    if (!matches(text, value)) setText(toText(value));
  }
  return [text, setText] as const;
}

function NumericBox({
  text,
  onChangeText,
  label,
  suffix,
  allowNegative,
  invalid,
  testID,
}: {
  text: string;
  onChangeText: (t: string) => void;
  label: string;
  suffix?: string | undefined;
  allowNegative: boolean;
  invalid: boolean;
  testID?: string;
}) {
  const p = useTheme();
  // iOS's decimal pad has no minus key.
  const keyboardType = allowNegative && Platform.OS === "ios" ? "numbers-and-punctuation" : "decimal-pad";
  return (
    <View style={styles.boxRow}>
      <TextInput
        testID={testID}
        value={text}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        inputMode="decimal"
        returnKeyType="done"
        accessibilityLabel={label}
        placeholder="–"
        placeholderTextColor={p.textMuted}
        style={[
          styles.numberInput,
          { color: p.text, backgroundColor: p.surface, borderColor: invalid ? p.danger : p.border },
        ]}
      />
      {suffix ? (
        <AppText variant="bodyStrong" tone="muted">
          {suffix}
        </AppText>
      ) : null}
    </View>
  );
}

export function rangeHint(min: number | undefined, max: number | undefined, unit?: string): string | null {
  const u = unit ? ` ${unit}` : "";
  if (typeof min === "number" && typeof max === "number") return `Between ${formatNumber(min)} and ${formatNumber(max)}${u}.`;
  if (typeof min === "number") return `At least ${formatNumber(min)}${u}.`;
  if (typeof max === "number") return `At most ${formatNumber(max)}${u}.`;
  return null;
}

export function NumberInput({
  field,
  value,
  onChange,
  invalid,
}: {
  field: NumberField;
  value: unknown;
  onChange: (value: number | string | null) => void;
  invalid: boolean;
}) {
  const [text, setText] = useSyncedText(value, textFromValue, (t, v) => Object.is(parseNumberText(t), v));
  return (
    <NumericBox
      testID={`input-${field.key}`}
      text={text}
      label={field.label}
      suffix={field.unit}
      allowNegative={typeof field.min !== "number" || field.min < 0}
      invalid={invalid}
      onChangeText={(t) => {
        setText(t);
        onChange(parseNumberText(t));
      }}
    />
  );
}

/** Minutes, entered as hours + minutes. */
export function DurationInput({
  field,
  value,
  onChange,
  invalid,
}: {
  field: DurationField;
  value: unknown;
  onChange: (value: number | string | null) => void;
  invalid: boolean;
}) {
  const toParts = (v: unknown): { h: string; m: string } => {
    if (typeof v !== "number" || !isFinite(v)) return { h: "", m: "" };
    const h = Math.floor(Math.abs(v) / 60);
    const m = Math.round((Math.abs(v) - h * 60) * 100) / 100;
    return { h: h > 0 ? String(h) : "", m: String(m) };
  };
  const [parts, setParts] = useState(() => toParts(value));
  const [lastValue, setLastValue] = useState<unknown>(value);
  if (!Object.is(lastValue, value)) {
    setLastValue(value);
    const current = combine(parts.h, parts.m);
    if (!Object.is(current, value)) setParts(toParts(value));
  }

  function combine(h: string, m: string): number | string | null {
    const hv = parseNumberText(h);
    const mv = parseNumberText(m);
    if (hv === null && mv === null) return null;
    if ((hv !== null && typeof hv !== "number") || (mv !== null && typeof mv !== "number")) return `${h}:${m}`;
    return (typeof hv === "number" ? hv : 0) * 60 + (typeof mv === "number" ? mv : 0);
  }

  const update = (next: { h: string; m: string }) => {
    setParts(next);
    onChange(combine(next.h, next.m));
  };

  return (
    <View style={styles.durationRow}>
      <NumericBox
        testID={`input-${field.key}-hours`}
        text={parts.h}
        label={`${field.label}, hours`}
        suffix="h"
        allowNegative={false}
        invalid={invalid}
        onChangeText={(h) => update({ ...parts, h })}
      />
      <NumericBox
        testID={`input-${field.key}-minutes`}
        text={parts.m}
        label={`${field.label}, minutes`}
        suffix="min"
        allowNegative={false}
        invalid={invalid}
        onChangeText={(m) => update({ ...parts, m })}
      />
    </View>
  );
}

export function durationHint(field: DurationField, value: unknown): string | null {
  const parts: string[] = [];
  if (typeof value === "number" && isFinite(value) && value >= 60) parts.push(`= ${formatDuration(value)}.`);
  if (typeof field.max === "number") parts.push(`Up to ${formatDuration(field.max)}.`);
  return parts.length ? parts.join(" ") : null;
}

export function TextInputField({
  field,
  value,
  onChange,
  invalid,
}: {
  field: TextField | TextareaField;
  value: unknown;
  onChange: (value: string | null) => void;
  invalid: boolean;
}) {
  const p = useTheme();
  const text = typeof value === "string" ? value : "";
  const multiline = field.type === "textarea";
  const max = maxLengthOf(field);
  // `max_length` counts Unicode code points, like the form engine.
  const length = Array.from(text).length;
  return (
    <View style={styles.textWrap}>
      <TextInput
        testID={`input-${field.key}`}
        value={text}
        onChangeText={(t) => onChange(t === "" ? null : t)}
        multiline={multiline}
        accessibilityLabel={field.label}
        placeholder={multiline ? "Type here…" : undefined}
        placeholderTextColor={p.textMuted}
        returnKeyType={multiline ? "default" : "done"}
        style={[
          styles.textInput,
          multiline && styles.textarea,
          { color: p.text, backgroundColor: p.surface, borderColor: invalid ? p.danger : p.border },
        ]}
      />
      {length > max * 0.8 ? (
        <AppText variant="caption" tone={length > max ? "danger" : "muted"} style={styles.counter}>
          {length} / {max}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boxRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  numberInput: {
    minWidth: 110,
    minHeight: MIN_TOUCH + 4,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 22,
    fontWeight: "600",
  },
  durationRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  textWrap: { gap: spacing.xs },
  textInput: {
    minHeight: MIN_TOUCH,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 17,
  },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  counter: { textAlign: "right" },
});

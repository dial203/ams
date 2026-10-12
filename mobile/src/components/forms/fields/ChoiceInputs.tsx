import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { valuesEqual, type BooleanField, type MultiselectField, type SelectField } from "@ams/shared";
import { haptics } from "../../../lib/haptics";
import { spacing } from "../../../theme";
import { AppText } from "../../ui";
import { ChoiceButton } from "./ChoiceButton";

/** Short option lists render as a segmented row, others as a vertical list. */
function isSegmented(field: SelectField): boolean {
  return field.options.length <= 3 && field.options.every((o) => o.label.length <= 12);
}

function optionText(option: { value: string | number; label: string }): string {
  // Numeric scales such as CR-10: show the number next to its descriptor.
  if (typeof option.value === "number" && option.label !== String(option.value)) {
    return `${option.value} · ${option.label}`;
  }
  return option.label;
}

export function SelectInput({
  field,
  value,
  onChange,
}: {
  field: SelectField;
  value: unknown;
  onChange: (value: string | number | null) => void;
}) {
  const segmented = isSegmented(field);
  return (
    <View
      style={segmented ? styles.segmented : styles.list}
      accessibilityRole="radiogroup"
      accessibilityLabel={field.label}
    >
      {field.options.map((option) => {
        const selected = valuesEqual(value, option.value);
        return (
          <ChoiceButton
            key={String(option.value)}
            label={optionText(option)}
            selected={selected}
            align={segmented ? "center" : "left"}
            style={segmented ? styles.segment : undefined}
            onPress={() => {
              haptics.selection();
              onChange(selected && field.required !== true ? null : option.value);
            }}
          />
        );
      })}
    </View>
  );
}

export function MultiselectInput({
  field,
  value,
  onChange,
}: {
  field: MultiselectField;
  value: unknown;
  onChange: (value: (string | number)[]) => void;
}) {
  const selected = Array.isArray(value) ? (value as (string | number)[]) : [];
  const max = typeof field.max_selected === "number" ? field.max_selected : null;
  const min = typeof field.min_selected === "number" ? field.min_selected : null;
  const [limitHit, setLimitHit] = useState(false);

  const toggle = (optionValue: string | number) => {
    const isOn = selected.some((v) => valuesEqual(v, optionValue));
    if (isOn) {
      setLimitHit(false);
      haptics.selection();
      onChange(selected.filter((v) => !valuesEqual(v, optionValue)));
      return;
    }
    if (max !== null && selected.length >= max) {
      setLimitHit(true);
      haptics.warning();
      return;
    }
    setLimitHit(false);
    haptics.selection();
    onChange([...selected, optionValue]);
  };

  const hint =
    min !== null && max !== null
      ? `Choose ${min === max ? min : `${min} to ${max}`}.`
      : max !== null
        ? `Choose up to ${max}.`
        : min !== null
          ? `Choose at least ${min}.`
          : "Choose all that apply.";

  return (
    <View style={styles.chipsWrap}>
      <View style={styles.chips} accessibilityLabel={field.label}>
        {field.options.map((option) => (
          <ChoiceButton
            key={String(option.value)}
            role="checkbox"
            label={option.label}
            selected={selected.some((v) => valuesEqual(v, option.value))}
            style={styles.chip}
            onPress={() => toggle(option.value)}
          />
        ))}
      </View>
      <AppText variant="caption" tone={limitHit ? "warning" : "muted"} accessibilityLiveRegion="polite">
        {limitHit && max !== null ? `You can choose up to ${max}. Unselect one first.` : hint}
      </AppText>
    </View>
  );
}

export function BooleanInput({
  field,
  value,
  onChange,
}: {
  field: BooleanField;
  value: unknown;
  onChange: (value: boolean | null) => void;
}) {
  const pick = (v: boolean) => {
    haptics.selection();
    onChange(value === v && field.required !== true ? null : v);
  };
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={field.label}>
      <ChoiceButton label="Yes" selected={value === true} style={styles.segment} onPress={() => pick(true)} />
      <ChoiceButton label="No" selected={value === false} style={styles.segment} onPress={() => pick(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: "row", gap: spacing.sm },
  segment: { flex: 1 },
  list: { gap: spacing.sm },
  chipsWrap: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 48, paddingHorizontal: spacing.lg },
});

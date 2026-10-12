import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { errorMessage, type Field, type Value } from "@ams/shared";
import { radius, spacing, useTheme } from "../../theme";
import { AppText } from "../ui";
import { displayFieldValue, stripMarkdown } from "./display";
import { FieldShell } from "./FieldShell";
import { BooleanInput, MultiselectInput, SelectInput } from "./fields/ChoiceInputs";
import { DateInput, DateTimeInput, TimeInput } from "./fields/PickerInputs";
import { ScaleInput } from "./fields/ScaleInput";
import { DurationInput, NumberInput, TextInputField, durationHint, rangeHint } from "./fields/TextInputs";

export interface FieldRendererProps {
  field: Field;
  value: unknown;
  /** Calculated value (for `calculated` fields). */
  computed?: Value | undefined;
  /** Error code (FORMS.md) for this field, if any. */
  errorCode?: string | undefined;
  onChange: (key: string, value: unknown) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}

/** Renders one field of a form schema for the athlete. Covers every FORMS.md field type. */
export function FieldRenderer({ field, value, computed, errorCode, onChange, onLayout }: FieldRendererProps) {
  const p = useTheme();
  const error = errorCode ? errorMessage(errorCode, field) : null;
  const invalid = error !== null;
  const set = (v: unknown) => onChange(field.key, v);

  switch (field.type) {
    case "info":
      return (
        <View
          onLayout={onLayout}
          style={[styles.info, { backgroundColor: p.surfaceAlt }]}
          testID={`field-${field.key}`}
          accessible
        >
          <AppText variant="heading">{field.label}</AppText>
          {field.help ? <AppText variant="body">{stripMarkdown(field.help)}</AppText> : null}
        </View>
      );
    case "calculated": {
      const text = displayFieldValue(field, computed ?? null);
      return (
        <View
          onLayout={onLayout}
          style={[styles.calculated, { borderColor: p.border }]}
          testID={`field-${field.key}`}
          accessible
          accessibilityLabel={`${field.label}, calculated: ${text}`}
        >
          <AppText variant="body" tone="muted" style={styles.flex}>
            {field.label}
          </AppText>
          <AppText variant="heading" testID={`computed-${field.key}`}>
            {text}
          </AppText>
        </View>
      );
    }
    case "scale":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <ScaleInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    case "select":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <SelectInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    case "multiselect":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <MultiselectInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    case "boolean":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <BooleanInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    case "number":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout} hint={rangeHint(field.min, field.max, field.unit)}>
          <NumberInput field={field} value={value} onChange={set} invalid={invalid} />
        </FieldShell>
      );
    case "duration":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout} hint={durationHint(field, value)}>
          <DurationInput field={field} value={value} onChange={set} invalid={invalid} />
        </FieldShell>
      );
    case "text":
    case "textarea":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <TextInputField field={field} value={value} onChange={set} invalid={invalid} />
        </FieldShell>
      );
    case "date":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <DateInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    case "time":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <TimeInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    case "datetime":
      return (
        <FieldShell field={field} error={error} onLayout={onLayout}>
          <DateTimeInput field={field} value={value} onChange={set} />
        </FieldShell>
      );
    default:
      // A field type from a newer schema version: show its label so the form stays usable.
      return (
        <FieldShell field={field as Field} error={error} onLayout={onLayout}>
          <AppText tone="muted">This question can't be answered in this version of the app.</AppText>
        </FieldShell>
      );
  }
}

const styles = StyleSheet.create({
  info: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  calculated: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
  },
  flex: { flex: 1 },
});

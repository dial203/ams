import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import {
  isValidDateString,
  isValidDateTimeString,
  isValidTimeString,
  type DateField,
  type DateTimeField,
  type TimeField,
} from "@ams/shared";
import {
  dateFromClock,
  dateFromIso,
  formatDateTimeValue,
  formatLongDate,
  toLocalClock,
  toLocalIsoDate,
  toLocalIsoWithOffset,
} from "../../../lib/format";
import { haptics } from "../../../lib/haptics";
import { spacing, useTheme } from "../../../theme";
import { Button } from "../../ui";

type Mode = "date" | "time" | "datetime";

interface PickerProps {
  label: string;
  mode: Mode;
  /** Current value as a Date (for the picker), or null when unset. */
  date: Date | null;
  /** Text shown on the button. */
  display: string | null;
  placeholder: string;
  onPick: (date: Date) => void;
  onClear: (() => void) | null;
  minimumDate?: Date | undefined;
  maximumDate?: Date | undefined;
  testID: string;
}

/**
 * A button showing the value; Android opens the system dialog(s), iOS expands an inline
 * picker under the button.
 */
function PickerButton({
  label,
  mode,
  date,
  display,
  placeholder,
  onPick,
  onClear,
  minimumDate,
  maximumDate,
  testID,
}: PickerProps) {
  const p = useTheme();
  const [open, setOpen] = useState(false);
  const initial = date ?? clampDate(new Date(), minimumDate, maximumDate);

  const pick = (d: Date) => {
    haptics.selection();
    onPick(d);
  };

  const openAndroid = () => {
    const openTime = (base: Date) =>
      DateTimePickerAndroid.open({
        value: base,
        mode: "time",
        is24Hour: true,
        onValueChange: (_e, picked) => pick(picked),
      });
    if (mode === "time") {
      openTime(initial);
      return;
    }
    DateTimePickerAndroid.open({
      value: initial,
      mode: "date",
      ...(minimumDate ? { minimumDate } : {}),
      ...(maximumDate ? { maximumDate } : {}),
      onValueChange: (_e, picked) => {
        if (mode === "datetime") {
          const merged = new Date(picked);
          merged.setHours(initial.getHours(), initial.getMinutes(), 0, 0);
          openTime(merged);
        } else {
          pick(picked);
        }
      },
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Button
          testID={testID}
          label={display ?? placeholder}
          variant="secondary"
          accessibilityLabel={`${label}: ${display ?? "not set"}`}
          accessibilityHint={`Opens a ${mode === "time" ? "time" : "date"} picker`}
          onPress={() => (Platform.OS === "android" ? openAndroid() : setOpen((o) => !o))}
          style={styles.flex}
        />
        {onClear && display ? <Button label="Clear" variant="ghost" onPress={onClear} /> : null}
      </View>
      {open && Platform.OS !== "android" ? (
        <View style={[styles.inline, { borderColor: p.border, backgroundColor: p.surface }]}>
          <DateTimePicker
            testID={`${testID}-picker`}
            value={initial}
            mode={mode}
            display={mode === "date" ? "inline" : "spinner"}
            themeVariant={p.scheme}
            accentColor={p.primary}
            {...(minimumDate ? { minimumDate } : {})}
            {...(maximumDate ? { maximumDate } : {})}
            onValueChange={(_e, picked) => pick(picked)}
          />
          <Button label="Done" variant="ghost" onPress={() => setOpen(false)} />
        </View>
      ) : null}
    </View>
  );
}

function clampDate(d: Date, min?: Date, max?: Date): Date {
  if (min && d < min) return min;
  if (max && d > max) return max;
  return d;
}

interface InputProps<F> {
  field: F;
  value: unknown;
  onChange: (value: string | null) => void;
}

export function DateInput({ field, value, onChange }: InputProps<DateField>) {
  const valid = isValidDateString(value);
  return (
    <PickerButton
      testID={`input-${field.key}`}
      label={field.label}
      mode="date"
      date={valid ? dateFromIso(value) : null}
      display={valid ? formatLongDate(value) : null}
      placeholder="Choose a date"
      minimumDate={isValidDateString(field.min) ? dateFromIso(field.min) : undefined}
      maximumDate={isValidDateString(field.max) ? dateFromIso(field.max) : undefined}
      onPick={(d) => onChange(toLocalIsoDate(d))}
      onClear={field.required === true ? null : () => onChange(null)}
    />
  );
}

export function TimeInput({ field, value, onChange }: InputProps<TimeField>) {
  const valid = isValidTimeString(value);
  return (
    <PickerButton
      testID={`input-${field.key}`}
      label={field.label}
      mode="time"
      date={valid ? dateFromClock(value) : null}
      display={valid ? value : null}
      placeholder="Choose a time"
      onPick={(d) => onChange(toLocalClock(d))}
      onClear={field.required === true ? null : () => onChange(null)}
    />
  );
}

export function DateTimeInput({ field, value, onChange }: InputProps<DateTimeField>) {
  const valid = isValidDateTimeString(value);
  return (
    <PickerButton
      testID={`input-${field.key}`}
      label={field.label}
      mode="datetime"
      date={valid ? new Date(value) : null}
      display={valid ? formatDateTimeValue(value) : null}
      placeholder="Choose date and time"
      onPick={(d) => onChange(toLocalIsoWithOffset(d))}
      onClear={field.required === true ? null : () => onChange(null)}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  inline: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: spacing.sm },
});

import type { Ref } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { MIN_TOUCH, radius, spacing, useTheme } from "../../theme";
import { AppText } from "./AppText";

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string | null;
  hint?: string | null;
  /** Shown right of the input, e.g. a unit. */
  suffix?: string | null;
  ref?: Ref<TextInput>;
}

export function TextField({ label, error, hint, suffix, multiline, ref, ...rest }: TextFieldProps) {
  const p = useTheme();
  return (
    <View style={styles.wrap}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.row}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint ?? undefined}
          placeholderTextColor={p.textMuted}
          multiline={multiline}
          {...rest}
          style={[
            styles.input,
            multiline && styles.multiline,
            {
              color: p.text,
              backgroundColor: p.surface,
              borderColor: error ? p.danger : p.border,
            },
          ]}
        />
        {suffix ? (
          <AppText variant="body" tone="muted" style={styles.suffix}>
            {suffix}
          </AppText>
        ) : null}
      </View>
      {hint && !error ? (
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 17,
  },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  suffix: { minWidth: 24 },
});

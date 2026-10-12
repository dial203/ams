import type { ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { Field } from "@ams/shared";
import { spacing } from "../../theme";
import { AppText } from "../ui";
import { stripMarkdown } from "./display";

export interface FieldShellProps {
  field: Field;
  error?: string | null;
  children: ReactNode;
  onLayout?: (e: LayoutChangeEvent) => void;
  /** Extra line under the input (ranges, counters). */
  hint?: string | null;
}

/** Label, "Required" marker, help text and error message around one input. */
export function FieldShell({ field, error, children, onLayout, hint }: FieldShellProps) {
  const required = field.required === true && field.type !== "calculated" && field.type !== "info";
  const help = stripMarkdown(field.help);
  return (
    <View style={styles.field} onLayout={onLayout} testID={`field-${field.key}`}>
      <View style={styles.labelRow}>
        <AppText variant="heading" style={styles.label}>
          {field.label}
        </AppText>
        {required ? (
          <AppText variant="caption" tone="muted">
            Required
          </AppText>
        ) : null}
      </View>
      {help ? (
        <AppText variant="body" tone="muted">
          {help}
        </AppText>
      ) : null}
      {children}
      {hint && !error ? (
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="label" tone="danger" accessibilityLiveRegion="polite" testID={`error-${field.key}`}>
          ⚠ {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  labelRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  label: { flex: 1 },
});

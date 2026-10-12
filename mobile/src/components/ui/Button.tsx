import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { MIN_TOUCH, radius, spacing, useTheme } from "../../theme";
import { AppText } from "./AppText";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const p = useTheme();
  const inactive = disabled || loading;
  const colors = {
    primary: { bg: p.primary, fg: p.primaryText, border: p.primary },
    secondary: { bg: p.surface, fg: p.primary, border: p.border },
    ghost: { bg: "transparent", fg: p.primary, border: "transparent" },
    danger: { bg: p.surface, fg: p.danger, border: p.danger },
  }[variant];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: inactive ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={colors.fg} /> : icon}
        <AppText variant="bodyStrong" style={{ color: colors.fg, textAlign: "center" }}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
});

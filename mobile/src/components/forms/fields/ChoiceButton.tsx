import type { ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { MIN_TOUCH, radius, spacing, useTheme } from "../../../theme";
import { AppText } from "../../ui";

export interface ChoiceButtonProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: "radio" | "checkbox";
  accessibilityLabel?: string;
  /** Larger text for number buttons. */
  emphasis?: boolean;
  align?: "center" | "left";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  disabled?: boolean;
  testID?: string;
}

/** A big, tappable option. Selection is shown by fill, weight and a check mark, not colour alone. */
export function ChoiceButton({
  label,
  selected,
  onPress,
  role = "radio",
  accessibilityLabel,
  emphasis = false,
  align = "center",
  style,
  children,
  disabled = false,
  testID,
}: ChoiceButtonProps) {
  const p = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === "checkbox" ? { checked: selected, disabled } : { selected, checked: selected, disabled }}
      style={({ pressed }) => [
        styles.base,
        align === "left" && styles.left,
        {
          backgroundColor: selected ? p.primary : p.surface,
          borderColor: selected ? p.primary : p.border,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <AppText
        variant={emphasis ? "heading" : "bodyStrong"}
        maxFontSizeMultiplier={emphasis ? 1.6 : undefined}
        style={{ color: selected ? p.primaryText : p.text, textAlign: align === "left" ? "left" : "center" }}
      >
        {selected && !emphasis ? "✓ " : ""}
        {label}
      </AppText>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH + 4,
    minWidth: MIN_TOUCH,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  left: { alignItems: "flex-start" },
});

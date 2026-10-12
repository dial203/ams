import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { radius, spacing, useTheme } from "../../theme";

export interface CardProps extends ViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, style, ...rest }: CardProps) {
  const p = useTheme();
  return (
    <View {...rest} style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});

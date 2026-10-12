import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import { useTheme, type Palette } from "../../theme";

export type TextVariant = "display" | "title" | "heading" | "body" | "bodyStrong" | "label" | "caption";
export type TextTone = "default" | "muted" | "primary" | "danger" | "success" | "warning" | "inverse";

const variants: Record<TextVariant, TextStyle> = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700" },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18 },
};

function toneColor(tone: TextTone, p: Palette): string {
  switch (tone) {
    case "muted":
      return p.textMuted;
    case "primary":
      return p.primary;
    case "danger":
      return p.danger;
    case "success":
      return p.success;
    case "warning":
      return p.warning;
    case "inverse":
      return p.textInverse;
    default:
      return p.text;
  }
}

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
}

/** Text with the app's type scale. Scales with the system font size (Dynamic Type). */
export function AppText({ variant = "body", tone = "default", style, ...rest }: AppTextProps) {
  const p = useTheme();
  const role = variant === "title" || variant === "display" ? "header" : rest.accessibilityRole;
  return (
    <Text
      {...rest}
      accessibilityRole={role}
      style={StyleSheet.flatten([variants[variant], { color: toneColor(tone, p) }, style])}
    />
  );
}

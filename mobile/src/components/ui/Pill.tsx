import { StyleSheet, View } from "react-native";
import { flagColor, type Flag } from "@ams/shared";
import { FLAG_META, radius, spacing, useTheme } from "../../theme";
import { AppText } from "./AppText";

export type PillTone = "neutral" | "success" | "warning" | "danger" | "primary";

/** Small status label. Always has text, so meaning never depends on colour alone. */
export function Pill({ label, tone = "neutral", symbol }: { label: string; tone?: PillTone; symbol?: string }) {
  const p = useTheme();
  const c = {
    neutral: { bg: p.surfaceAlt, fg: p.textMuted },
    success: { bg: p.successSoft, fg: p.success },
    warning: { bg: p.warningSoft, fg: p.warning },
    danger: { bg: p.dangerSoft, fg: p.danger },
    primary: { bg: p.primarySoft, fg: p.primary },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <AppText variant="caption" style={[styles.text, { color: c.fg }]}>
        {symbol ? `${symbol} ` : ""}
        {label}
      </AppText>
    </View>
  );
}

/** Metric flag: colour plus a shape and a word. */
export function FlagBadge({ flag }: { flag: Flag | undefined }) {
  const p = useTheme();
  const color = flagColor(flag);
  const meta = FLAG_META[color];
  return (
    <View
      style={[styles.pill, { backgroundColor: p.surfaceAlt, borderColor: p.flag[color], borderWidth: 1 }]}
      accessibilityLabel={`Flag: ${meta.label}`}
    >
      <AppText variant="caption" style={[styles.text, { color: p.flag[color] }]}>
        {meta.symbol} {meta.label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  text: { fontWeight: "600" },
});

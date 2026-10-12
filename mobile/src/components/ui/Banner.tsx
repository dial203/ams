import { StyleSheet, View } from "react-native";
import { radius, spacing, useTheme } from "../../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

export type BannerTone = "info" | "success" | "warning" | "error";

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void; loading?: boolean };
  testID?: string;
}

const ICONS: Record<BannerTone, string> = { info: "ℹ", success: "✓", warning: "!", error: "!" };

export function Banner({ tone = "info", title, message, action, testID }: BannerProps) {
  const p = useTheme();
  const colors = {
    info: { bg: p.primarySoft, fg: p.text, accent: p.primary },
    success: { bg: p.successSoft, fg: p.text, accent: p.success },
    warning: { bg: p.warningSoft, fg: p.text, accent: p.warning },
    error: { bg: p.dangerSoft, fg: p.text, accent: p.danger },
  }[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "error" || tone === "warning" ? "polite" : "none"}
      style={[styles.banner, { backgroundColor: colors.bg, borderLeftColor: colors.accent }]}
    >
      <View style={styles.row}>
        <AppText
          variant="bodyStrong"
          style={[styles.icon, { color: colors.accent }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {ICONS[tone]}
        </AppText>
        <View style={styles.text}>
          {title ? <AppText variant="bodyStrong">{title}</AppText> : null}
          <AppText variant="body" style={{ color: colors.fg }}>
            {message}
          </AppText>
        </View>
      </View>
      {action ? (
        <Button label={action.label} onPress={action.onPress} loading={action.loading} variant="secondary" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.md, borderLeftWidth: 4, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  icon: { width: 18, textAlign: "center" },
  text: { flex: 1, gap: 2 },
});

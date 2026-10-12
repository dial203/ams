import { ActivityIndicator, StyleSheet, View } from "react-native";
import { describeError } from "../../lib/errors";
import { spacing, useTheme } from "../../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  const p = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={p.primary} size="large" />
      <AppText variant="body" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

export function ErrorState({
  error,
  title = "Couldn't load this",
  onRetry,
  retrying = false,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <AppText variant="heading" style={styles.centerText}>
        {title}
      </AppText>
      <AppText variant="body" tone="muted" style={styles.centerText}>
        {describeError(error)}
      </AppText>
      {onRetry ? <Button label="Try again" onPress={onRetry} loading={retrying} variant="secondary" /> : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.center}>
      <AppText variant="heading" style={styles.centerText}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" tone="muted" style={styles.centerText}>
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  centerText: { textAlign: "center" },
});

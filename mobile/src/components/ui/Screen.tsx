import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { spacing, useTheme } from "../../theme";
import { OfflineBanner } from "./OfflineBanner";

export interface ScreenProps {
  children: ReactNode;
  /** Scrollable content (default true). */
  scroll?: boolean;
  /** Enables pull to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Safe-area edges to pad (screens under a header only need the bottom). */
  edges?: Edge[];
  footer?: ReactNode;
  testID?: string;
}

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  edges = ["top"],
  footer,
  testID,
}: ScreenProps) {
  const p = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: p.background }]} testID={testID}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.primary} />
            ) : undefined
          }
        >
          <OfflineBanner />
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.content]}>
          <OfflineBanner />
          {children}
        </View>
      )}
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
});

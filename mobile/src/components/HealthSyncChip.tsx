import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useHealthStatus } from "../lib/health/HealthContext";
import type { HealthStatus } from "../lib/health/types";
import { MIN_TOUCH } from "../theme";
import { Pill, type PillTone } from "./ui";

export function healthChipState(status: HealthStatus | undefined): { label: string; tone: PillTone; symbol: string } {
  if (!status) return { label: "Health sync…", tone: "neutral", symbol: "○" };
  switch (status.state) {
    case "unavailable":
      return { label: "Health sync needs the development build", tone: "neutral", symbol: "○" };
    case "disconnected":
      return { label: "Health sync off", tone: "neutral", symbol: "○" };
    case "connected":
      if (status.authError) return { label: "Health sync: reconnect needed", tone: "warning", symbol: "!" };
      if (!status.syncActive) return { label: "Health sync paused", tone: "warning", symbol: "‖" };
      if (status.syncing) return { label: "Health sync: syncing…", tone: "primary", symbol: "↻" };
      return { label: "Health sync on", tone: "success", symbol: "✓" };
  }
}

/** Status of Apple Health / Health Connect sync; opens the Devices tab. */
export function HealthSyncChip() {
  const router = useRouter();
  const status = useHealthStatus();
  const chip = healthChipState(status.data);
  return (
    <Pressable
      onPress={() => router.push("/devices")}
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      accessibilityHint="Opens Devices"
      hitSlop={8}
      style={styles.touch}
      testID="health-sync-chip"
    >
      <Pill label={chip.label} tone={chip.tone} symbol={chip.symbol} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { minHeight: MIN_TOUCH - 16, justifyContent: "center", alignSelf: "flex-start" },
});

import { useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@ams/shared";
import { describeError } from "../lib/errors";
import { HealthConnectError, HealthUnavailableError, type HealthStatus, type HealthUnavailableReason } from "../lib/health/types";
import { useHealthAdapter, useHealthStatus } from "../lib/health/HealthContext";
import { haptics } from "../lib/haptics";
import { useActiveMembership } from "../lib/session/membership";
import { spacing } from "../theme";
import { ChoiceButton } from "./forms/fields/ChoiceButton";
import { AppText, Banner, Button, Card, Pill } from "./ui";

const UNAVAILABLE_TEXT: Record<HealthUnavailableReason, string> = {
  "not-installed":
    "This build doesn't include the Open Wearables health SDK. Install the AMS development build to sync your phone's health data.",
  "native-module-missing":
    "Expo Go can't read health data. Install the AMS development build to sync your phone's health data.",
  "unsupported-platform": "Health sync works on iPhone and Android phones.",
};

export function healthStoreName(status: HealthStatus | undefined): string {
  if (status?.state === "connected" && status.provider === "samsung") return "Samsung Health";
  return Platform.OS === "ios" ? "Apple Health" : "Health Connect";
}

/** Apple Health / Health Connect sync through the Open Wearables SDK. */
export function HealthCard() {
  const adapter = useHealthAdapter();
  const health = useHealthStatus();
  const queryClient = useQueryClient();
  const { orgId } = useActiveMembership();
  const [busy, setBusy] = useState<"connect" | "disconnect" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const status = health.data;
  const store = healthStoreName(status);

  const run = async (kind: "connect" | "disconnect" | "resume", task: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await task();
      if (kind === "connect") haptics.success();
    } catch (e) {
      setError(
        e instanceof HealthConnectError || e instanceof HealthUnavailableError ? e.message : describeError(e),
      );
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.self.wearables(orgId) });
    }
  };

  const connect = () => run("connect", () => adapter.connect(orgId, provider ? { provider } : {}));
  const disconnect = () =>
    Alert.alert(`Stop syncing ${store}?`, "Data already synced stays with your team.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => void run("disconnect", () => adapter.disconnect(orgId)) },
    ]);

  return (
    <Card testID="health-card">
      <View style={styles.header}>
        <AppText variant="heading" style={styles.flex}>
          {store}
        </AppText>
        {status?.state === "connected" ? (
          <Pill label={status.syncActive ? "Syncing on" : "Paused"} tone={status.syncActive ? "success" : "warning"} />
        ) : status?.state === "disconnected" ? (
          <Pill label="Not connected" />
        ) : null}
      </View>

      {status?.state === "unavailable" ? (
        <>
          <AppText variant="bodyStrong">Health sync needs the development build</AppText>
          <AppText variant="body" tone="muted">
            {UNAVAILABLE_TEXT[status.reason]}
          </AppText>
        </>
      ) : null}

      {status?.state === "disconnected" ? (
        <>
          <AppText variant="body" tone="muted">
            Share sleep, heart rate, HRV, activity and workouts from {Platform.OS === "ios" ? "Apple Health" : "your phone"} with
            your team. Data goes straight to your team's Open Wearables server.
          </AppText>
          {Platform.OS === "android" && status.providers.filter((p) => p.available).length > 1 ? (
            <View style={styles.providers} accessibilityRole="radiogroup" accessibilityLabel="Health app">
              {status.providers
                .filter((p) => p.available)
                .map((p) => (
                  <ChoiceButton
                    key={p.id}
                    label={p.name}
                    selected={(provider ?? "google") === p.id}
                    onPress={() => setProvider(p.id)}
                    style={styles.flex}
                  />
                ))}
            </View>
          ) : null}
          <Button
            label={`Connect ${provider === "samsung" ? "Samsung Health" : store}`}
            onPress={() => void connect()}
            loading={busy === "connect"}
            testID="health-connect"
          />
        </>
      ) : null}

      {status?.state === "connected" ? (
        <>
          <AppText variant="body" tone="muted">
            {status.syncing
              ? "Syncing now…"
              : !status.initialExportDone
                ? "Uploading your recent history. This can take a while; keep the app open on Wi-Fi."
                : "Up to date. New data syncs in the background."}
            {status.sentCount > 0 ? ` ${status.sentCount} records sent this session.` : ""}
          </AppText>
          {adapter.connectedOrgId() && adapter.connectedOrgId() !== orgId ? (
            <Banner tone="info" message="Health sync is connected for your profile in another organization." />
          ) : null}
          {status.authError ? (
            <Banner
              tone="warning"
              message="Health sync lost its connection to the server."
              action={{ label: "Reconnect", onPress: () => void connect(), loading: busy === "connect" }}
            />
          ) : null}
          {!status.syncActive ? (
            <Button
              label="Resume sync"
              variant="secondary"
              onPress={() => void run("resume", () => adapter.startSync())}
              loading={busy === "resume"}
            />
          ) : null}
          <Button label="Disconnect" variant="danger" onPress={disconnect} loading={busy === "disconnect"} />
        </>
      ) : null}

      {error ? <Banner tone="error" message={error} testID="health-error" /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  providers: { flexDirection: "row", gap: spacing.sm },
});

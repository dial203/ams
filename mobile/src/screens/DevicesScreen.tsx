import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, type WearableConnection, type WearableProvider } from "@ams/shared";
import { HealthCard } from "../components/HealthCard";
import { AppText, Button, Card, EmptyState, ErrorState, LoadingState, Pill, Screen } from "../components/ui";
import { isWearablesNotConfigured } from "../lib/errors";
import { HEALTH_STATUS_KEY } from "../lib/health/HealthContext";
import { formatTimeAgo } from "../lib/format";
import { useNow, useWearableProviders, useWearableStatus } from "../lib/queries";
import { useActiveMembership } from "../lib/session/membership";
import { spacing } from "../theme";

export function providerName(provider: string, providers: WearableProvider[] | undefined): string {
  const match = providers?.find((p) => p.provider === provider);
  if (match) return match.name;
  return provider
    .split(/[_-]/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function connectionPill(status: string): { label: string; tone: "success" | "neutral" | "warning" } {
  if (status === "active") return { label: "Connected", tone: "success" };
  if (status === "revoked" || status === "disconnected") return { label: "Disconnected", tone: "neutral" };
  return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: "warning" };
}

/** `/me/wearables*` answer 503 when the server has no Open Wearables configuration. */
export function WearablesNotConfigured() {
  return (
    <Card testID="wearables-not-configured">
      <AppText variant="bodyStrong">Wearables aren't set up by your organization yet</AppText>
      <AppText variant="body" tone="muted">
        Device connections become available once your staff configure them. Your questionnaires work as usual.
      </AppText>
    </Card>
  );
}

function ConnectionRow({ connection, name, now }: { connection: WearableConnection; name: string; now: number }) {
  const pill = connectionPill(connection.status);
  return (
    <Card testID={`connection-${connection.connection_id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.flex}>
          <AppText variant="heading">{name}</AppText>
          {connection.account_label ? (
            <AppText variant="caption" tone="muted">
              {connection.account_label}
            </AppText>
          ) : null}
        </View>
        <Pill label={pill.label} tone={pill.tone} />
      </View>
      <AppText variant="body" tone="muted">
        {connection.last_synced_at ? `Last synced ${formatTimeAgo(connection.last_synced_at, now)}` : "Waiting for the first sync"}
      </AppText>
      {connection.devices.length > 0 ? (
        <AppText variant="caption" tone="muted">
          Devices: {connection.devices.join(", ")}
        </AppText>
      ) : null}
    </Card>
  );
}

export function DevicesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orgId } = useActiveMembership();
  const now = useNow();
  const status = useWearableStatus();
  const providers = useWearableProviders();
  const connections = useMemo(
    () =>
      (status.data?.connections ?? [])
        .slice()
        .sort((a, b) => Number(b.status === "active") - Number(a.status === "active")),
    [status.data],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.wearables(orgId) });
    void queryClient.invalidateQueries({ queryKey: HEALTH_STATUS_KEY });
  };

  return (
    <Screen onRefresh={refresh} refreshing={status.isRefetching} testID="devices-screen">
      <View>
        <AppText variant="title">Devices</AppText>
        <AppText variant="body" tone="muted">
          Wearables and health apps that share data with your team.
        </AppText>
      </View>

      <HealthCard />

      <AppText variant="heading">Connected devices</AppText>
      {status.isPending ? (
        <LoadingState label="Loading your devices…" />
      ) : status.isError && !status.data && isWearablesNotConfigured(status.error) ? (
        <WearablesNotConfigured />
      ) : status.isError && !status.data ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : connections.length === 0 ? (
        <EmptyState title="No devices connected" message="Connect Garmin, Oura, Whoop, Polar and more." />
      ) : (
        <View style={styles.list}>
          {connections.map((c) => (
            <ConnectionRow key={c.connection_id} connection={c} name={providerName(c.provider, providers.data)} now={now} />
          ))}
        </View>
      )}

      {isWearablesNotConfigured(status.error) && !status.data ? null : (
        <Button label="Connect a device" onPress={() => router.push("/connect-device")} testID="open-connect-device" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.md },
  rowHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
});

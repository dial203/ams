import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, type WearableProvider, type WearableStatus } from "@ams/shared";
import { AppText, Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, type BannerTone } from "../components/ui";
import { useApi } from "../lib/api";
import { describeError, isWearablesNotConfigured } from "../lib/errors";
import { haptics } from "../lib/haptics";
import { useWearableProviders, useWearableStatus } from "../lib/queries";
import { useActiveMembership } from "../lib/session/membership";
import { WearablesNotConfigured } from "./DevicesScreen";
import { radius, spacing, useTheme } from "../theme";

/** Deep link Open Wearables sends the browser back to after the provider's OAuth. */
export const WEARABLE_REDIRECT_PATH = "wearables/connected";

function ProviderIcon({ provider }: { provider: WearableProvider }) {
  const p = useTheme();
  if (provider.icon_url) {
    return <Image source={{ uri: provider.icon_url }} style={styles.icon} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[styles.icon, { backgroundColor: p.primarySoft }]}>
      <AppText variant="heading" tone="primary">
        {provider.name.charAt(0)}
      </AppText>
    </View>
  );
}

/**
 * Cloud wearables (Garmin, Oura, Whoop, Polar, ...): AMS returns the provider's authorization
 * URL from Open Wearables; it opens in an auth session that returns to the app's deep link.
 */
export function ConnectDeviceScreen() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { orgId } = useActiveMembership();
  const providers = useWearableProviders();
  const status = useWearableStatus();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: BannerTone; text: string } | null>(null);

  const cloud = (providers.data ?? []).filter((p) => p.kind === "cloud" && p.enabled);
  const activeProviders = new Set(
    (status.data?.connections ?? []).filter((c) => c.status === "active").map((c) => c.provider),
  );

  const connect = async (provider: WearableProvider, newAccount: boolean) => {
    setConnecting(provider.provider);
    setMessage(null);
    try {
      const redirectUri = Linking.createURL(WEARABLE_REDIRECT_PATH);
      const { authorization_url } = await api.self.connectWearable(orgId, {
        provider: provider.provider,
        redirect_uri: redirectUri,
        ...(newAccount ? { new_account: true } : {}),
      });
      const result = await WebBrowser.openAuthSessionAsync(authorization_url, redirectUri);
      await queryClient.invalidateQueries({ queryKey: queryKeys.self.wearables(orgId) });
      const refreshed = queryClient.getQueryData<WearableStatus>(queryKeys.self.wearables(orgId));
      const connected = refreshed?.connections.some((c) => c.provider === provider.provider && c.status === "active");
      if (result.type === "success" || connected) {
        haptics.success();
        setMessage({ tone: "success", text: `${provider.name} is connected. Data appears after its first sync.` });
      } else {
        setMessage({ tone: "info", text: `${provider.name} wasn't connected. You can try again.` });
      }
    } catch (e) {
      setMessage({
        tone: "error",
        text: isWearablesNotConfigured(e)
          ? "Wearables aren't set up by your organization yet."
          : describeError(e),
      });
    } finally {
      setConnecting(null);
    }
  };

  return (
    <Screen edges={["bottom"]} testID="connect-device-screen">
      <AppText variant="body" tone="muted">
        You'll sign in with the device maker and allow sharing. Apple Health and Health Connect are set up on the
        Devices screen.
      </AppText>
      {message ? <Banner tone={message.tone} message={message.text} testID="connect-message" /> : null}
      {providers.isPending ? (
        <LoadingState label="Loading providers…" />
      ) : providers.isError && !providers.data && isWearablesNotConfigured(providers.error) ? (
        <WearablesNotConfigured />
      ) : providers.isError && !providers.data ? (
        <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
      ) : cloud.length === 0 ? (
        <EmptyState title="No providers available" message="Your team hasn't enabled any wearable providers yet." />
      ) : (
        <View style={styles.list}>
          {cloud.map((provider) => {
            const isConnected = activeProviders.has(provider.provider);
            return (
              <Card key={provider.provider} style={styles.row} testID={`provider-${provider.provider}`}>
                <ProviderIcon provider={provider} />
                <View style={styles.flex}>
                  <AppText variant="heading">{provider.name}</AppText>
                  {isConnected ? (
                    <AppText variant="caption" tone="success">
                      ✓ Connected
                    </AppText>
                  ) : null}
                </View>
                <Button
                  label={isConnected ? "Add account" : "Connect"}
                  variant={isConnected ? "secondary" : "primary"}
                  accessibilityLabel={`${isConnected ? "Add another account for" : "Connect"} ${provider.name}`}
                  onPress={() => void connect(provider, isConnected)}
                  loading={connecting === provider.provider}
                  disabled={connecting !== null && connecting !== provider.provider}
                  testID={`connect-${provider.provider}`}
                />
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1 },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});

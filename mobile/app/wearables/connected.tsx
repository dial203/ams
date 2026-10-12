import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@ams/shared";
import { AppText, Button, Screen } from "../../src/components/ui";
import { useActiveMembership } from "../../src/lib/session/membership";
import { spacing } from "../../src/theme";

/**
 * Redirect target of the wearable OAuth flow (`Linking.createURL("wearables/connected")`).
 * Usually the auth session captures it; when the OS hands the link to the app instead
 * (some Android browsers), this screen confirms and refreshes the connection list.
 */
export default function WearableConnectedRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orgId } = useActiveMembership();
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>();
  const failed = typeof params.error === "string" && params.error !== "";

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.wearables(orgId) });
  }, [queryClient, orgId]);

  return (
    <Screen edges={["bottom"]}>
      <View style={styles.body}>
        <AppText variant="title">{failed ? "Connection failed" : "Device connected"}</AppText>
        <AppText variant="body" tone="muted">
          {failed
            ? (params.error_description ?? "The device maker didn't complete the connection. Please try again.")
            : "Your data appears in AMS after the device's first sync."}
        </AppText>
        <Button label="Back to Devices" onPress={() => router.replace("/devices")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, marginTop: spacing.xl },
});

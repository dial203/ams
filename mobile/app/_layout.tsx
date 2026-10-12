import { useEffect, useRef, useState } from "react";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, useRouter, type Theme } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiContext } from "../src/lib/api";
import { HealthContext } from "../src/lib/health/HealthContext";
import { disablePush, getRegisteredPushToken, refreshPushRegistration } from "../src/lib/push";
import { setupQueryManagers } from "../src/lib/queryClient";
import { createAppServices, StorageContext, type AppServices } from "../src/lib/services";
import { ActiveMembershipContext, type ActiveMembership } from "../src/lib/session/membership";
import { SessionProvider } from "../src/lib/session/SessionProvider";
import { AppGateContext, useAppGate } from "../src/lib/session/useAppGate";
import { palettes } from "../src/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function navigationTheme(scheme: "light" | "dark"): Theme {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const p = palettes[scheme];
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: p.primary,
      background: p.background,
      card: p.surface,
      text: p.text,
      border: p.border,
    },
  };
}

/** Opens a questionnaire when a reminder notification carrying `form_id` is tapped. */
function useNotificationNavigation(enabled: boolean) {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const formId = response.notification.request.content.data?.form_id;
    if (typeof formId === "string" && formId !== "") {
      router.push({ pathname: "/form/[formId]", params: { formId } });
    }
  }, [enabled, response, router]);
}

function RootNavigator({ services }: { services: AppServices }) {
  const gate = useAppGate();
  const [lastMembership, setLastMembership] = useState<ActiveMembership | null>(null);
  const appMembership = gate.kind === "app" ? gate.membership : null;
  // Keep the last membership while screens unmount after sign-out, so they never see null.
  if (appMembership && appMembership !== lastMembership) setLastMembership(appMembership);

  useEffect(() => {
    if (gate.kind !== "loading") void SplashScreen.hideAsync().catch(() => undefined);
  }, [gate.kind]);

  const inApp = gate.kind === "app";
  useEffect(() => {
    if (!inApp) return;
    void services.health.restore();
    void refreshPushRegistration(services.api, services.storage).catch(() => undefined);
  }, [inApp, services]);

  useNotificationNavigation(inApp);

  // While loading, the splash screen stays up; routing as signed-out keeps deep links such
  // as ams://accept-invite intact.
  const view = gate.kind === "loading" ? "signedOut" : gate.kind;

  return (
    <AppGateContext.Provider value={gate}>
      <ActiveMembershipContext.Provider value={appMembership ?? lastMembership}>
        <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
          <Stack.Protected guard={view === "app"}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="form/[formId]" options={{ title: "", headerBackTitle: "Today" }} />
            <Stack.Screen name="connect-device" options={{ title: "Connect a device", presentation: "modal" }} />
            <Stack.Screen name="wearables/connected" options={{ title: "Device connected" }} />
          </Stack.Protected>
          <Stack.Protected guard={view === "selectOrg"}>
            <Stack.Screen name="select-org" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={view === "noAthlete" || view === "accountError"}>
            <Stack.Screen name="account-status" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={view === "signedOut"}>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Screen name="accept-invite" options={{ title: "Invitation" }} />
          <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
        </Stack>
      </ActiveMembershipContext.Provider>
    </AppGateContext.Provider>
  );
}

function createApp() {
  const services = createAppServices();
  return {
    services,
    // Push tokens are removed while the session can still authenticate the DELETE.
    beforeSignOut: async () => {
      if (await getRegisteredPushToken(services.storage)) await disablePush(services.api, services.storage);
    },
    afterSignOut: () => services.health.signOutLocal(),
  };
}

export default function RootLayout() {
  const [{ services, beforeSignOut, afterSignOut }] = useState(createApp);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";

  useEffect(() => setupQueryManagers(), []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navigationTheme(scheme)}>
        <QueryClientProvider client={services.queryClient}>
          <ApiContext.Provider value={services.api}>
            <StorageContext.Provider value={services.storage}>
              <HealthContext.Provider value={services.health}>
                <SessionProvider
                  api={services.api}
                  tokens={services.tokens}
                  storage={services.storage}
                  queryClient={services.queryClient}
                  sessionExpired={services.sessionExpired}
                  beforeSignOut={beforeSignOut}
                  afterSignOut={afterSignOut}
                >
                  <StatusBar style={scheme === "dark" ? "light" : "dark"} />
                  <RootNavigator services={services} />
                </SessionProvider>
              </HealthContext.Provider>
            </StorageContext.Provider>
          </ApiContext.Provider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

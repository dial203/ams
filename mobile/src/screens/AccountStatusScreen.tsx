import { StyleSheet, View } from "react-native";
import { AppText, Button, Screen } from "../components/ui";
import { describeError } from "../lib/errors";
import { useSession } from "../lib/session/SessionProvider";
import { useGate } from "../lib/session/useAppGate";
import { spacing } from "../theme";

/** Shown when the account can't be loaded, or has no athlete profile in any organization. */
export function AccountStatusScreen() {
  const gate = useGate();
  const { signOut } = useSession();

  if (gate.kind === "accountError") {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={styles.body}>
          <AppText variant="title">Couldn't load your account</AppText>
          <AppText variant="body" tone="muted">
            {describeError(gate.error)}
          </AppText>
          <Button label="Try again" onPress={gate.retry} />
          <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
        </View>
      </Screen>
    );
  }

  const name = gate.kind === "noAthlete" ? gate.me.user.full_name : "";
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.body}>
        <AppText variant="title">No athlete profile</AppText>
        <AppText variant="body" tone="muted">
          {name ? `${name}, your` : "Your"} account isn't linked to an athlete profile in any organization. This app is
          for completing your own check-ins; staff use the AMS web app. Ask your staff to send you an athlete invitation.
        </AppText>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, marginTop: spacing.xxl },
});

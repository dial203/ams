import { Pressable, StyleSheet, View } from "react-native";
import { terminology, type Membership } from "@ams/shared";
import { AppText, Button, Screen } from "../components/ui";
import { useSession } from "../lib/session/SessionProvider";
import { useGate } from "../lib/session/useAppGate";
import { MIN_TOUCH, radius, spacing, useTheme } from "../theme";

/** Org picker for users who are an athlete in more than one organization. */
export function SelectOrgScreen() {
  const gate = useGate();
  const { selectOrg, signOut, storedOrgId } = useSession();
  const p = useTheme();
  const memberships: Membership[] = gate.kind === "selectOrg" || gate.kind === "app" ? gate.memberships : [];

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.header}>
        <AppText variant="title">Choose an organization</AppText>
        <AppText variant="body" tone="muted">
          You're a member of several. You can switch later in your profile.
        </AppText>
      </View>
      <View style={styles.list} accessibilityRole="list">
        {memberships.map((m) => {
          const t = terminology(m.org);
          const current = m.org.id === storedOrgId;
          return (
            <Pressable
              key={m.org.id}
              onPress={() => void selectOrg(m.org.id)}
              accessibilityRole="button"
              accessibilityLabel={`${m.org.name}, as ${t.athlete}`}
              accessibilityState={{ selected: current }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: p.surface, borderColor: current ? p.primary : p.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <AppText variant="heading">{m.org.name}</AppText>
              <AppText variant="body" tone="muted">
                {t.athlete}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.xl },
  list: { gap: spacing.md },
  row: { minHeight: MIN_TOUCH + 16, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg, gap: 2 },
});

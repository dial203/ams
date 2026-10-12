import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, Screen } from "../src/components/ui";
import { spacing } from "../src/theme";

export default function NotFoundRoute() {
  const router = useRouter();
  return (
    <Screen edges={["bottom"]}>
      <View style={styles.body}>
        <AppText variant="title">Page not found</AppText>
        <AppText variant="body" tone="muted">
          This link doesn't lead anywhere in the app.
        </AppText>
        <Button label="Go to Today" onPress={() => router.replace("/")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, marginTop: spacing.xl },
});

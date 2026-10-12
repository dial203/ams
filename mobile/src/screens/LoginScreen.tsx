import { useRef, useState } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import { useRouter } from "expo-router";
import { isApiError } from "@ams/shared";
import { AppText, Banner, Button, Screen, TextField } from "../components/ui";
import { serverHost } from "../lib/config";
import { describeError, isNetworkError } from "../lib/errors";
import { useSession } from "../lib/session/SessionProvider";
import { spacing } from "../theme";

export function LoginScreen() {
  const { signIn, expired } = useSession();
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (email.trim() === "" || password === "") {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // The navigator switches to the app once the session is signed in.
    } catch (e) {
      if (isApiError(e) && e.status === 401) setError("Email or password is incorrect.");
      else if (isNetworkError(e)) setError(`Can't reach the AMS server at ${serverHost()}. Check your connection.`);
      else setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.header}>
        <AppText variant="display">AMS</AppText>
        <AppText variant="body" tone="muted">
          Sign in to complete your check-ins and see your trends.
        </AppText>
      </View>
      {expired ? <Banner tone="warning" message="Your session has expired. Please sign in again." /> : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="login-email"
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        testID="login-password"
      />
      {error ? <Banner tone="error" message={error} testID="login-error" /> : null}
      <Button label="Sign in" onPress={() => void submit()} loading={busy} testID="login-submit" />
      <View style={styles.footer}>
        <Button
          label="I have an invitation"
          variant="ghost"
          onPress={() => router.push("/accept-invite")}
          accessibilityHint="Set up your account from an invitation link"
        />
        <AppText variant="caption" tone="muted" style={styles.center}>
          Server: {serverHost()}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.xxl, marginBottom: spacing.lg },
  footer: { gap: spacing.sm, marginTop: spacing.lg },
  center: { textAlign: "center" },
});

import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, queryKeys } from "@ams/shared";
import { AppText, Banner, Button, Card, Screen, TextField } from "../components/ui";
import { useApi } from "../lib/api";
import { APP_VERSION, MIN_PASSWORD_LENGTH, serverHost } from "../lib/config";
import { describeError } from "../lib/errors";
import { PushError, disablePush, enablePush, getRegisteredPushToken } from "../lib/push";
import { useSelfAthlete } from "../lib/queries";
import { useStorage } from "../lib/services";
import { useActiveMembership } from "../lib/session/membership";
import { useSession } from "../lib/session/SessionProvider";
import { useGate, useMeQuery } from "../lib/session/useAppGate";
import { MIN_TOUCH, spacing, useTheme } from "../theme";

const PUSH_KEY = ["ams", "device", "push-token"] as const;

function NameEditor({ current }: { current: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  const mutation = useMutation({
    mutationFn: (fullName: string) => api.me.update({ full_name: fullName }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });
  if (!editing) {
    return (
      <Button
        label="Edit name"
        variant="ghost"
        onPress={() => {
          setName(current);
          setEditing(true);
        }}
      />
    );
  }
  return (
    <View style={styles.form}>
      <TextField label="Full name" value={name} onChangeText={setName} autoComplete="name" />
      {mutation.isError ? <Banner tone="error" message={describeError(mutation.error)} /> : null}
      <View style={styles.row}>
        <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={styles.flex} />
        <Button
          label="Save"
          onPress={() => mutation.mutate(name.trim())}
          disabled={name.trim() === ""}
          loading={mutation.isPending}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

function PasswordForm() {
  const api = useApi();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api.me.update({ password: next, current_password: current }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    },
  });

  const submit = () => {
    setDone(false);
    if (current === "") return setFieldError("Enter your current password.");
    if (next.length < MIN_PASSWORD_LENGTH) return setFieldError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setFieldError("The new passwords don't match.");
    setFieldError(null);
    mutation.mutate();
  };

  // The API answers 403 for a wrong current password (never 401, which would end the session).
  const serverError = mutation.isError
    ? isApiError(mutation.error) && mutation.error.status === 403
      ? "Your current password is incorrect."
      : describeError(mutation.error)
    : null;

  return (
    <View style={styles.form}>
      <TextField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      <TextField
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      />
      <TextField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {fieldError || serverError ? <Banner tone="error" message={(fieldError ?? serverError)!} /> : null}
      {done ? <Banner tone="success" message="Password changed." /> : null}
      <Button label="Change password" variant="secondary" onPress={submit} loading={mutation.isPending} />
    </View>
  );
}

function NotificationsToggle() {
  const api = useApi();
  const storage = useStorage();
  const queryClient = useQueryClient();
  const p = useTheme();
  const registered = useQuery({ queryKey: PUSH_KEY, queryFn: () => getRegisteredPushToken(storage), networkMode: "always" });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (on: boolean) => (on ? enablePush(api, storage) : disablePush(api, storage).then(() => null)),
    onSuccess: (token) => queryClient.setQueryData(PUSH_KEY, token),
    onError: (e) => setError(e instanceof PushError ? e.message : describeError(e)),
  });
  const enabled = Boolean(registered.data);

  return (
    <View style={styles.form}>
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Reminders</AppText>
          <AppText variant="caption" tone="muted">
            Notifications when a questionnaire is due.
          </AppText>
        </View>
        <Switch
          value={mutation.isPending ? mutation.variables === true : enabled}
          onValueChange={(on) => {
            setError(null);
            mutation.mutate(on);
          }}
          disabled={mutation.isPending || registered.isPending}
          accessibilityLabel="Questionnaire reminders"
          trackColor={{ true: p.primary, false: p.border }}
          testID="push-toggle"
        />
      </View>
      {error ? <Banner tone="error" message={error} /> : null}
    </View>
  );
}

export function ProfileScreen() {
  const me = useMeQuery();
  const athlete = useSelfAthlete();
  const gate = useGate();
  const { org, terminology } = useActiveMembership();
  const { signOut, clearOrg } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const memberships = gate.kind === "app" ? gate.memberships : [];

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "Reminders stop and health sync pauses on this phone until you sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setSigningOut(true);
          void signOut();
        },
      },
    ]);

  return (
    <Screen testID="profile-screen">
      <AppText variant="title">Profile</AppText>

      <Card>
        <AppText variant="heading">{me.data?.user.full_name ?? athlete.data?.display_name ?? ""}</AppText>
        <AppText variant="body" tone="muted">
          {me.data?.user.email ?? ""}
        </AppText>
        <View style={styles.kv}>
          <AppText variant="label" tone="muted">
            Organization
          </AppText>
          <AppText variant="body">{org.name}</AppText>
        </View>
        {athlete.data ? (
          <View style={styles.kv}>
            <AppText variant="label" tone="muted">
              {terminology.athlete} code
            </AppText>
            <AppText variant="body">{athlete.data.code}</AppText>
          </View>
        ) : null}
        {me.data ? <NameEditor current={me.data.user.full_name} /> : null}
      </Card>

      <Card>
        <AppText variant="heading">Notifications</AppText>
        <NotificationsToggle />
      </Card>

      <Card>
        <AppText variant="heading">Password</AppText>
        <PasswordForm />
      </Card>

      {memberships.length > 1 ? (
        <Button label="Switch organization" variant="secondary" onPress={() => void clearOrg()} />
      ) : null}
      <Button label="Sign out" variant="danger" onPress={confirmSignOut} loading={signingOut} testID="sign-out" />

      <AppText variant="caption" tone="muted" style={styles.about}>
        AMS {APP_VERSION} · {serverHost()}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.md },
  flex: { flex: 1 },
  kv: { gap: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: MIN_TOUCH },
  about: { textAlign: "center" },
});

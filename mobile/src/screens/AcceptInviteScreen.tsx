import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { isApiError, queryKeys, type OrgRole } from "@ams/shared";
import { AppText, Banner, Button, Card, LoadingState, Screen, TextField } from "../components/ui";
import { useApi } from "../lib/api";
import { MIN_PASSWORD_LENGTH } from "../lib/config";
import { describeError } from "../lib/errors";
import { formatShortDate } from "../lib/format";
import { useSession } from "../lib/session/SessionProvider";
import { spacing } from "../theme";

/** Accepts a bare token or any link carrying `token=...` (ams://accept-invite?token=..., web links). */
export function extractInviteToken(input: string): string {
  const text = input.trim();
  const match = /[?&]token=([^&#\s]+)/.exec(text);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return text;
}

const ROLE_LABELS: Record<OrgRole, string> = { owner: "owner", admin: "admin", staff: "staff member", athlete: "athlete" };

export function AcceptInviteScreen() {
  const api = useApi();
  const router = useRouter();
  const session = useSession();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(() => (typeof params.token === "string" ? extractInviteToken(params.token) : ""));
  const [pasted, setPasted] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ name?: string; password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const invite = useQuery({
    queryKey: queryKeys.invite(token),
    queryFn: ({ signal }) => api.auth.getInvite(token, { signal }),
    enabled: token !== "",
    retry: false,
  });

  const submit = async () => {
    const next: typeof errors = {};
    if (fullName.trim() === "") next.name = "Enter your name.";
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (confirm !== password) next.confirm = "The passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await session.acceptInvite({ token, password, full_name: fullName.trim() });
      setDone(invite.data?.org_name ?? "your team");
    } catch (e) {
      setErrors({
        form:
          isApiError(e) && (e.status === 404 || e.status === 410)
            ? "This invitation is no longer valid. Ask your staff for a new one."
            : describeError(e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={styles.header}>
          <AppText variant="title">You're in</AppText>
          <AppText variant="body" tone="muted">
            Your account for {done} is ready.
          </AppText>
        </View>
        <Button label="Continue" onPress={() => router.replace("/")} testID="invite-continue" />
      </Screen>
    );
  }

  if (token === "") {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={styles.header}>
          <AppText variant="title">Accept an invitation</AppText>
          <AppText variant="body" tone="muted">
            Open the invitation link from your email on this phone, or paste the link here.
          </AppText>
        </View>
        <TextField
          label="Invitation link or code"
          value={pasted}
          onChangeText={setPasted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="invite-link"
        />
        <Button label="Continue" onPress={() => setToken(extractInviteToken(pasted))} disabled={pasted.trim() === ""} />
        <Button label="Back to sign in" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace("/login"))} />
      </Screen>
    );
  }

  if (invite.isPending) return <LoadingState label="Checking your invitation…" />;

  if (invite.isError) {
    const gone = isApiError(invite.error) && (invite.error.status === 404 || invite.error.status === 410);
    return (
      <Screen edges={["top", "bottom"]}>
        <AppText variant="title">Invitation</AppText>
        <Banner
          tone="error"
          message={gone ? "This invitation link is invalid or has expired. Ask your staff to send a new one." : describeError(invite.error)}
          {...(gone ? {} : { action: { label: "Try again", onPress: () => void invite.refetch() } })}
        />
        <Button label="Use another link" variant="secondary" onPress={() => setToken("")} />
      </Screen>
    );
  }

  const details = invite.data;
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.header}>
        <AppText variant="title">Join {details.org_name}</AppText>
        <AppText variant="body" tone="muted">
          You've been invited as {ROLE_LABELS[details.role] ?? details.role}. Set your name and a password to finish.
        </AppText>
      </View>
      {session.status === "signedIn" ? (
        <Banner tone="info" message="You're signed in on this phone. Accepting will sign you in with the invited account." />
      ) : null}
      <Card>
        <AppText variant="label" tone="muted">
          Email
        </AppText>
        <AppText variant="bodyStrong">{details.email}</AppText>
        <AppText variant="caption" tone="muted">
          Invitation valid until {formatShortDate(details.expires_at.slice(0, 10))}
        </AppText>
      </Card>
      <TextField
        label="Your name"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
        error={errors.name}
        testID="invite-name"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errors.password}
        testID="invite-password"
      />
      <TextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.confirm}
        testID="invite-confirm"
      />
      {errors.form ? <Banner tone="error" message={errors.form} /> : null}
      <Button label="Create account" onPress={() => void submit()} loading={busy} testID="invite-submit" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginTop: spacing.xl },
});

import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  calculatedFields,
  isApiError,
  queryKeys,
  type DueForm,
  type FormValues,
  type Submission,
  type SubmissionValidation,
} from "@ams/shared";
import { displayFieldValue, FormWizardView, useFormWizard } from "../components/forms";
import { AppText, Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen } from "../components/ui";
import { useApi } from "../lib/api";
import { describeError, isNetworkError } from "../lib/errors";
import { formatRelativeDay } from "../lib/format";
import { haptics } from "../lib/haptics";
import { useAthleteDay, useSelfAthlete, useTodayForms } from "../lib/queries";
import { useActiveMembership } from "../lib/session/membership";
import { spacing, useTheme } from "../theme";

type SubmitProblem = { kind: "network" | "validation" | "other"; message: string };

function SuccessView({ due, submission, today }: { due: DueForm; submission: Submission; today: string }) {
  const p = useTheme();
  const router = useRouter();
  const athlete = useSelfAthlete();
  const name = athlete.data?.preferred_name || athlete.data?.first_name;
  const results = calculatedFields(due.version.schema)
    .map((f) => ({ field: f, value: submission.computed[f.key] }))
    .filter((r) => r.value !== null && r.value !== undefined);
  return (
    <Screen edges={["bottom"]} testID="submit-success">
      <View style={styles.center}>
        <View style={[styles.check, { backgroundColor: p.success }]} importantForAccessibility="no-hide-descendants">
          <AppText variant="display" tone="inverse">
            ✓
          </AppText>
        </View>
        <AppText variant="title" accessibilityLiveRegion="polite">
          {name ? `Thanks, ${name}!` : "Thanks!"}
        </AppText>
        <AppText variant="body" tone="muted" style={styles.centerText}>
          {due.form.name} saved for {formatRelativeDay(submission.local_date, today).toLowerCase()}.
        </AppText>
      </View>
      {results.length > 0 ? (
        <Card>
          {results.map(({ field, value }) => (
            <View key={field.key} style={styles.resultRow}>
              <AppText variant="body" tone="muted" style={styles.flex}>
                {field.label}
              </AppText>
              <AppText variant="heading">{displayFieldValue(field, value)}</AppText>
            </View>
          ))}
        </Card>
      ) : null}
      <Button label="Back to Today" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="submit-done" />
    </Screen>
  );
}

function ConflictView({ due }: { due: DueForm }) {
  const router = useRouter();
  return (
    <Screen edges={["bottom"]} testID="submit-conflict">
      <View style={styles.center}>
        <AppText variant="title">Already submitted today</AppText>
        <AppText variant="body" tone="muted" style={styles.centerText}>
          {due.form.name} can only be completed once a day, and today's entry is already in.
        </AppText>
      </View>
      <Button label="Back to Today" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </Screen>
  );
}

function QuestionnaireForm({ due, today }: { due: DueForm; today: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { orgId } = useActiveMembership();
  const wizard = useFormWizard(due.version.schema);
  const [problem, setProblem] = useState<SubmitProblem | null>(null);
  // Decided when the form opens: a refetch after submitting must not swap the success screen out.
  const [outcome, setOutcome] = useState<{ kind: "success"; submission: Submission } | { kind: "conflict" } | null>(
    () => (due.completed && !due.form.allow_multiple_per_day ? { kind: "conflict" } : null),
  );

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.self.submit(orgId, { form_id: due.form.id, values }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.forms(orgId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.submissions(orgId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.metrics(orgId) });
  };

  const submit = async (validation: SubmissionValidation) => {
    setProblem(null);
    try {
      // Only visible, non-empty input values; the server recomputes calculated fields.
      const submission = await mutation.mutateAsync(validation.values);
      haptics.success();
      invalidate();
      setOutcome({ kind: "success", submission });
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        invalidate();
        setOutcome({ kind: "conflict" });
        return;
      }
      haptics.error();
      if (isApiError(e) && e.status === 422 && e.fieldErrors) {
        const unknown = wizard.applyServerErrors(e.fieldErrors);
        setProblem({
          kind: "validation",
          message:
            unknown.length > 0
              ? `Some answers were rejected (${unknown.join(", ")}). The form may have changed; go back and reopen it.`
              : "Please check the highlighted answers.",
        });
        return;
      }
      if (isNetworkError(e)) {
        setProblem({
          kind: "network",
          message: "Couldn't send your answers: no connection. They're kept on this screen, so you can retry.",
        });
        return;
      }
      setProblem({ kind: "other", message: describeError(e) });
    }
  };

  usePreventRemove(wizard.dirty && outcome === null && !mutation.isPending, ({ data }) => {
    Alert.alert("Discard your answers?", "They haven't been submitted yet.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  if (outcome?.kind === "success") return <SuccessView due={due} submission={outcome.submission} today={today} />;
  if (outcome?.kind === "conflict") return <ConflictView due={due} />;

  const retry = () => {
    const validation = wizard.validateAll();
    if (validation.ok) void submit(validation);
  };

  return (
    <FormWizardView
      wizard={wizard}
      intro={due.form.description}
      submitting={mutation.isPending}
      onSubmit={(v) => void submit(v)}
      banner={
        problem ? (
          <Banner
            testID="submit-problem"
            tone={problem.kind === "network" ? "warning" : "error"}
            message={problem.message}
            {...(problem.kind === "validation" ? {} : { action: { label: "Retry", onPress: retry, loading: mutation.isPending } })}
          />
        ) : null
      }
    />
  );
}

/** `form/[formId]`: today's questionnaire as a one-section-per-screen wizard. */
export function QuestionnaireScreen({ formId }: { formId: string }) {
  const navigation = useNavigation();
  const { today } = useAthleteDay();
  const forms = useTodayForms(today);
  const due = forms.data?.find((d) => d.form.id === formId);

  useEffect(() => {
    navigation.setOptions({ title: due?.form.name ?? "Questionnaire" });
  }, [navigation, due?.form.name]);

  if (forms.isPending) return <LoadingState label="Loading questionnaire…" />;
  if (!due) {
    if (forms.isError) {
      return (
        <Screen edges={["bottom"]}>
          <ErrorState error={forms.error} onRetry={() => void forms.refetch()} retrying={forms.isRefetching} />
        </Screen>
      );
    }
    return (
      <Screen edges={["bottom"]}>
        <EmptyState title="Form not available" message="This questionnaire isn't available to you today." />
      </Screen>
    );
  }
  // `key` resets the wizard if the form gets a new published version.
  return <QuestionnaireForm key={due.version.id} due={due} today={today} />;
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: spacing.md, marginTop: spacing.xl },
  centerText: { textAlign: "center" },
  check: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1 },
});
